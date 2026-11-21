// 선별·요약 + 보고서 (11/08 조장: 「보고서 초안」 탭을 합침)
// 왼쪽: 폴더별 선별 기사. 체크 = 보고서에 넣을 기사. 기사를 누르면 그 자리에서 6항목 요약이 펼쳐진다
// 오른쪽: 체크한 기사로 만드는 보고서 (제목 · 방향 → 초안 → 미리보기 · 줄 빼기 · AI 보충 근거 찾기)
// 폴더 옮기기는 기사 펼침의 「폴더」 메뉴로 (끌어 놓기는 11/08에 뺌)
import { useState } from 'react'
import { SAMPLE_SUMMARIES } from './sampleArticles.js'
import { AI_BLOCKED_TITLE, useOps } from './ops.js'
import SummaryItems from './SummaryItems.jsx'
import { formatPublished } from './utils.js'
import AddMaterial from './AddMaterial.jsx'
import FolderBar from './FolderBar.jsx'
import ReportComposer from './ReportComposer.jsx'
import { INBOX } from './folders.js'
import Dropdown, { Seg } from './Dropdown.jsx'

const IMPORTANCE_LABEL = { high: '중요', normal: '' }
const JOB_LABEL = { queued: '요약 대기', running: '요약 중', error: '요약 오류' }

function importanceOf(article) {
  return article.importanceLevel ?? SAMPLE_SUMMARIES[article.id]?.importance ?? 'normal'
}

