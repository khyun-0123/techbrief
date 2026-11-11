// 기술 시계열 「AI 흐름 정리」 작업 (11/11): 키워드 분석 화면을 떠나도 정리를 기다렸다가 끝나면 알려 준다
// - 정리 요청은 여기 한 곳에서 한다 (같은 말은 한 번만). 화면(KeywordAnalysis)이 닫혀도 결과를 버리지 않는다
// - 보는 중(watch)인 말은 알리지 않는다. 보다가 떠난 말이 아직 정리 중이면 오른쪽 아래 진행 창에 올리고,
//   끝나면 「정리 끝」으로 바꿔 알린다 (안 본 것 = unseen). 다시 열면 seen
// - 서버도 같은 말의 정리를 한 번만 돌린다 (server/timeline.js storyRuns)
import { useEffect, useSyncExternalStore } from 'react'
import { fetchTimelineStory } from './api.js'

const BASE_TITLE = typeof document !== 'undefined' ? document.title : '테크브리프'
const jobs = new Map() // query → { query, status: 'running' | 'done' | 'error', startedAt, endedAt, story, error, watchers, listed, unseen }
const listeners = new Set()
let snapshot = []
let openRequest = null // 진행 창 「분석 보기」 → 대시보드가 그 말을 연다 ({ query, n })

function emit() {
  snapshot = [...jobs.values()].map((j) => ({ ...j }))
  const unseen = snapshot.filter((j) => j.unseen).length
  if (typeof document !== 'undefined') document.title = unseen ? `(${unseen}) ${BASE_TITLE}` : BASE_TITLE
  for (const l of listeners) l()
}
function subscribe(l) {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getSnapshot = () => snapshot
const getOpenRequest = () => openRequest

// 정리를 시작한다 (이미 했거나 하는 중이면 그대로). 미리 분석된 말은 서버가 기억해 둔 값이 바로 온다
export function startStory(query) {
  const have = jobs.get(query)
  if (have && have.status !== 'error') return
  const job = { query, status: 'running', startedAt: Date.now(), endedAt: null, story: null, error: '', watchers: have?.watchers ?? 0, listed: have?.listed ?? false, unseen: false }
  jobs.set(query, job)
  emit()
  fetchTimelineStory(query)
    .then((story) => {
      Object.assign(job, { status: 'done', story, endedAt: Date.now(), unseen: job.listed && job.watchers === 0 })
    })
    .catch((err) => {
      Object.assign(job, { status: 'error', error: err.message, endedAt: Date.now(), unseen: job.listed && job.watchers === 0 })
    })
    .finally(emit)
}

// 화면이 그 말을 보고 있는 동안 (알림 대상 아님). 보던 화면이 닫혔는데 아직 정리 중이면 진행 창에 올린다
// (다시 하기로 작업 객체가 바뀔 수 있어 매번 query로 찾는다)
function watch(query) {
  const job = jobs.get(query)
  if (!job) return () => {}
  Object.assign(job, { watchers: job.watchers + 1, unseen: false, listed: false })
  emit()
  return () => {
    const now = jobs.get(query)
    if (!now) return
    now.watchers = Math.max(0, now.watchers - 1)
    if (now.watchers === 0 && now.status === 'running') now.listed = true
    emit()
  }
}

export function dismissStory(query) {
  const job = jobs.get(query)
  if (!job) return
  if (job.status === 'running') job.listed = false
  else jobs.delete(query) // 다시 열면 서버가 기억한 값이 바로 온다
  emit()
}

export function retryStory(query) {
  const job = jobs.get(query)
  if (job) job.listed = true
  startStory(query)
}

export function requestOpenStory(query) {
  openRequest = { query, n: (openRequest?.n ?? 0) + 1 }
  emit()
}
export function consumeOpenRequest() {
  const r = openRequest
  openRequest = null
  return r
}

// 모든 작업 (진행 창 · 대시보드 칩 표시)
export function useStoryJobs() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
export function useOpenRequest() {
  return useSyncExternalStore(subscribe, getOpenRequest)
}

// 한 말의 정리: 시작하고, 보는 동안 watch. enabled가 false면 (숫자를 아직 못 받음) 기다린다
export function useStory(query, enabled = true) {
  const all = useStoryJobs()
  useEffect(() => {
    if (!query || !enabled) return undefined
    startStory(query)
    return watch(query)
  }, [query, enabled])
  return all.find((j) => j.query === query) ?? null
}
