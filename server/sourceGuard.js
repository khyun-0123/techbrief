// 외부 출처 지킴이 (11/12, 33 문서 6장 W19 · 7장): 한 곳이 호출 한도에 걸리거나 멈춰도 서비스 전체가 멈추지 않게
// - 출처마다 오늘(한국 날짜) 호출 수 · 실패 수를 센다. 실제 사용이 늘면 한도에 얼마나 가까운지 관리 페이지 「운영」에서 본다
// - 하루 한도가 알려진 출처는 미리 멈춘다: 자동 수집 같은 뒤에서 도는 일(background)은 한도의 80%에서, 사람이 누른 요청은 98%에서
// - 429 · 5xx · 연결 실패면 그 출처를 「언제까지 쉼」으로 두고(Retry-After가 있으면 그 시간), 그동안은 부르지 않고 바로 실패 → 부르는 쪽이 대체 경로로 간다
// - 기록은 서버 메모리. 오늘 숫자는 usage_events(type 'ext')에도 남겨 다시 켜도 이어 센다
// - 11/13: 한도가 「월」 단위인 출처(네이버 API HUB 콘솔: 뉴스 검색 월 775만 · 검색어 트렌드 월 50만)는 이번 달 호출 수로도 막는다
// - 11/13: BigQuery는 호출 수가 아니라 「읽은 양」이 비용이다 → 쿼리마다 읽은 양을 적고(usage_events 'ext-bytes') 이번 달 합계가
//   무료 1TiB에 가까우면 막는다 (자동 작업 85%, 사람 요청 98%, 기본 한도 1,050GB = BIGQUERY_MONTHLY_GB). 11/11 하루 약 500GB로 무료량을 넘긴 일 (33 문서 W24)
import { dbEnabled, query } from './db/index.js'

// 하루 한도 (알려진 것만, 환경 변수로 바꿀 수 있음). 출처: 23 문서
const envNum = (k, d) => (process.env[k] != null && process.env[k] !== '' ? Number(process.env[k]) : d)
export const SOURCES = {
  // 11/13 API HUB 콘솔 확인: 「NAVER 검색」 월 7,750,000회 · 「검색트렌드」 월 500,000회 (11월 1~12일 사용 1,267 · 579회)
  'naver-news': { label: '네이버 뉴스 검색', daily: envNum('NAVER_NEWS_DAILY_LIMIT', null), monthly: envNum('NAVER_NEWS_MONTHLY_LIMIT', 7_750_000), restMs: 30 * 60_000, note: '월 7,750,000회 (API HUB 콘솔, NAVER_NEWS_MONTHLY_LIMIT)' },
  'naver-datalab': { label: '네이버 데이터랩', daily: envNum('NAVER_DATALAB_DAILY_LIMIT', null), monthly: envNum('NAVER_DATALAB_MONTHLY_LIMIT', 500_000), restMs: 60 * 60_000, note: '월 500,000회 (API HUB 콘솔, NAVER_DATALAB_MONTHLY_LIMIT)' },
  bigquery: { label: 'Google 특허 (BigQuery)', daily: null, monthlyGB: envNum('BIGQUERY_MONTHLY_GB', 1_050), restMs: 60 * 60_000, note: '이번 달 읽은 양 기준 (무료 1TiB ≈ 1,100GB, BIGQUERY_MONTHLY_GB) · 하루 할당량 51GiB는 Google 콘솔' },
  openalex: { label: 'OpenAlex', daily: null, restMs: null, note: '하루 예산 — 막히면 논문 출처 사슬이 다음 출처로 (papers/index.js)' },
  crossref: { label: 'Crossref', daily: null, restMs: null, note: '' },
  semanticscholar: { label: 'Semantic Scholar', daily: null, restMs: null, note: '' },
  arxiv: { label: 'arXiv', daily: null, restMs: null, note: '' },
  kci: { label: 'KCI 국내 논문', daily: envNum('KCI_DAILY_LIMIT', null), restMs: 30 * 60_000, note: '한도는 공식 페이지에 안 적힘 (공공데이터포털 개발 단계 5,000회 · 23 문서) — 알면 KCI_DAILY_LIMIT' },
  scienceon: { label: 'ScienceON 국내 논문 (KISTI)', daily: envNum('SCIENCEON_DAILY_LIMIT', 1_000), restMs: 30 * 60_000, note: '한도는 매뉴얼에 숫자가 없음 — 대량 · 짧은 시간 과다 요청은 이용 제한(매뉴얼 v2.6), 우리 기본 하루 1,000회 (SCIENCEON_DAILY_LIMIT)' },
  wikipedia: { label: 'Wikipedia', daily: null, restMs: 10 * 60_000, note: '' },
}

