// 외부 출처 지킴이 (11/12, 33 문서 6장 W19 · 7장): 한 곳이 호출 한도에 걸리거나 멈춰도 서비스 전체가 멈추지 않게
// - 출처마다 오늘(한국 날짜) 호출 수 · 실패 수를 센다. 실제 사용이 늘면 한도에 얼마나 가까운지 관리 페이지 「운영」에서 본다
// - 하루 한도가 알려진 출처는 미리 멈춘다: 자동 수집 같은 뒤에서 도는 일(background)은 한도의 80%에서, 사람이 누른 요청은 98%에서
// - 429 · 5xx · 연결 실패면 그 출처를 「언제까지 쉼」으로 두고(Retry-After가 있으면 그 시간), 그동안은 부르지 않고 바로 실패 → 부르는 쪽이 대체 경로로 간다
// - 기록은 서버 메모리. 오늘 숫자는 usage_events(type 'ext')에도 남겨 다시 켜도 이어 센다
import { dbEnabled, query } from './db/index.js'

// 하루 한도 (알려진 것만, 환경 변수로 바꿀 수 있음). 출처: 23 문서
export const SOURCES = {
  'naver-news': { label: '네이버 뉴스 검색', daily: Number(process.env.NAVER_NEWS_DAILY_LIMIT ?? 25_000), restMs: 30 * 60_000, note: '한도는 NAVER_NEWS_DAILY_LIMIT (기본 25,000, API HUB 실제 한도는 콘솔에서 확인)' },
  'naver-datalab': { label: '네이버 데이터랩', daily: Number(process.env.NAVER_DATALAB_DAILY_LIMIT ?? 1_000), restMs: 60 * 60_000, note: '기본 1,000 (NAVER_DATALAB_DAILY_LIMIT)' },
  bigquery: { label: 'Google 특허 (BigQuery)', daily: null, restMs: 60 * 60_000, note: '하루 스캔 50GiB 안 (patents.js가 따로 관리)' },
  openalex: { label: 'OpenAlex', daily: null, restMs: null, note: '하루 예산 — 막히면 논문 출처 사슬이 다음 출처로 (papers/index.js)' },
  crossref: { label: 'Crossref', daily: null, restMs: null, note: '' },
  semanticscholar: { label: 'Semantic Scholar', daily: null, restMs: null, note: '' },
  arxiv: { label: 'arXiv', daily: null, restMs: null, note: '' },
  wikipedia: { label: 'Wikipedia', daily: null, restMs: 10 * 60_000, note: '' },
}

const BG_SHARE = 0.8
const USER_SHARE = 0.98
const state = (globalThis.__sourceGuard ??= { day: null, counts: {}, restUntil: {}, lastError: {}, loaded: false })

const kstDay = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
function today() {
  const d = kstDay()
  if (state.day !== d) Object.assign(state, { day: d, counts: {}, loaded: false })
  return state.counts
}

// 다시 켰을 때 오늘 숫자를 DB에서 한 번 불러온다
async function loadToday() {
  if (state.loaded || !dbEnabled()) return
  state.loaded = true
  try {
    const { rows } = await query(
      `SELECT split_part(detail, ':', 1) AS s, count(*)::int AS n, count(*) FILTER (WHERE detail LIKE '%:fail')::int AS f
         FROM usage_events WHERE type = 'ext' AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') GROUP BY 1`,
    )
    const counts = today()
    for (const r of rows) counts[r.s] = { calls: Math.max(counts[r.s]?.calls ?? 0, r.n), fails: Math.max(counts[r.s]?.fails ?? 0, r.f) }
  } catch (err) {
    console.warn(`[source] 오늘 호출 수를 못 불러옴: ${err.message}`)
  }
}

function record(source, ok) {
  const c = (today()[source] ??= { calls: 0, fails: 0 })
  c.calls += 1
  if (!ok) c.fails += 1
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
  const limit = SOURCES[source]?.daily
  const used = today()[source]?.calls ?? 0
  if (limit && used >= limit * (background ? BG_SHARE : USER_SHARE)) {
    throw new SourceUnavailableError(source, background ? `오늘 호출 ${used}회로 한도(${limit})의 ${BG_SHARE * 100}%에 닿아 자동 작업은 멈춤` : `오늘 호출 ${used}회로 한도(${limit})에 가까움`)
  }
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
  return Object.entries(SOURCES).map(([id, s]) => {
    const c = counts[id] ?? { calls: 0, fails: 0 }
    const until = state.restUntil[id] ?? 0
    return {
      id,
      label: s.label,
      today: c.calls,
      fails: c.fails,
      daily: s.daily,
      usedShare: s.daily ? Math.round((c.calls / s.daily) * 1000) / 10 : null,
      restingUntil: Date.now() < until ? new Date(until).toISOString() : null,
      lastError: state.lastError[id] ?? null,
      note: s.note,
    }
  })
}
