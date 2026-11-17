// 대시보드 (11/07 팀 회의, 11/10 다시 배치): 첫 화면
// - 처음: 「키워드 분석」 검색창 + 바로 아래 「요즘 뜨는 기술」(참고해서 고르도록). 분석 칸은 비어 있어 작다
// - 찾거나 기술을 누르면: 같은 패널 안에서 분석이 펼쳐진다 (연관 키워드 맵 + 기술 시계열, KeywordAnalysis.jsx). 검색창과 분석을 한 카드로 묶어 겹치지 않게
//   「자료 찾기 →」(기간과 함께)를 눌러야 자료 현황에서 뉴스 · 논문을 찾는다. 「닫기」로 처음 모양으로
// - 검색어 칩은 두 묶음 (11/16 조장): 「자동 수집 키워드」(공용, 예전 추천 검색어를 합침) · 「즐겨찾기 · 최근 검색어」(내 것, IP별).
//   어느 칩이든 누르면 그 말로 분석한다 (예전: 자동 수집 키워드는 자료 현황으로 넘어갔음 — 대시보드는 분석하는 곳. 모은 기사는 「자료 찾기 →」)
// - 예전 「추적 중인 키워드 추이」는 11/10 조장 결정으로 뺐다 (KeywordTrends.jsx는 그래프 부품 Spark만 씀)
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchReadyTimelines } from './api.js'
import KeywordAnalysis, { AnalysisPreview } from './KeywordAnalysis.jsx'
import DashHome from './DashHome.jsx'
import { consumeOpenRequest, useOpenRequest, useStoryJobs } from './storyJobs.js'
import TechTrends from './TechTrends.jsx'
import TrendRail from './TrendRail.jsx'
import VerdictModal from './VerdictModal.jsx'
import { LAST_ANALYZED_KEY } from './utils.js'

// 칩에 보이는 이름 (11/14 D6): 저장된 검색어가 「ai 안경」 · 「tandem oled」처럼 소문자라 표 · 카드의 「AI 안경」과 달라 보였음
// → 4글자 이하 영문 낱말(AI · OLED · LED · TFT · QD)만 대문자로. 누르면 원래 말 그대로 분석한다
const showTerm = (q) => String(q).replace(/\b[a-z]{2,4}\b/g, (w) => w.toUpperCase())
// 「바로 볼 수 있는 분석」 처음에 보이는 수 (11/14 D5: 8개 고정) → 11/15: 2줄에 들어가는 만큼, 남으면 마지막 자리에 「+n개 더」
// (FHD에서 8개가 7 + 1로 끊기고, QHD는 12개가 다 들어가는데 4개를 숨겼음). 휴대폰은 한 줄로 두고 옆으로 밀어 봄
const READY_SHOWN = 8 // 아직 못 쟀을 때
const READY_LINES = 1 // 11/17 조장: 한 줄만 (넘치면 「+n개 더」)

// 칩 폭을 차례로 줄에 담아 lines줄 안에 몇 개 들어가는지 (다 못 담으면 「+n개 더」 자리를 남김)
function fitInLines(widths, moreW, avail, gap, lines) {
  const linesOf = (ws) => {
    let n = 1
    let x = 0
    for (const w of ws) {
      if (x === 0) x = w
      else if (x + gap + w <= avail) x += gap + w
      else {
        n += 1
        x = w
      }
    }
    return n
  }
  if (linesOf(widths) <= lines) return widths.length
  for (let k = widths.length - 1; k > 0; k -= 1) if (linesOf([...widths.slice(0, k), moreW]) <= lines) return k
  return 1
}

