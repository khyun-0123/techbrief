// 사용 현황 기록과 집계 (17 문서 4장). IP·User-Agent·이름은 저장하지 않는다
// client_id는 브라우저가 만든 무작위 값 — 대략적인 사용자 수를 세는 데만 쓴다
// DB가 없으면 서버 메모리에 둔다 (서버를 끄면 비워짐)
import { dbEnabled, query } from './db/index.js'

// 화면이 보내는 종류. 그 밖의 값은 버린다
export const CLIENT_TYPES = ['visit', 'search', 'select', 'summary', 'open', 'report', 'export']
// 서버가 직접 남기는 종류는 'ai' 하나: AI 호출 (자동 요약 포함, 비용 가늠)
const EXPORT_FORMATS = ['pdf', 'ppt', 'copy']

export const KEEP_DAYS = 90 // 원본 기록 보관 기간 (17 문서 4-2)
const DETAIL_MAX = 80
const PER_MINUTE = 120 // 브라우저 하나가 1분에 보낼 수 있는 기록 수 (잘못된 반복 호출 막기)

const memory = [] // DB 없을 때: { type, detail, client_id, value, created_at }
const MEMORY_MAX = 20_000

const recent = new Map() // client_id → { minute, count }
function tooMany(clientId) {
  const minute = Math.floor(Date.now() / 60_000)
  const r = recent.get(clientId)
  if (!r || r.minute !== minute) {
    recent.set(clientId, { minute, count: 1 })
    if (recent.size > 5_000) recent.clear()
    return false
  }
  return ++r.count > PER_MINUTE
}

const clean = (s, max = DETAIL_MAX) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

async function insert(type, detail, clientId, value = null) {
  const row = { type, detail: detail || null, client_id: clientId || null, value, created_at: new Date() }
  if (!dbEnabled()) {
    memory.push(row)
    if (memory.length > MEMORY_MAX) memory.splice(0, memory.length - MEMORY_MAX)
    return
  }
  await query('INSERT INTO usage_events (type, detail, client_id, value) VALUES ($1, $2, $3, $4)', [
    row.type,
    row.detail,
    row.client_id,
    row.value,
  ])
}

// 화면에서 온 기록. 잘못된 값은 조용히 버린다 (기록 실패가 사용을 막으면 안 됨)
export async function recordClientEvent(body) {
  const type = String(body?.type ?? '')
  const clientId = clean(body?.clientId, 40)
  if (!CLIENT_TYPES.includes(type) || !/^[\w-]{8,40}$/.test(clientId)) return false
  if (tooMany(clientId)) return false
  let detail = clean(body?.detail)
  if (type === 'export' && !EXPORT_FORMATS.includes(detail)) return false
  if (type === 'visit') {
    // 방문은 브라우저당 하루 한 번
    if (await visitedToday(clientId)) return false
    detail = ''
  }
  await insert(type, detail, clientId)
  return true
}

async function visitedToday(clientId) {
  if (!dbEnabled()) {
    const today = new Date().toDateString()
    return memory.some((e) => e.type === 'visit' && e.client_id === clientId && e.created_at.toDateString() === today)
  }
  const { rows } = await query(
    `SELECT 1 FROM usage_events WHERE type = 'visit' AND client_id = $1 AND created_at >= date_trunc('day', now()) LIMIT 1`,
    [clientId],
  )
  return rows.length > 0
}

// AI 호출 한 번 (kind: summary · report · section · test, ok, 걸린 ms). 실패해도 호출 쪽에 영향 없게
export function recordAiCall(kind, ok, ms) {
  insert('ai', `${clean(kind, 20)}:${ok ? 'ok' : 'fail'}`, null, Math.round(ms)).catch((err) =>
    console.warn(`[usage] AI 호출 기록 실패: ${err.message}`),
  )
}

// 90일 지난 원본 기록 지우기 (서버가 켜질 때와 하루 한 번)
export async function pruneUsage() {
  if (!dbEnabled()) {
    const limit = Date.now() - KEEP_DAYS * 86_400_000
    const keep = memory.filter((e) => e.created_at.getTime() >= limit)
    memory.splice(0, memory.length, ...keep)
    return
  }
  await query(`DELETE FROM usage_events WHERE created_at < now() - make_interval(days => $1)`, [KEEP_DAYS])
}

