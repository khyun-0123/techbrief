// 자동 최신화: 등록 키워드로 기사를 모으고, 중요한 기사 몇 건은 미리 요약해 둔다
// - 주기: 꺼짐(기본) / 매일 정해진 시각 / N시간마다. 「지금 최신화」로 바로 실행할 수도 있다
// - 최신화가 끝나면 제목에 키워드가 있는 새 기사를 전부 자동 요약 대기열에 넣는다 (아래 '자동 요약 대기열')
// - 팀원마다 자기 포트로 앱을 켜도 DB는 같이 쓴다 → DB 잠금으로 한 곳에서만 실행한다
// - 앱(npm run dev)이 켜져 있을 때만 돈다. 꺼져 있던 동안 지난 예정은 켜진 뒤 한 번 따라잡는다
import { collect, listArticles } from './collector/index.js'
import { importanceRule } from './importanceRule.js'
import { db, dbEnabled, query } from './db/index.js'
import { getKeywords, getSetting, getSummaries, setSetting } from './db/store.js'
import { pingModel, PRIORITY, queueStatus, withQueueContext } from './llm/client.js'
import { isOutdatedSummary, summarizeArticle } from './summarize.js'
import { aiPaused } from './ops.js'
import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'
import pg from 'pg'

const SETTINGS_KEY = 'refresh_settings'
const STATE_KEY = 'refresh_state'
const LOCK_ID = 5_0505 // pg_advisory_lock 번호 (이 앱 전용)
const TICK_MS = 60_000
const STALE_MS = 30 * 60_000 // 실행 중 표시가 이보다 오래되면 중간에 꺼진 것으로 본다
const KST = 9 * 3600_000 // 한국 시간 (서머타임 없음)

export const HOUR_OPTIONS = [1, 2, 3, 4, 6, 8, 12]
// autoSummary: 자동 요약 켜기/끄기. all(관련도 낮음을 뺀 기사 전부, 중요도 높은 순) / off(직접 누를 때만)
// 개발 중에는 off로 두고, 시연·테스트 때 all로 켠다
export const AUTO_SUMMARY_OPTIONS = ['all', 'off']
const DEFAULT_SETTINGS = { mode: 'off', time: '06:00', hours: 2, autoSummary: 'off', summaryDays: 7, naverKeepDays: 0 }
// 네이버로 모은 기사 보관 (11/17 조장 · 37 문서 Q6): 21 = 21일 지나면 지움(네이버 이용 조건, 23 문서) · 0 = 지우지 않음(1년 뒤 정리, 예전 그대로)
// 1·2차 출처(RSS)는 네이버가 아니라 원래 사이트에서 받으므로 해당 없음. 요약된 기사는 보고서 근거라 남긴다
export const NAVER_KEEP_OPTIONS = [21, 0]
// 자동 요약할 기사 기간 (관리자, 11/08). 기사(네이버 · 전문매체)만. 네이버 검색 결과 보관 21일(23 문서) 안에서 고른다
// 논문은 기간 기준이 달라 따로 둔다 (지금은 7일 고정, PAPER_SUMMARY_DAYS)
export const SUMMARY_DAY_OPTIONS = [3, 7, 14, 21]
const PAPER_SUMMARY_DAYS = 7
const isPaper = (a) => String(a.section ?? '').startsWith('feed:crossref')

// ── 수집 담당 앱 (11/15) ──
// REFRESH_SCHEDULER: leader(잠금을 늘 쥐고 혼자 수집) | on(예전처럼 잠금을 잡은 앱이 수집) | off(이 앱은 수집 · 자동 요약 안 함)
// 기본값: 공용 서버(npm run serve, 3038)는 leader, 나머지(npm run dev)는 on
// 왜: 예전 코드로 켜 둔 팀원 앱이 같은 DB 잠금(50505)을 먼저 잡아, 옛 코드로 수집해 RSS · 자동 요약이 빠졌다.
// 3038이 잠금을 전용 연결로 늘 쥐고 있으면 다른 앱은 잠금을 못 잡아 건너뛴다 (다른 앱의 DB 연결 수 자체는 줄지 않음)
export function schedulerMode() {
  const v = String(process.env.REFRESH_SCHEDULER ?? '').trim().toLowerCase()
  if (['leader', 'on', 'off'].includes(v)) return v
  return process.env.TECHBRIEF_SUPERVISED === '1' ? 'leader' : 'on'
}

