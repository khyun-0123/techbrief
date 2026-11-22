// 「최근·즐겨찾기 N ▾」 (11/22 조장 검수): 대시보드 · 자료 현황 검색 띠에서 같은 자리 · 같은 부품
// - 예전 자료 현황 왼쪽 「즐겨찾기 · 최근 검색어」 막대(FavoritesRail)와 대시보드 칩 줄을 하나로 — 목록 표가 막대 폭만큼 넓어짐
// - 펼친 목록: ★ 즐겨찾기 / 최근 검색어. 말을 누르면 그 말로 (onPick), ☆ · ★ 로 즐겨찾기 넣고 빼기, × 로 최근 검색어 지우기
// - 키보드: 단추에서 Enter · Space · ↓ = 열기, 목록 안 ↑↓ 이동, Esc = 닫고 단추로. 바깥을 누르면 닫힘
// - done: AI 흐름 정리가 끝났는데 아직 안 본 말 (대시보드)
import { useEffect, useRef, useState } from 'react'

// 보이는 이름 (11/14 D6): 저장된 검색어가 「ai 안경」 · 「tandem oled」처럼 소문자라 표 · 카드의 「AI 안경」과 달라 보였음
// → 4글자 이하 영문 낱말(AI · OLED · LED · TFT · QD)만 대문자로. 누르면 원래 말 그대로
const showTerm = (q) => String(q).replace(/\b[a-z]{2,4}\b/g, (w) => w.toUpperCase())

export default function FavMenu({ favorites = [], recent = [], active = null, done = new Set(), onPick, onToggleFavorite, onRemoveRecent, label = '최근·즐겨찾기', className = '' }) {
  const [open, setOpen] = useState(false)
  const btn = useRef(null)
  const panel = useRef(null)
  const recents = recent.filter((q) => !favorites.includes(q))
  const n = favorites.length + recents.length
  const anyDone = [...favorites, ...recents].some((q) => done.has(q))

  useEffect(() => {
    if (!open) return undefined
    panel.current?.querySelector('.fm-go')?.focus()
    const away = (e) => {
      if (!btn.current?.contains(e.target) && !panel.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const close = () => {
    setOpen(false)
    btn.current?.focus()
  }
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...panel.current.querySelectorAll('.fm-go')]
    const i = items.indexOf(document.activeElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }
  const pick = (q) => {
    setOpen(false)
    onPick(q)
  }

  const row = (q, starred) => (
    <li key={q} className={q === active ? 'fm-row is-on' : 'fm-row'}>
      <button type="button" className={starred ? 'fm-star on' : 'fm-star'} onClick={() => onToggleFavorite?.(q)} aria-pressed={starred} aria-label={starred ? `「${q}」 즐겨찾기 빼기` : `「${q}」 즐겨찾기`} title={starred ? '즐겨찾기 빼기' : '즐겨찾기 (나만 보여요)'}>
        {starred ? '★' : '☆'}
      </button>
      <button type="button" className="fm-go" onClick={() => pick(q)} title={`「${q}」(으)로`}>
        {showTerm(q)}
        {done.has(q) && <span className="fm-done"> · AI 정리 끝</span>}
      </button>
      {!starred && onRemoveRecent && (
        <button type="button" className="fm-x" onClick={() => onRemoveRecent(q)} aria-label={`「${q}」 최근 검색어에서 지우기`} title="최근 검색어에서 지우기">
          ×
        </button>
      )}
    </li>
  )

  return (
    <div className={`fav-menu ${className}`.trim()}>
      <button
        ref={btn}
        type="button"
        className={open ? 'fm-btn is-open' : 'fm-btn'}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
        disabled={n === 0}
        title={n ? '★ 즐겨찾기 · 최근 검색어 (나만 보여요)' : '아직 찾은 말이 없어요'}
      >
        {label} <span className="fm-n">{n}</span>
        {anyDone && <span className="fm-dot" aria-label="AI 흐름 정리가 끝난 말이 있어요" />}
        <span aria-hidden="true" className="fm-caret">
          ▾
        </span>
      </button>
      {open && (
        <div ref={panel} className="fm-panel" role="group" aria-label={label} onKeyDown={onKey}>
          {favorites.length > 0 && (
            <>
              <p className="fm-head">★ 즐겨찾기</p>
              <ul>{favorites.map((q) => row(q, true))}</ul>
            </>
          )}
          {recents.length > 0 && (
            <>
              <p className="fm-head">최근 검색어</p>
              <ul>{recents.map((q) => row(q, false))}</ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
