import { useState } from 'react'
import { SAMPLE_SUMMARIES } from './sampleArticles.js'
import SummaryItems from './SummaryItems.jsx'
import { formatPublished } from './utils.js'

const IMPORTANCE_LABEL = { high: '중요도 높음', normal: '중요도 보통' }
const JOB_LABEL = { queued: '요약 대기', running: '요약 중', error: '요약 오류' }

// 실제 기사는 서버가 매긴 중요도, 샘플은 샘플 값
function importanceOf(article) {
  return article.importanceLevel ?? SAMPLE_SUMMARIES[article.id]?.importance ?? 'normal'
}

// aiSummaries·queue는 App이 관리한다 (「선별 추가」하면 자동 요약)
function SelectSummary({ candidates, includedIds, setIncludedIds, onExclude, onGoCollect, onGoReport, aiSummaries, queue }) {
  const [sort, setSort] = useState('importance')
  const [activeId, setActiveId] = useState(null)

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
  const jobOf = (id) => queue.jobs.find((j) => j.id === id)
  const activeJob = active && jobOf(active.id)
  const activeBusy = activeJob && (activeJob.status === 'queued' || activeJob.status === 'running')
  const summarizedCount = candidates.filter((a) => aiSummaries[a.id]).length
  const allChecked = candidates.length > 0 && candidates.every((a) => includedIds.includes(a.id))

  function toggleIncluded(id) {
    setIncludedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleAll() {
    setIncludedIds(allChecked ? [] : candidates.map((a) => a.id))
  }

  return (
    <main className="page">
      <header className="page-header with-actions">
        <div>
          <h1>뉴스 선별·요약</h1>
          <p>선별한 기사는 자동으로 6항목 요약을 시작해요. 요약을 확인하고 보고서에 넣을 기사를 체크하세요.</p>
        </div>
        <div className="header-actions">
          <span className="header-count">
            보고서에 넣을 기사 <strong>{includedIds.length}건</strong>
          </span>
          <button
            type="button"
            className="btn primary"
            onClick={onGoReport}
            disabled={includedIds.length === 0}
            title={includedIds.length === 0 ? '왼쪽 목록에서 보고서에 넣을 기사를 체크하세요' : undefined}
          >
            보고서 초안 만들기 →
          </button>
        </div>
      </header>

      {candidates.length === 0 ? (
        <section className="panel select-empty">
          <p className="empty">아직 선별한 기사가 없어요. 수집 현황에서 「선별 추가」를 눌러 주세요.</p>
          <button type="button" className="btn primary" onClick={onGoCollect}>
            수집 현황으로 가기
          </button>
        </section>
      ) : (
        <div className="select-content">
          <section className="panel select-pane">
            <div className="candidate-header">
              <h2>
                후보 기사 {candidates.length}건 <small>· 요약 완료 {summarizedCount}</small>
              </h2>
              <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬">
                <option value="importance">중요도순</option>
                <option value="latest">최신순</option>
              </select>
              <button type="button" className="btn" onClick={toggleAll}>
                {allChecked ? '전체 해제' : '전체 선택'}
              </button>
            </div>

            <ul className="candidates">
              {sorted.map((a) => {
                const importance = importanceOf(a)
                const job = jobOf(a.id)
                const jobStatus = aiSummaries[a.id] && job?.status !== 'running' && job?.status !== 'queued' ? 'done' : job?.status
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
                        {jobStatus === 'done' && <span className="summary-state done"> · 요약 완료</span>}
                        {jobStatus && jobStatus !== 'done' && (
                          <span className={`summary-state ${jobStatus}`}>
                            {' '}
                            · {JOB_LABEL[jobStatus]}
                            {jobStatus === 'running' && ` ${queue.progressOf(job)}%`}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={importance === 'high' ? 'chip' : 'chip muted'}>{IMPORTANCE_LABEL[importance]}</span>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="panel select-pane detail">
            <div className="detail-body">
              <span className="detail-label">선택한 기사</span>
              <h2>{active.title}</h2>
              <p className="meta">
                {active.source} · {formatPublished(active.hoursAgo)}
                {active.sameIssue > 0 && ` · 같은 이슈 기사 ${active.sameIssue}건 묶음`}
              </p>

              {activeBusy && (
                <div className="summary-progress">
                  <span>
                    {activeJob.status === 'running'
                      ? `AI 요약 중 ${queue.progressOf(activeJob)}% (예상)`
                      : `요약 대기 중 — 앞에 ${queue.jobs.filter((j) => j.status === 'queued' || j.status === 'running').findIndex((j) => j.id === active.id)}건`}
                  </span>
                  <div className="gauge gauge-running">
                    <div className="gauge-fill" style={{ width: `${queue.progressOf(activeJob)}%` }} />
                  </div>
                </div>
              )}
              {activeJob?.status === 'error' && <p className="ai-error">요약 오류: {activeJob.error}</p>}

              {ai ? (
                <>
                  <h3>AI 요약 (6항목)</h3>
                  <SummaryItems summary={ai.summary} />
                  {ai.summary.warnings?.length > 0 && <p className="ai-warning">⚠ {ai.summary.warnings.join(' / ')}</p>}
                  <p className="hint">
                    모델 {ai.model} · {new Date(ai.createdAt).toLocaleString('ko-KR')}
                  </p>
                </>
              ) : summary ? (
                <>
                  <h3>3줄 요약 (샘플)</h3>
                  <ol className="summary">
                    {summary.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ol>
                </>
              ) : (
                <>
                  <h3>기사 요약문</h3>
                  {active.description ? (
                    <p className="description">{active.description}</p>
                  ) : (
                    <p className="hint">이 기사는 아직 요약이 없어요.</p>
                  )}
                </>
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
            </div>

            <div className="detail-actions">
              <button
                type="button"
                className="btn"
                onClick={() => queue.enqueue(active, { refresh: Boolean(ai) })}
                disabled={Boolean(activeBusy)}
              >
                {activeBusy ? '요약 진행 중…' : ai ? '요약 다시 생성' : 'AI 요약 생성'}
              </button>
              <button
                type="button"
                className={activeIncluded ? 'btn' : 'btn primary'}
                onClick={() => toggleIncluded(active.id)}
              >
                {activeIncluded ? '보고서에서 빼기' : '보고서에 넣기'}
              </button>
              <button type="button" className="btn danger" onClick={() => onExclude(active.id)}>
                선별 취소
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default SelectSummary