// 전용 연결 하나로 수집 잠금(LOCK_ID) · 자동 요약 잠금(LOCK_ID + 1)을 쥔다. 풀(최대 5)에서 빌리지 않는다
// Vite가 서버 코드만 다시 읽어도 연결이 남도록 globalThis에 둔다. 연결이 끊기면 PG가 잠금을 풀고, 다음 확인(1분) 때 다시 잡는다
const leader = (globalThis.__techbriefLeader ??= { client: null, held: false, since: null, error: null, connecting: false })
export const leaderHolds = () => leader.held && Boolean(leader.client)

// 배경 작업(요즘 뜨는 기술 · 논문 DB · 시계열 미리 분석 · 자동 요약 현황 저장)을 이 앱이 해도 되는지 (11/17, 36 문서 2-2)
// 예전: 수집만 담당 앱이 하고 나머지는 켜진 앱마다 돌아, 팀원 앱이 AI · OpenAlex 한도를 같이 쓰고 같은 저장값(tech_trends 등)을 덮어쓸 수 있었다
// - off: 안 함 · leader: 수집 잠금을 쥐었을 때만 · on(팀원 개발 앱): 다른 앱이 수집 잠금을 쥐고 있으면 그 앱에 맡김
// 관리 페이지에서 사람이 바로 돌리는 것(지금 갱신 · 미리 분석)은 막지 않는다
export async function backgroundAllowed() {
  const mode = schedulerMode()
  if (mode === 'off') return false
  if (!dbEnabled() || leaderHolds()) return true
  if (mode === 'leader') return false
  const { rows } = await query(`SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND objsubid = 1 AND granted LIMIT 1`, [LOCK_ID]).catch(() => ({ rows: [] }))
  return rows.length === 0
}

async function ensureLeaderLock() {
  if (schedulerMode() !== 'leader' || !dbEnabled() || leader.held || leader.connecting) return
  leader.connecting = true
  let client = null
  try {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: `techbrief-leader:${process.env.PORT ?? ''}` })
    client.on('error', (err) => dropLeader(client, err))
    client.on('end', () => dropLeader(client))
    await client.connect()
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS a, pg_try_advisory_lock($2) AS b', [LOCK_ID, LOCK_ID + 1])
    if (rows[0].a && rows[0].b) {
      Object.assign(leader, { client, held: true, since: new Date().toISOString(), error: null })
      console.log('[refresh] 수집 잠금을 쥐었어요 (이 앱이 수집 · 자동 요약 담당)')
      client = null
    } else {
      // 다른 앱이 지금 잡고 있다 (실행 중). 그 실행이 끝나면 다음 확인 때 잡는다
      leader.error = '다른 앱이 잠금을 쥐고 있어 기다리는 중'
    }
  } catch (err) {
    leader.error = err.message
  } finally {
    leader.connecting = false
    if (client) client.end().catch(() => {})
  }
}

function dropLeader(client, err) {
  if (leader.client !== client) return
  Object.assign(leader, { client: null, held: false, since: null, error: err ? `잠금 연결 끊김: ${err.message}` : '잠금 연결 끊김' })
  console.warn(`[refresh] ${leader.error} · 1분 안에 다시 잡아요`)
}

// 어느 앱 · 어느 코드가 돌렸는지 (실행 기록 · 관리 페이지)
function runnerInfo() {
  const git = (...args) => {
    try {
      return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      return null
    }
  }
  return {
    host: hostname(),
    port: process.env.PORT ?? null,
    pid: process.pid,
    mode: schedulerMode(),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    commit: git('rev-parse', '--short', 'HEAD'),
  }
}

let memoryKeywords = [] // DB가 없을 때 마지막으로 받은 키워드
let localRun = null // 이 프로세스에서 도는 실행 { promise, progress }

export function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input }
  return {
    mode: ['off', 'daily', 'interval'].includes(s.mode) ? s.mode : 'off',
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) ? s.time : DEFAULT_SETTINGS.time,
    hours: HOUR_OPTIONS.includes(Number(s.hours)) ? Number(s.hours) : DEFAULT_SETTINGS.hours,
    autoSummary: AUTO_SUMMARY_OPTIONS.includes(s.autoSummary) ? s.autoSummary : DEFAULT_SETTINGS.autoSummary,
    summaryDays: SUMMARY_DAY_OPTIONS.includes(Number(s.summaryDays)) ? Number(s.summaryDays) : DEFAULT_SETTINGS.summaryDays,
    naverKeepDays: NAVER_KEEP_OPTIONS.includes(Number(s.naverKeepDays)) ? Number(s.naverKeepDays) : DEFAULT_SETTINGS.naverKeepDays,
    enabledAt: s.enabledAt ?? null, // 켠 시각. 켜기 전에 지난 예정은 따라잡지 않는다
  }
}

