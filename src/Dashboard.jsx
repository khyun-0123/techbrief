// 대시보드 (11/07 팀 회의, 11/10 다시 배치): 첫 화면. 위에서 아래로 「찾기 → 분석 → 발견」
// 1. 자료 검색 — 찾으면 바로 자료 현황으로 가지 않고, 아래 「키워드 분석」(연관 키워드 맵 + 기술 시계열)을 그 키워드로 채운다 (11/10 조장 흐름:
//    키워드로 검색 → 맵 → 범위 선정 → 자료 현황에서 선별). 「자료 찾기 →」를 누르면 자료 현황에서 찾는다
// 2. 키워드 분석 (KeywordAnalysis.jsx) — 처음엔 자동 수집 키워드 첫 번째
// 3. 요즘 뜨는 기술 — 기술을 누르면 위 키워드 분석이 그 기술로 바뀐다
// - 자동 수집 키워드 칩은 지금처럼 자료 현황에서 모은 기사를 그 키워드로 걸러 보여 준다
// - 예전 「추적 중인 키워드 추이」는 11/10 조장 결정으로 뺐다 (KeywordTrends.jsx는 그래프 부품 Spark만 씀)
import { useRef, useState } from 'react'
import KeywordAnalysis from './KeywordAnalysis.jsx'
import TechTrends from './TechTrends.jsx'

function Dashboard({ stats, keywords, recommended = [], favorites, recent, periods, period, onPeriod, onSearch, onKeyword, onGoCollect, onRemember }) {
  const [text, setText] = useState('')
  const [focus, setFocus] = useState(null) // 키워드 분석에 보일 말 (고르기 전엔 자동 수집 키워드 첫 번째)
  const shown = focus ?? keywords[0] ?? null
  const analysisRef = useRef(null)

  // 분석할 말을 바꾸고 그 자리로 (찾은 말은 최근 검색어에 남긴다)
  function analyze(q) {
    setFocus(q)
    onRemember?.(q)
    requestAnimationFrame(() => analysisRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const recentOnly = recent.filter((q) => !favorites.includes(q) && !recommended.includes(q)).slice(0, 8)
  const recommendedOnly = recommended.filter((q) => !favorites.includes(q))
  const chipCount = keywords.length + recommendedOnly.length + favorites.length + recentOnly.length

  function submit(e) {
    e.preventDefault()
    const q = text.trim()
    if (q) analyze(q)
  }

  return (
    <main className="page page-wide">
      <header className="page-header with-actions">
        <div>
          <h1>대시보드</h1>
          <p>키워드를 찾으면 연관 키워드와 기술의 흐름을 먼저 보여 줘요. 볼 범위를 정한 뒤 자료 현황에서 선별하세요.</p>
        </div>
        <div className="header-actions">
          <span className="header-count">{stats.collectedLabel}</span>
          <button type="button" className="btn primary" onClick={onGoCollect}>
            자료 현황으로 →
          </button>
        </div>
      </header>

      <section className="panel dash-search">
        <h2 className="dash-title">키워드 검색</h2>
        <form className="search-form" onSubmit={submit}>
          <input
            type="search"
            placeholder="찾을 키워드·제목 (예: 마이크로LED, 투명 OLED)"
            aria-label="분석할 키워드"
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
            분석
          </button>
        </form>
        <p className="dash-note">아래 「키워드 분석」에 연관 키워드와 기술 시계열을 보여 줘요. 뉴스 · 논문 목록은 「자료 찾기 →」로 자료 현황에서 봐요 (기간은 그때 이 값으로).</p>

        {chipCount > 0 && (
          <details className="dash-more">
            <summary>
              자동 수집 키워드 · 추천 · 즐겨찾기 · 최근 검색어 <span className="dash-more-count">{chipCount}개</span>
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
            {recommendedOnly.length > 0 && (
              <div className="dash-chips">
                <span className="dash-chips-label">
                  추천 검색어
                  <small>뉴스·논문에서 찾기</small>
                </span>
                <div className="dash-chips-list">
                  {recommendedOnly.map((k) => (
                    <button key={k} type="button" className="chip dash-chip" onClick={() => analyze(k)} title={`「${k}」 분석 (관리자가 고른 추천 검색어)`}>
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
                  <small>뉴스·논문에서 찾기</small>
                </span>
                <div className="dash-chips-list">
                  {favorites.map((k) => (
                    <button key={k} type="button" className="chip dash-chip" onClick={() => analyze(k)} title={`「${k}」 분석`}>
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
                    <button key={k} type="button" className="chip dash-chip" onClick={() => analyze(k)} title={`「${k}」 분석`}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </details>
        )}
      </section>

      <div ref={analysisRef} className="ka-anchor">
        {/* key: 키워드가 바뀌면 새로 그린다 (고른 범위 · 받은 값 초기화) */}
        <KeywordAnalysis key={shown ?? ''} keyword={shown} onSearch={onSearch} />
      </div>

      <TechTrends onPick={analyze} />
    </main>
  )
}

export default Dashboard
