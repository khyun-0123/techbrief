// 자동 최신화: 등록 키워드로 기사를 모으고, 중요한 기사 몇 건은 미리 요약해 둔다
// - 주기: 꺼짐(기본) / 매일 정해진 시각 / N시간마다. 「지금 최신화」로 바로 실행할 수도 있다
// - 최신화가 끝나면 제목에 키워드가 있는 새 기사를 전부 자동 요약 대기열에 넣는다 (아래 '자동 요약 대기열')
// - 팀원마다 자기 포트로 앱을 켜도 DB는 같이 쓴다 → DB 잠금으로 한 곳에서만 실행한다
// - 앱(npm run dev)이 켜져 있을 때만 돈다. 꺼져 있던 동안 지난 예정은 켜진 뒤 한 번 따라잡는다
import { collect, listArticles } from './collector/index.js'
import { db, dbEnabled } from './db/index.js'
import { getKeywords, getSetting, getSummaries, setSetting } from './db/store.js'
import { pingModel, PRIORITY, queueStatus } from './llm/client.js'
import { summarizeArticle } from './summarize.js'

const SETTINGS_KEY = 'refresh_settings'
const STATE_KEY = 'refresh_state'
const LOCK_ID = 5_0505 // pg_advisory_lock 번호 (이 앱 전용)
const TICK_MS = 60_000
const STALE_MS = 30 * 60_000 // 실행 중 표시가 이보다 오래되면 중간에 꺼진 것으로 본다
const KST = 9 * 3600_000 // 한국 시간 (서머타임 없음)

export const HOUR_OPTIONS = [1, 2, 3, 4, 6, 8, 12]
// autoSummary: 자동 요약 켜기/끄기. all(제목에 키워드가 있는 기사 전부) / off(직접 누를 때만)
// 개발 중에는 off로 두고, 시연·테스트 때 all로 켠다
export const AUTO_SUMMARY_OPTIONS = ['all', 'off']
const DEFAULT_SETTINGS = { mode: 'off', time: '06:00', hours: 2, autoSummary: 'off' }

let memoryKeywords = [] // DB가 없을 때 마지막으로 받은 키워드
let localRun = null // 이 프로세스에서 도는 실행 { promise, progress }

export function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input }
  return {
    mode: ['off', 'daily', 'interval'].includes(s.mode) ? s.mode : 'off',
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) ? s.time : DEFAULT_SETTINGS.time,
    hours: HOUR_OPTIONS.includes(Number(s.hours)) ? Number(s.hours) : DEFAULT_SETTINGS.hours,
    autoSummary: AUTO_SUMMARY_OPTIONS.includes(s.autoSummary) ? s.autoSummary : DEFAULT_SETTINGS.autoSummary,
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
    backlog: await getSetting(BACKLOG_KEY, null), // 자동 요약 대기열 { remaining, important, current, done, failed, note }
    lastRunAt: state.lastRunAt ?? null,
    lastResult: state.lastResult ?? null,
    nextRunAt: next ? next.toISOString() : null,
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
  // 자동 요약을 켜거나 끄면 대기열을 바로 다시 짠다 (꺼짐이면 지금 요약 중인 1건까지만 하고 멈춤)
  if (settings.autoSummary !== before.autoSummary) {
    const { articles } = await listArticles()
    await setBacklog(await buildBacklog(articles))
  }
  return refreshStatus()
}

// 제목에 키워드가 들어간 이슈만 자동 요약한다 (본문에만 스치듯 나온 기사는 제외)
// 대표 기사 제목에 없어도 같은 이슈 기사 중 하나의 제목에 있으면 관련도 high (collector/index.js)
function titleHasKeyword(article) {
  return article.relevance === 'high'
}

// ── 자동 요약 대기열 ──
// 최신화가 끝나면 아직 요약 안 된 기사(제목에 키워드가 있는 이슈, 최근 7일)를 전부 대기열에 넣고
// 뒤에서 한 건씩 요약한다. 최신화와 따로 돌아서, 다음 최신화 때 새 기사를 반영해 순서를 다시 짠다
// 순서: 목록과 같은 중요도 점수(collector/score.js)가 높은 것부터, 같으면 최신부터. 최신성은 점수 안에 들어 있다
const WORKER_LOCK_ID = LOCK_ID + 1 // 팀원 앱 여러 개가 같은 DB를 쓰면 한 곳에서만 요약한다
const BACKLOG_KEY = 'summary_backlog'