// 다음 예정 시각. 지난 예정을 아직 안 했으면 지금 바로 (따라잡기)
export function nextRunAt(settings, lastRunAt, now = Date.now()) {
  const last = Math.max(lastRunAt ? Date.parse(lastRunAt) : 0, settings.enabledAt ? Date.parse(settings.enabledAt) : 0)
  if (settings.mode === 'interval') {
    return new Date(Math.max(now, last + settings.hours * 3600_000))
  }
  if (settings.mode === 'daily') {
    const [h, m] = settings.time.split(':').map(Number)
    const kstNow = new Date(now + KST)
    let slot = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate(), h, m) - KST
    if (slot > now) slot -= 24 * 3600_000 // 오늘 시각이 아직이면 직전 예정은 어제
    if (last < slot) return new Date(now) // 직전 예정을 놓쳤다
    return new Date(slot + 24 * 3600_000)
  }
  return null
}

async function loadState() {
  return getSetting(STATE_KEY, {})
}

// 대기열 보기: 자동 요약 대기열 요약 (남은 수 · 지금 요약 중인 기사)
export function backlogBrief() {
  return { remaining: backlog.length, important: backlog.filter((b) => b.important).length, current: stats.current, next: backlog.slice(0, 5).map((b) => b.article.title) }
}

export async function refreshStatus() {
  const settings = normalizeSettings(await getSetting(SETTINGS_KEY, {}))
  const state = await loadState()
  const running = Boolean(state.running && Date.now() - Date.parse(state.running.updatedAt ?? state.running.startedAt) < STALE_MS)
  const next = nextRunAt(settings, state.lastRunAt)
  return {
    settings,
    hourOptions: HOUR_OPTIONS,
    running: running ? state.running : null,
    queue: queueStatus(),
    backlog: await getSetting(BACKLOG_KEY, null), // 자동 요약 대기열 { remaining, important, current, done, failed, preempted, note }
    lastRunAt: state.lastRunAt ?? null,
    lastResult: state.lastResult ?? null,
    nextRunAt: next ? next.toISOString() : null,
    // 이 앱(지금 응답하는 앱)의 수집 담당 상태
    scheduler: { mode: schedulerMode(), leader: leaderHolds(), since: leader.since, error: leaderHolds() ? null : leader.error },
  }
}

// 자동 최신화 설정(자동 요약 켜기/끄기 포함)은 관리자만 바꾼다 — 권한 확인은 API(server/index.js)에서 (17 문서)
// 「지금 최신화」는 누구나 누를 수 있다 (일반 사용자는 10분에 한 번)
export async function saveRefreshSettings(input) {
  const before = normalizeSettings(await getSetting(SETTINGS_KEY, {}))
  const settings = normalizeSettings({ ...input, enabledAt: before.enabledAt })
  // 꺼짐→켜짐이거나 주기를 바꾸면 지금부터 센다
  if (settings.mode !== 'off' && (settings.mode !== before.mode || settings.time !== before.time || settings.hours !== before.hours)) {
    settings.enabledAt = new Date().toISOString()
  }
  await setSetting(SETTINGS_KEY, settings)
  // 자동 요약을 켜거나 끄거나 기간을 바꾸면 대기열을 바로 다시 짠다 (꺼짐이면 지금 요약 중인 1건까지만 하고 멈춤)
  if (settings.autoSummary !== before.autoSummary || settings.summaryDays !== before.summaryDays) {
    await setBacklog(await buildBacklog())
  }
  return refreshStatus()
}

// 자동 요약 대상 (11/08 조장: 「중요도 높은 것만」이 아니라 「중요도 높은 순으로 전부」)
// 관련도 「낮음」(주식 · 판촉 등 주제 밖, 화면에서 기본으로 숨김)만 빼고 나머지 전부를 중요도 순으로 요약한다
// 예전: 제목에 키워드가 있는 이슈(관련도 high)만 → 101건을 다 하면 멈췄음
// 11/09 조장: 논문은 초록이 첫 요약 역할을 하므로 자동 요약하지 않는다 (쓸 논문만 사람이 눌러 원문 기반으로 요약 · 분석)
function autoSummaryTarget(article) {
  return article.relevance !== 'low' && !isPaper(article)
}

