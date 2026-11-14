// 테스트 페이지(/admin/test)의 「시험 도구」 탭. 관리자만 쓴다
// 1. 수집 시험: 네이버에서 찾기를 기간별로 돌려 몇 건이 오는지, 얼마나 걸리는지 (찾기는 원래 저장하지 않음)
// 2. 요약 시험: 기사 한 건을 AI 서버별로 요약해 나란히 비교. 저장하지 않아 공용 요약에 영향 없음
import { useState } from 'react'
import { searchNewsApi, testSummaryApi } from './api.js'
import SummaryItems from './SummaryItems.jsx'
import { Seg } from './Dropdown.jsx'

const PERIODS = [
  ['today', '최근 24시간'],
  ['week', '최근 7일'],
  ['all', '기간 전체 (정확도순)'],
]

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}초`
}

function TestTools({ providers }) {
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState('week')
  const [search, setSearch] = useState(null) // { loading } | { result, ms } | { error }
  const [pickedId, setPickedId] = useState(null)
  const ready = providers.filter((p) => p.ready)
  const [chosen, setChosen] = useState(() => ready.map((p) => p.id))
  const [runs, setRuns] = useState({}) // provider id → { loading } | { result } | { error }

  const articles = search?.result?.articles ?? []
  const picked = articles.find((a) => a.id === pickedId)

  async function runSearch(e) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setSearch({ loading: true })
    setPickedId(null)
    setRuns({})
    const started = Date.now()
    try {
      const result = await searchNewsApi(q, period)
      setSearch({ result, ms: Date.now() - started })
    } catch (err) {
      setSearch({ error: err.message })
    }
  }

  // AI 서버는 한 번에 하나씩 처리되므로 차례로 부른다
  async function runSummaries() {
    if (!picked) return
    const targets = ready.filter((p) => chosen.includes(p.id))
    setRuns(Object.fromEntries(targets.map((p) => [p.id, { loading: true }])))
    for (const p of targets) {
      try {
        const result = await testSummaryApi(picked, picked.related ?? [], p.id)
        setRuns((prev) => ({ ...prev, [p.id]: { result } }))
      } catch (err) {
        setRuns((prev) => ({ ...prev, [p.id]: { error: err.message } }))
      }
    }
  }

  const running = Object.values(runs).some((r) => r.loading)

  return (
    <main className="page">
      <header className="page-header">
        <h1>시험 도구</h1>
        <p>수집·요약을 시험해 봐요. 여기서 만든 결과는 저장하지 않아 다른 사용자 화면에 영향이 없어요. 요약 시험은 AI 비용이 들어요.</p>
      </header>

      <section className="panel tools-card">
        <h2>1. 수집 시험</h2>
        <form className="tools-row" onSubmit={runSearch}>
          <input type="search" placeholder="검색어 (예: 마이크로LED)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="검색어" />
          <Seg value={period} onChange={setPeriod} label="기간" options={PERIODS.map(([value, label]) => ({ value, label }))} />
          <button type="submit" className="btn primary" disabled={!query.trim() || search?.loading}>
            {search?.loading ? '찾는 중…' : '네이버에서 찾기'}
          </button>
        </form>
        {search?.error && <p className="ai-error" role="alert">{search.error}</p>}
        {search?.result && (
          <>
            <dl className="tools-stats">
              <div>
                <dt>받은 기사</dt>
                <dd>{search.result.fetched}건</dd>
              </div>
              <div>
                <dt>이슈 (같은 이슈 묶은 뒤)</dt>
                <dd>{articles.length}개</dd>
              </div>
              <div>
                <dt>걸린 시간</dt>
                <dd>{seconds(search.ms)}</dd>
              </div>
              <div>
                <dt>상한 도달</dt>
                <dd>{search.result.truncated ? `예 · ${new Date(search.result.oldestAt).toLocaleString('ko-KR')} 이후만` : '아니요'}</dd>
              </div>
            </dl>
            <p className="hint">요약을 시험할 기사를 하나 고르세요 (중요도순 상위 20개).</p>
            <ul className="tools-list">
              {[...articles]
                .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
                .slice(0, 20)
                .map((a) => (
                  <li key={a.id}>
                    <label>
                      <input type="radio" name="pick" checked={pickedId === a.id} onChange={() => setPickedId(a.id)} />
                      <span className="tools-score">{a.importance ?? 0}점</span>
                      {a.title}
                      <span className="tools-meta">
                        {a.source}
                        {a.related?.length > 0 && ` · 같은 이슈 ${a.related.length}건`}
                      </span>
                    </label>
                  </li>
                ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel tools-card">
        <h2>2. 요약 시험 (AI 서버 비교)</h2>
        {ready.length === 0 ? (
          <p className="hint">설정된 AI 서버가 없어요.</p>
        ) : (
          <>
            <div className="tools-row">
              {ready.map((p) => (
                <label key={p.id} className="tools-check">
                  <input
                    type="checkbox"
                    checked={chosen.includes(p.id)}
                    onChange={(e) => setChosen((prev) => (e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)))}
                  />
                  {p.label} · {p.model.split('/').pop()}
                </label>
              ))}
              <button type="button" className="btn primary" onClick={runSummaries} disabled={!picked || chosen.length === 0 || running}>
                {running ? '요약 중…' : '고른 기사로 요약 시험'}
              </button>
            </div>
            {!picked && <p className="hint">위 수집 시험에서 기사를 먼저 고르세요.</p>}
            {picked && <p className="hint">기사: {picked.title}</p>}
            <div className="tools-compare">
              {ready
                .filter((p) => runs[p.id])
                .map((p) => {
                  const r = runs[p.id]
                  return (
                    <div key={p.id} className="tools-result">
                      <h3>
                        {p.label}
                        {r.result && (
                          <span className="tools-meta">
                            {' '}
                            · {r.result.model} · {seconds(r.result.ms)}
                            {r.result.usage?.total_tokens ? ` · ${r.result.usage.total_tokens.toLocaleString()} 토큰` : ''}
                          </span>
                        )}
                      </h3>
                      {r.loading && <p className="hint">요약 중… (한 번에 하나씩 처리해요)</p>}
                      {r.error && <p className="ai-error" role="alert">{r.error}</p>}
                      {r.result && (
                        <>
                          <SummaryItems summary={r.result.summary} />
                          {r.result.summary.warnings?.length > 0 && <p className="hint">⚠ {r.result.summary.warnings.join(' / ')}</p>}
                        </>
                      )}
                    </div>
                  )
                })}
            </div>
          </>
        )}
      </section>
    </main>
  )
}

export default TestTools