function SelectSummary({
  candidates,
  includedIds,
  setIncludedIds,
  onExclude,
  onGoCollect,
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
  reportArticles,
  reports,
  folderSummary,
  reportJobs,
  onJobAdded,
  onOpenReport,
}) {
  const { aiBlocked } = useOps()
  const [sort, setSort] = useState('importance')
  const [openId, setOpenId] = useState(null)
  const [folder, setFolder] = useState(null) // 보는 폴더 (null = 전체)
  const [showAdd, setShowAdd] = useState(false)
  // 폭 901~1100(FHD 절반 등)에서는 두 칸을 나란히 두기 좁아 하나씩 본다 (11/15 화면 틀). 그 밖의 폭에서는 CSS가 단추를 숨기고 둘 다 보인다
  const [pane, setPane] = useState('list')
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

  const jobOf = (id) => queue.jobs.find((j) => j.id === id)
  const summarizedCount = sorted.filter((a) => aiSummaries[a.id]).length
  // 전체 선택 · 해제는 지금 보는 폴더 안에서만 (다른 폴더의 체크는 그대로)
  const allChecked = sorted.length > 0 && sorted.every((a) => a.aiAllowed === false || includedIds.includes(a.id))

  function toggleIncluded(id) {
    setIncludedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

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

  function detail(a) {
    const ai = aiSummaries[a.id]
    const sample = SAMPLE_SUMMARIES[a.id]
    const job = jobOf(a.id)
    const busy = job && (job.status === 'queued' || job.status === 'running')
    return (
      <div className="candidate-detail">
        <div className="candidate-detail-tools">
          <label className="folder-move">
            폴더
            <Dropdown value={folderIdOf(a.id)} onChange={(v) => onMove(a.id, v)} label="폴더" size="sm" options={folders.map((f) => ({ value: f.id, label: f.name }))} />
          </label>
          {a.url && (
            <a href={a.url} target="_blank" rel="noreferrer">
              원문 열기 ↗
            </a>
          )}
        </div>
        {busy && (
          <div className="summary-progress">
            <span>{job.status === 'running' ? `AI 요약 중 ${queue.progressOf(job)}% (예상)` : '요약 대기 중'}</span>
            <div className="gauge gauge-running">
              <div className="gauge-fill" style={{ width: `${queue.progressOf(job)}%` }} />
            </div>
          </div>
        )}
        {job?.status === 'error' && <p className="ai-error" role="alert">요약 오류: {job.error}</p>}
        {ai ? (
          <>
            <SummaryItems summary={ai.summary} />
            {ai.summary.warnings?.length > 0 && <p className="ai-warning">확인할 점: {ai.summary.warnings.join(' / ')}</p>}
            <p className="hint">
              모델 {ai.model} · {new Date(ai.createdAt).toLocaleString('ko-KR')}
            </p>
          </>
        ) : sample ? (
          <ol className="summary">
            {sample.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        ) : (
          <>
            {a.description ? <p className="description">{a.description}</p> : <p className="hint">아직 요약이 없어요.</p>}
            {a.aiAllowed === false && <p className="hint">AI 요약 · 보고서에 쓰지 않기로 한 자료예요. 원문을 직접 읽어 주세요.</p>}
            {!busy && a.aiAllowed !== false && (
              <button type="button" className="btn outline" onClick={() => queue.enqueue(a)} disabled={aiBlocked} title={aiBlocked ? AI_BLOCKED_TITLE : undefined}>
                AI 요약 만들기
              </button>
            )}
          </>
        )}
      </div>
    )
  }

  const checkedHere = sorted.filter((a) => includedIds.includes(a.id)).length
  const someChecked = checkedHere > 0 && !allChecked

  return (
    <main className="page page-wide select-page">
      <header className="page-header with-actions">
        <div>
          <h1>선별·요약</h1>
          {/* 11/17 (39 문서 C6): 마지막 단계 */}
          <p>자료를 눌러 요약을 보고, 넣을 자료를 체크하세요.</p>
        </div>
        <div className="header-actions">
          {candidates.length > 0 && (
            <div className="segmented select-pane-switch" role="group" aria-label="보는 칸">
              <button type="button" aria-pressed={pane === 'list'} onClick={() => setPane('list')}>
                선별 자료 <span className="select-pane-n">{candidates.length}</span>
              </button>
              <button type="button" aria-pressed={pane === 'report'} onClick={() => setPane('report')}>
                보고서 <span className="select-pane-n">{reportArticles.length}</span>
              </button>
            </div>
          )}
          <button type="button" className={showAdd ? 'btn primary' : 'btn'} aria-expanded={showAdd} onClick={() => setShowAdd((v) => !v)}>
            + 자료 올리기
          </button>
        </div>
      </header>

      {showAdd && <AddMaterial folders={folders} defaultFolder={folder ?? INBOX} selectByDefault onAdded={onMaterialAdded} onClose={() => setShowAdd(false)} />}

      {candidates.length === 0 ? (
        // 빈 상태: 보고서까지 가는 3단계를 보여 준다 (11/09 디자인 정리, 28 문서 4장)
        <section className="panel select-empty" aria-labelledby="select-empty-title">
          <h2 id="select-empty-title">아직 선별한 기사가 없어요</h2>
          <ol className="select-steps">
            <li>
              <b>자료 현황에서 기사 고르기</b>
              <span>기사 줄의 「선별 추가」를 누르면 여기로 모여요. 폴더를 골라 나눠 담을 수 있어요.</span>
            </li>
            <li>
              <b>요약 확인하기</b>
              <span>선별한 기사는 AI가 6항목으로 요약해요. 요약을 보고 보고서에 넣을 기사를 체크해요.</span>
            </li>
            <li>
              <b>보고서 만들기</b>
              <span>필요하면 방향을 적고 「보고서 만들기」를 눌러요. 다 만들어지면 「내 보고서」에 저장돼요.</span>
            </li>
          </ol>
          <div className="select-empty-actions">
            <button type="button" className="btn primary" onClick={onGoCollect}>
              자료 현황으로 가기
            </button>
            <button type="button" className="btn outline" onClick={() => setShowAdd(true)}>
              내 자료 올리기
            </button>
          </div>
        </section>
      ) : (
        <div className={`select-report show-${pane}`}>
          <section className="panel panel-flush select-list" aria-label="선별 자료">
            <div className="select-list-head">
              <h2>선별 자료</h2>
              <Seg
                value={sort}
                onChange={setSort}
                label="정렬"
                size="md"
                options={[
                  { value: 'importance', label: '중요도순' },
                  { value: 'latest', label: '최신순' },
                ]}
              />
            </div>
            <FolderBar
              folders={folders}
              counts={folderCounts}
              checked={checkedByFolder}
              active={folder}
              allOption
              onPick={setFolder}
              onCreate={(name) => setFolder(onCreateFolder(name))}
              onRename={onRenameFolder}
              onDelete={(id) => {
                onDeleteFolder(id)
                setFolder(null)
              }}
            />
            <div className="select-list-tools">
              <label className="check-all">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked
                  }}
                  onChange={toggleAll}
                  disabled={sorted.length === 0}
                />
                {checkedHere > 0 ? (
                  <span>
                    <strong>{checkedHere}</strong> / {sorted.length}건 체크 · 보고서에 들어가요
                  </span>
                ) : (
                  <span>
                    {sorted.length}건 · 요약 {summarizedCount}
                  </span>
                )}
              </label>
              {checkedHere > 0 && (
                <button type="button" className="btn-text danger" onClick={removeChecked} title="체크한 기사를 선별 목록에서 빼요. 만든 요약은 그대로 남아요">
                  선별에서 빼기
                </button>
              )}
            </div>

            {sorted.length === 0 ? (
              <p className="empty">이 폴더에는 아직 기사가 없어요. 자료 현황에서 「선별 추가」 옆 폴더를 고르거나, 기사를 펼쳐 「폴더」를 바꾸세요.</p>
            ) : (
              <ul className="candidates">
                {sorted.map((a) => {
                  const job = jobOf(a.id)
                  const jobStatus = aiSummaries[a.id] && job?.status !== 'running' && job?.status !== 'queued' ? 'done' : job?.status
                  const open = openId === a.id
                  const checked = includedIds.includes(a.id)
                  return (
                    <li key={a.id} className={['candidate', open && 'open', checked && 'checked'].filter(Boolean).join(' ')}>
                      <div className="candidate-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleIncluded(a.id)}
                          disabled={a.aiAllowed === false}
                          title={a.aiAllowed === false ? 'AI 입력을 허용하지 않은 자료라 보고서에 넣을 수 없어요' : '보고서에 넣기'}
                          aria-label={`${a.title} 보고서에 넣기`}
                        />
                        <button type="button" className="candidate-text" aria-expanded={open} onClick={() => setOpenId(open ? null : a.id)}>
                          <span className="title">
                            {importanceOf(a) === 'high' && <span className="badge-important">{IMPORTANCE_LABEL.high}</span>}
                            {a.material && <span className="badge-material">직접 추가</span>}
                            {a.title}
                          </span>
                          <span className="meta">
                            {folder === null && <span className="folder-tag">{folders.find((f) => f.id === folderIdOf(a.id))?.name}</span>}
                            <span>{a.source}</span>
                            <span>{formatPublished(a.hoursAgo)}</span>
                            {jobStatus === 'done' ? (
                              <span className="summary-dot done">요약 완료</span>
                            ) : jobStatus ? (
                              <span className={`summary-dot ${jobStatus}`}>
                                {JOB_LABEL[jobStatus]}
                                {jobStatus === 'running' && ` ${queue.progressOf(job)}%`}
                              </span>
                            ) : (
                              <span className="summary-dot none">요약 없음</span>
                            )}
                          </span>
                        </button>
                        <span className="candidate-caret" aria-hidden="true">
                          {open ? '접기' : '요약'}
                        </span>
                      </div>
                      {open && detail(a)}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <ReportComposer
            articles={reportArticles}
            aiSummaries={aiSummaries}
            queue={queue}
            reports={reports}
            reportJobs={reportJobs}
            onJobAdded={onJobAdded}
            onOpenReport={onOpenReport}
            folderSummary={folderSummary}
          />
        </div>
      )}
    </main>
  )
}

export default SelectSummary