// ── 찾기 결과 자동 요약 (11/09 조장: 등록 키워드가 아니어도 기술 분야에서 중요하다고 판단된 기사는 자동 요약) ──
// 「뉴스·논문에서 찾기」 결과 중 「중요」(관리 페이지 기준, 기본 45점 이상, 11/09 재설계 점수: 신규성 · 사업 연관성 · 출처 신뢰도 위주) 뉴스를
// 중요도 순으로 SEARCH_PICK건까지 자동 요약 대기열에 넣는다. 사람이 누른 요약이 늘 먼저다 (BACKGROUND). 자동 요약이 꺼져 있으면 넣지 않는다
// 찾기 결과는 DB에 쌓지 않으므로 대기열을 다시 짤 때 사라지지 않게 따로 들고 있다가, 요약되면 뺀다
const SEARCH_MIN = () => importanceRule().high // 관리 페이지 「중요도 기준」 (11/15)
const SEARCH_PICK = 15 // 한 번 찾기에서 넣는 최대 건수
const SEARCH_QUEUE_MAX = 30 // 들고 있는 최대 건수
const searchExtras = (globalThis.__searchSummaryExtras ??= new Map()) // id → { article, important: true }
export async function queueSearchSummaries(articles) {
  const { autoSummary } = normalizeSettings(await getSetting(SETTINGS_KEY, {}))
  if (autoSummary === 'off') return 0
  const picked = articles
    .filter((a) => !a.paper && !a.summaryId && (a.importance ?? 0) >= SEARCH_MIN() && a.relevance !== 'low')
    .sort((x, y) => (y.importance ?? 0) - (x.importance ?? 0))
    .slice(0, SEARCH_PICK)
  const done = await getSummaries(picked.map((a) => a.id))
  const fresh = picked.filter((a) => !done[a.id] && !searchExtras.has(a.id) && !backlog.some((b) => b.article.id === a.id))
  for (const a of fresh) searchExtras.set(a.id, { article: a, important: true, fromSearch: true })
  while (searchExtras.size > SEARCH_QUEUE_MAX) searchExtras.delete(searchExtras.keys().next().value)
  if (!fresh.length) return 0
  // 대기열에서 중요도 자리를 찾아 끼워 넣는다
  await setBacklog(sortBacklog([...backlog, ...fresh.map((a) => searchExtras.get(a.id))]))
  return fresh.length
}
// 다시 만들 예전 요약(redo)은 아직 요약 안 된 기사 다음에 (11/17)
const sortBacklog = (list) =>
  list.sort(
    (x, y) =>
      Number(Boolean(x.redo)) - Number(Boolean(y.redo)) ||
      (y.article.importance ?? 0) - (x.article.importance ?? 0) ||
      y.article.publishedAt.localeCompare(x.article.publishedAt),
  )

// ── 자동 요약 대기열 ──
// 최신화가 끝나면 아직 요약 안 된 기사(관련도 낮음을 뺀 이슈, 최근 7일)를 전부 대기열에 넣고
// 뒤에서 한 건씩 요약한다. 최신화와 따로 돌아서, 다음 최신화 때 새 기사를 반영해 순서를 다시 짠다
// 순서: 목록과 같은 중요도 점수(collector/score.js)가 높은 것부터, 같으면 최신부터. 최신성은 점수 안에 들어 있다
const WORKER_LOCK_ID = LOCK_ID + 1 // 팀원 앱 여러 개가 같은 DB를 쓰면 한 곳에서만 요약한다
const BACKLOG_KEY = 'summary_backlog'

// 패널의 '중요 N건' 표시: 대상 기사(이미 요약된 것 포함) 중 점수 상위 20%
// 남은 기사 안에서 매번 다시 자르면 기준이 계속 내려간다
const IMPORTANT_SHARE = 0.2

