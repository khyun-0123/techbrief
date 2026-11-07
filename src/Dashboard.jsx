// 대시보드 (11/07 팀 회의): 첫 화면. (오늘 수집 · 선별 숫자는 11/08부터 위 메뉴 막대에 작게) · 자료 검색(키워드·즐겨찾기·최근 검색어 칩은 접어 둠) · 요즘 뜨는 기술 · 추적 중인 키워드 추이
// - 「자료 검색」은 네이버에서 찾고 자료 현황 탭으로 넘어가 결과를 보여 준다
// - 자동 수집 키워드를 누르면 자료 현황에서 모은 기사를 그 키워드로 걸러 보여 준다
import { useState } from 'react'
import KeywordTrends from './KeywordTrends.jsx'
import TechTrends from './TechTrends.jsx'

function Dashboard({ stats, keywords, favorites, recent, periods, period, onPeriod, onSearch, onKeyword, onGoCollect }) {
  const [text, setText] = useState('')
  const recentOnly = recent.filter((q) => !favorites.includes(q)).slice(0, 8)
  const chipCount = keywords.length + favorites.length + recentOnly.length

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
          <select value={period} onChange={(e) => onPeriod(e.target.value)} aria-label="찾을 기간">
            {periods.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <button type="submit" className="btn primary" disabled={!text.trim()}>
            자료 검색
          </button>
        </form>
        <p className="dash-note">네이버 뉴스에서 찾아 자료 현황 탭에 보여 줘요. 결과가 적으면 기간을 「최근 7일」이나 「전체」로 넓혀 보세요.</p>

        {chipCount > 0 && (
          <details className="dash-more">
            <summary>
              자동 수집 키워드 · 즐겨찾기 · 최근 검색어 <span className="dash-more-count">{chipCount}개</span>
            </summary>
            {keywords.length > 0 && (
              <div className="dash-chips">
                <span className="dash-chips-label">
                  자동 수집 키워드
                  <small>모은 기사에서 보기</small>
                </span>
                <div className="dash-chips-list">
                  {keywords.map((k) => (
                    <button key={k} type="button" className="chip dash-chip" onClick={() => onKeyword(k)} title={`모은 기사 중 「${k}」만 보기`}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {favorites.length > 0 && (
              <div className="dash-chips">
                <span className="dash-chips-label">
                  ★ 즐겨찾기
                  <small>네이버에서 찾기</small>
                </span>
                <div className="dash-chips-list">
                  {favorites.map((k) => (
                    <button key={k} type="button" className="chip dash-chip" onClick={() => onSearch(k)} title={`네이버에서 「${k}」 찾기`}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {recentOnly.length > 0 && (
              <div className="dash-chips">
                <span className="dash-chips-label">
                  최근 검색어
                  <small>네이버에서 다시 찾기</small>
                </span>
                <div className="dash-chips-list">
                  {recentOnly.map((k) => (
                    <button key={k} type="button" className="chip dash-chip" onClick={() => onSearch(k)} title={`네이버에서 「${k}」 찾기`}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </details>
        )}
      </section>

      <TechTrends onPick={onSearch} />

      <KeywordTrends />
    </main>
  )
}

export default Dashboard