const BG_SHARE = 0.8
const USER_SHARE = 0.98
const BQ_BG_SHARE = 0.85 // BigQuery 자동 작업은 월 한도의 85%(약 900GB)에서 멈춤
const state = (globalThis.__sourceGuard ??= { day: null, counts: {}, restUntil: {}, lastError: {}, loaded: false })
state.month ??= { ym: null, counts: {}, bytes: {} }

const kstDay = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
function today() {
  const d = kstDay()
  if (state.day !== d) Object.assign(state, { day: d, counts: {}, loaded: false })
  const ym = d.slice(0, 7)
  if (state.month.ym !== ym) state.month = { ym, counts: {}, bytes: {} }
  return state.counts
}
const monthOf = () => (today(), state.month)

// 다시 켰을 때 오늘 숫자를 DB에서 한 번 불러온다
async function loadToday() {
  if (!dbEnabled()) return
  today()
  const m = state.month
  if (state.loaded && m.loaded) return
  const needDay = !state.loaded
  state.loaded = true
  m.loaded = true
  try {
    if (needDay) {
      const { rows } = await query(
        `SELECT split_part(detail, ':', 1) AS s, count(*)::int AS n, count(*) FILTER (WHERE detail LIKE '%:fail')::int AS f
           FROM usage_events WHERE type = 'ext' AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') GROUP BY 1`,
      )
      const counts = today()
      for (const r of rows) counts[r.s] = { calls: Math.max(counts[r.s]?.calls ?? 0, r.n), fails: Math.max(counts[r.s]?.fails ?? 0, r.f) }
    }
    // 이번 달 (한국 날짜 기준 달): 호출 수 · BigQuery 읽은 양. 달이 바뀌면 today()가 새로 만들어 다시 불러온다
    const monthStart = `(date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`
    const calls = await query(`SELECT split_part(detail, ':', 1) AS s, count(*)::int AS n FROM usage_events WHERE type = 'ext' AND created_at >= ${monthStart} GROUP BY 1`)
    for (const r of calls.rows) m.counts[r.s] = Math.max(m.counts[r.s] ?? 0, r.n)
    const bytes = await query(`SELECT split_part(detail, ':', 1) AS s, sum(split_part(detail, ':', 2)::bigint)::text AS b FROM usage_events WHERE type = 'ext-bytes' AND created_at >= ${monthStart} GROUP BY 1`)
    for (const r of bytes.rows) m.bytes[r.s] = Math.max(m.bytes[r.s] ?? 0, Number(r.b))
  } catch (err) {
    console.warn(`[source] 오늘 · 이번 달 호출 수를 못 불러옴: ${err.message}`)
  }
}

function record(source, ok) {
  const c = (today()[source] ??= { calls: 0, fails: 0 })
  c.calls += 1
  if (!ok) c.fails += 1
  const m = monthOf()
  m.counts[source] = (m.counts[source] ?? 0) + 1
  if (dbEnabled()) query("INSERT INTO usage_events (type, detail) VALUES ('ext', $1)", [`${source}:${ok ? 'ok' : 'fail'}`]).catch(() => {})
}

export class SourceUnavailableError extends Error {
  constructor(source, why, until = null) {
    super(`${SOURCES[source]?.label ?? source}: ${why}`)
    this.name = 'SourceUnavailableError'
    this.source = source
    this.until = until
    this.status = 503
    this.unavailable = true
  }
}