// 대상 기간: 기사는 관리자가 정한 기간(summaryDays), 논문은 7일. 넘겨받은 목록(화면 기간 7일) 대신 그 기간으로 다시 불러온다
async function buildBacklog() {
  const { autoSummary, summaryDays } = normalizeSettings(await getSetting(SETTINGS_KEY, {}))
  if (autoSummary === 'off') return []
  const { articles } = await listArticles({ days: Math.max(summaryDays, PAPER_SUMMARY_DAYS) })
  const since = (days) => Date.now() - days * 86_400_000
  const candidates = articles.filter(
    (a) => autoSummaryTarget(a) && Date.parse(a.publishedAt) >= since(isPaper(a) ? PAPER_SUMMARY_DAYS : summaryDays),
  )
  const done = await getSummaries([...candidates.map((a) => a.id), ...searchExtras.keys()])
  const scores = candidates.map((a) => a.importance ?? 0).sort((x, y) => y - x)
  const cut = Math.max(1, scores[Math.floor(scores.length * IMPORTANT_SHARE)] ?? Infinity)
  // 찾기 결과에서 넣어 둔 기사: 이미 요약됐으면 빼고 나머지는 같이 줄 세운다
  for (const id of [...searchExtras.keys()]) if (done[id]) searchExtras.delete(id)
  const ids = new Set(candidates.map((a) => a.id))
  // 11/17: 예전 모양 요약(11/07 전, 예전 앱이 만든 것)도 다시 만든다 — 새 기사 요약을 다 한 뒤에 (sortBacklog)
  const redo = (a) => Boolean(done[a.id]) && isOutdatedSummary(done[a.id].summary)
  return sortBacklog([
    ...candidates.filter((a) => !done[a.id] || redo(a)).map((a) => ({ article: a, important: (a.importance ?? 0) >= cut, ...(redo(a) ? { redo: true } : {}) })),
    ...[...searchExtras.values()].filter((e) => !ids.has(e.article.id)),
  ])
}

let backlog = [] // [{ article, important }] 중요도 점수 순
let worker = null
// preempted: 사람 요청에 자리를 내주느라 끊겨 대기열에 다시 넣은 횟수 (실패 아님, 저장 안 됨)
const stats = { done: 0, failed: 0, preempted: 0, current: null, note: null }

async function saveBacklogStatus() {
  if (!(await backgroundAllowed().catch(() => false))) return // 11/17: 담당 앱만 저장 (다른 앱이 패널 숫자를 덮어쓰지 않게)
  return setSetting(BACKLOG_KEY, {
    remaining: backlog.length,
    important: backlog.filter((b) => b.important).length,
    ...stats,
    updatedAt: new Date().toISOString(),
  }).catch(() => {})
}

async function setBacklog(list) {
  backlog = list
  await saveBacklogStatus()
  // 찾기 · 설정 저장 같은 사람 요청에서 시작돼도 자동 작업으로 보이게 맥락을 비운다 (대기열 보기)
  if (!worker && backlog.length) worker = withQueueContext({ client: null, label: null }, runWorker).finally(() => (worker = null))
  return backlog.length
}

// AI 연결이 안 될 때 다시 시도 (같은 프로세스에 하나만)
const RETRY_MIN = 5
const retry = (globalThis.__summaryRetry ??= { timer: null })
function scheduleRetry() {
  if (retry.timer) return
  retry.timer = setTimeout(() => {
    retry.timer = null
    if (!worker && backlog.length) worker = withQueueContext({ client: null, label: null }, runWorker).finally(() => (worker = null))
  }, RETRY_MIN * 60_000)
  retry.timer.unref?.()
}

