// 메뉴 막대 오른쪽 「설정」 (11/09 조장): 예전 「내 자료」 · 「관리자」 링크를 하나로 모은 작은 창
// - 내 보고서 · 선별 정리본 받기 (.html, 인쇄하면 PDF)
// - 새 자리로 옮기기 (선별 · 폴더 · 즐겨찾기를 파일로 내보내고 불러오기 → DataMove)
// - 관리자 페이지
// - 화면 라이트 · 다크 (11/21 팀 회의, theme.js — 이 브라우저에 기억)
import { useEffect, useRef, useState } from 'react'
import { pageZoom } from './utils.js'
import { setTheme, useTheme } from './theme.js'

function SettingsMenu({ admin, reportCount, selectedCount, onBundle, onMove }) {
  const [open, setOpen] = useState(null) // { top, right } — 메뉴 막대(가로 스크롤)에 잘리지 않게 화면 기준으로 띄움
  const btnRef = useRef(null)
  const menuRef = useRef(null)
  const theme = useTheme()

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(null)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(null)
        btnRef.current?.focus()
      }
    }
    const close = () => setOpen(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    menuRef.current?.querySelector('button, a')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const pick = (fn) => () => {
    setOpen(null)
    fn()
  }

  return (
    <span className="settings">
      <button
        ref={btnRef}
        type="button"
        className="topbar-link settings-btn"
        aria-haspopup="menu"
        aria-expanded={Boolean(open)}
        onClick={() => {
          if (open) return setOpen(null)
          const r = btnRef.current.getBoundingClientRect()
          const z = pageZoom() // 작은 노트북 배율 (utils.js)
          setOpen({ top: r.bottom / z + 12, right: Math.max(8, (window.innerWidth - r.right) / z) })
        }}
      >
        {/* 11/23: 글자 ⚙는 글꼴마다 작고 줄이 어긋나 SVG로 (사용 안내 i와 같은 크기) */}
        <svg className="topbar-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        설정
      </button>
      {open && (
        <div ref={menuRef} className="settings-menu" role="menu" aria-label="설정" style={{ top: open.top, right: open.right }}>
          <button type="button" role="menuitem" onClick={pick(onBundle)}>
            <b>내 보고서 · 선별 정리본 받기</b>
            <small>
              보고서 {reportCount}개 · 선별 {selectedCount}건을 한 파일로 (.html, 인쇄하면 PDF)
            </small>
          </button>
          <button type="button" role="menuitem" onClick={pick(onMove)}>
            <b>새 자리로 옮기기</b>
            <small>선별 · 폴더 · 즐겨찾기를 파일로 내보내고, 새 PC에서 불러와요</small>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={theme === 'dark'} onClick={pick(() => setTheme(theme === 'dark' ? 'light' : 'dark'))}>
            <b>{theme === 'dark' ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기'}</b>
            <small>지금 {theme === 'dark' ? '다크' : '라이트'} · 이 브라우저에 기억해요</small>
          </button>
          <hr />
          <a role="menuitem" href="/admin">
            <b>관리자 페이지{admin ? ` (${admin.name})` : ''}</b>
            <small>수집 키워드 · AI 모델 · 보고서 관리</small>
          </a>
        </div>
      )}
    </span>
  )
}

export default SettingsMenu
