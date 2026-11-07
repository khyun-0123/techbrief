import { useState } from 'react'
import { SAMPLE_SUMMARIES } from './sampleArticles.js'
import { useFeature } from './features.js'
import { AI_BLOCKED_TITLE, useOps } from './ops.js'
import SentimentBadge, { sentimentOf } from './SentimentBadge.jsx'
import SummaryItems from './SummaryItems.jsx'
import { formatPublished } from './utils.js'
import AddMaterial from './AddMaterial.jsx'
import FolderBar from './FolderBar.jsx'
import WikiLookup from './WikiLookup.jsx'
import { dragArticle, INBOX } from './folders.js'

const IMPORTANCE_LABEL = { high: '중요도 높음', normal: '중요도 보통' }
const JOB_LABEL = { queued: '요약 대기', running: '요약 중', error: '요약 오류' }

// 실제 기사는 서버가 매긴 중요도, 샘플은 샘플 값
function importanceOf(article) {
  return article.importanceLevel ?? SAMPLE_SUMMARIES[article.id]?.importance ?? 'normal'
}

// aiSummaries·queue는 App이 관리한다 (「선별 추가」하면 자동 요약)
// 폴더 (11/07 결정, 27 문서 2장): 폴더별로 보고, 끌어서 옮기고, 여러 폴더의 기사를 체크해 한 보고서로 묶는다
function SelectSummary({
  candidates,
  includedIds,
  setIncludedIds,
  onExclude,
  onGoCollect,
  onGoReport,
  aiSummaries,
  queue,
  folders,
  folderIdOf,
  folderCounts,
  onMove,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMaterialAdded,
}) {
  const { aiBlocked } = useOps() // 운영 상태 「AI 기능 정지」 (19 문서 6장)
  const [sort, setSort] = useState('importance')
  const showSentiment = useFeature('sentiment') // 실험 기능
  const [activeId, setActiveId] = useState(null)
  const [folder, setFolder] = useState(null) // 보는 폴더 (null = 전체)
  const [showAdd, setShowAdd] = useState(false)
  const inFolder = (a) => folder === null || folderIdOf(a.id) === folder
  const checkedByFolder = {}
  for (const a of candidates) if (includedIds.includes(a.id)) checkedByFolder[folderIdOf(a.id)] = (checkedByFolder[folderIdOf(a.id)] ?? 0) + 1

  const sorted = candidates.filter(inFolder).sort((a, b) => {
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
  const jobOf = (id) => queue.jobs.find((j) => j.id === id)
  const activeJob = active && jobOf(active.id)
  const activeBusy = activeJob && (activeJob.status === 'queued' || activeJob.status === 'running')
  const summarizedCount = sorted.filter((a) => aiSummaries[a.id]).length
  // 전체 선택 · 해제는 지금 보는 폴더 안에서만 (다른 폴더의 체크는 그대로)
  const allChecked = sorted.length > 0 && sorted.every((a) => includedIds.includes(a.id))

  function toggleIncluded(id) {
    setIncludedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // 체크한 기사를 선별 목록에서 뺀다 (지금 보는 폴더 안에서)
  function removeChecked() {
    const ids = sorted.filter((a) => includedIds.includes(a.id)).map((a) => a.id)
    if (ids.length === 0) return
    if (!window.confirm(`체크한 기사 ${ids.length}건을 선별에서 뺄까요? 만든 요약은 그대로 남아요.`)) return
    ids.forEach(onExclude)
  }

  function toggleAll() {
    const ids = new Set(sorted.filter((a) => a.aiAllowed !== false).map((a) => a.id))
    setIncludedIds((prev) => (allChecked ? prev.filter((id) => !ids.has(id)) : [...prev.filter((id) => !ids.has(id)), ...ids]))
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
          <button type="button" className={showAdd ? 'btn primary' : 'btn'} aria-expanded={showAdd} onClick={() => setShowAdd((v) => !v)}>
            + 자료 올리기
          </button>
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

      {showAdd && (
        <AddMaterial
          folders={folders}
          defaultFolder={folder ?? INBOX}
          selectByDefault
          onAdded={(m, opts) => onMaterialAdded(m, opts)}
          onClose={() => setShowAdd(false)}
        />
      )}
      <FolderBar
        label="폴더"
        folders={folders}
        counts={folderCounts}
        checked={checkedByFolder}
        active={folder}
        allOption
        onPick={setFolder}
        onDropArticle={(folderId, articleId) => onMove(articleId, folderId)}
        onCreate={(name) => setFolder(onCreateFolder(name))}
        onRename={onRenameFolder}
        onDelete={(id) => {
          onDeleteFolder(id)
          setFolder(null)
        }}
      />
      {candidates.length === 0 ? (
        <section className="panel select-empty">
          <p className="empty">아직 선별한 기사가 없어요. 자료 현황에서 「선별 추가」를 눌러 주세요.</p>
          <button type="button" className="btn primary" onClick={onGoCollect}>
            자료 현황으로 가기
          </button>
        </section>
      ) : (
        <div className="select-content">
          <section className="panel select-pane">
            <div className="candidate-header">
              <h2>
                {folder === null ? '후보 기사' : folders.find((f) => f.id === folder)?.name} {sorted.length}건 <small>· 요약 완료 {summarizedCount}</small>
              </h2>
              <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬">
                <option value="importance">중요도순</option>
                <option value="latest">최신순</option>
              </select>
              <button type="button" className="btn" onClick={toggleAll}>
                {allChecked ? '전체 해제' : '전체 선택'}
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={removeChecked}
                disabled={includedIds.length === 0}
                title="체크한 기사를 선별 목록에서 빼요. 만든 요약은 그대로 남아요"
              >
                선별 삭제
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
                    className={a.id === active?.id ? 'candidate active' : 'candidate'}
                    onClick={() => setActiveId(a.id)}
                    draggable
                    onDragStart={(e) => dragArticle(e, a.id)}
                  >
                    <input
                      type="checkbox"
                      checked={includedIds.includes(a.id)}
                      onChange={() => toggleIncluded(a.id)}
                      onClick={(e) => e.stopPropagation()}
                      disabled={a.aiAllowed === false}
                      title={a.aiAllowed === false ? 'AI 입력을 허용하지 않은 자료라 보고서에 넣을 수 없어요' : undefined}
                      aria-label={`${a.title} 보고서에 포함`}
                    />
                    <div className="candidate-text">
                      <div className="title">{a.title}</div>
                      <div className="meta">
                        {folder === null && <span className="folder-tag">▤ {folders.find((f) => f.id === folderIdOf(a.id))?.name} · </span>}
                        {a.material && <span className="badge-material">직접 추가</span>} {a.source} · {formatPublished(a.hoursAgo)}
                        {a.sameIssue > 0 && ` · 같은 이슈 ${a.sameIssue}건`}
                        {jobStatus === 'done' && <span className="summary-state done"> · 요약 완료</span>}
                        {showSentiment && sentimentOf(a, aiSummaries[a.id]?.summary) && (
                          <>
                            {' · '}
                            <SentimentBadge sentiment={sentimentOf(a, aiSummaries[a.id]?.summary)} />
                          </>
                        )}
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

          {!active ? (
            <section className="panel select-pane detail">
              <p className="empty">이 폴더에는 아직 기사가 없어요. 자료 현황에서 기사를 위 폴더로 끌어다 놓거나, 기사 옆 폴더 메뉴로 옮기세요.</p>
            </section>
          ) : (
          <section className="panel select-pane detail">
            <div className="detail-body">
              <div className="detail-top">
                <span className="detail-label">선택한 기사</span>
                <label className="folder-move">
                  폴더
                  <select value={folderIdOf(active.id)} onChange={(e) => onMove(active.id, e.target.value)}>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <h2>{active.title}</h2>
              <p className="meta">
                {active.source} · {formatPublished(active.hoursAgo)}
                {active.sameIssue > 0 && ` · 같은 이슈 기사 ${active.sameIssue}건 묶음`}
              </p>
              {showSentiment && ai?.summary?.sentiment && (
                <p className="sentiment-line">
                  <SentimentBadge sentiment={ai.summary.sentiment} /> {ai.summary.sentiment.reason}
                  <span className="sentiment-note"> · 선별 판단용 보조 표시 (투자 판단용 아님)</span>
                </p>
              )}

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
                  {active.aiAllowed === false && <p className="hint">AI 요약 · 보고서에 쓰지 않기로 한 자료예요. 원문을 직접 읽어 주세요.</p>}
                  {!activeBusy && active.aiAllowed !== false && (
                    <button
                      type="button"
                      className="btn outline"
                      onClick={() => queue.enqueue(active)}
                      disabled={aiBlocked}
                      title={aiBlocked ? AI_BLOCKED_TITLE : undefined}
                    >
                      AI 요약 만들기
                    </button>
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

              <WikiLookup terms={ai?.summary.keywords ?? summary?.keywords ?? [active.keyword].filter((k) => k && k !== '직접 추가')} />

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

          </section>
          )}
        </div>
      )}
    </main>
  )
}

export default SelectSummary
