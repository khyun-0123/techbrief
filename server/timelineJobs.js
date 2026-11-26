// 기술 시계열 미리 분석 (11/10 조장: 사용자가 찾은 키워드 · 요즘 뜨는 기술을 미리 다 분석해 두자 — 열자마자 보이게)
// 대상 (겹치면 한 번): 자동 수집 키워드 + 최근 14일 「뉴스·논문에서 찾기」로 많이 찾은 말 20개 + 요즘 뜨는 기술 종합 10위
// - 숫자(buildTimeline)와 AI 흐름 정리(timelineStory)를 둘 다 만들어 7일 기억. 3일이 지나면 다시 만든다
// - AI는 「뒤에서 도는 일」 순서라 사람이 누른 요약 · 보고서가 먼저다 (llm/client.js PRIORITY.BACKGROUND)
// - 특허: 받아 둔 디스플레이 특허 DB · 전 세계 특허 제목 파일에서 미리 센다(비용 없음, 11/12). 둘 다 없을 때만 BigQuery(한 번 26GB)라 미리 받지 않고 사람이 열 때 받는다
// - OpenAlex는 한 말에 $0.002 → 30개면 $0.06. 서버가 켜지고 10분 뒤, 그 뒤 6시간마다. TIMELINE_PRECOMPUTE=off면 안 함
// - 11/17: 같은 말의 연관 키워드 맵 · 맵 재료(논문 · 특허) · 보고서용 묶음도 같이 만들어 둔다 (37 문서 P3). 예전엔 시계열만 28개 준비되고 맵은 2개뿐이라
//   미리 분석된 말도 맵을 열면 네이버 + 형태소 분석을 기다렸고, 묶음이 없으면 보고서 만들 때 최대 20초 기다렸다. 맵은 네이버 1회 · AI 안 씀. 이미 있으면 바로 끝남
import { dbEnabled } from './db/index.js'
import { getKeywords, getSetting, setSetting } from './db/store.js'
import { frequentSearches, queryKey, rememberTerms } from './queryTerms.js'
import { getTechTrends } from './techtrends.js'
import { buildTimeline, cachedTimeline, storyMatches, timelineStory } from './timeline.js'
import { surgeMonths } from './timesfm.js'
import { patentDbReady, titlesReady } from './patentDb.js'
import { relatedWords } from './related.js'
import { mapMaterials } from './mapMaterials.js'
import { prepareBundle } from './keywordBundle.js'
import { searchPaperArticles } from './searchPapers.js'
import { tune } from './tunables.js'

// 맵 · 맵 재료 · 보고서용 묶음 (하나가 실패해도 나머지는 계속)
async function warmExtras(query) {
  let n = 0
  for (const [name, job] of [
    ['맵', () => relatedWords(query, { background: true })],
    ['맵 재료', () => mapMaterials(query)],
    ['보고서 묶음', () => prepareBundle(query)],
    // 11/17 D2: 디스플레이 논문 DB에 적은 말은 OpenAlex에서 받아 키워드마다 저장 (papers/keywordStore.js, 한 말 약 $0.001 · 6시간 기억)
    ['키워드 논문', () => searchPaperArticles(query, 'all')],
  ]) {
    try {
      const r = await job()
      if (!['보고서 묶음', '키워드 논문'].includes(name) && r && !r.cached) n += 1 // 새로 만든 맵 · 맵 재료 수 (묶음은 기억 여부를 돌려주지 않아 세지 않음)
    } catch (err) {
      console.warn(`[timeline-jobs] ${name} ${query}: ${err.message}`)
    }
  }
  return n
}

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
  for (const r of await frequentSearches({ days: 14, limit: tune('frequentLimit') }).catch(() => [])) add(r.query, '많이 찾음')
  try {
    const tt = await getTechTrends({ period: 'week' })
    for (const r of (tt.composite ?? []).slice(0, tune('trendingLimit'))) {
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
  let extras = 0
  const failed = []
  try {
    const targets = await precomputeTargets()
    await setSetting(STATE_KEY, { ...(await getSetting(STATE_KEY, {})), phase: 'running', startedAt: started, total: targets.length })
    for (const t of targets) {
      const { timeline, story } = await cachedTimeline(t.query)
      // 11/12 D3: 디스플레이 특허 DB가 생기면 예전 특허 숫자로 만든 것은 3일이 안 지났어도 다시 (특허 DB는 비용 없음)
      const toDb = timeline && Boolean(await patentDbReady()) && (!['family', 'family-all'].includes(timeline.patents?.basis) || (timeline.patents?.inDisplay && Boolean(await titlesReady())))
      // 11/17 P12: 시계열을 다시 계산해 글이 예전 숫자로 쓰였으면 3일이 안 지났어도 다시 쓴다 (사람이 열기 전에)
      if (timeline && story && Date.now() - Date.parse(story.at) < FRESH_MS && !toDb && (story.thin || storyMatches(timeline, story))) {
        skipped += 1
        // 「예상 밖 급증」(TimesFM, 11/16)만 없으면 채워 둔다 (기억해 둔 값이 있으면 바로 끝남)
        if (timeline.naver?.status === 'ok') await surgeMonths(timeline.naver.months).catch((err) => console.warn(`[timesfm] ${err.message}`))
        extras += await warmExtras(t.query)
        continue
      }
      try {
        await buildTimeline(t.query, { background: true, refresh: Boolean(timeline) && Date.now() - Date.parse(timeline.at) >= FRESH_MS })
        await timelineStory(t.query, { background: true, refresh: Boolean(story) })
        made += 1
        extras += await warmExtras(t.query)
      } catch (err) {
        // 사람 요청에 자리를 내준 것(PreemptedError)은 다음 차례에 다시
        failed.push({ query: t.query, error: err.preempted ? '사람 요청 먼저 (다음에 다시)' : err.message })
      }
    }
    const state = { phase: null, startedAt: started, endedAt: new Date().toISOString(), total: targets.length, made, skipped, extras, failed: failed.slice(0, 10) }
    await setSetting(STATE_KEY, state)
    console.log(`[timeline-jobs] 미리 분석 ${made}개 · 건너뜀 ${skipped}개 · 맵 · 맵 재료 새로 ${extras}개 · 실패 ${failed.length}개`)
    return state
  } finally {
    run.busy = false
  }
}

// allowed: 이 앱이 배경 작업을 해도 되는지 (11/17, refresh.js backgroundAllowed — 수집 담당 앱만)
export function startPrecompute({ allowed = async () => true } = {}) {
  if (process.env.TIMELINE_PRECOMPUTE === 'off' || !dbEnabled()) return
  clearTimeout(run.timer)
  const tick = () => {
    allowed()
      .catch(() => false)
      .then((ok) => (ok ? runPrecompute() : null))
      .catch((err) => console.warn(`[timeline-jobs] 실패: ${err.message}`))
      .finally(() => {
        run.timer = setTimeout(tick, tune('precomputeHours') * 3600_000) // 11/26: 관리 페이지 「세부 설정 › 미리 분석」 (기본 6시간)
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
    out.push({ query: timeline.query, from: t.from, stage: timeline.stage?.stage ?? null, growth: timeline.stage?.growth ?? null, companyShareNow: timeline.stage?.companyShareNow ?? null, story: Boolean(story && !story.thin && storyMatches(timeline, story)) })
    if (out.length >= limit) break
  }
  const state = await getSetting(STATE_KEY, {})
  return { items: out, state }
}
