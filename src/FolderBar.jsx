// 선별 폴더 막대 (11/07 결정, 27 문서 2장)
// - 자료 현황: 「선별 추가」가 담을 폴더를 고르는 줄
// - 선별·요약: 폴더별로 보기 · 폴더 이름 바꾸기 · 지우기 (기사 옮기기는 기사 펼침의 「폴더」 메뉴)
import { useEffect, useRef, useState } from 'react'
import { INBOX } from './folders.js'

// counts: { [folderId]: n } · checked: { [folderId]: n } (보고서에 넣을 체크 수, 선별·요약에서만)
function FolderBar({ label, folders, counts, checked, active, allOption, onPick, onCreate, onRename, onDelete }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const total = Object.values(counts).reduce((n, c) => n + c, 0)

  function submit(e) {
    e.preventDefault()
    const n = name.trim()
    if (n) onCreate(n)
    setName('')
    setAdding(false)
  }

  const activeFolder = folders.find((f) => f.id === active)
  // 폴더 칩은 한 줄로 옆으로 밀어 봄 (11/15: 자료 현황도 선별·요약처럼). 고른 폴더가 가려지지 않게 따라간다
  const chipsRef = useRef(null)
  useEffect(() => {
    const box = chipsRef.current
    const chip = box?.querySelector('.folder-chip.active')
    if (!box || !chip || box.scrollWidth <= box.clientWidth) return
    const left = chip.offsetLeft - box.offsetLeft
    if (left < box.scrollLeft || left + chip.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = left - 16
  }, [active, folders.length])

  return (
    <div className="folder-bar" role="group" aria-label={label}>
      {label && <span className="folder-bar-label">{label}</span>}
      <div ref={chipsRef} className="folder-chips">
        {allOption && (
          <button type="button" className={active === null ? 'folder-chip active' : 'folder-chip'} aria-pressed={active === null} onClick={() => onPick(null)}>
            전체 <span className="folder-count">{total}</span>
          </button>
        )}
        {folders.map((f) => (
          <button
            key={f.id}
            type="button"
            className={active === f.id ? 'folder-chip active' : 'folder-chip'}
            aria-pressed={active === f.id}
            onClick={() => onPick(f.id)}
          >
            <span aria-hidden="true">▤</span> {f.name} <span className="folder-count">{counts[f.id] ?? 0}</span>
            {checked?.[f.id] > 0 && <span className="folder-checked" title="보고서에 넣으려고 체크한 기사">✓{checked[f.id]}</span>}
          </button>
        ))}
        {adding ? (
          <form className="folder-new" onSubmit={submit}>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="폴더 이름 (예: 마이크로LED)" aria-label="새 폴더 이름" maxLength={40} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
            <button type="submit" className="btn outline" disabled={!name.trim()}>
              만들기
            </button>
            <button type="button" className="btn" onClick={() => setAdding(false)}>
              취소
            </button>
          </form>
        ) : (
          <button type="button" className="folder-chip folder-add" onClick={() => setAdding(true)}>
            + 새 폴더
          </button>
        )}
      </div>
      {activeFolder && activeFolder.id !== INBOX && (onRename || onDelete) && (
        <details className="folder-menu">
          <summary aria-label={`「${activeFolder.name}」 폴더 관리`} title="폴더 이름 바꾸기 · 지우기">
            ⋯
          </summary>
          <div className="folder-menu-pop">
            {onRename && (
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.closest('details').open = false
                  const n = window.prompt('폴더 이름', activeFolder.name)?.trim()
                  if (n) onRename(activeFolder.id, n)
                }}
              >
                이름 바꾸기
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="danger-text"
                onClick={(e) => {
                  e.currentTarget.closest('details').open = false
                  if (window.confirm(`「${activeFolder.name}」 폴더를 지울까요? 안의 기사는 「미분류」로 옮겨요.`)) onDelete(activeFolder.id)
                }}
              >
                폴더 지우기
              </button>
            )}
          </div>
        </details>
      )}
    </div>
  )
}

export default FolderBar