// ── 집계 ──
// 기간: 1(오늘) · 7 · 30일. 집계는 메모리·DB 모두 같은 코드로 하려고 기간 안의 원본을 불러와 JS로 센다
// (90일 보관 · 소규모 팀이라 많아야 수만 건)
async function eventsSince(since) {
  if (!dbEnabled()) return memory.filter((e) => e.created_at >= since)
  const { rows } = await query(
    'SELECT type, detail, client_id, value, created_at FROM usage_events WHERE created_at >= $1 ORDER BY created_at',
    [since],
  )
  return rows
}

function startOf(days) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (days - 1))
  return d
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function top(list, n) {
  const counts = new Map()
  for (const x of list) if (x) counts.set(x, (counts.get(x) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .slice(0, n)
    .map(([label, count]) => ({ label, count }))
}

const ofType = (events, type) => events.filter((e) => e.type === type)
const clientsOf = (events) => new Set(events.map((e) => e.client_id).filter(Boolean))

// keywords: 지금 자동 수집 키워드 (검색어 Top에서 「자동 수집에 없음」 표시용)
export async function usageStats(days, keywords = []) {
  const period = [1, 7, 30].includes(days) ? days : 7
  const since = startOf(period)
  const events = await eventsSince(since)
  const user = events.filter((e) => e.type !== 'ai')

  // 사용량: 날마다 방문(브라우저 수)·활동 수, 요일·시간대
  const byDay = []
  for (let i = 0; i < period; i++) {
    const d = new Date(since)
    d.setDate(since.getDate() + i)
    byDay.push({ day: dayKey(d), visits: 0, actions: 0 })
  }
  const dayIndex = new Map(byDay.map((d, i) => [d.day, i]))
  const byHour = Array(24).fill(0)
  const byWeekday = Array(7).fill(0) // 0 = 일요일
  for (const e of user) {
    const at = new Date(e.created_at)
    const row = byDay[dayIndex.get(dayKey(at))]
    if (!row) continue
    if (e.type === 'visit') row.visits++
    else row.actions++
    if (e.type !== 'visit') {
      byHour[at.getHours()]++
      byWeekday[at.getDay()]++
    }
  }

  // 관심사
  const lower = new Set(keywords.map((k) => k.toLowerCase()))
  const searches = top(ofType(user, 'search').map((e) => e.detail), 20).map((s) => ({
    ...s,
    inKeywords: lower.has(s.label.toLowerCase()),
  }))

  // 성과: 선별 → 보고서까지 간 비율 = 보고서를 만든 브라우저 / 선별한 브라우저
  const selectors = clientsOf(ofType(user, 'select'))
  const reporters = [...clientsOf(ofType(user, 'report'))].filter((c) => selectors.has(c))
  const exports = ofType(user, 'export')

  // 시스템: AI 호출
  const ai = ofType(events, 'ai')
  const aiOk = ai.filter((e) => e.detail?.endsWith(':ok'))
  const today = startOf(1)

  return {
    days: period,
    since: since.toISOString(),
    usage: {
      visits: ofType(user, 'visit').length,
      clients: clientsOf(user).size,
      actions: user.filter((e) => e.type !== 'visit').length,
      byDay,
      byHour,
      byWeekday,
    },
    interests: {
      searches,
      selectedKeywords: top(ofType(user, 'select').map((e) => e.detail), 10),
      summarizedKeywords: top(ofType(user, 'summary').map((e) => e.detail), 10),
      openedArticles: top(ofType(user, 'open').map((e) => e.detail), 10),
    },
    outcomes: {
      searches: ofType(user, 'search').length,
      selects: ofType(user, 'select').length,
      summaries: ofType(user, 'summary').length,
      reports: ofType(user, 'report').length,
      exports: {
        total: exports.length,
        pdf: exports.filter((e) => e.detail === 'pdf').length,
        ppt: exports.filter((e) => e.detail === 'ppt').length,
        copy: exports.filter((e) => e.detail === 'copy').length,
      },
      selectClients: selectors.size,
      reportClients: reporters.length,
    },
    system: {
      aiCalls: ai.length,
      aiCallsToday: ai.filter((e) => new Date(e.created_at) >= today).length,
      aiFailed: ai.length - aiOk.length,
      aiAvgMs: aiOk.length ? Math.round(aiOk.reduce((s, e) => s + (e.value ?? 0), 0) / aiOk.length) : null,
    },
    keepDays: KEEP_DAYS,
    stored: dbEnabled(),
  }
}
