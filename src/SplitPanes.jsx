// 두 칸 나누기 (11/14 조장): 윈도우 화면 반반 나누기처럼 가운데 손잡이를 끌어 두 칸 비율을 바꾼다
// - 놓을 때 한 칸이 COLLAPSE_AT보다 작으면 그 칸은 접혀서 세로 탭으로, 나머지 한 칸만 크게. 탭을 누르면 다시 반반
// - 칸마다 × 로 닫기(= 접기). 접힌 탭을 누르면 다시 반반
// - 끌 수 있는 비율은 MIN ~ 1-MIN (칸이 너무 좁아 보기 흉하지 않게). 좁은 칸의 모양은 CSS container query가 바꾼다(.split-pane)
// - 손잡이: 키보드 ← → 로 5%씩, Home = 반반. 두 번 누르면 반반. 비율은 이 브라우저에만 기억 (보는 사람마다 다름)
// - 900px 이하 화면은 위아래로 쌓고 손잡이 없이 ×/펼치기만
import { useEffect, useRef, useState } from 'react'

const MIN = 0.34 // 한 칸 최소 34% (1280px 화면에서 약 340px — 맵 · 시계열이 모두 읽히는 폭, 11/14 3038 실측)
const COLLAPSE_AT = 0.24 // 놓을 때 이보다 작으면 접음
const load = (key) => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null')
    return v && typeof v.ratio === 'number' ? v : null
  } catch {
    return null
  }
}
const save = (key, v) => {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // 저장소를 못 쓰면 이번 화면에서만
  }
}

export default function SplitPanes({ storageKey, left, right }) {
  const saved = load(storageKey)
  const [ratio, setRatio] = useState(saved?.ratio ?? 0.5)
  const [closed, setClosed] = useState(saved?.closed ?? null) // null | 'left' | 'right'
  const [drag, setDrag] = useState(null) // 끄는 중 비율
  const box = useRef(null)
  useEffect(() => save(storageKey, { ratio, closed }), [storageKey, ratio, closed])

  const restore = () => {
    setClosed(null)
    setRatio(0.5)
  }
  const close = (side) => setClosed(side)
  const settle = (r) => {
    if (r < COLLAPSE_AT) return setClosed('left')
    if (r > 1 - COLLAPSE_AT) return setClosed('right')
    setRatio(Math.min(1 - MIN, Math.max(MIN, r)))
  }
  const onPointerDown = (e) => {
    e.preventDefault()
    const rect = box.current.getBoundingClientRect()
    const at = (x) => Math.min(0.9, Math.max(0.1, (x - rect.left) / rect.width))
    const move = (ev) => setDrag(at(ev.clientX))
    const up = (ev) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      settle(at(ev.clientX))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    setDrag(ratio)
  }
  const onKeyDown = (e) => {
    if (e.key === 'ArrowLeft') settle(ratio - 0.05)
    else if (e.key === 'ArrowRight') settle(ratio + 0.05)
    else if (e.key === 'Home' || e.key === 'Enter') setRatio(0.5)
    else return
    e.preventDefault()
  }
  const r = drag ?? ratio
  const warn = drag != null && (drag < COLLAPSE_AT ? 'left' : drag > 1 - COLLAPSE_AT ? 'right' : null)
  const closeBtn = (side, title) => (
    <button type="button" className="split-close" onClick={() => close(side)} aria-label={`${title} 접기`} title={`${title} 접기 — 접힌 탭을 누르면 다시 반반`}>
      ×
    </button>
  )
  const tab = (side, title) => (
    <button type="button" className="split-tab" onClick={restore} aria-label={`${title} 다시 펴기 (반반)`} title="다시 반반으로">
      <span className="split-tab-icon" aria-hidden="true">
        {side === 'left' ? '›' : '‹'}
      </span>
      <span className="split-tab-text">{title}</span>
    </button>
  )
  const cols = closed === 'left' ? 'var(--split-tab) 0 minmax(0, 1fr)' : closed === 'right' ? 'minmax(0, 1fr) 0 var(--split-tab)' : `minmax(0, ${r}fr) var(--split-handle) minmax(0, ${1 - r}fr)`
  return (
    <div ref={box} className={`split${drag != null ? ' dragging' : ''}${closed ? ` closed-${closed}` : ''}`} style={{ '--split-cols': cols }}>
      {closed === 'left' ? tab('left', left.title) : <div className={`split-pane${warn === 'left' ? ' will-close' : ''}`}>{left.render(closeBtn('left', left.title))}</div>}
      {closed ? (
        <span aria-hidden="true" />
      ) : (
        <div
          className="split-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="두 칸 비율 (← → 로 조절, Enter = 반반)"
          aria-valuemin={Math.round(MIN * 100)}
          aria-valuemax={Math.round((1 - MIN) * 100)}
          aria-valuenow={Math.round(r * 100)}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          onDoubleClick={() => setRatio(0.5)}
          title="끌어서 비율 조절 · 두 번 누르면 반반"
        >
          <span className="split-grip" aria-hidden="true" />
        </div>
      )}
      {closed === 'right' ? tab('right', right.title) : <div className={`split-pane${warn === 'right' ? ' will-close' : ''}`}>{right.render(closeBtn('right', right.title))}</div>}
      {warn && <p className="split-hint">놓으면 「{warn === 'left' ? left.title : right.title}」 칸이 접혀요</p>}
    </div>
  )
}
