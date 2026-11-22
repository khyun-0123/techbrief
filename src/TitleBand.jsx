// 화면 위 제목 띠 (11/22 조장 A안): 메뉴 막대 아래 화면 폭 전체의 각진 흰 띠 — 왼쪽은 「지금 보고 있는 것」 제목, 오른쪽은 그 화면의 도구
// - 대시보드: 키워드 분석 · 「AI 안경」 · 단계 · 자사 위협 | 검색칸(최근·즐겨찾기를 칸 안 오른쪽에) · 분석
// - 자료 현황: 자료 현황 · 「찾은 말」 또는 모은 자료 | 찾기칸 · 찾기 · 기간 · 출처 · 정렬 · 자료 추가
// - 선별·요약: 선별·요약 · 고른 키워드 태그 | 자료 올리기 · 정렬
// - 내 보고서: 내 보고서 · 보는 묶음 | 보고서 찾기 · 정렬
// 화면 읽기 프로그램에는 제목이 그 화면의 h1
export default function TitleBand({ over, title, meta = null, badges = null, children, className = '' }) {
  return (
    <div className={`title-band ${className}`.trim()}>
      <div className="tb-title">
        {over && <span className="tb-over">{over}</span>}
        <div className="tb-line">
          <h1>{title}</h1>
          {badges}
          {meta && <span className="tb-meta">{meta}</span>}
        </div>
      </div>
      {children && <div className="tb-tools">{children}</div>}
    </div>
  )
}

// 검색칸 (A안): 돋보기 · 입력 · 칸 안 오른쪽 끝 덧붙임(최근·즐겨찾기 등) — 바깥에 실행 단추
export function SearchBox({ id, value, onChange, placeholder, label, suffix = null }) {
  return (
    <div className="tb-search">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />
      {suffix}
    </div>
  )
}
