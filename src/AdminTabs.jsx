// 관리 페이지 메뉴 안 세부 탭 (11/26 조장: 「메뉴에 들어가면 스크롤을 엄청 해야 한다 — 위에서 세부 메뉴를 골라 그 화면만」)
// - 카드 묶음(Pane)마다 탭 하나. 고른 탭만 보이고 나머지는 숨긴다(지우지 않음 — 고치던 칸 · 저장 전 값이 그대로 남게)
// - 주소에 남긴다: #targets/sources → 새로 고침 · 링크로 그 탭이 바로 열림
// - tab="*"인 Pane은 모든 탭에서 보인다 (예: 「바꾼 기록」)
import { createContext, useContext, useEffect, useState } from 'react'

const Ctx = createContext(null)

const subFromHash = (section, keys) => {
  const [sec, sub] = window.location.hash.slice(1).split('/')
  return sec === section && keys.includes(sub) ? sub : keys[0]
}

export function SubTabs({ section, tabs, children }) {
  const keys = tabs.map(([k]) => k)
  const keyText = keys.join('|')
  const [cur, setCur] = useState(() => subFromHash(section, keys))
  useEffect(() => {
    const onHash = () => setCur(subFromHash(section, keyText.split('|')))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [section, keyText])
  const pick = (k) => {
    window.history.replaceState(null, '', `#${section}/${k}`)
    setCur(k)
    window.scrollTo({ top: 0 })
  }
  return (
    <Ctx.Provider value={cur}>
      <div className="adm-subtabs" role="tablist" aria-label="세부 메뉴">
        {tabs.map(([k, label, count]) => (
          <button key={k} type="button" role="tab" aria-selected={cur === k} className={cur === k ? 'adm-subtab is-on' : 'adm-subtab'} onClick={() => pick(k)}>
            {label}
            {count != null && <span className="adm-subtab-n">{count}</span>}
          </button>
        ))}
      </div>
      {children}
    </Ctx.Provider>
  )
}

export function Pane({ tab, className = 'adm-stack', children }) {
  const cur = useContext(Ctx)
  const on = cur == null || tab === '*' || tab === cur
  return (
    <div className={className} role={tab === '*' ? undefined : 'tabpanel'} hidden={!on}>
      {children}
    </div>
  )
}

// 긴 목록 쪽 나누기 (11/26): 변경 기록 · 보고서 관리. list가 바뀌어 쪽이 넘치면 마지막 쪽으로
export function usePages(list, size) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(list.length / size))
  const at = Math.min(page, pages - 1)
  return { items: list.slice(at * size, at * size + size), page: at, pages, setPage, total: list.length, size }
}

export function Pager({ p }) {
  if (p.pages <= 1) return null
  const go = (n) => {
    p.setPage(n)
    window.scrollTo({ top: 0 })
  }
  return (
    <nav className="adm-pager" aria-label="쪽 넘기기">
      <button type="button" className="adm-btn" disabled={p.page === 0} onClick={() => go(p.page - 1)}>
        ‹ 앞
      </button>
      <span className="muted">
        {p.page + 1} / {p.pages}쪽 · {p.page * p.size + 1}~{Math.min(p.total, (p.page + 1) * p.size)} / {p.total}건
      </span>
      <button type="button" className="adm-btn" disabled={p.page >= p.pages - 1} onClick={() => go(p.page + 1)}>
        뒤 ›
      </button>
    </nav>
  )
}
