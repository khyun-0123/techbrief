// 대시보드 (11/07 팀 회의): 첫 화면. 오늘 수집 현황 숫자 · 자료 검색 · 키워드 추이를 한곳에서 본다
// - 「자료 검색」은 네이버에서 찾고 자료 현황 탭으로 넘어가 결과를 보여 준다
// - 자동 수집 키워드를 누르면 자료 현황에서 모은 기사를 그 키워드로 걸러 보여 준다
import { useState } from 'react'
import KeywordTrends from './KeywordTrends.jsx'

function Dashboard({ stats, keywords, favorites, recent, onSearch, onKeyword, onGoCollect }) {
  const [text, setText] = useState('')
  const recentOnly = recent.filter((q) => !favorites.includes(q)).slice(0, 8)

  function submit(e) {
    e.preventDefault()
    const q = text.trim()
    if (q) onSearch(q)
  }

  return (
    <main className="page page-wide">
      <header className="page-header with-actions">
        <div>
          <h1>대시보드</h1>
          <p>오늘 모인 자료와 키워드 흐름을 한눈에 봐요. 찾고 싶은 말이 있으면 아래에서 바로 찾으세요.</p>
        </div>
        <div className="header-actions">
          <span className="header-count">{stats.collectedLabel}</span>
          <button type="button" className="btn primary" onClick={onGoCollect}>
            자료 현황으로 →
          </button>
        </div>
      </header>

      <section className="stats">
        <div className="stat">
          <span className="stat-label">오늘 수집된 이슈 · 기사</span>
          <strong>
            {stats.todayIssues}개 <small>· 기사 {stats.todayArticles}건</small>
          </strong>
        </div>
        <div className="stat" title={keywords.join(' · ')}>
          <span className="stat-label">자동 수집 키워드</span>
          <strong>{keywords.length}개</strong>
        </div>
        <div className="stat">
          <span className="stat-label">선별한 기사</span>
          <strong>{stats.selected}건</strong>
        </div>
      </section>

      <section className="panel dash-search">
        <h2 className="dash-title">자료 검색</h2>
        <form className="search-form" onSubmit={submit}>
          <input
            type="search"
            placeholder="찾을 키워드·제목 (예: 마이크로LED, 투명 OLED)"
            aria-label="자료 검색"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn primary" disabled={!text.trim()}>
            자료 검색
          </button>
        </form>
        <p className="dash-note">네이버 뉴스에서 찾아 자료 현황 탭에 보여 줘요.</p>

        {keywords.length > 0 && (
          <div className="dash-chips">
            <span className="dash-chips-label">자동 수집 키워드</span>
            {keywords.map((k) => (
              <button key={k} type="button" className="chip dash-chip" onClick={() => onKeyword(k)} title={`모은 기사 중 「${k}」만 보기`}>
                {k}
              </button>
            ))}
          </div>
        )}
        {favorites.length > 0 && (
          <div className="dash-chips">
            <span className="dash-chips-label">★ 즐겨찾기</span>
            {favorites.map((q) => (
              <button key={q} type="button" className="chip dash-chip" onClick={() => onSearch(q)} title={`네이버에서 「${q}」 찾기`}>
                {q}
              </button>
            ))}
          </div>
        )}
        {recentOnly.length > 0 && (
          <div className="dash-chips">
            <span className="dash-chips-label">최근 검색어</span>
            {recentOnly.map((q) => (
              <button key={q} type="button" className="chip dash-chip" onClick={() => onSearch(q)} title={`네이버에서 「${q}」 찾기`}>
                {q}
              </button>
            ))}
          </div>
        )}
      </section>

      <KeywordTrends />
    </main>
  )
}

export default Dashboard