async function runWorker() {
  if (!(await pingModel())) {
    // 11/17: 예전엔 다음 최신화(2시간 뒤)까지 쉬었다 → 맥미니 인터넷이 잠깐 끊겨도 자동 요약이 2시간 멈춤. 5분 뒤 다시
    stats.note = `AI 모델에 연결되지 않아 자동 요약을 잠시 멈춤 (${RETRY_MIN}분 뒤 다시 시도)`
    scheduleRetry()
    return saveBacklogStatus()
  }
  if (schedulerMode() === 'off') return
  // 담당 앱이면 전용 연결이 이미 잠금을 쥐고 있다 (같은 잠금을 다른 연결로 다시 잡으면 실패하므로 건너뜀)
  const client = dbEnabled() && !leaderHolds() ? await (await db()).connect() : null
  try {
    if (client && !(await client.query('SELECT pg_try_advisory_lock($1) AS ok', [WORKER_LOCK_ID])).rows[0].ok) return
    stats.note = null
    let failedInRow = 0
    let summarizedInPass = true
    for (;;) {
      // 다 했으면 한 번 더 확인한다 (다른 팀원 앱이 최신화해 새 기사가 생겼을 수 있음)
      // 다시 짠 목록에서 새로 요약한 게 없었으면 멈춘다 (같은 기사를 계속 도는 것 방지)
      if (!backlog.length) {
        if (!summarizedInPass) break
        backlog = await buildBacklog()
        summarizedInPass = false
      }
      if (!backlog.length) break
      // 운영 상태가 AI 기능 정지 · 점검 중이면 멈춘다 (재개 뒤 다음 최신화 때 이어서)
      if (await aiPaused()) {
        stats.note = '운영 상태(AI 기능 정지 · 점검 중) 때문에 자동 요약을 멈춤 · 재개 뒤 다음 최신화 때 이어서'
        break
      }
      const item = backlog.shift()
      const { article } = item
      stats.current = article.title
      await saveBacklogStatus()
      try {
        // 사람이 누른 요약이 있으면 그것부터 처리된다 (자동 요약은 가장 낮은 우선순위). 이미 요약됐으면 바로 넘어감
        const result = await summarizeArticle(article, article.related, { priority: item.important ? PRIORITY.AUTO_IMPORTANT : PRIORITY.AUTO, refresh: Boolean(item.redo) })
        if (!result.cached) {
          stats.done += 1
          summarizedInPass = true
        }
        failedInRow = 0
        searchExtras.delete(article.id)
      } catch (err) {
        if (err.preempted) {
          // 끊긴 요약은 저장되지 않았다 → 「요약 안 됨」 그대로. 원래 자리(맨 앞)에 다시 넣어 사람 요청 뒤에 바로 이어서 한다
          // 그 사이 대기열을 새로 짰으면(최신화) 이미 들어 있으므로 중복으로 넣지 않는다
          if (!backlog.some((b) => b.article.id === article.id)) backlog.unshift(item)
          stats.preempted += 1
          continue
        }
        stats.failed += 1
        failedInRow += 1
        searchExtras.delete(article.id) // 찾기 결과는 다시 시도하지 않는다
        console.error(`[summary] 자동 요약 실패: ${err.message}`)
        if (failedInRow >= 3) {
          stats.note = `요약이 연달아 실패해 멈춤 (${err.message}) · 다음 최신화 때 다시 시도`
          break
        }
      }
    }
  } finally {
    stats.current = null
    await saveBacklogStatus()
    if (client) {
      await client.query('SELECT pg_advisory_unlock($1)', [WORKER_LOCK_ID]).catch(() => {})
      client.release()
    }
  }
}

// 앱이 켜질 때: 밀린 요약이 있으면 이어서 한다 (자동 요약이 꺼짐이면 대기열이 비어 아무것도 안 함)
async function resumeBacklog() {
  if (schedulerMode() === 'off') return
  try {
    const n = await setBacklog(await buildBacklog())
    if (n) console.log(`[summary] 밀린 자동 요약 ${n}건 이어서 시작`)
  } catch (err) {
    console.error(`[summary] 자동 요약 시작 실패: ${err.message}`)
  }
}

async function withLock(fn) {
  if (!dbEnabled()) return fn()
  if (schedulerMode() === 'leader') await ensureLeaderLock()
  if (leaderHolds()) return fn() // 앱 안에서는 localRun이 겹쳐 돌지 않게 막는다
  const client = await (await db()).connect()
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID])
    if (!rows[0].ok) return null
    try {
      return await fn()
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID])
    }
  } finally {
    client.release()
  }
}

async function execute({ trigger, keywords }) {
  const startedAt = new Date().toISOString()
  const runner = runnerInfo()
  const progress = { trigger, startedAt, phase: 'collect', done: 0, total: 0, current: null, by: process.env.PORT ?? null, runner }
  localRun.progress = progress
  const prev = await loadState()
  // updatedAt: 키워드가 많으면 요약이 30분을 넘길 수 있어, 멈춤 판단은 마지막 진행 시각으로 한다
  const saveProgress = () => setSetting(STATE_KEY, { ...prev, running: { ...progress, updatedAt: new Date().toISOString() } })
  await saveProgress()

  const result = { trigger, startedAt, fetched: 0, added: 0, queued: 0, failedKeywords: [], note: null, runner }
  try {
    const collected = await collect(keywords)
    Object.assign(result, { fetched: collected.fetched, added: collected.added })
    result.failedKeywords = collected.failed.map((f) => f.keyword)

    result.queued = await setBacklog(await buildBacklog())
  } catch (err) {
    result.error = err.message
  }
  result.finishedAt = new Date().toISOString()
  // 실패해도 마지막 실행 시각은 남긴다 (실패한 채로 1분마다 다시 도는 것을 막음)
  await setSetting(STATE_KEY, { lastRunAt: startedAt, lastResult: result, running: null })
  console.log(`[refresh] ${trigger} 완료: 새 기사 ${result.added}건, 자동 요약 대기 ${result.queued}건${result.error ? `, 오류 ${result.error}` : ''}`)
  return result
}

