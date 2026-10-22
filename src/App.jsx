import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { collectNews, fetchHealth } from './api.js'
import ProgressPanel from './ProgressPanel.jsx'
import ReportArchive from './ReportArchive.jsx'
import ReportDraft from './ReportDraft.jsx'
import { loadReports, saveReports } from './reportStore.js'
import { useSummaryQueue } from './summaryQueue.js'
import { DEFAULT_KEYWORDS, SAMPLE_ARTICLES } from './sampleArticles.js'
import SelectSummary from './SelectSummary.jsx'
import { formatPublished, load } from './utils.js'

const KEYWORDS_KEY = 'techbrief-keywords'
const SELECTED_KEY = 'techbrief-selected'
const INCLUDED_KEY = 'techbrief-included'
const ARTICLES_KEY = 'techbrief-articles' // 마지막으로 수집한 기사 (서버를 꺼도 화면에 남게)
const COLLECTED_AT_KEY = 'techbrief-collected-at'
const AI_SUMMARIES_KEY = 'techbrief-ai-summaries'
const MAX_SAVED = 400

// 서버 기사(publishedAt)를 화면에서 쓰는 모양(hoursAgo)으로 바꾼다
function toView(a) {
  if (a.hoursAgo !== undefined) return a
  return { ...a, hoursAgo: Math.max(0, (Date.now() - Date.parse(a.publishedAt)) / 3600_000) }
}

const PERIODS = [
  { value: 'today', label: '오늘', hours: 24 },
  { value: 'week', label: '최근 7일', hours: 24 * 7 },
  { value: 'all', label: '전체', hours: Infinity },
]

