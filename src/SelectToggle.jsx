// 자료 현황 표의 선별 버튼 (11/09 다시 짬, 11/22 폴더 → 키워드 태그)
// - 선별 전: 「+ 선별」 — 지금 찾고 있는 말(tag)이 태그로 붙는다
// - 이미 선별했지만 지금 찾는 말 태그가 없으면: 「+ 이 키워드에도」 (태그 하나 더, 11/22 조장)
// - 선별 후: 「✓ 선별됨 ▾」 → 작은 메뉴에서 붙은 태그 보기 · 이 태그만 빼기 · 선별에서 빼기
// 버튼 폭을 두 상태 모두 같게 두어 줄마다 버튼 위치가 어긋나지 않게 한다.
// 메뉴는 표의 가로 스크롤 영역에 잘리지 않게 화면 기준(fixed)으로 띄운다
import { useEffect, useRef, useState } from 'react'
import { pageZoom } from './utils.js'

function SelectToggle({ selected, tags = [], tag, onToggle, onAddTag, onRemoveTag }) {
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
      <button type="button" className="sel-toggle" onClick={onToggle} title={`선별에 담아요 — 「${tag}」 태그로 묶여요`}>
        + 선별
      </button>
    )
  }
  if (tag && !tags.includes(tag)) {
    return (
      <button type="button" className="sel-toggle" onClick={() => onAddTag(tag)} title={`이미 「${tags.join(' · ')}」(으)로 선별했어요 — 「${tag}」 태그도 붙여요`}>
        + 이 키워드에도
      </button>
    )
  }

  function openMenu() {
    if (menu) return setMenu(null)
    const r = btnRef.current.getBoundingClientRect()
    const z = pageZoom() // 작은 노트북 배율 (utils.js)
    setMenu({ top: r.bottom / z + 4, right: (window.innerWidth - r.right) / z })
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
        title={`선별됨 · 태그 「${tags.join(' · ')}」 — 눌러서 태그 빼기 · 선별에서 빼기`}
      >
        ✓ 선별됨 <span aria-hidden="true">▾</span>
      </button>
      {menu && (
        <div ref={menuRef} className="sel-menu" role="menu" style={{ top: menu.top, right: menu.right }}>
          <p className="sel-menu-label">붙은 키워드 태그</p>
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitem"
              disabled={tags.length < 2}
              title={tags.length < 2 ? '태그가 하나라 뺄 수 없어요 — 아래 「선별에서 빼기」' : `「${t}」 태그만 빼요 (다른 태그로는 남음)`}
              onClick={() => {
                setMenu(null)
                onRemoveTag(t)
              }}
            >
              <span className="sel-menu-check" aria-hidden="true">
                #
              </span>
              {t}
              {tags.length > 1 && <span className="sel-menu-hint"> · 이 태그 빼기</span>}
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