async function resolveKeywords(keywords) {
  if (!dbEnabled() && keywords?.length) memoryKeywords = keywords
  const words = dbEnabled() ? await getKeywords() : keywords?.length ? keywords : memoryKeywords
  if (!words.length) throw Object.assign(new Error('등록된 키워드가 없어요.'), { status: 400 })
  return words
}

// trigger: 'manual'(지금 최신화) | 'schedule'
async function runRefresh({ trigger, words }) {
  try {
    const result = await withLock(async () => {
      // 잠금을 얻는 사이 다른 팀원 앱이 방금 끝냈을 수 있다 → 예약 실행이면 다시 확인
      if (trigger === 'schedule') {
        const settings = normalizeSettings(await getSetting(SETTINGS_KEY, {}))
        const next = nextRunAt(settings, (await loadState()).lastRunAt)
        if (!next || next.getTime() > Date.now()) return { skipped: true }
      }
      return execute({ trigger, keywords: words })
    })
    if (result === null) throw Object.assign(new Error('다른 팀원 앱에서 최신화 중이에요.'), { status: 409 })
    return result
  } finally {
    localRun = null
  }
}

// 「지금 최신화」: 확인만 하고 바로 응답한다. 진행 상황은 GET /api/refresh로 본다
export async function startRefresh(keywords) {
  if (localRun) throw Object.assign(new Error('이미 최신화 중이에요.'), { status: 409 })
  localRun = { progress: null }
  try {
    const words = await resolveKeywords(keywords)
    const { running } = await refreshStatus()
    if (running) throw Object.assign(new Error('다른 팀원 앱에서 최신화 중이에요. 잠시 후 다시 확인해 주세요.'), { status: 409 })
    runRefresh({ trigger: 'manual', words }).catch((err) => console.error(`[refresh] ${err.message}`))
  } catch (err) {
    localRun = null
    throw err
  }
}

async function tick() {
  if (schedulerMode() === 'off') return
  await ensureLeaderLock().catch(() => {}) // 담당 앱: 잠금을 놓쳤으면 다시 잡는다 (예약이 꺼져 있어도)
  if (localRun) return
  try {
    const settings = normalizeSettings(await getSetting(SETTINGS_KEY, {}))
    const next = nextRunAt(settings, (await loadState()).lastRunAt)
    if (!next || next.getTime() > Date.now()) return
    if (localRun) return
    localRun = { progress: null }
    let words
    try {
      words = await resolveKeywords()
    } catch (err) {
      localRun = null
      throw err
    }
    await runRefresh({ trigger: 'schedule', words })
  } catch (err) {
    if (err.status !== 409 && err.status !== 400) console.error(`[refresh] 예약 실행 실패: ${err.message}`)
  }
}

// 앱이 켜질 때 한 번 부른다 (Vite 개발 서버·단독 서버)
// 타이머는 프로세스에 하나만 두고, 부를 때마다 가장 최근에 읽은 코드의 tick을 쓴다 (11/09)
// 예전: 처음 켤 때 만든 타이머가 그때의 tick을 계속 불러서, 서버 코드를 고쳐도(Vite가 모듈만 다시 읽음)
// 정기 수집은 서버를 켤 때의 옛 코드로 돌았다 (키워드 논문 · RSS 8곳 · 1·2차 출처 전체 수집이 정기 수집에서 빠짐)
globalThis.__techbriefTick = tick
export function startScheduler() {
  if (globalThis.__techbriefScheduler) return
  globalThis.__techbriefScheduler = setInterval(() => globalThis.__techbriefTick(), TICK_MS)
  globalThis.__techbriefScheduler.unref?.()
  setTimeout(() => globalThis.__techbriefTick(), 5_000).unref?.()
  setTimeout(resumeBacklog, 15_000).unref?.()
}
