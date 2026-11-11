// 대시보드 (11/07 팀 회의, 11/10 다시 배치): 첫 화면
// - 처음: 「키워드 분석」 검색창 + 바로 아래 「요즘 뜨는 기술」(참고해서 고르도록). 분석 칸은 비어 있어 작다
// - 찾거나 기술을 누르면: 같은 패널 안에서 분석이 펼쳐진다 (연관 키워드 맵 + 기술 시계열, KeywordAnalysis.jsx). 검색창과 분석을 한 카드로 묶어 겹치지 않게
//   「자료 찾기 →」(기간과 함께)를 눌러야 자료 현황에서 뉴스 · 논문을 찾는다. 「닫기」로 처음 모양으로
// - 자동 수집 키워드 칩은 지금처럼 자료 현황에서 모은 기사를 그 키워드로 걸러 보여 준다
// - 예전 「추적 중인 키워드 추이」는 11/10 조장 결정으로 뺐다 (KeywordTrends.jsx는 그래프 부품 Spark만 씀)
import { useEffect, useRef, useState } from 'react'
import { fetchReadyTimelines } from './api.js'
import KeywordAnalysis, { AnalysisPreview } from './KeywordAnalysis.jsx'
import { consumeOpenRequest, useOpenRequest, useStoryJobs } from './storyJobs.js'
import TechTrends from './TechTrends.jsx'

function Dashboard({ stats, keywords, recommended = [], favorites, recent, periods, period, onPeriod, onSearch, onScopeSearch, onKeyword, onGoCollect, onRemember }) {
  const [text, setText] = useState('')
  const [focus, setFocus] = useState(null) // 분석 중인 말 (없으면 검색창 + 미리 분석된 키워드 + 요즘 뜨는 기술)
  const [ready, setReady] = useState([]) // 미리 분석해 둔 말 (11/10): 검색 전에도 분석이 어떤 모양인지 보이게
  useEffect(() => {
    let alive = true
    fetchReadyTimelines()
      .then((d) => alive && setReady(d.items ?? []))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const panelRef = useRef(null)
  // 진행 창 「분석 보기」(11/11): 다른 화면에서 눌러도 대시보드로 와서 그 말을 연다
  const openRequest = useOpenRequest()
  useEffect(() => {
    const r = openRequest && consumeOpenRequest()
    if (r) analyze(r.query)
  }, [openRequest]) // eslint-disable-line react-hooks/exhaustive-deps
  // 흐름 정리가 끝났는데 아직 안 본 말 · 정리 중인 말: 칩에 표시
  const storyJobs = useStoryJobs()
  const unseen = new Set(storyJobs.filter((j) => j.unseen).map((j) => j.query))
  const mark = (q) =>
    unseen.has(q) ? (
      <span className="dash-done-dot" title="AI 흐름 정리 끝 · 아직 안 봄">
        <span className="sr-only">(AI 흐름 정리 끝)</span>
      </span>
    ) : null

  // 분석할 말을 바꾸고 그 자리로 (찾은 말은 최근 검색어에 남긴다)
  function analyze(q) {
    setFocus(q)
    setText(q)
    onRemember?.(q)
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  function close() {
    setFocus(null)
    setText('')
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
          <p>기술 키워드를 분석하고, 볼 범위를 정한 뒤 자료 현황에서 선별하세요.</p>
        </div>
        <div className="header-actions">
          <span className="header-count">{stats.collectedLabel}</span>
          <button type="button" className="btn primary" onClick={onGoCollect}>
            자료 현황으로 →
          </button>
        </div>
      </header>

      <section ref={panelRef} className={focus ? 'panel dash-search is-open' : 'panel dash-search'} aria-labelledby="dash-search-title">
        <div className="dash-search-head">
          <h2 id="dash-search-title" className="dash-title">
            키워드 분석
          </h2>
          {focus && (
            <button type="button" className="btn" onClick={close}>
              닫기
            </button>
          )}
        </div>
        <form className="search-form" onSubmit={submit}>
          <input
            type="search"
            placeholder="찾을 키워드·제목 (예: 마이크로LED, 투명 OLED)"
            aria-label="분석할 키워드"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn primary" disabled={!text.trim() || text.trim() === focus}>
            분석
          </button>
        </form>
        {!focus && (
          <>
            <p className="dash-note">무엇을 찾을지 모르겠으면 아래 「요즘 뜨는 기술」이나 바로 볼 수 있는 분석에서 골라 보세요.</p>
            {/* 예시: AI 정리까지 있는 미리 분석 중 흐름이 잘 보이는 것(「연구 지속」이 아닌 단계)을 먼저 */}
            <AnalysisPreview example={(ready.find((r) => r.story && r.stage && r.stage !== '연구 지속') ?? ready.find((r) => r.story))?.query ?? null} onOpen={analyze} />
            {ready.length > 0 && (
              <div className="dash-ready" aria-label="미리 분석된 키워드">
                <span className="dash-chips-label">바로 볼 수 있는 분석</span>
                <div className="dash-ready-list">
                  {ready.map((r) => (
                    <button key={r.query} type="button" className="dash-ready-item" onClick={() => analyze(r.query)} title={`${r.from.join(' · ')}${r.growth ? ` · 논문 ${r.growth}배` : ''}${r.story ? ' · AI 정리 있음' : ''}`}>
                      <b>{r.query}</b>
                      {r.stage && <span className="dash-ready-stage">{r.stage}</span>}
                      {mark(r.query)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {chipCount > 0 && (
          <details className="dash-more">
            <summary>
              자동 수집 키워드 · 추천 · 즐겨찾기 · 최근 검색어 <span className="dash-more-count">{chipCount}개</span>
              {[...recommendedOnly, ...favorites, ...recentOnly].some((k) => unseen.has(k)) && mark([...unseen][0])}
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
                      {mark(k)}
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
                      {mark(k)}
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
                      {mark(k)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </details>
        )}
        {/* key: 키워드가 바뀌면 새로 그린다 (고른 범위 · 받은 값 초기화) */}
        {focus && <KeywordAnalysis key={focus} keyword={focus} onSearch={onSearch} onScopeSearch={onScopeSearch} periods={periods} period={period} onPeriod={onPeriod} />}
      </section>

      <TechTrends onPick={analyze} />
    </main>
  )
}

export default Dashboard
