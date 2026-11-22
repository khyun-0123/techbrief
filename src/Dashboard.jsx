// 대시보드 (11/07 팀 회의, 11/10 다시 배치): 첫 화면
// - 11/22 팀 회의: 위 한 줄(마지막 수집 · 「자료 현황으로 →」)을 없애고 그 자리에 검색창. 「바로 볼 수 있는 분석」 · 「분석하면 이렇게 보여요」 예시는 뺌
//   (거기 든 말은 요즘 뜨는 기술 · 관리자가 등록한 키워드라 왼쪽 막대 · 팀 합의로 이미 보임)
// - 첫 화면은 늘 분석이 펼쳐진 모양: 요즘 뜨는 기술 1위를 저절로 골라 분석한다 (옆에 「다른 키워드로 검색해 보세요」 회색 안내).
//   저절로 고른 말은 최근 검색어 · 보고서 주제 키워드(LAST_ANALYZED_KEY)에 남기지 않는다 — 사람이 고른 말만
//   요즘 뜨는 기술을 못 받으면 예전 첫 화면(최근 중요 자료 · 최근 내 보고서, DashHome.jsx)
// - 검색창 옆 칩은 내 검색어(★ 즐겨찾기 · 최근 검색어, IP별)만. 한 줄에 들어가는 만큼, 남으면 「+n개 더」.
//   자동 수집 키워드 칩은 뺌 (관리자가 등록한 키워드는 팀 합의라 모두 앎, 11/22)
// - 11/22 조장 시안: 「자료 선별하기 →」 · 「보고서까지 자동 진행」은 세 칸 아래 고정 바(dash-next, KeywordAnalysis가 그림).
//   고른 범위 바로 옆에서 누르고, 스크롤해도 늘 보인다. 왼쪽 「요즘 뜨는 기술」 막대는 접을 수 있다(이 브라우저에 기억) — 맵이 넓어짐
// - 예전 「추적 중인 키워드 추이」는 11/10 조장 결정으로 뺐다 (KeywordTrends.jsx는 그래프 부품 Spark만 씀)
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import KeywordAnalysis from './KeywordAnalysis.jsx'
import DashHome from './DashHome.jsx'
import { consumeOpenRequest, useOpenRequest, useStoryJobs } from './storyJobs.js'
import TechTrends from './TechTrends.jsx'
import TrendRail from './TrendRail.jsx'
import VerdictModal from './VerdictModal.jsx'
import { LAST_ANALYZED_KEY } from './utils.js'

// 칩에 보이는 이름 (11/14 D6): 저장된 검색어가 「ai 안경」 · 「tandem oled」처럼 소문자라 표 · 카드의 「AI 안경」과 달라 보였음
// → 4글자 이하 영문 낱말(AI · OLED · LED · TFT · QD)만 대문자로. 누르면 원래 말 그대로 분석한다
const showTerm = (q) => String(q).replace(/\b[a-z]{2,4}\b/g, (w) => w.toUpperCase())
const MINE_MAX = 12 // 내 검색어 칩 최대 (즐겨찾기 + 최근)

// 칩 폭을 차례로 한 줄에 담아 몇 개 들어가는지 (다 못 담으면 「+n개 더」 자리를 남김)
function fitInLine(widths, moreW, avail, gap) {
  const total = (ws) => ws.reduce((a, w) => a + w, 0) + gap * Math.max(0, ws.length - 1)
  if (total(widths) <= avail) return widths.length
  for (let k = widths.length - 1; k > 0; k -= 1) if (total([...widths.slice(0, k), moreW]) <= avail) return k
  return 0
}

