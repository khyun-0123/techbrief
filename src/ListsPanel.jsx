// 수집 설정 아래 「회사·관심 기술」: 자사·자회사 / 경쟁사 / 관심 기술 목록 (13 문서 F6, 팀 공용)
import { useState } from 'react'

const GROUPS = [
  ['own', '자사·자회사', '「자사·자회사 기사 제외」에 쓰여요', '예: LG디스플레이'],
  ['competitors', '경쟁사', '중요도의 경쟁사 언급에 쓰여요', '예: 삼성디스플레이'],
  ['interests', '관심 기술', '관련도·중요도 판단에 쓸 예정이에요', '예: 마이크로LED'],
]

function ChipList({ id, label, hint, placeholder, words, onChange }) {
  const [input, setInput] = useState('')
  function add(e) {
    e.preventDefault()
    const word = input.trim()
    if (word && !words.includes(word)) onChange([...words, word])
    setInput('')
  }
  return (
    <div className="list-group">
      <form onSubmit={add}>
        <label htmlFor={`list-${id}`}>{label}</label>
        <input id={`list-${id}`} type="text" placeholder={placeholder} value={input} onChange={(e) => setInput(e.target.value)} />
      </form>
      <p className="list-hint">{hint}</p>
      <div className="chips">
        {words.length === 0 && <span className="list-empty">아직 없어요</span>}
        {words.map((w) => (
          <span key={w} className="chip">
            {w}
            <button type="button" onClick={() => onChange(words.filter((x) => x !== w))} aria-label={`${w} 삭제`}>
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

function ListsPanel({ lists, onSave, error }) {
  if (!lists) return null
  return (
    <details className="lists-panel">
      <summary>
        회사·관심 기술 <span className="list-count">자사 {lists.own.length} · 경쟁사 {lists.competitors.length} · 관심 기술 {lists.interests.length}</span>
      </summary>
      {GROUPS.map(([key, label, hint, placeholder]) => (
        <ChipList
          key={key}
          id={key}
          label={label}
          hint={hint}
          placeholder={placeholder}
          words={lists[key]}
          onChange={(next) => onSave({ ...lists, [key]: next })}
        />
      ))}
      <p className="hint">팀이 같이 쓰는 목록이에요. 바꾸면 모두에게 적용돼요.</p>
      {error && <p className="ai-error">{error}</p>}
    </details>
  )
}

export default ListsPanel