function Dashboard({ resetKey = 0, homeIssues = [], reports = [], onOpenReport, onGoReports, stats, keywords, favorites, recent, onSearch, onScopeSearch, onAutoReport, onGoCollect, onRemember }) {
  const [text, setText] = useState('')
  const [focus, setFocus] = useState(null) // 분석 중인 말 (없으면 검색창 + 미리 분석된 키워드 + 요즘 뜨는 기술)
  const [ready, setReady] = useState([]) // 미리 분석해 둔 말 (11/10): 검색 전에도 분석이 어떤 모양인지 보이게
  const [readyLoading, setReadyLoading] = useState(true) // 11/17: 받는 동안 칩 자리를 그려 둔다
  const [allReady, setAllReady] = useState(false)
  // 「분석하면 이렇게 보여요 · 예시」 (11/15 조장): 펼친 채로 아래 「최근 중요 기사」가 4건 이상 보이면 펼침, 그보다 적으면 접음.
  // 창 크기를 바꾸면 다시 정하고, 사람이 직접 펴거나 접으면 그때부터는 손대지 않는다. 화면 틀 밖(휴대폰)은 11/14 결정대로 펼침
  const [exampleOpen, setExampleOpen] = useState(true)
  const exampleRef = useRef(null)
  const readyBoxRef = useRef(null)
  const readyMeasureRef = useRef(null)
  const [readyFit, setReadyFit] = useState(READY_SHOWN)
  const exampleManual = useRef(false)
  const exampleExtra = useRef(null) // 펼쳤을 때 늘어나는 높이 (펼쳐 있을 때 잼)
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
  // 대시보드 탭을 한 번 더 누르거나 로고를 누르면 첫 화면으로 (11/15): 분석 · 펼친 목록 · 판정 창을 닫는다
  const firstReset = useRef(resetKey)
  useEffect(() => {
    if (resetKey === firstReset.current) return
    setFocus(null)
    setText('')
    setDrawer(false)
    setVerdictView(null)
  }, [resetKey])
  // 「바로 볼 수 있는 분석」 칩: 보이지 않는 측정 줄에서 칩 폭을 재서 2줄에 담는다 (창 폭이 바뀌면 다시)
  useLayoutEffect(() => {
    if (focus) return undefined
    const box = readyBoxRef.current
    const meas = readyMeasureRef.current
    if (!box || !meas) return undefined
    const decide = () => {
      const list = box.querySelector('.dash-ready-list')
      if (list && getComputedStyle(list).flexWrap === 'nowrap') return setReadyFit(ready.length) // 휴대폰: 한 줄 옆으로 밀기
      const [label, ...rest] = [...meas.children]
      const more = rest.pop()
      const widths = rest.map((e) => e.offsetWidth)
      const avail = box.clientWidth
      const gap = 8
      const total = widths.reduce((a, w) => a + w, 0) + gap * Math.max(0, widths.length - 1)
      // 다 들어가면 제목 옆 한 줄, 아니면 제목 아래 전체 폭으로 2줄
      if (label.offsetWidth + 12 + total <= avail) return setReadyFit(widths.length)
      setReadyFit(fitInLines(widths, more.offsetWidth, avail, gap, READY_LINES))
    }
    decide()
    const ro = new ResizeObserver(decide)
    ro.observe(box)
    return () => ro.disconnect()
  }, [focus, ready])
  useLayoutEffect(() => {
    if (focus) return undefined
    const det = exampleRef.current
    const body = document.querySelector('.dash-home-body.is-articles')
    if (!det || !body) return undefined
    const MIN_ROWS = 4
    const decide = () => {
      if (exampleManual.current) return
      if (getComputedStyle(body).maxHeight !== 'none') return setExampleOpen(true)
      // 모두 offsetHeight · clientHeight(배율 전 CSS 픽셀)로 잰다 — 작은 노트북 zoom에서도 단위가 같게
      const row = body.querySelector('li')?.offsetHeight || 52
      const summaryH = det.querySelector('summary')?.offsetHeight ?? 0
      if (det.open) exampleExtra.current = det.offsetHeight - summaryH
      const room = det.open ? body.clientHeight : body.clientHeight - (exampleExtra.current ?? Infinity)
      setExampleOpen(Math.floor(room / row) >= MIN_ROWS)
    }
    decide()
    const ro = new ResizeObserver(decide)
    ro.observe(body)
    ro.observe(det)
    return () => ro.disconnect()
  }, [focus])
  useEffect(() => {
    let alive = true
    fetchReadyTimelines()
      .then((d) => alive && setReady(d.items ?? []))
      .catch(() => {})
      .finally(() => alive && setReadyLoading(false))
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
    // 11/12: 마지막으로 분석한 키워드 — 보고서를 만들 때 그 분석 묶음이 자동으로 근거에 들어간다 (ReportComposer, server/keywordBundle.js)
    try {
      localStorage.setItem(LAST_ANALYZED_KEY, JSON.stringify({ query: q, at: Date.now() }))
    } catch {
      // 저장소를 못 쓰면 보고서에서 주제 키워드를 직접 고른다
    }
    onRemember?.(q)
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  function close() {
    setFocus(null)
    setText('')
  }
  // 내 검색어: ★ 즐겨찾기 먼저, 그 뒤 최근 검색어 (자동 수집 키워드 · 즐겨찾기와 겹치는 말은 한 번만)
  const recentOnly = recent.filter((q) => !favorites.includes(q) && !keywords.includes(q)).slice(0, 8)
  const mine = [...favorites.map((q) => ({ q, star: true })), ...recentOnly.map((q) => ({ q, star: false }))]
  const chipCount = keywords.length + mine.length

  function submit(e) {
    e.preventDefault()
    const q = text.trim()
    if (q) analyze(q)
  }

  return (
    <main className={focus ? 'page page-wide dash-page' : 'page page-wide dash-page is-home'}>
      <header className="page-header with-actions">
        <div>
          <h1>대시보드</h1>
          <p>기술 키워드를 분석하고, 볼 범위를 정한 뒤 자료 현황에서 선별하세요.</p>
        </div>
        <div className="header-actions">
          <span className="header-count">{stats.collectedLabel}</span>
          {/* 11/17 (39 문서 C6): 분석 중에는 숨김 — 같은 곳으로 가는 진한 단추(「자료 고르기 →」)가 분석 칸에 있어 둘이 됐음 */}
          {!focus && (
            <button type="button" className="btn primary" onClick={onGoCollect}>
              자료 현황으로 →
            </button>
          )}
        </div>
      </header>

      <div className="dash-layout">
        <TrendRail onPick={analyze} onOpen={() => setDrawer(true)} onVerdicts={setVerdictData} onVerdict={openVerdict} />
      <div className="dash-main">
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
            {/* 11/14 D5: 눈 갈 곳은 「바로 볼 수 있는 분석」 칩 줄 하나. 분석 예시(11/10)는 아래 접힌 줄로 (자동 수집 키워드 목록과 같은 모양) */}
            {readyLoading && ready.length === 0 && (
              <div className="dash-ready" aria-label="바로 볼 수 있는 분석을 불러오는 중">
                <span className="dash-chips-label">바로 볼 수 있는 분석</span>
                <div className="dash-ready-list" aria-hidden="true">
                  {[96, 120, 140, 104, 88].map((w, i) => (
                    <span key={i} className="dash-ready-item is-wait" style={{ width: w }} />
                  ))}
                </div>
              </div>
            )}
            {ready.length > 0 && (
              <div ref={readyBoxRef} className="dash-ready" aria-label="미리 분석된 키워드">
                <span className="dash-chips-label">바로 볼 수 있는 분석</span>
                {/* 측정용 (보이지 않음): 칩마다 폭을 재서 몇 개 보일지 정한다 */}
                <div ref={readyMeasureRef} className="dash-ready-measure" aria-hidden="true">
                  <span className="dash-chips-label">바로 볼 수 있는 분석</span>
                  {ready.map((r) => (
                    <span key={r.query} className="dash-ready-item">
                      <b>{showTerm(r.query)}</b>
                      {r.stage && <span className="dash-ready-stage">{r.stage}</span>}
                      {mark(r.query)}
                    </span>
                  ))}
                  <span className="btn-text dash-ready-more">+{ready.length}개 더</span>
                </div>
                <div className="dash-ready-list">
                  {(allReady ? ready : ready.slice(0, readyFit)).map((r) => (
                    <button key={r.query} type="button" className="dash-ready-item" onClick={() => analyze(r.query)} title={`${r.from.join(' · ')}${r.growth ? ` · 논문 ${r.growth}배` : ''}${r.story ? ' · AI 정리 있음' : ''}`}>
                      <b>{showTerm(r.query)}</b>
                      {r.stage && <span className="dash-ready-stage">{r.stage}</span>}
                      {mark(r.query)}
                    </button>
                  ))}
                  {ready.length > readyFit && (
                    <button type="button" className="btn-text dash-ready-more" aria-expanded={allReady} onClick={() => setAllReady((v) => !v)}>
                      {allReady ? '접기' : `+${ready.length - readyFit}개 더`}
                    </button>
                  )}
                </div>
              </div>
            )}
            {/* 11/14 조장: 예시는 처음부터 펼쳐 둠. 11/15 조장: 아래 「최근 중요 기사」가 4건보다 적게 보이면 접는다 (위 exampleOpen) */}
            <details
              ref={exampleRef}
              className="dash-more"
              open={exampleOpen}
              onToggle={(e) => {
                if (e.currentTarget.open === exampleOpen) return
                exampleManual.current = true
                setExampleOpen(e.currentTarget.open)
              }}
            >
              <summary>분석하면 이렇게 보여요 · 예시</summary>
              {/* 예시: AI 정리까지 있는 미리 분석 중 흐름이 잘 보이는 것(「연구 지속」이 아닌 단계)을 먼저 */}
              <AnalysisPreview example={(ready.find((r) => r.story && r.stage && r.stage !== '연구 지속') ?? ready.find((r) => r.story))?.query ?? null} onOpen={analyze} />
            </details>
          </>
        )}

        {chipCount > 0 && (
          <details className="dash-more">
            <summary>
              자동 수집 키워드 · 즐겨찾기 · 최근 검색어 <span className="dash-more-count">{chipCount}개</span>
              {[...keywords, ...mine.map((m) => m.q)].some((k) => unseen.has(k)) && mark([...unseen][0])}
            </summary>
            {keywords.length > 0 && (
              <div className="dash-chips">
                <span className="dash-chips-label">
                  자동 수집 키워드
                  <small>모두에게 보이는 추천</small>
                </span>
                <div className="dash-chips-list">
                  {keywords.map((k) => (
                    <button key={k} type="button" className="chip dash-chip" onClick={() => analyze(k)} title={`「${k}」 분석 (자동으로 모으는 키워드)`}>
                      {showTerm(k)}
                      {mark(k)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {mine.length > 0 && (
              <div className="dash-chips">
                <span className="dash-chips-label">
                  즐겨찾기 · 최근 검색어
                  <small>나만 보여요</small>
                </span>
                <div className="dash-chips-list">
                  {mine.map(({ q, star }) => (
                    <button key={q} type="button" className="chip dash-chip" onClick={() => analyze(q)} title={`「${q}」 분석${star ? ' (즐겨찾기)' : ''}`}>
                      {star && <span aria-label="즐겨찾기">★ </span>}
                      {showTerm(q)}
                      {mark(q)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </details>
        )}
        {/* key: 키워드가 바뀌면 새로 그린다 (고른 범위 · 받은 값 초기화) */}
        {focus && <KeywordAnalysis key={focus} keyword={focus} onSearch={onSearch} onScopeSearch={onScopeSearch} onAutoReport={onAutoReport} />}
      </section>
      {/* 첫 화면(분석 전)에만: 최근 중요 기사 · 최근 내 보고서 (11/15 시안 A) */}
      {!focus && <DashHome issues={homeIssues} reports={reports} onOpenReport={onOpenReport} onGoReports={onGoReports} onGoCollect={onGoCollect} />}
      </div>
      </div>

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
