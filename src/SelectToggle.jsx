// 자료 현황 표의 선별 버튼 (11/09 다시 짬)
// - 선별 전: 「+ 선별」 (담을 폴더는 목록 위 「담을 폴더」에서 고름)
// - 선별 후: 「✓ 선별됨 ▾」 → 작은 메뉴에서 폴더 옮기기 · 선별에서 빼기
// 버튼 폭을 두 상태 모두 같게 두어 줄마다 버튼 위치가 어긋나지 않게 한다.
// 메뉴는 표의 가로 스크롤 영역에 잘리지 않게 화면 기준(fixed)으로 띄운다
import { useEffect, useRef, useState } from 'react'

function SelectToggle({ selected, folders, folderId, targetName, onToggle, onMove }) {
  const [menu, setMenu] = useState(null) // { top, right }
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menu) return undefined
    const close = () => setMenu(null)
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) close()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        close()
        btnRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    menuRef.current?.querySelector('button')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  if (!selected) {
    return (
      <button type="button" className="sel-toggle" onClick={onToggle} title={`「${targetName}」 폴더에 담아요 (담을 폴더는 목록 위에서 골라요)`}>
        + 선별
      </button>
    )
  }

  const current = folders.find((f) => f.id === folderId)
  function openMenu() {
    if (menu) return setMenu(null)
    const r = btnRef.current.getBoundingClientRect()
    setMenu({ top: r.bottom + 4, right: window.innerWidth - r.right })
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="sel-toggle on"
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
        onClick={openMenu}
        title={`선별됨 · 「${current?.name ?? '미분류'}」 폴더 — 눌러서 폴더 옮기기 · 빼기`}
      >
        ✓ 선별됨 <span aria-hidden="true">▾</span>
      </button>
      {menu && (
        <div ref={menuRef} className="sel-menu" role="menu" style={{ top: menu.top, right: menu.right }}>
          <p className="sel-menu-label">담긴 폴더</p>
          {folders.map((f) => (
            <button
              key={f.id}
              type="button"
              role="menuitemradio"
              aria-checked={f.id === folderId}
              className={f.id === folderId ? 'on' : undefined}
              onClick={() => {
                if (f.id !== folderId) onMove(f.id)
                setMenu(null)
              }}
            >
              <span className="sel-menu-check" aria-hidden="true">
                {f.id === folderId ? '✓' : ''}
              </span>
              {f.name}
            </button>
          ))}
          <hr />
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              setMenu(null)
              onToggle()
            }}
          >
            <span className="sel-menu-check" aria-hidden="true" />
            선별에서 빼기
          </button>
        </div>
      )}
    </>
  )
}

export default SelectToggle
