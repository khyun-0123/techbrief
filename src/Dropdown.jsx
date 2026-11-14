// 맞춤 드롭다운 (11/15 조장: 「선택하는 거 디자인 수정 — 기본 쓰지 말고」). 브라우저 기본 <select> 대신 토큰으로 그린 단추 + 목록
// - 선택지가 2~3개이고 짧으면 드롭다운 대신 분리형 버튼(.segmented)을 쓴다. 여기는 선택지가 많거나 길거나 개수가 바뀌는 곳(출처 · 폴더 · 설정)
// - options: [{ value, label, hint? }] 또는 묶음 [{ group: '출처 단계', options: [...] }]
// - 키보드 (WAI-ARIA listbox): 단추에서 ↓ · Enter · Space = 열기, 목록에서 ↑↓ · Home · End = 이동, Enter = 고르기, Esc = 닫기, 글자 = 그 글자로 시작하는 항목
// - 화면 아래쪽이 좁으면 위로 펼침. 바깥을 누르면 닫힘
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

// 묶음을 펼친 목록. head = 그 묶음의 첫 항목이면 묶음 이름 (목록에서 제목 줄로)
const flat = (options) =>
  options
    .flatMap((o) => (o.group ? o.options.map((x) => ({ ...x, group: o.group })) : [o]))
    .map((o, i, all) => ({ ...o, head: o.group && (i === 0 || all[i - 1].group !== o.group) ? o.group : null }))

export default function Dropdown({ value, onChange, options, label, title, disabled = false, className = '', size = 'md', placeholder = '고르기' }) {
  const id = useId()
  const items = flat(options)
  const current = items.find((o) => String(o.value) === String(value))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [up, setUp] = useState(false)
  const btn = useRef(null)
  const list = useRef(null)
  const typed = useRef({ text: '', at: 0 })

  const openList = () => {
    if (disabled) return
    setActive(Math.max(0, items.findIndex((o) => String(o.value) === String(value))))
    setOpen(true)
  }
  const close = (focus = true) => {
    setOpen(false)
    if (focus) btn.current?.focus()
  }
  const choose = (o) => {
    if (o.disabled) return
    if (String(o.value) !== String(value)) onChange?.(o.value)
    close()
  }

  // 열 때: 아래 자리가 모자라면 위로, 목록에 초점
  useLayoutEffect(() => {
    if (!open) return
    const r = btn.current.getBoundingClientRect()
    const h = Math.min(320, items.length * 36 + 16)
    setUp(window.innerHeight - r.bottom < h + 8 && r.top > h + 8)
    list.current?.focus()
  }, [open, items.length])
  // 고른 항목이 보이게
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])
  // 바깥 누르면 닫기
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => {
      if (!btn.current?.contains(e.target) && !list.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const move = (to) => {
    const n = items.length
    let i = (to + n) % n
    for (let k = 0; k < n && items[i].disabled; k++) i = (i + 1) % n
    setActive(i)
  }
  const onListKey = (e) => {
    if (e.key === 'ArrowDown') move(active + 1)
    else if (e.key === 'ArrowUp') move(active - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(items.length - 1)
    else if (e.key === 'Enter' || e.key === ' ') choose(items[active])
    else if (e.key === 'Escape') close()
    else if (e.key === 'Tab') setOpen(false)
    else if (e.key.length === 1) {
      const now = e.timeStamp
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
      const i = items.findIndex((o) => String(o.label).toLowerCase().startsWith(typed.current.text))
      if (i >= 0) setActive(i)
      return
    } else return
    e.preventDefault()
  }

  return (
    <span className={`dd dd-${size} ${className}`}>
      <button
        ref={btn}
        type="button"
        className="dd-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={label ? `${label}: ${current?.label ?? placeholder}` : undefined}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault()
            openList()
          }
        }}
      >
        <span className="dd-value">{current?.label ?? placeholder}</span>
        <svg className="dd-caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          className={`dd-list${up ? ' up' : ''}`}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-o${active}`}
          onKeyDown={onListKey}
        >
          {items.map((o, i) => {
            const head = o.head
            const on = String(o.value) === String(value)
            return [
              head && (
                <li key={`g-${head}`} className="dd-group" role="presentation">
                  {head}
                </li>
              ),
              <li
                key={String(o.value)}
                id={`${id}-o${i}`}
                data-i={i}
                role="option"
                aria-selected={on}
                aria-disabled={o.disabled || undefined}
                className={`dd-opt${i === active ? ' active' : ''}${on ? ' on' : ''}${o.group ? ' in-group' : ''}`}
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                <span className="dd-check" aria-hidden="true">
                  {on ? '✓' : ''}
                </span>
                <span className="dd-text">
                  {o.label}
                  {o.hint && <small>{o.hint}</small>}
                </span>
              </li>,
            ]
          })}
        </ul>
      )}
    </span>
  )
}

// 분리형 버튼 (선택지 2~3개 · 짧은 글자): 모두 펼쳐 두고 하나를 고른다. 모양은 Storybook 「Segmented」(.segmented)
export function Seg({ value, onChange, options, label, title, size = 'md', disabled = false }) {
  return (
    <div className={`segmented seg-${size}`} role="radiogroup" aria-label={label} title={title}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={String(o.value) === String(value)} disabled={disabled} onClick={() => String(o.value) !== String(value) && onChange?.(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// 기간 버튼 세트 (11/15 조장: 「오늘 · 최근 7일 · 전체 고르는 버튼셋 만들고 사이즈 통일」) — 모든 화면의 기간 고르기는 이것
// options: [{ value, label }]. 쪽 도구줄은 size="lg"(40), 칸 · 왼쪽 막대 안은 "md"(32). full = 칸 너비 전체로 나눔
export function PeriodSeg({ value, onChange, options, size = 'lg', full = false, label = '기간', title }) {
  return (
    <div className={full ? 'period-seg full' : 'period-seg'}>
      <Seg value={value} onChange={onChange} options={options} label={label} size={size} title={title} />
    </div>
  )
}
