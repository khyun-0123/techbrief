import { useEffect, useState } from 'react'
import { requestSummary } from './api.js'
import { SAMPLE_SUMMARIES } from './sampleArticles.js'
import { formatPublished, load } from './utils.js'

const IMPORTANCE_LABEL = { high: '중요도 높음', normal: '중요도 보통' }
const AI_SUMMARIES_KEY = 'techbrief-ai-summaries'

// 6항목 요약 (1차 인터뷰)
const ITEM_LABELS = [
  ['concept', '컨셉'],
  ['principle', '원리'],
  ['pros_cons', '장단점'],
  ['competitors', '타사 현황'],
  ['application', '활용 방안'],
  ['effect', '효과성'],
]
const BASIS_LABEL = {
  article: '기사 근거',
  ai_background: 'AI 보충 · 확인 필요',
  ai_suggestion: 'AI 제안',
}

// 실제 기사는 서버가 매긴 중요도, 샘플은 샘플 값
function importanceOf(article) {
  return article.importanceLevel ?? SAMPLE_SUMMARIES[article.id]?.importance ?? 'normal'
}

function SelectSummary({ candidates, includedIds, setIncludedIds, onExclude, onGoCollect }) {
  const [sort, setSort] = useState('importance')
  const [activeId, setActiveId] = useState(null)
  const [aiSummaries, setAiSummaries] = useState(() => load(AI_SUMMARIES_KEY, {}))
  const [loadingId, setLoadingId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    localStorage.setItem(AI_SUMMARIES_KEY, JSON.stringify(aiSummaries))
  }, [aiSummaries])

  const sorted = [...candidates].sort((a, b) => {
    if (sort === 'importance') {
      const rank = (x) => (importanceOf(x) === 'high' ? 0 : 1)
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
    }
    return a.hoursAgo - b.hoursAgo
  })

  // 고른 기사가 목록에서 빠지면 첫 기사를 보여 준다
  const active = sorted.find((a) => a.id === activeId) ?? sorted[0]
  const summary = active && SAMPLE_SUMMARIES[active.id]
  const ai = active && aiSummaries[active.id]
  const activeIncluded = active && includedIds.includes(active.id)

  function toggleIncluded(id) {
    setIncludedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function includeOne(id) {
    setIncludedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  async function handleSummarize(article) {
    setLoadingId(article.id)
    setError('')
    try {
      const result = await requestSummary(article, { refresh: Boolean(aiSummaries[article.id]) })
      setAiSummaries((prev) => ({ ...prev, [article.id]: result }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>뉴스 선별·요약</h1>
        <p>보고서에 넣을 기사를 고르고, 기사별 요약을 확인해요. 「AI 요약 생성」을 누르면 6항목으로 요약해요.</p>
      </header>

      {candidates.length === 0 ? (
        <section className="panel select-empty">
          <p className="empty">아직 선별한 기사가 없어요. 수집 현황에서 「선별에 추가」를 눌러 주세요.</p>
          <button type="button" className="btn primary" onClick={onGoCollect}>
            수집 현황으로 가기
          </button>
        </section>
      ) : (
        <div className="select-content">
          <section className="panel">
            <div className="candidate-header">
              <h2>후보 기사 {candidates.length}건</h2>
              <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬">
                <option value="importance">중요도순</option>
                <option value="latest">최신순</option>
              </select>
              <button type="button" className="btn" onClick={() => setIncludedIds(candidates.map((a) => a.id))}>
                전체 선택
              </button>
              <button type="button" className="btn" onClick={() => setIncludedIds([])}>
                선택 해제
              </button>
            </div>

            <ul className="candidates">
              {sorted.map((a) => {
                const importance = importanceOf(a)
                return (
                  <li
                    key={a.id}
                    className={a.id === active.id ? 'candidate active' : 'candidate'}
                    onClick={() => setActiveId(a.id)}
                  >
                    <input
                      type="checkbox"
                      checked={includedIds.includes(a.id)}
                      onChange={() => toggleIncluded(a.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`${a.title} 보고서에 포함`}
                    />
                    <div className="candidate-text">
                      <div className="title">{a.title}</div>
                      <div className="meta">
                        {a.source} · {formatPublished(a.hoursAgo)}
                        {a.sameIssue > 0 && ` · 같은 이슈 ${a.sameIssue}건`}
                      </div>
                    </div>
                    <span className={importance === 'high' ? 'chip' : 'chip muted'}>{IMPORTANCE_LABEL[importance]}</span>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="panel detail">
            <span className="detail-label">선택한 기사</span>
            <h2>{active.title}</h2>
            <p className="meta">
              {active.source} · {formatPublished(active.hoursAgo)}
              {active.sameIssue > 0 && ` · 같은 이슈 기사 ${active.sameIssue}건 묶음`}
            </p>

            {ai ? (
              <>
                <h3>AI 요약 (6항목)</h3>
                <dl className="ai-summary">
                  {ITEM_LABELS.map(([key, label]) => {
                    const item = ai.summary.items?.[key]
                    if (!item) return null
                    return (
                      <div key={key} className="ai-item">
                        <dt>{label}</dt>
                        <dd>
                          {item.text}
                          {item.basis === 'article' && item.refs?.length > 0 && (
                            <span className="ref"> [{item.refs.join('][')}]</span>
                          )}
                          <span className={`basis basis-${item.basis}`}>{BASIS_LABEL[item.basis] ?? item.basis}</span>
                        </dd>
                      </div>
                    )
                  })}
                </dl>
                {ai.summary.warnings?.length > 0 && (
                  <p className="ai-warning">⚠ {ai.summary.warnings.join(' / ')}</p>
                )}
                <p className="hint">
                  모델 {ai.model} · {new Date(ai.createdAt).toLocaleString('ko-KR')}
                </p>
              </>
            ) : summary ? (
              <h3>3줄 요약 (샘플)</h3>
            ) : (
              <h3>기사 요약문</h3>
            )}
            {ai ? null : summary ? (
              <ol className="summary">
                {summary.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            ) : active.description ? (
              <p className="description">{active.description}</p>
            ) : (
              <p className="hint">이 기사는 아직 요약이 없어요.</p>
            )}

            <h3>핵심 키워드</h3>
            <div className="chips">
              {(ai?.summary.keywords ?? summary?.keywords ?? [active.keyword]).map((k) => (
                <span key={k} className="chip">
                  {k}
                </span>
              ))}
            </div>

            {active.url ? (
              <p className="source-link">
                원문 링크:{' '}
                <a href={active.url} target="_blank" rel="noreferrer">
                  {active.source} 원문 열기 ↗
                </a>
              </p>
            ) : (
              <p className="source-link">원문 링크: 샘플 기사라 원문이 없어요</p>
            )}

            {error && <p className="ai-error">{error}</p>}

            <div className="detail-actions">
              <button
                type="button"
                className="btn"
                onClick={() => handleSummarize(active)}
                disabled={loadingId !== null}
              >
                {loadingId === active.id ? 'AI 요약 중…' : ai ? '요약 다시 생성' : 'AI 요약 생성'}
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => includeOne(active.id)}
                disabled={activeIncluded}
              >
                {activeIncluded ? '보고서에 포함됨 ✓' : '보고서에 포함'}
              </button>
              <button type="button" className="btn danger" onClick={() => onExclude(active.id)}>
                제외
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="panel report-bar">
        <span>
          보고서에 포함된 기사 <strong>{includedIds.length}건</strong>
        </span>
        <button type="button" className="btn primary" disabled title="보고서 초안 화면은 다음 단계에서 만들어요">
          보고서 초안 만들기
        </button>
      </section>
    </main>
  )
}

export default SelectSummary