function App() {
  const [keywords, setKeywords] = useState(() => load(KEYWORDS_KEY, DEFAULT_KEYWORDS))
  const [selectedIds, setSelectedIds] = useState(() => load(SELECTED_KEY, []))
  const [includedIds, setIncludedIds] = useState(() => load(INCLUDED_KEY, []))
  const [screen, setScreen] = useState('collect')
  const [keywordInput, setKeywordInput] = useState('')
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState('today')
  const [source, setSource] = useState('all')
  const [fetched, setFetched] = useState(() => load(ARTICLES_KEY, []))
  const [collectedAt, setCollectedAt] = useState(() => load(COLLECTED_AT_KEY, null))
  const [collecting, setCollecting] = useState(false)
  const [collectError, setCollectError] = useState('')
  const [sort, setSort] = useState('latest')
  const [aiSummaries, setAiSummaries] = useState(() => load(AI_SUMMARIES_KEY, {}))
  const [reports, setReports] = useState(() => loadReports())
  const [health, setHealth] = useState(null) // { model, modelReachable } | { error }

  // 상단 메뉴 오른쪽의 AI 연결 상태 (1분마다 확인)
  useEffect(() => {
    let alive = true
    const check = () =>
      fetchHealth()
        .then((h) => alive && setHealth(h))
        .catch(() => alive && setHealth({ error: true }))
    check()
    const timer = setInterval(check, 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  function updateReports(update) {
    setReports((prev) => {
      const next = update(prev)
      saveReports(next)
      return next
    })
  }

  useEffect(() => {
    localStorage.setItem(AI_SUMMARIES_KEY, JSON.stringify(aiSummaries))
  }, [aiSummaries])

  // 「선별에 추가」하면 자동 요약 (08 13-1: 선별한 기사만 요약)
  const queue = useSummaryQueue({
    onDone: (id, result) => setAiSummaries((prev) => ({ ...prev, [id]: result })),
  })

  useEffect(() => {
    localStorage.setItem(KEYWORDS_KEY, JSON.stringify(keywords))
  }, [keywords])

  useEffect(() => {
    localStorage.setItem(SELECTED_KEY, JSON.stringify(selectedIds))
  }, [selectedIds])

  useEffect(() => {
    localStorage.setItem(INCLUDED_KEY, JSON.stringify(includedIds))
  }, [includedIds])

  // 한 번도 수집하지 않았으면 샘플 기사를 보여 준다
  const isSample = fetched.length === 0
  const pool = useMemo(() => (isSample ? SAMPLE_ARTICLES : fetched.map(toView)), [isSample, fetched])
  const sources = useMemo(() => [...new Set(pool.map((a) => a.source))].sort(), [pool])

  // 수집 대상: 등록한 키워드에 해당하는 기사
  const collected = pool.filter((a) => keywords.includes(a.keyword))
  const todayIssues = collected.filter((a) => a.hoursAgo < 24)
  const countArticles = (list) => list.reduce((n, a) => n + 1 + (a.sameIssue ?? 0), 0)

  const maxHours = PERIODS.find((p) => p.value === period).hours
  const q = query.trim().toLowerCase()
  const visible = collected
    .filter(
      (a) =>
        a.hoursAgo < maxHours &&
        (source === 'all' || a.source === source) &&
        (!q || a.title.toLowerCase().includes(q) || a.keyword.toLowerCase().includes(q)),
    )
    .sort((a, b) => (sort === 'importance' ? (b.importance ?? 0) - (a.importance ?? 0) : 0) || a.hoursAgo - b.hoursAgo)

  function handleAddKeyword(e) {
    e.preventDefault()
    const word = keywordInput.trim()
    if (!word || keywords.includes(word)) return
    setKeywords((prev) => [...prev, word])
    setKeywordInput('')
  }

  function handleRemoveKeyword(word) {
    setKeywords((prev) => prev.filter((k) => k !== word))
  }

  async function handleCollect() {
    setCollecting(true)
    setCollectError('')
    try {
      const result = await collectNews(keywords)
      const articles = result.articles.slice(0, MAX_SAVED)
      setFetched(articles)
      setCollectedAt(result.lastCollectedAt)
      localStorage.setItem(ARTICLES_KEY, JSON.stringify(articles))
      localStorage.setItem(COLLECTED_AT_KEY, JSON.stringify(result.lastCollectedAt))
      if (result.failed?.length) {
        setCollectError(`일부 키워드 수집 실패: ${result.failed.map((f) => f.keyword).join(', ')}`)
      }
    } catch (err) {
      setCollectError(err.message)
    } finally {
      setCollecting(false)
    }
  }

  function toggleSelected(article) {
    const { id } = article
    if (selectedIds.includes(id)) {
      setSelectedIds((prev) => prev.filter((x) => x !== id))
      // 선별을 풀면 보고서 포함 목록에서도 빼고, 아직 시작 전인 요약은 취소한다
      setIncludedIds((prev) => prev.filter((x) => x !== id))
      queue.remove(id)
    } else {
      setSelectedIds((prev) => [...prev, id])
      if (!aiSummaries[id]) queue.enqueue(article)
    }
  }

  // 선별에서 빠진 기사는 보고서 포함 목록에서도 뺀다
  const candidates = pool.filter((a) => selectedIds.includes(a.id))
  const included = includedIds.filter((id) => selectedIds.includes(id))

  function handleExclude(id) {
    setSelectedIds((prev) => prev.filter((x) => x !== id))
    setIncludedIds((prev) => prev.filter((x) => x !== id))
    queue.remove(id)
  }

  // 보고서에는 선별 화면에서 고른 순서대로
  const reportArticles = included.map((id) => candidates.find((a) => a.id === id)).filter(Boolean)

  return (
    <div className="app">
      <nav className="topbar">
        <span className="brand">테크브리프</span>
        <div className="tabs">
        <button
          type="button"
          className={screen === 'collect' ? 'tab active' : 'tab'}
          onClick={() => setScreen('collect')}
        >
          수집 현황
        </button>
        <button
          type="button"
          className={screen === 'select' ? 'tab active' : 'tab'}
          onClick={() => setScreen('select')}
        >
          선별·요약
        </button>
        <button
          type="button"
          className={screen === 'report' ? 'tab active' : 'tab'}
          onClick={() => setScreen('report')}
        >
          보고서 초안
        </button>
        <button
          type="button"
          className={screen === 'archive' ? 'tab active' : 'tab'}
          onClick={() => setScreen('archive')}
        >
          보고서함{reports.length > 0 && <span className="tab-count">{reports.length}</span>}
        </button>
        </div>
        <span className="topbar-side">
          {health === null ? null : health.error ? (
            <span className="ai-status off">● 서버 연결 안 됨</span>
          ) : health.modelReachable ? (
            <span className="ai-status on" title="AI 요약 모델에 연결됨">
              ● AI {health.model}
            </span>
          ) : (
            <span className="ai-status off" title="맥미니(AI 서버)에 닿지 않아요. 요약·보고서를 만들 수 없어요">
              ● AI 연결 안 됨
            </span>
          )}
        </span>
      </nav>

      {screen === 'archive' ? (
        <ReportArchive
          reports={reports}
          onDelete={(id) => updateReports((list) => list.filter((r) => r.id !== id))}
          onGoDraft={() => setScreen(reportArticles.length ? 'report' : 'select')}
        />
      ) : screen === 'report' ? (
        <ReportDraft
          articles={reportArticles}
          aiSummaries={aiSummaries}
          queue={queue}
          reports={reports}
          onSaved={(entry) => updateReports((list) => [entry, ...list])}
          onUpdated={(entry) => updateReports((list) => list.map((r) => (r.id === entry.id ? entry : r)))}
          onGoSelect={() => setScreen('select')}
          onGoArchive={() => setScreen('archive')}
        />
      ) : screen === 'select' ? (
        <SelectSummary
          candidates={candidates}
          includedIds={included}
          setIncludedIds={setIncludedIds}
          onExclude={handleExclude}
          onGoCollect={() => setScreen('collect')}
          onGoReport={() => setScreen('report')}
          aiSummaries={aiSummaries}
          queue={queue}
        />
      ) : (
        <main className="page">
          <header className="page-header with-actions">
            <div>
              <h1>뉴스 수집 현황</h1>
              <p>
                {isSample
                  ? '키워드로 기사를 모아 보여 줘요. 아직 수집 전이라 샘플 기사를 보여 줘요.'
                  : '네이버 뉴스에서 모은 기사예요. 같은 이슈 기사는 하나로 묶었어요.'}
              </p>
            </div>
            <span className="last-collected">
              {collecting ? '수집 중…' : collectedAt ? `마지막 수집 ${new Date(collectedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '아직 수집 전'}
            </span>
          </header>

          <section className="stats">
            <div className="stat">
              <span className="stat-label">오늘 수집된 이슈 · 기사</span>
              <strong>
                {todayIssues.length}개 <small>· 기사 {countArticles(todayIssues)}건</small>
              </strong>
            </div>
            <div className="stat">
              <span className="stat-label">등록한 키워드</span>
              <strong>{keywords.length}개</strong>
            </div>
            <div className="stat">
              <span className="stat-label">선별한 기사</span>
              <strong>{selectedIds.length}건</strong>
            </div>
          </section>

          <div className="content">
            <section className="panel list-panel">
              <div className="filters">
                <input
                  type="search"
                  placeholder="모은 기사에서 찾기 (제목·키워드)"
                  aria-label="모은 기사에서 찾기"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="기간">
                  {PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="출처">
                  <option value="all">모든 출처</option>
                  {sources.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬">
                  <option value="latest">최신순</option>
                  <option value="importance">중요도순</option>
                </select>
              </div>
              <p className="list-meta">
                이슈 {visible.length}개 · 기사 {countArticles(visible)}건
              </p>

              {visible.length === 0 ? (
                <p className="empty">조건에 맞는 기사가 없어요. 기간을 넓히거나 키워드를 추가해 보세요.</p>
              ) : (
                <table className="articles">
                  <colgroup>
                    <col />
                    <col className="col-source" />
                    <col className="col-time" />
                    <col className="col-keyword" />
                    <col className="col-actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>제목</th>
                      <th>출처</th>
                      <th>발행</th>
                      <th>키워드</th>
                      <th>작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((a) => {
                      const selected = selectedIds.includes(a.id)
                      return (
                        <tr key={a.id}>
                          <td>
                            <div className="title" title={a.title}>
                              {a.importanceLevel === 'high' && <span className="badge-important">중요</span>}
                              {a.title}
                            </div>
                            {a.sameIssue > 0 && <div className="same-issue">같은 이슈 기사 {a.sameIssue}건</div>}
                          </td>
                          <td className="source" title={a.source}>
                            {a.source}
                          </td>
                          <td>{formatPublished(a.hoursAgo)}</td>
                          <td>
                            <span className="chip">{a.keyword}</span>
                          </td>
                          <td className="actions">
                            {a.url ? (
                              <a className="btn" href={a.url} target="_blank" rel="noreferrer">
                                원문 보기
                              </a>
                            ) : (
                              <button type="button" className="btn" disabled title="샘플 기사라 원문이 없어요">
                                원문 보기
                              </button>
                            )}
                            <button
                              type="button"
                              className={selected ? 'btn primary' : 'btn outline'}
                              onClick={() => toggleSelected(a)}
                            >
                              {selected ? '선별됨 ✓' : '선별에 추가'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </section>

            <aside className="panel settings">
              <h2>수집 설정</h2>
              <form onSubmit={handleAddKeyword}>
                <label htmlFor="keyword">키워드</label>
                <input
                  id="keyword"
                  type="text"
                  placeholder="키워드를 입력하고 Enter"
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                />
              </form>
              <div className="chips">
                {keywords.map((k) => (
                  <span key={k} className="chip">
                    {k}
                    <button type="button" onClick={() => handleRemoveKeyword(k)} aria-label={`${k} 삭제`}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="btn primary collect-btn"
                onClick={handleCollect}
                disabled={collecting || keywords.length === 0}
              >
                {collecting ? '수집 중…' : '지금 수집하기'}
              </button>
              <p className="hint">키워드마다 네이버 뉴스 최신 100건을 가져와요.</p>
              {collectError && <p className="ai-error">{collectError}</p>}
              {isSample && <p className="hint">샘플 기사에는 생성형 AI · 반도체 · 클라우드 · OLED 키워드가 있어요.</p>}
            </aside>
          </div>
        </main>
      )}
      <ProgressPanel queue={queue} />
    </div>
  )
}

export default App
