// AI 요약 대기열 — 「선별 추가」·「요약 추가」를 누르면 여기에 들어가 한 건씩 요약된다 (10 보고서 계획 2절)
// 모델은 진행률을 알려 주지 않으므로, 게이지는 지금까지 걸린 평균 시간으로 계산한 '예상' 값이다
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAiParallel, lookupSummaries, requestSummary } from './api.js'
import { track } from './usage.js'
import { load } from './utils.js'
import { isTransient, waitForServer } from './errorReport.js'

const AVG_KEY = 'techbrief-summary-avg-ms'
// 끝나지 않은 작업(대기 · 진행 · 서버 재시작으로 멈춘 오류)을 이 브라우저에 저장 — 새로 고치거나 다시 접속하면 「대기」로 되살림 (11/26)
const PENDING_KEY = 'techbrief-summary-pending'
const slim = (a) => ({ id: a.id, url: a.url, title: a.title, source: a.source, keyword: a.keyword, description: a.description, aiAllowed: a.aiAllowed, related: (a.related ?? []).map(({ id, url, title, source, description }) => ({ id, url, title, source, description })) })
const DEFAULT_AVG_MS = 25_000 // 맥미니 qwen3:14b 실측 22~33초

// 오래 기다리다 연결이 끊겨도 이어 받기 (11/25 팀 검수: 300초 넘게 걸리면 가끔 서버 오류)
// - AI 대기열이 길면 요약 요청이 응답을 오래 붙잡는다. 앞단(Railway 등)이 시간 제한으로 끊어도 서버는 요약을 끝까지 하고 DB에 저장함
// - 그래서 1분 넘게 기다리다 실패하면 10초마다 저장된 요약을 찾아본다 (최대 15분). 「다시 요약」은 새로 만든 것만 받음
const RECOVER_AFTER_MS = 60_000
const RECOVER_EVERY_MS = 10_000
const RECOVER_FOR_MS = 15 * 60_000
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// 11/26 조장: 서버가 다시 켜지는 중(머지 → Railway 다시 배포, 502)이면 오류로 멈추지 않고 서버가 돌아올 때까지 기다린 뒤
// 저장된 요약을 먼저 찾고, 없으면 다시 요청한다 (최대 3번). onWait(true/false)로 화면에 「다시 연결 기다리는 중」
async function summaryWithRecovery(article, opts, onWait) {
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now()
    try {
      return await summaryOnce(article, opts, t0)
    } catch (err) {
      if (!isTransient(err) || attempt >= 3) throw err
      onWait?.(true)
      const back = await waitForServer()
      onWait?.(false)
      if (!back) throw err
      const hit = (await lookupSummaries([article.id]).catch(() => null))?.summaries?.[article.id]
      if (hit && (!opts.refresh || Date.parse(hit.createdAt ?? '') >= t0)) return hit
    }
  }
}
async function summaryOnce(article, opts, t0) {
  try {
    return await requestSummary(article, opts)
  } catch (err) {
    if (Date.now() - t0 < RECOVER_AFTER_MS) throw err
    while (Date.now() - t0 < RECOVER_FOR_MS) {
      await wait(RECOVER_EVERY_MS)
      const hit = (await lookupSummaries([article.id]).catch(() => null))?.summaries?.[article.id]
      if (hit && (!opts.refresh || Date.parse(hit.createdAt ?? '') >= t0)) return hit
      // 기다리는 사이 서버가 다시 켜졌으면 그 요약은 사라졌다 — 기다리지 말고 다시 요청 (위 summaryWithRecovery)
      const started = await fetch('/api/health', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
      if (Date.parse(started?.server?.startedAt ?? '') > t0) throw Object.assign(err, { transient: true })
    }
    throw err
  }
}

// status: 'queued' | 'running' | 'done' | 'error'
export function useSummaryQueue({ onDone }) {
  const [jobs, setJobs] = useState(() =>
    load(PENDING_KEY, [])
      .filter((j) => j?.id && j.article)
      .map((j) => ({ ...j, status: 'queued', error: '', waiting: false, transient: false })),
  )
  const pendingKey = jobs
    .filter((j) => j.status === 'queued' || j.status === 'running' || (j.status === 'error' && j.transient))
    .map((j) => j.id)
    .join('|')
  useEffect(() => {
    try {
      const keep = jobs.filter((j) => pendingKey.split('|').includes(j.id))
      localStorage.setItem(PENDING_KEY, JSON.stringify(keep.map((j) => ({ id: j.id, title: j.title, article: slim(j.article), refresh: j.refresh, select: j.select, addedAt: j.addedAt }))))
    } catch {
      // 저장 공간이 막히면 이번 화면에서만
    }
    // 끝나지 않은 작업 목록이 바뀔 때만 저장
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey])
  const [avgMs, setAvgMs] = useState(() => load(AVG_KEY, DEFAULT_AVG_MS))
  const [now, setNow] = useState(() => Date.now())
  const inFlight = useRef(new Set()) // 지금 보내 둔 요약의 id (상태가 바뀌기 전에 같은 일을 두 번 보내지 않게)
  // 11/26: 지금 AI 연결의 「동시 요청 수」만큼 함께 보낸다 (맥미니 1 = 예전처럼 한 건씩). 1분마다 서버에 물어봄
  const [parallel, setParallel] = useState(1)
  useEffect(() => {
    let on = true
    const read = () =>
      fetchAiParallel()
        .then((n) => on && setParallel(Math.max(1, Math.min(16, Number(n) || 1))))
        .catch(() => {})
    read()
    const t = setInterval(read, 60_000)
    return () => {
      on = false
      clearInterval(t)
    }
  }, [])
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

  // 대기 중인 작업을 실행한다 — 동시 요청 수(parallel)만큼 함께 (11/26, 처음 값 1 = 한 건씩)
  useEffect(() => {
    if (inFlight.current.size >= parallel) return
    const starts = jobs.filter((j) => j.status === 'queued' && !inFlight.current.has(j.id)).slice(0, parallel - inFlight.current.size)
    if (!starts.length) return
    for (const j of starts) inFlight.current.add(j.id)
    const startedAt = Date.now()
    const ids = new Set(starts.map((j) => j.id))
    // 대기열과 요약 서버를 맞추는 effect라 여기서 상태를 바꾼다 (다음 작업을 '진행 중'으로 표시)
    // oxlint-disable-next-line react/set-state-in-effect
    setJobs((list) => list.map((j) => (ids.has(j.id) ? { ...j, status: 'running', startedAt } : j)))

    for (const next of starts) {
      track('summary', next.article.keyword ?? '')
      summaryWithRecovery(next.article, { refresh: next.refresh, select: next.select }, (waiting) => setJobs((list) => list.map((j) => (j.id === next.id ? { ...j, waiting } : j))))
        .then((result) => {
          const took = Date.now() - startedAt
          onDoneRef.current?.(next.id, result)
          setJobs((list) => list.map((j) => (j.id === next.id ? { ...j, status: 'done', finishedAt: Date.now(), took } : j)))
          // 서버 캐시로 바로 끝난 경우(1초 미만)는 평균에 넣지 않는다. 여럿을 함께 보내면 한 건 시간이 길어지므로 평균은 「한 건 끝날 때까지」 그대로
          if (took > 1000) {
            setAvgMs((prev) => {
              const avg = Math.round(prev * 0.7 + took * 0.3)
              localStorage.setItem(AVG_KEY, JSON.stringify(avg))
              return avg
            })
          }
        })
        .catch((err) => {
          setJobs((list) => list.map((j) => (j.id === next.id ? { ...j, status: 'error', error: err.message, transient: isTransient(err), waiting: false } : j)))
        })
        .finally(() => {
          inFlight.current.delete(next.id)
          setNow(Date.now()) // 다음 작업을 시작하도록 다시 그린다
        })
    }
  }, [jobs, now, parallel])

  // 서버가 다시 켜지느라 오류로 멈춘 작업은 서버가 돌아오면 저절로 다시 대기로 (11/26 조장 「재접속되면 작업 대기 상태로」)
  const stuck = jobs.some((j) => j.status === 'error' && j.transient)
  useEffect(() => {
    if (!stuck) return undefined
    let on = true
    waitForServer().then((back) => {
      if (!on || !back) return
      setJobs((list) => list.map((j) => (j.status === 'error' && j.transient ? { ...j, status: 'queued', error: '', transient: false } : j)))
    })
    return () => {
      on = false
    }
  }, [stuck])

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
  const runningList = jobs.filter((j) => j.status === 'running')
  const overall = jobs.length ? Math.round(((finished + runningList.reduce((n, j) => n + progressOf(j) / 100, 0)) / jobs.length) * 100) : 0
  // 남은 시간: 함께 보내는 수(parallel)로 나눔. 도는 것 중 가장 늦게 끝날 것 + 대기 건수 ÷ parallel × 평균
  const queuedN = jobs.filter((j) => j.status === 'queued').length
  const runLeft = runningList.reduce((m, j) => Math.max(m, avgMs - (now - j.startedAt)), 0)
  const remainingMs = Math.max(0, runLeft) + Math.ceil(queuedN / parallel) * avgMs

  return { jobs, enqueue, remove, clearFinished, retry, progressOf, overall, remainingMs, avgMs, now }
}