function Dashboard({ resetKey = 0, homeIssues = [], reports = [], onOpenReport, onGoReports, favorites, recent, onSearch, onScopeSearch, onAutoReport, onGoCollect, onRemember }) {
  // 보고서의 「분석 열기 ↗」 링크(/?analyze=키워드, 11/17)로 들어오면 그 키워드 분석을 바로 연다
  const [linked] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('analyze')?.trim().slice(0, 50) || null
    } catch {
      return null
    }
  })
  const [text, setText] = useState(linked ?? '')
  const [focus, setFocus] = useState(linked) // 분석 중인 말
  const [auto, setAuto] = useState(false) // 지금 분석이 요즘 뜨는 기술 1위를 저절로 고른 것인지 (11/22)
  const [firstTrend, setFirstTrend] = useState(null) // 요즘 뜨는 기술 1위 (TrendRail이 받으면 알려 줌)
  const [trendFailed, setTrendFailed] = useState(false)
  useEffect(() => {
    if (linked) window.history.replaceState(null, '', window.location.pathname) // 새로고침해도 다시 열리지 않게 주소에서 뺀다
  }, [linked])
  // 첫 화면: 사람이 고른 말이 없으면 요즘 뜨는 기술 1위로 (11/22). TrendRail이 받은 뒤 한 번 부른다 — 그 사이 사람이 찾았으면 그대로
  const focusRef = useRef(focus)
  focusRef.current = focus
  const onFirstTrend = (name) => {
    if (!name) return setTrendFailed(true)
    setFirstTrend(name)
    if (!focusRef.current) {
      setFocus(name)
      setAuto(true)
    }
  }
  // 요즘 뜨는 기술 (11/14 조장): 왼쪽 작은 막대 + 「펼쳐 보기」로 왼쪽에서 나오는 판, 자사 위협 · 기회 설명 창
  const [drawer, setDrawer] = useState(false)
  const [drawerClosing, setDrawerClosing] = useState(false) // 11/17: 닫을 때도 미끄러져 들어가게 (끝나면 drawer를 끔)
  const closeDrawer = useCallback(() => {
    if (drawerClosing) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return setDrawer(false)
    setDrawerClosing(true)
    setTimeout(() => {
      setDrawer(false)
      setDrawerClosing(false)
    }, 240)
  }, [drawerClosing])
  const [verdictData, setVerdictData] = useState(null)
  const [verdictView, setVerdictView] = useState(null) // { term, info }
  const drawerClose = useRef(null)
  useEffect(() => {
    if (!drawer) return undefined
    drawerClose.current?.focus()
    const esc = (e) => e.key === 'Escape' && !verdictView && closeDrawer()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [drawer, verdictView, closeDrawer])
  const openVerdict = (term, info) => setVerdictView({ term, info })
  // 대시보드 탭을 한 번 더 누르거나 로고를 누르면 첫 화면으로 (11/15): 요즘 뜨는 기술 1위 분석 · 펼친 목록 · 판정 창을 닫는다
  const firstReset = useRef(resetKey)
  useEffect(() => {
    if (resetKey === firstReset.current) return
    setFocus(firstTrend)
    setAuto(Boolean(firstTrend))
    setText('')
    setDrawer(false)
    setVerdictView(null)
  }, [resetKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const panelRef = useRef(null)
  const [nextSlot, setNextSlot] = useState(null) // 하단 고정 바 자리 (KeywordAnalysis가 createPortal로 채움)
  // 왼쪽 막대 접기 (11/22): 맵 · 시계열 칸을 넓게. 이 브라우저에 기억
  const [railOff, setRailOff] = useState(() => {
    try {
      return localStorage.getItem('techbrief.railOff') === '1'
    } catch {
      return false
    }
  })
  const toggleRail = () =>
    setRailOff((v) => {
      try {
        localStorage.setItem('techbrief.railOff', v ? '0' : '1')
      } catch {
        // 저장 공간을 못 쓰면 이번 화면에서만
      }
      return !v
    })
  // 진행 창 「분석 보기」(11/11): 다른 화면에서 눌러도 대시보드로 와서 그 말을 연다
  const openRequest = useOpenRequest()
  useEffect(() => {
    const r = openRequest && consumeOpenRequest()
    if (r) analyze(r.query)
  }, [openRequest]) // eslint-disable-line react-hooks/exhaustive-deps
  // 흐름 정리가 끝났는데 아직 안 본 말: 칩에 표시
  const storyJobs = useStoryJobs()
  const unseen = new Set(storyJobs.filter((j) => j.unseen).map((j) => j.query))
  const mark = (q) =>
    unseen.has(q) ? (
      <span className="dash-done-dot" title="AI 흐름 정리 끝 · 아직 안 봄">
        <span className="sr-only">(AI 흐름 정리 끝)</span>
      </span>
    ) : null

  // 분석할 말을 바꾸고 그 자리로 (사람이 고른 말은 최근 검색어에 남긴다)
  function analyze(q) {
    setFocus(q)
    setAuto(false)
    setText(q)
    // 11/12: 마지막으로 분석한 키워드 — 보고서를 만들 때 그 분석 묶음이 자동으로 근거에 들어간다 (ReportComposer, server/keywordBundle.js)
    try {
      localStorage.setItem(LAST_ANALYZED_KEY, JSON.stringify({ query: q, at: Date.now() }))
    } catch {
      // 저장소를 못 쓰면 보고서에서 주제 키워드를 직접 고른다
    }
    onRemember?.(q)
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }
  // 내 검색어: ★ 즐겨찾기 먼저, 그 뒤 최근 검색어 (겹치는 말은 한 번만)
  const mine = [...favorites.map((q) => ({ q, star: true })), ...recent.filter((q) => !favorites.includes(q)).map((q) => ({ q, star: false }))].slice(0, MINE_MAX)
  // 한 줄에 들어가는 만큼만 (11/15 「바로 볼 수 있는 분석」과 같은 방식): 보이지 않는 측정 줄에서 칩 폭을 재고, 창 폭이 바뀌면 다시
  const chipsRef = useRef(null)
  const measureRef = useRef(null)
  const [fit, setFit] = useState(MINE_MAX)
  const [allChips, setAllChips] = useState(false)
  const mineKey = mine.map((m) => m.q).join('|')
  useLayoutEffect(() => {
    const box = chipsRef.current
    const meas = measureRef.current
    if (!box || !meas) return undefined
    const decide = () => {
      const [label, ...rest] = [...meas.children]
      const more = rest.pop()
      const gap = 6
      setFit(fitInLine(rest.map((e) => e.offsetWidth), more.offsetWidth, box.clientWidth - label.offsetWidth - 10, gap))
    }
    decide()
    const ro = new ResizeObserver(decide)
    ro.observe(box)
    return () => ro.disconnect()
  }, [mineKey])

  function submit(e) {
    e.preventDefault()
    const q = text.trim()
    if (q) analyze(q)
  }
  const chip = ({ q, star }) => (
    <>
      {star && <span aria-label="즐겨찾기">★ </span>}
      {showTerm(q)}
      {mark(q)}
    </>
  )
  const home = !focus && trendFailed // 요즘 뜨는 기술을 못 받았을 때만 예전 첫 화면

  return (
    <main className={home ? 'page page-wide dash-page is-home' : 'page page-wide dash-page'}>
      {/* 11/21 팀 회의: 화면의 제목 · 설명 문구 없앰 (화면 읽기 프로그램용 제목만 숨겨 둠) */}
      <h1 className="sr-only">대시보드</h1>
      <div className={railOff ? 'dash-layout is-rail-off' : 'dash-layout'}>
        <TrendRail
          collapsed={railOff}
          onToggle={toggleRail}
          active={focus}
          onFirst={onFirstTrend}
          onPick={analyze}
          onOpen={() => setDrawer(true)}
          onVerdicts={setVerdictData}
          onVerdict={openVerdict}
        />
        <div className="dash-main">
          {/* 11/22 팀 회의: 위 한 줄(마지막 수집 · 「자료 현황으로 →」) 자리에 검색창 + 내 검색어 한 줄 */}
          <div className="dash-top">
            <form className="search-form dash-searchbar" onSubmit={submit} role="search" aria-label="키워드 분석">
              <input
                type="search"
                placeholder={auto ? '다른 키워드로 검색해 보세요' : '찾을 키워드 (예: 마이크로LED, 투명 OLED)'}
                aria-label="분석할 키워드"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button type="submit" className="btn primary" disabled={!text.trim() || text.trim() === focus}>
                분석
              </button>
            </form>
            {mine.length > 0 && (
              <div ref={chipsRef} className={allChips ? 'dash-mine is-all' : 'dash-mine'}>
                {/* 측정용 (보이지 않음): 칩마다 폭을 재서 몇 개 보일지 정한다 */}
                <div ref={measureRef} className="dash-mine-measure" aria-hidden="true">
                  <span className="dash-mine-label">내 검색어</span>
                  {mine.map((m) => (
                    <span key={m.q} className="chip dash-chip">
                      {chip(m)}
                    </span>
                  ))}
                  <span className="btn-text dash-mine-more">+{mine.length}개 더</span>
                </div>
                <span className="dash-mine-label" title="★ 즐겨찾기 · 최근 검색어 (나만 보여요)">
                  내 검색어
                </span>
                {(allChips ? mine : mine.slice(0, fit)).map((m) => (
                  <button key={m.q} type="button" className={m.q === focus ? 'chip dash-chip on' : 'chip dash-chip'} onClick={() => analyze(m.q)} title={`「${m.q}」 분석${m.star ? ' (즐겨찾기)' : ' (최근 검색어)'}`}>
                    {chip(m)}
                  </button>
                ))}
                {mine.length > fit && (
                  <button type="button" className="btn-text dash-mine-more" aria-expanded={allChips} onClick={() => setAllChips((v) => !v)}>
                    {allChips ? '접기' : `+${mine.length - fit}개 더`}
                  </button>
                )}
              </div>
            )}
          </div>
          {focus && (
            <section ref={panelRef} className="panel dash-search is-open" aria-label={`「${focus}」 키워드 분석`}>
              {/* key: 키워드가 바뀌면 새로 그린다 (고른 범위 · 받은 값 초기화) */}
              <KeywordAnalysis key={focus} keyword={focus} nextSlot={nextSlot} autoNote={auto ? '요즘 뜨는 기술 1위라 먼저 보여 드려요 · 다른 키워드로 검색해 보세요' : null} onSearch={onSearch} onScopeSearch={onScopeSearch} onAutoReport={onAutoReport} />
            </section>
          )}
          {/* 요즘 뜨는 기술을 못 받았을 때만: 최근 중요 자료 · 최근 내 보고서 (11/15 시안 A) */}
          {home && <DashHome issues={homeIssues} reports={reports} onOpenReport={onOpenReport} onGoReports={onGoReports} onGoCollect={onGoCollect} />}
        </div>
      </div>

      {/* 하단 고정 바 자리: 세 칸 뒤라 키보드 · 화면 읽기 순서도 「검토 → 다음 단계」 */}
      {focus && <div ref={setNextSlot} className="dash-next" />}
      {/* 「세부 기술 × 경쟁사 특허」는 대시보드에서 뺌 (11/14 조장: 계속 볼 자료가 아님) — 보고서 분석 자료 · 위협 · 기회 설명 창에서 씀 */}
      {drawer && (
        <div className={drawerClosing ? 'trend-drawer-backdrop is-closing' : 'trend-drawer-backdrop'} role="presentation" onClick={(e) => e.target === e.currentTarget && closeDrawer()}>
          <div className="trend-drawer" role="dialog" aria-modal="true" aria-label="요즘 뜨는 기술 전체">
            <TechTrends
              onPick={(t) => {
                setDrawer(false)
                analyze(t)
              }}
              verdicts={verdictData?.verdicts}
              onVerdict={openVerdict}
              onClose={closeDrawer}
              closeRef={drawerClose}
            />
            {/* 11/17 조장: 판 오른쪽 가장자리 손잡이 — 눌러서 닫기 */}
            <button type="button" className="trend-drawer-grip" onClick={closeDrawer} aria-label="요즘 뜨는 기술 접기" title="접기">
              <span aria-hidden="true">‹</span>
            </button>
          </div>
        </div>
      )}
      {verdictView && (
        <VerdictModal
          term={verdictView.term}
          info={verdictView.info}
          threatFactor={verdictData?.threatFactor}
          onClose={() => setVerdictView(null)}
          onAnalyze={(t) => {
            setVerdictView(null)
            setDrawer(false)
            analyze(t)
          }}
        />
      )}
    </main>
  )
}

export default Dashboard
