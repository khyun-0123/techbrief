// 「회사」: 자사·자회사 / 경쟁사 목록 (13 문서 F6, 팀 공용). 관심 기술은 11/17부터 자동 수집 키워드를 그대로 씀 (server/collector/lists.js)
// 중요도 점수에 쓰여 모두에게 영향을 주므로 관리자 화면에서만 바꾼다. 일반 화면은 보기만 (17 문서)
import { useState } from 'react'

const GROUPS = [
  ['own', '자사·자회사', '「자사·자회사 기사 제외」에 쓰여요', '예: LG디스플레이'],
  ['competitors', '경쟁사', '중요도의 경쟁사 언급에 쓰여요', '예: 삼성디스플레이'],
]

// onChange가 없으면 보기만
export function ChipList({ id, label, hint, placeholder, words, onChange }) {
  const [input, setInput] = useState('')
  function add(e) {
    e.preventDefault()
    const word = input.trim()
    if (word && !words.includes(word)) onChange([...words, word])
    setInput('')
  }
  return (
    <div className="list-group">
      {onChange ? (
        <form onSubmit={add}>
          <label htmlFor={`list-${id}`}>{label}</label>
          {/* Enter만으로는 알기 어려워 「추가」 버튼을 함께 둔다 */}
          <div className="chip-add">
            <input id={`list-${id}`} type="text" placeholder={placeholder} value={input} onChange={(e) => setInput(e.target.value)} />
            <button type="submit" className="chip-add-btn" disabled={!input.trim()}>
              추가
            </button>
          </div>
        </form>
      ) : (
        <p className="list-label">{label}</p>
      )}
      <p className="list-hint">{hint}</p>
      <div className="chips">
        {words.length === 0 && <span className="list-empty">아직 없어요</span>}
        {words.map((w) => (
          <span key={w} className="chip">
            {w}
            {onChange && (
              <button type="button" onClick={() => onChange(words.filter((x) => x !== w))} aria-label={`${w} 삭제`}>
                ×
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

// 일반 화면: 보기만. 바꾸는 곳은 관리자 화면(AdminApp)
function ListsPanel({ lists }) {
  if (!lists) return null
  return (
    <details className="lists-panel">
      <summary>
        회사 <span className="list-count">자사 {lists.own.length} · 경쟁사 {lists.competitors.length}</span>
      </summary>
      {GROUPS.map(([key, label, hint, placeholder]) => (
        <ChipList
          key={key}
          id={key}
          label={label}
          hint={hint}
          placeholder={placeholder}
          words={lists[key]}
        />
      ))}
      <p className="hint">팀이 같이 쓰는 목록이라 관리자가 정해요.</p>
    </details>
  )
}

// 관리자 화면: 두 목록을 바꿔 저장 (17 문서)
export function ListsEditor({ lists, onSave }) {
  return GROUPS.map(([key, label, hint, placeholder]) => (
    <ChipList
      key={key}
      id={key}
      label={label}
      hint={hint}
      placeholder={placeholder}
      words={lists[key]}
      onChange={(next) => onSave({ ...lists, [key]: next })}
    />
  ))
}

export default ListsPanel
