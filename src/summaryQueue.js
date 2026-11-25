// AI 요약 대기열 — 「선별 추가」·「요약 추가」를 누르면 여기에 들어가 한 건씩 요약된다 (10 보고서 계획 2절)
// 모델은 진행률을 알려 주지 않으므로, 게이지는 지금까지 걸린 평균 시간으로 계산한 '예상' 값이다
import { useCallback, useEffect, useRef, useState } from 'react'
import { lookupSummaries, requestSummary } from './api.js'
import { track } from './usage.js'
import { load } from './utils.js'

const AVG_KEY = 'techbrief-summary-avg-ms'
const DEFAULT_AVG_MS = 25_000 // 맥미니 qwen3:14b 실측 22~33초

// 오래 기다리다 연결이 끊겨도 이어 받기 (11/25 팀 검수: 300초 넘게 걸리면 가끔 서버 오류)
// - AI 대기열이 길면 요약 요청이 응답을 오래 붙잡는다. 앞단(Railway 등)이 시간 제한으로 끊어도 서버는 요약을 끝까지 하고 DB에 저장함
// - 그래서 1분 넘게 기다리다 실패하면 10초마다 저장된 요약을 찾아본다 (최대 15분). 「다시 요약」은 새로 만든 것만 받음
const RECOVER_AFTER_MS = 60_000
const RECOVER_EVERY_MS = 10_000
const RECOVER_FOR_MS = 15 * 60_000
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function summaryWithRecovery(article, opts) {
  const t0 = Date.now()
  try {
    return await requestSummary(article, opts)
  } catch (err) {
    if (Date.now() - t0 < RECOVER_AFTER_MS) throw err
    while (Date.now() - t0 < RECOVER_FOR_MS) {
      await wait(RECOVER_EVERY_MS)
      const hit = (await lookupSummaries([article.id]).catch(() => null))?.summaries?.[article.id]
      if (hit && (!opts.refresh || Date.parse(hit.createdAt ?? '') >= t0)) return hit
    }
    throw err
  }
}

// status: 'queued' | 'running' | 'done' | 'error'
export function useSummaryQueue({ onDone }) {
  const [jobs, setJobs] = useState([])
  const [avgMs, setAvgMs] = useState(() => load(AVG_KEY, DEFAULT_AVG_MS))
  const [now, setNow] = useState(() => Date.now())
  const busy = useRef(false)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  })

  // 진행 중인 작업이 있으면 게이지를 움직이기 위해 시계를 돌린다
  const hasRunning = jobs.some((j) => j.status === 'running')
  useEffect(() => {
    if (!hasRunning) return undefined
    const timer = setInterval(() => setNow(Date.now()), 400)
    return () => clearInterval(timer)
  }, [hasRunning])

  // 대기 중인 작업을 하나씩 실행한다
  useEffect(() => {
    if (busy.current) return
    const next = jobs.find((j) => j.status === 'queued')
    if (!next) return
    busy.current = true
    const startedAt = Date.now()
    // 대기열과 요약 서버를 맞추는 effect라 여기서 상태를 바꾼다 (다음 작업을 '진행 중'으로 표시)
    // oxlint-disable-next-line react/set-state-in-effect
    setJobs((list) => list.map((j) => (j.id === next.id ? { ...j, status: 'running', startedAt } : j)))

    track('summary', next.article.keyword ?? '')
    summaryWithRecovery(next.article, { refresh: next.refresh, select: next.select })
      .then((result) => {
        const took = Date.now() - startedAt
        onDoneRef.current?.(next.id, result)
        setJobs((list) => list.map((j) => (j.id === next.id ? { ...j, status: 'done', finishedAt: Date.now(), took } : j)))
        // 서버 캐시로 바로 끝난 경우(1초 미만)는 평균에 넣지 않는다
        if (took > 1000) {
          setAvgMs((prev) => {
            const avg = Math.round(prev * 0.7 + took * 0.3)
            localStorage.setItem(AVG_KEY, JSON.stringify(avg))
            return avg
          })
        }
      })
      .catch((err) => {
        setJobs((list) => list.map((j) => (j.id === next.id ? { ...j, status: 'error', error: err.message } : j)))
      })
      .finally(() => {
        busy.current = false
        setNow(Date.now()) // 다음 작업을 시작하도록 다시 그린다
      })
  }, [jobs, now])

  // 같은 기사가 대기·진행 중이면 다시 넣지 않는다. 끝난 기사는 새로 넣는다
  const enqueue = useCallback((article, { refresh = false, select = false } = {}) => {
    setJobs((list) => {
      const existing = list.find((j) => j.id === article.id)
      if (existing && (existing.status === 'queued' || existing.status === 'running')) return list
      const job = { id: article.id, title: article.title, article, refresh, select, status: 'queued', addedAt: Date.now() }
      return [...list.filter((j) => j.id !== article.id), job]
    })
  }, [])

  // 진행 중인 작업은 끝까지 진행하고, 나머지는 목록에서 뺀다 (대기 중이면 취소)
  const remove = useCallback((id) => {
    setJobs((list) => list.filter((j) => j.id !== id || j.status === 'running'))
  }, [])

  const clearFinished = useCallback(() => {
    setJobs((list) => list.filter((j) => j.status === 'queued' || j.status === 'running'))
  }, [])

  const retry = useCallback((id) => {
    setJobs((list) => list.map((j) => (j.id === id && j.status === 'error' ? { ...j, status: 'queued', error: '' } : j)))
  }, [])

  // 0~100. 진행 중이면 평균 시간 대비 경과 시간, 끝나기 전에는 95%까지만
  const progressOf = useCallback(
    (job) => {
      if (!job) return 0
      if (job.status === 'done' || job.status === 'error') return 100
      if (job.status === 'queued') return 0
      return Math.min(95, Math.round(((now - job.startedAt) / avgMs) * 100))
    },
    [now, avgMs],
  )

  const finished = jobs.filter((j) => j.status === 'done' || j.status === 'error').length
  const running = jobs.find((j) => j.status === 'running')
  const overall = jobs.length ? Math.round(((finished + progressOf(running) / 100) / jobs.length) * 100) : 0
  const remainingMs = jobs
    .filter((j) => j.status === 'queued')
    .reduce((ms) => ms + avgMs, running ? Math.max(0, avgMs - (now - running.startedAt)) : 0)

  return { jobs, enqueue, remove, clearFinished, retry, progressOf, overall, remainingMs, avgMs, now }
}
