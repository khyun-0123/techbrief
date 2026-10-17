import { useState } from 'react'
import { SAMPLE_SUMMARIES } from './sampleArticles.js'
import { formatPublished } from './utils.js'

const IMPORTANCE_LABEL = { high: '중요도 높음', normal: '중요도 보통' }

function SelectSummary({ candidates, includedIds, setIncludedIds, onExclude, onGoCollect }) {
  const [sort, setSort] = useState('importance')
  const [activeId, setActiveId] = useState(null)

  const sorted = [...candidates].sort((a, b) => {
    if (sort === 'importance') {
      const rank = (x) => (SAMPLE_SUMMARIES[x.id]?.importance === 'high' ? 0 : 1)
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
    }
    return a.hoursAgo - b.hoursAgo
  })

  // 고른 기사가 목록에서 빠지면 첫 기사를 보여 준다
  const active = sorted.find((a) => a.id === activeId) ?? sorted[0]
  const summary = active && SAMPLE_SUMMARIES[active.id]
  const activeIncluded = active && includedIds.includes(active.id)

  function toggleIncluded(id) {
    setIncludedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function includeOne(id) {
    setIncludedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>뉴스 선별·요약</h1>
        <p>보고서에 넣을 기사를 고르고, 기사별 3줄 요약을 확인해요. 지금은 샘플 요약으로 동작해요.</p>
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
                const importance = SAMPLE_SUMMARIES[a.id]?.importance ?? 'normal'
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

            <h3>3줄 요약</h3>
            {summary ? (
              <ol className="summary">
                {summary.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            ) : (
              <p className="hint">이 기사는 아직 요약이 없어요.</p>
            )}

            <h3>핵심 키워드</h3>
            <div className="chips">
              {(summary?.keywords ?? [active.keyword]).map((k) => (
                <span key={k} className="chip">
                  {k}
                </span>
              ))}
            </div>

            <p className="source-link">원문 링크: 샘플 기사라 원문이 없어요</p>

            <div className="detail-actions">
              <button type="button" className="btn" disabled title="AI 요약 연결 후 사용할 수 있어요">
                요약 다시 생성
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