// 부르기 전에: 쉬는 중이거나 오늘 한도에 가까우면 부르지 않는다
export async function checkSource(source, { background = false } = {}) {
  await loadToday()
  const until = state.restUntil[source] ?? 0
  if (Date.now() < until) throw new SourceUnavailableError(source, `잠시 쉬는 중 (${new Date(until).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}까지)`, until)
  const share = background ? BG_SHARE : USER_SHARE
  const limit = SOURCES[source]?.daily
  const used = today()[source]?.calls ?? 0
  if (limit && used >= limit * share) {
    throw new SourceUnavailableError(source, background ? `오늘 호출 ${used}회로 하루 한도(${limit})의 ${BG_SHARE * 100}%에 닿아 자동 작업은 멈춤` : `오늘 호출 ${used}회로 하루 한도(${limit})에 가까움`)
  }
  const monthly = SOURCES[source]?.monthly
  const usedMonth = monthOf().counts[source] ?? 0
  if (monthly && usedMonth >= monthly * share) {
    throw new SourceUnavailableError(source, background ? `이번 달 호출 ${usedMonth.toLocaleString()}회로 월 한도(${monthly.toLocaleString()})의 ${BG_SHARE * 100}%에 닿아 자동 작업은 멈춤` : `이번 달 호출이 월 한도(${monthly.toLocaleString()})에 가까움`)
  }
  const gb = SOURCES[source]?.monthlyGB
  if (gb) {
    const usedGB = (monthOf().bytes[source] ?? 0) / 1e9
    const cap = gb * (background ? BQ_BG_SHARE : USER_SHARE)
    if (usedGB >= cap) {
      throw new SourceUnavailableError(source, `이번 달 읽은 양 ${Math.round(usedGB)}GB로 무료량 기준(${gb}GB)의 ${Math.round((background ? BQ_BG_SHARE : USER_SHARE) * 100)}%에 닿아 ${background ? '자동 작업은 멈춤' : '멈춤 — 다음 달 1일에 다시'} (크레딧이 나가지 않게)`)
    }
  }
}

// BigQuery: 쿼리 하나가 읽은 양을 적는다 (응답의 totalBytesProcessed). 이번 달 합계로 checkSource가 막는다
export function reportBytes(source, bytes) {
  const n = Math.round(Number(bytes) || 0)
  if (n <= 0) return
  const m = monthOf()
  m.bytes[source] = (m.bytes[source] ?? 0) + n
  if (dbEnabled()) query("INSERT INTO usage_events (type, detail) VALUES ('ext-bytes', $1)", [`${source}:${n}`]).catch(() => {})
}

// 부른 뒤에: 성공 · 실패를 적고, 한도 · 서버 오류면 쉬게 한다
export function reportSource(source, { ok, status = null, retryAfterSec = null, error = null } = {}) {
  record(source, ok)
  if (ok) return
  state.lastError[source] = { at: new Date().toISOString(), status, message: String(error ?? '').slice(0, 160) }
  const rest = SOURCES[source]?.restMs
  const limited = status === 429 || (status != null && status >= 500) || status === 'network'
  if (rest && limited) state.restUntil[source] = Date.now() + (retryAfterSec > 0 ? retryAfterSec * 1000 : rest)
}

// fetch 한 번을 지켜서 부른다 (출처 하나에 fetch 하나인 곳용)
export async function guardedFetch(source, url, init = {}, { background = false } = {}) {
  await checkSource(source, { background })
  let res
  try {
    res = await fetch(url, init)
  } catch (err) {
    reportSource(source, { ok: false, status: err.name === 'TimeoutError' ? 'network' : 'network', error: err.message })
    throw err
  }
  const retry = Number(res.headers.get('retry-after'))
  reportSource(source, { ok: res.ok, status: res.ok ? null : res.status, retryAfterSec: Number.isFinite(retry) ? retry : null, error: res.ok ? null : `응답 ${res.status}` })
  return res
}

// 관리 페이지 「운영」 · /api/health
export async function sourceStatus() {
  await loadToday()
  const counts = today()
  const m = monthOf()
  return Object.entries(SOURCES).map(([id, s]) => {
    const c = counts[id] ?? { calls: 0, fails: 0 }
    const until = state.restUntil[id] ?? 0
    const month = m.counts[id] ?? 0
    const gb = s.monthlyGB ? Math.round(((m.bytes[id] ?? 0) / 1e9) * 10) / 10 : null
    return {
      id,
      label: s.label,
      today: c.calls,
      fails: c.fails,
      daily: s.daily,
      month,
      monthly: s.monthly ?? null,
      monthGB: gb,
      monthlyGB: s.monthlyGB ?? null,
      // 한도 대비 % (하루 · 월 · 읽은 양 중 가장 높은 것)
      usedShare: Math.max(
        s.daily ? Math.round((c.calls / s.daily) * 1000) / 10 : 0,
        s.monthly ? Math.round((month / s.monthly) * 1000) / 10 : 0,
        s.monthlyGB ? Math.round((gb / s.monthlyGB) * 1000) / 10 : 0,
      ) || null,
      restingUntil: Date.now() < until ? new Date(until).toISOString() : null,
      lastError: state.lastError[id] ?? null,
      note: s.note,
    }
  })
}
