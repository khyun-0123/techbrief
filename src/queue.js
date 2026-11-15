// AI 대기열 데이터 (11/15): 받아 오기 · 한 줄씩 펴기 · 세기. 그리는 부분은 QueueView.jsx
import { useEffect, useState } from 'react'

export const WHO_LABEL = { mine: '내 작업', auto: '자동', other: '다른 사람' }
export const FILTERS = [
  ['all', '전체'],
  ['mine', '내 작업'],
  ['auto', '자동'],
  ['other', '다른 사람'],
]

// 대기열을 주기적으로 받아 온다. 창이 안 보이는 탭이면 쉰다
export function useQueue(intervalMs = 5000) {
  const [data, setData] = useState(null)
  useEffect(() => {
    let alive = true
    let timer = null
    const load = async () => {
      if (document.visibilityState !== 'hidden') {
        try {
          const res = await fetch('/api/queue')
          if (res.ok && alive) setData(await res.json())
        } catch {
          // 잠깐 못 받아도 다음 번에 다시
        }
      }
      if (alive) timer = setTimeout(load, intervalMs)
    }
    load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [intervalMs])
  return data
}

function seconds(ms) {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`
}

// 서버 응답을 한 줄씩으로 편다: { key, who, title, kind, state, busy }
export function queueRows(data) {
  if (!data) return []
  const rows = []
  if (data.running) {
    const r = data.running
    rows.push({ key: 'run', who: r.who, kind: r.kindLabel, title: r.label ?? r.kindLabel, state: `처리 중 · ${seconds(r.runningMs)}`, busy: true })
  }
  data.waiting.forEach((w, i) => rows.push({ key: `w${i}`, who: w.who, kind: w.kindLabel, title: w.label ?? w.kindLabel, state: `대기 ${i + 1}번째` }))
  // 보고서 작업: AI를 부르는 단계는 위 줄에도 보이므로, 여기서는 작업 단위로 한 줄
  data.reports.forEach((j, i) =>
    rows.push({
      key: `r${i}`,
      who: j.who,
      kind: '보고서 작업',
      title: j.title,
      state: j.status === 'queued' ? '보고서 차례 기다림' : j.status === 'need_confirm' ? '확인 기다림' : `${j.step ?? '쓰는 중'}${j.progress ? ` ${j.progress}%` : ''}`,
      busy: j.status === 'running',
    }),
  )
  const b = data.backlog
  if (b?.remaining > 0 || b?.current) {
    rows.push({
      key: 'backlog',
      who: 'auto',
      kind: '자동 요약',
      title: `자동 요약 대기 ${b.remaining}건${b.important ? ` (중요 ${b.important}건)` : ''}`,
      state: b.current ? `요약 중: ${b.current}` : b.next?.[0] ? `다음: ${b.next[0]}` : '',
      busy: Boolean(b.current),
    })
  }
  return rows
}

export function countBy(rows) {
  const c = { all: rows.length, mine: 0, auto: 0, other: 0 }
  rows.forEach((r) => (c[r.who] += 1))
  return c
}