// 패널의 '중요 N건' 표시: 대상 기사(이미 요약된 것 포함) 중 점수 상위 20%
// 남은 기사 안에서 매번 다시 자르면 기준이 계속 내려간다
const IMPORTANT_SHARE = 0.2

async function buildBacklog(articles) {
  const { autoSummary } = normalizeSettings(await getSetting(SETTINGS_KEY, {}))
  if (autoSummary === 'off') return []
  const candidates = articles.filter(titleHasKeyword)
  const done = await getSummaries(candidates.map((a) => a.id))
  const scores = candidates.map((a) => a.importance ?? 0).sort((x, y) => y - x)
  const cut = Math.max(1, scores[Math.floor(scores.length * IMPORTANT_SHARE)] ?? Infinity)
  return candidates
    .filter((a) => !done[a.id])
    .map((a) => ({ article: a, important: (a.importance ?? 0) >= cut }))
    .sort(
      (x, y) =>
        (y.article.importance ?? 0) - (x.article.importance ?? 0) || y.article.publishedAt.localeCompare(x.article.publishedAt),
    )
}

let backlog = [] // [{ article, important }] 중요도 점수 순
let worker = null
const stats = { done: 0, failed: 0, current: null, note: null }

function saveBacklogStatus() {
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
  if (!worker && backlog.length) worker = runWorker().finally(() => (worker = null))
  return backlog.length
}

async function runWorker() {
  if (!(await pingModel())) {
    stats.note = 'AI 모델에 연결되지 않아 자동 요약을 멈춤 (다음 최신화 때 다시 시도)'
    return saveBacklogStatus()
  }
  const client = dbEnabled() ? await (await db()).connect() : null
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
        backlog = await buildBacklog((await listArticles()).articles)
        summarizedInPass = false
      }
      if (!backlog.length) break
      const { article } = backlog.shift()
      stats.current = article.title
      await saveBacklogStatus()
      try {
        // 사람이 누른 요약이 있으면 그것부터 처리된다 (자동 요약은 가장 낮은 우선순위). 이미 요약됐으면 바로 넘어감
        const result = await summarizeArticle(article, article.related, { priority: PRIORITY.BACKGROUND })
        if (!result.cached) {
          stats.done += 1
          summarizedInPass = true
        }
        failedInRow = 0
      } catch (err) {
        stats.failed += 1
        failedInRow += 1
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
  try {
    const { articles } = await listArticles()
    const n = await setBacklog(await buildBacklog(articles))
    if (n) console.log(`[summary] 밀린 자동 요약 ${n}건 이어서 시작`)
  } catch (err) {
    console.error(`[summary] 자동 요약 시작 실패: ${err.message}`)
  }
}

async function withLock(fn) {
  if (!dbEnabled()) return fn()
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
  const progress = { trigger, startedAt, phase: 'collect', done: 0, total: 0, current: null, by: process.env.PORT ?? null }
  localRun.progress = progress
  const prev = await loadState()
  // updatedAt: 키워드가 많으면 요약이 30분을 넘길 수 있어, 멈춤 판단은 마지막 진행 시각으로 한다
  const saveProgress = () => setSetting(STATE_KEY, { ...prev, running: { ...progress, updatedAt: new Date().toISOString() } })
  await saveProgress()

  const result = { trigger, startedAt, fetched: 0, added: 0, queued: 0, failedKeywords: [], note: null }
  try {
    const collected = await collect(keywords)
    Object.assign(result, { fetched: collected.fetched, added: collected.added })
    result.failedKeywords = collected.failed.map((f) => f.keyword)

    result.queued = await setBacklog(await buildBacklog(collected.articles))
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
export function startScheduler() {
  if (globalThis.__techbriefScheduler) return
  globalThis.__techbriefScheduler = setInterval(tick, TICK_MS)
  globalThis.__techbriefScheduler.unref?.()
  setTimeout(tick, 5_000).unref?.()
  setTimeout(resumeBacklog, 15_000).unref?.()
}
