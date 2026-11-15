// 기술 시계열 미리 분석 (11/10 조장: 사용자가 찾은 키워드 · 요즘 뜨는 기술을 미리 다 분석해 두자 — 열자마자 보이게)
// 대상 (겹치면 한 번): 자동 수집 키워드 + 최근 14일 「뉴스·논문에서 찾기」로 많이 찾은 말 20개 + 요즘 뜨는 기술 종합 10위
// - 숫자(buildTimeline)와 AI 흐름 정리(timelineStory)를 둘 다 만들어 7일 기억. 3일이 지나면 다시 만든다
// - AI는 「뒤에서 도는 일」 순서라 사람이 누른 요약 · 보고서가 먼저다 (llm/client.js PRIORITY.BACKGROUND)
// - 특허: 받아 둔 디스플레이 특허 DB · 전 세계 특허 제목 파일에서 미리 센다(비용 없음, 11/12). 둘 다 없을 때만 BigQuery(한 번 26GB)라 미리 받지 않고 사람이 열 때 받는다
// - OpenAlex는 한 말에 $0.002 → 30개면 $0.06. 서버가 켜지고 10분 뒤, 그 뒤 6시간마다. TIMELINE_PRECOMPUTE=off면 안 함
import { dbEnabled } from './db/index.js'
import { getKeywords, getSetting, setSetting } from './db/store.js'
import { frequentSearches, queryKey, rememberTerms } from './queryTerms.js'
import { getTechTrends } from './techtrends.js'
import { buildTimeline, cachedTimeline, timelineStory } from './timeline.js'
import { surgeMonths } from './timesfm.js'
import { patentDbReady, titlesReady } from './patentDb.js'

const STATE_KEY = 'timeline_precompute'
const FRESH_MS = 3 * 86_400_000
const run = (globalThis.__timelineJobs ??= { busy: false, timer: null })

// 미리 분석할 말 목록 (출처 표시와 함께)
export async function precomputeTargets() {
  const out = new Map()
  const add = (q, from) => {
    const k = queryKey(q)
    if (!k) return
    const e = out.get(k) ?? { query: String(q).trim(), from: [] }
    if (!e.from.includes(from)) e.from.push(from)
    out.set(k, e)
  }
  for (const k of await getKeywords().catch(() => [])) add(k, '자동 수집')
  for (const r of await frequentSearches({ days: 14, limit: 20 }).catch(() => [])) add(r.query, '많이 찾음')
  try {
    const tt = await getTechTrends({ period: 'week' })
    for (const r of (tt.composite ?? []).slice(0, 10)) {
      if (r.en) await rememberTerms(r.name, [r.en]).catch(() => {}) // 영문 이름을 알면 번역 건너뜀
      add(r.name, '요즘 뜨는 기술')
    }
  } catch (err) {
    console.warn(`[timeline-jobs] 요즘 뜨는 기술 목록 실패: ${err.message}`)
  }
  return [...out.values()]
}

export async function runPrecompute() {
  if (run.busy) return { skipped: true }
  run.busy = true
  const started = new Date().toISOString()
  let made = 0
  let skipped = 0
  const failed = []
  try {
    const targets = await precomputeTargets()
    await setSetting(STATE_KEY, { ...(await getSetting(STATE_KEY, {})), phase: 'running', startedAt: started, total: targets.length })
    for (const t of targets) {
      const { timeline, story } = await cachedTimeline(t.query)
      // 11/12 D3: 디스플레이 특허 DB가 생기면 예전 특허 숫자로 만든 것은 3일이 안 지났어도 다시 (특허 DB는 비용 없음)
      const toDb = timeline && Boolean(await patentDbReady()) && (!['family', 'family-all'].includes(timeline.patents?.basis) || (timeline.patents?.inDisplay && Boolean(await titlesReady())))
      if (timeline && story && Date.now() - Date.parse(story.at) < FRESH_MS && !toDb) {
        skipped += 1
        // 「예상 밖 급증」(TimesFM, 11/16)만 없으면 채워 둔다 (기억해 둔 값이 있으면 바로 끝남)
        if (timeline.naver?.status === 'ok') await surgeMonths(timeline.naver.months).catch((err) => console.warn(`[timesfm] ${err.message}`))
        continue
      }
      try {
        await buildTimeline(t.query, { background: true, refresh: Boolean(timeline) && Date.now() - Date.parse(timeline.at) >= FRESH_MS })
        await timelineStory(t.query, { background: true, refresh: Boolean(story) })
        made += 1
      } catch (err) {
        // 사람 요청에 자리를 내준 것(PreemptedError)은 다음 차례에 다시
        failed.push({ query: t.query, error: err.preempted ? '사람 요청 먼저 (다음에 다시)' : err.message })
      }
    }
    const state = { phase: null, startedAt: started, endedAt: new Date().toISOString(), total: targets.length, made, skipped, failed: failed.slice(0, 10) }
    await setSetting(STATE_KEY, state)
    console.log(`[timeline-jobs] 미리 분석 ${made}개 · 건너뜀 ${skipped}개 · 실패 ${failed.length}개`)
    return state
  } finally {
    run.busy = false
  }
}

export function startPrecompute() {
  if (process.env.TIMELINE_PRECOMPUTE === 'off' || !dbEnabled()) return
  clearTimeout(run.timer)
  const tick = () => {
    runPrecompute()
      .catch((err) => console.warn(`[timeline-jobs] 실패: ${err.message}`))
      .finally(() => {
        run.timer = setTimeout(tick, 6 * 3600_000)
      })
  }
  run.timer = setTimeout(tick, 10 * 60_000)
}

// 대시보드 「미리 분석된 키워드」: 숫자가 준비된 말만, 요즘 뜨는 기술 · 많이 찾은 말 순서로
export async function readyTimelines(limit = 12) {
  const targets = await precomputeTargets()
  const order = (t) => (t.from.includes('요즘 뜨는 기술') ? 0 : t.from.includes('많이 찾음') ? 1 : 2)
  const out = []
  for (const t of targets.sort((a, b) => order(a) - order(b))) {
    const { timeline, story } = await cachedTimeline(t.query)
    if (!timeline) continue
    out.push({ query: timeline.query, from: t.from, stage: timeline.stage?.stage ?? null, growth: timeline.stage?.growth ?? null, companyShareNow: timeline.stage?.companyShareNow ?? null, story: Boolean(story && !story.thin) })
    if (out.length >= limit) break
  }
  const state = await getSetting(STATE_KEY, {})
  return { items: out, state }
}
