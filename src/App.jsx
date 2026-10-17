import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { DEFAULT_KEYWORDS, SAMPLE_ARTICLES } from './sampleArticles.js'
import SelectSummary from './SelectSummary.jsx'
import { formatPublished, load } from './utils.js'

const KEYWORDS_KEY = 'techbrief-keywords'
const SELECTED_KEY = 'techbrief-selected'
const INCLUDED_KEY = 'techbrief-included'

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

  useEffect(() => {
    localStorage.setItem(KEYWORDS_KEY, JSON.stringify(keywords))
  }, [keywords])

  useEffect(() => {
    localStorage.setItem(SELECTED_KEY, JSON.stringify(selectedIds))
  }, [selectedIds])

  useEffect(() => {
    localStorage.setItem(INCLUDED_KEY, JSON.stringify(includedIds))
  }, [includedIds])

  const sources = useMemo(() => [...new Set(SAMPLE_ARTICLES.map((a) => a.source))], [])

  // 수집 대상: 등록한 키워드에 해당하는 기사
  const collected = SAMPLE_ARTICLES.filter((a) => keywords.includes(a.keyword))
  const todayCount = collected.filter((a) => a.hoursAgo < 24).length

  const maxHours = PERIODS.find((p) => p.value === period).hours
  const q = query.trim().toLowerCase()
  const visible = collected.filter(
    (a) =>
      a.hoursAgo < maxHours &&
      (source === 'all' || a.source === source) &&
      (!q || a.title.toLowerCase().includes(q) || a.keyword.toLowerCase().includes(q)),
  )

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

  function toggleSelected(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // 선별에서 빠진 기사는 보고서 포함 목록에서도 뺀다
  const candidates = SAMPLE_ARTICLES.filter((a) => selectedIds.includes(a.id))
  const included = includedIds.filter((id) => selectedIds.includes(id))

  function handleExclude(id) {
    setSelectedIds((prev) => prev.filter((x) => x !== id))
    setIncludedIds((prev) => prev.filter((x) => x !== id))
  }

  return (
    <div className="app">
      <nav className="topbar">
        <span className="brand">테크브리프</span>
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
        <span className="tab disabled" title="다음 단계에서 만들 화면">보고서 초안</span>
      </nav>

      {screen === 'select' ? (
        <SelectSummary
          candidates={candidates}
          includedIds={included}
          setIncludedIds={setIncludedIds}
          onExclude={handleExclude}
          onGoCollect={() => setScreen('collect')}
        />
      ) : (
        <main className="page">
          <header className="page-header">
            <h1>뉴스 수집 현황</h1>
            <p>설정한 키워드로 기사를 모아 보여 줘요. 지금은 샘플 기사로 동작해요.</p>
          </header>

          <section className="stats">
            <div className="stat">
              <span className="stat-label">오늘 수집된 기사</span>
              <strong>{todayCount}건</strong>
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
                  placeholder="제목이나 키워드로 검색"
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
              </div>

              {visible.length === 0 ? (
                <p className="empty">조건에 맞는 기사가 없어요. 기간을 넓히거나 키워드를 추가해 보세요.</p>
              ) : (
                <table className="articles">
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
                            <div className="title">{a.title}</div>
                            {a.sameIssue > 0 && <div className="same-issue">같은 이슈 기사 {a.sameIssue}건</div>}
                          </td>
                          <td>{a.source}</td>
                          <td>{formatPublished(a.hoursAgo)}</td>
                          <td>
                            <span className="chip">{a.keyword}</span>
                          </td>
                          <td className="actions">
                            <button type="button" className="btn" disabled title="샘플 기사라 원문이 없어요">
                              원문 보기
                            </button>
                            <button
                              type="button"
                              className={selected ? 'btn primary' : 'btn outline'}
                              onClick={() => toggleSelected(a.id)}
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
              <p className="hint">샘플 기사에는 생성형 AI · 반도체 · 클라우드 · OLED 키워드가 있어요.</p>
            </aside>
          </div>
        </main>
      )}
    </div>
  )
}

export default App
