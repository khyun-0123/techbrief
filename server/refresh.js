// 자동 최신화: 등록 키워드로 기사를 모으고, 중요한 기사 몇 건은 미리 요약해 둔다
// - 주기: 꺼짐(기본) / 매일 정해진 시각 / N시간마다. 「지금 최신화」로 바로 실행할 수도 있다
// - 미리 요약은 한 번에 최대 perRun건(기본 5). 나머지는 「선별에 추가」를 누를 때 요약한다
// - 팀원마다 자기 포트로 앱을 켜도 DB는 같이 쓴다 → DB 잠금으로 한 곳에서만 실행한다
// - 앱(npm run dev)이 켜져 있을 때만 돈다. 꺼져 있던 동안 지난 예정은 켜진 뒤 한 번 따라잡는다
import { collect } from './collector/index.js'
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
const DEFAULT_SETTINGS = { mode: 'off', time: '06:00', hours: 2, perRun: 5 }

let memoryKeywords = [] // DB가 없을 때 마지막으로 받은 키워드
let localRun = null // 이 프로세스에서 도는 실행 { promise, progress }

export function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input }
  return {
    mode: ['off', 'daily', 'interval'].includes(s.mode) ? s.mode : 'off',
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.time) ? s.time : DEFAULT_SETTINGS.time,
    hours: HOUR_OPTIONS.includes(Number(s.hours)) ? Number(s.hours) : DEFAULT_SETTINGS.hours,
    perRun: Math.min(10, Math.max(0, Math.round(Number(s.perRun)))) || 0,
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
  const running = Boolean(state.running && Date.now() - Date.parse(state.running.startedAt) < STALE_MS)
  const next = nextRunAt(settings, state.lastRunAt)
  return {
    settings,
    hourOptions: HOUR_OPTIONS,
    running: running ? state.running : null,
    queue: queueStatus(),
    lastRunAt: state.lastRunAt ?? null,
    lastResult: state.lastResult ?? null,
    nextRunAt: next ? next.toISOString() : null,
  }
}

// 자동 최신화 설정은 비밀번호를 아는 사람만 바꾼다 (팀원이 모르고 바꾸지 않게).
// .env.local의 REFRESH_PASSWORD, 없으면 'password'. 「지금 최신화」는 누구나 누를 수 있다
export function checkRefreshPassword(password) {
  if (password !== (process.env.REFRESH_PASSWORD || 'password')) {
    throw Object.assign(new Error('비밀번호가 맞지 않아요.'), { status: 401 })
  }
}

export async function saveRefreshSettings(input) {
  checkRefreshPassword(input.password)
  const before = normalizeSettings(await getSetting(SETTINGS_KEY, {}))
  const settings = normalizeSettings({ ...input, enabledAt: before.enabledAt })
  // 꺼짐→켜짐이거나 주기를 바꾸면 지금부터 센다
  if (settings.mode !== 'off' && (settings.mode !== before.mode || settings.time !== before.time || settings.hours !== before.hours)) {
    settings.enabledAt = new Date().toISOString()
  }
  await setSetting(SETTINGS_KEY, settings)
  return refreshStatus()
}

// 제목에 키워드가 들어간 기사만 미리 요약한다 (본문에만 스치듯 나온 기사는 제외)
function titleHasKeyword(article) {
  const squash = (t) => String(t).toLowerCase().replace(/\s+/g, '')
  return squash(article.title).includes(squash(article.keyword))
}

// 키워드를 돌아가며 중요도 높은 순으로 고른다 (한 키워드가 몫을 다 가져가지 않게)
async function pickForSummary(articles, limit) {
  if (limit <= 0) return []
  const candidates = articles.filter(titleHasKeyword)
  const done = await getSummaries(candidates.map((a) => a.id))
  const byKeyword = new Map()
  for (const a of candidates) {
    if (done[a.id]) continue
    if (!byKeyword.has(a.keyword)) byKeyword.set(a.keyword, [])
    byKeyword.get(a.keyword).push(a)
  }
  const queues = [...byKeyword.values()].map((list) =>
    list.sort((x, y) => y.importance - x.importance || y.publishedAt.localeCompare(x.publishedAt)),
  )
  const picked = []
  while (picked.length < limit && queues.some((q) => q.length)) {
    for (const q of queues) if (q.length && picked.length < limit) picked.push(q.shift())
  }
  return picked
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
  const settings = normalizeSettings(await getSetting(SETTINGS_KEY, {}))
  const progress = { trigger, startedAt, phase: 'collect', done: 0, total: 0, current: null, by: process.env.PORT ?? null }
  localRun.progress = progress
  const prev = await loadState()
  const saveProgress = () => setSetting(STATE_KEY, { ...prev, running: progress })
  await saveProgress()

  const result = { trigger, startedAt, fetched: 0, added: 0, summarized: 0, summaryFailed: 0, failedKeywords: [], note: null }
  try {
    const collected = await collect(keywords)
    Object.assign(result, { fetched: collected.fetched, added: collected.added })
    result.failedKeywords = collected.failed.map((f) => f.keyword)

    const picked = await pickForSummary(collected.articles, settings.perRun)
    if (picked.length && !(await pingModel())) {
      result.note = 'AI 모델에 연결되지 않아 미리 요약은 건너뜀'
    } else {
      Object.assign(progress, { phase: 'summarize', total: picked.length })
      await saveProgress()
      let failedInRow = 0
      for (const article of picked) {
        progress.current = article.title
        await saveProgress()
        try {
          // 사람이 누른 요약이 있으면 그것부터 처리된다 (자동 요약은 가장 낮은 우선순위)
          await summarizeArticle(article, article.related, { priority: PRIORITY.BACKGROUND })
          result.summarized += 1
          failedInRow = 0
        } catch (err) {
          result.summaryFailed += 1
          failedInRow += 1
          console.error(`[refresh] 요약 실패: ${err.message}`)
          if (failedInRow >= 2) {
            result.note = `요약이 연달아 실패해 멈춤 (${err.message})`
            break
          }
        }
        progress.done += 1
      }
    }
  } catch (err) {
    result.error = err.message
  }
  result.finishedAt = new Date().toISOString()
  // 실패해도 마지막 실행 시각은 남긴다 (실패한 채로 1분마다 다시 도는 것을 막음)
  await setSetting(STATE_KEY, { lastRunAt: startedAt, lastResult: result, running: null })
  console.log(`[refresh] ${trigger} 완료: 새 기사 ${result.added}건, 미리 요약 ${result.summarized}건${result.error ? `, 오류 ${result.error}` : ''}`)
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
}
