// AI 작업 진행 창 — 화면 오른쪽 아래, 모든 탭에서 보인다
// 11/08: 요약 대기열 + 보고서 작업 대기열(서버). 보고서 작업이 「요약 안 된 기사도 쓸까요?」를 물으면 여기서 답한다
import { useState } from 'react'

const STATUS_LABEL = { queued: '대기', running: '요약 중', done: '완료', error: '오류' }

function seconds(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`
}

function Gauge({ value, status }) {
  return (
    <div className={`gauge gauge-${status}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="gauge-fill" style={{ width: `${value}%` }} />
    </div>
  )
}

const REPORT_STATUS = { queued: '대기', running: '작성 중', need_confirm: '확인 필요', done: '완성', error: '오류', cancelled: '취소됨' }

function ReportJobs({ jobs, onAnswer, onCancel, onOpenReport, onHide }) {
  return (
    <ul className="progress-list report-jobs">
      {jobs.map((j) => (
        <li key={j.id} className={`progress-item status-${j.status}`}>
          <div className="progress-row">
            <span className="progress-title" title={j.title}>
              보고서 「{j.title}」 <small>· 기사 {j.count}건 · {j.levelLabel}</small>
            </span>
            <span className="progress-status">
              {REPORT_STATUS[j.status]}
              {j.status === 'queued' && j.queuePos > 0 && ` ${j.queuePos}번째`}
            </span>
            {['queued', 'running', 'need_confirm'].includes(j.status) ? (
              <button type="button" className="icon-btn" onClick={() => onCancel(j.id)} title="보고서 만들기 취소" aria-label="보고서 만들기 취소">
                ×
              </button>
            ) : (
              <button type="button" className="icon-btn" onClick={() => onHide(j.id)} title="목록에서 지우기" aria-label="목록에서 지우기">
                ×
              </button>
            )}
          </div>
          {['running', 'need_confirm', 'queued'].includes(j.status) && (
            <>
              <Gauge value={j.progress ?? 0} status="running" />
              <p className="progress-sub">{j.step}</p>
            </>
          )}
          {j.status === 'need_confirm' && j.question && (
            <div className="job-question">
              <p>
                보충에 쓸 만한 <strong>요약 안 된 기사 {j.question.count}건</strong>이 있어요. 요약해서 쓸까요? (약 {j.question.minutes}분 더 걸려요)
              </p>
              <ul>
                {j.question.items.slice(0, 4).map((it) => (
                  <li key={it.title}>
                    {it.external === 'news' ? '[새로 찾은 기사] ' : ''}
                    {it.title} <span className="hint">· {it.source}</span>
                  </li>
                ))}
                {j.question.items.length > 4 && <li className="hint">외 {j.question.items.length - 4}건</li>}
              </ul>
              <div className="job-question-actions">
                <button type="button" className="btn primary" onClick={() => onAnswer(j.id, true)}>
                  요약해서 쓰기
                </button>
                <button type="button" className="btn" onClick={() => onAnswer(j.id, false)}>
                  요약된 자료만 쓰기
                </button>
              </div>
            </div>
          )}
          {j.status === 'done' && (
            <p className="progress-sub">
              {j.result?.research?.filled ? `AI 해설 ${j.result.research.gaps}줄 중 ${j.result.research.filled}줄 보충 · ` : ''}
              <button type="button" className="link-btn" onClick={() => onOpenReport(j.entryId)}>
                보고서함에서 보기
              </button>
            </p>
          )}
          {j.status === 'error' && <p className="progress-error">{j.error}</p>}
        </li>
      ))}
    </ul>
  )
}

// quiet: 선별·요약 화면처럼 오른쪽 아래를 가리면 안 될 때 기본으로 접어 둔다 (확인 질문이 있으면 펼침)
function ProgressPanel({ queue, reportJobs = [], onAnswer, onCancel, onOpenReport, quiet = false }) {
  // 펼침 상태: 직접 누르기 전에는 '진행 중이면 펼치고, 다 끝나면 접는다'
  const [expanded, setExpanded] = useState(null)
  const [hidden, setHidden] = useState([]) // 이 화면에서 지운 끝난 보고서 작업
  const { jobs, remove, clearFinished, retry, progressOf, overall, remainingMs } = queue
  const reports = reportJobs.filter((j) => !hidden.includes(j.id))
  if (jobs.length === 0 && reports.length === 0) return null
  const reportActive = reports.some((j) => ['queued', 'running', 'need_confirm'].includes(j.status))
  const asking = reports.some((j) => j.status === 'need_confirm')
  // 「완료 지우기」: 끝난 요약과 끝난 보고서 작업(완성 · 오류 · 취소)을 함께 닫는다 (11/08: 보고서는 안 닫히던 문제)
  const finishedReports = reports.filter((j) => ['done', 'error', 'cancelled'].includes(j.status))
  const clearAll = () => {
    clearFinished()
    if (finishedReports.length) setHidden((h) => [...h, ...finishedReports.map((j) => j.id)])
  }

  const done = jobs.filter((j) => j.status === 'done').length
  const errors = jobs.filter((j) => j.status === 'error').length
  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running')
  const open = asking || (expanded ?? ((active || reportActive) && !quiet))

  return (
    <aside className="progress-panel" aria-label="AI 요약 진행">
      <div className="progress-head">
        <strong>AI 작업 진행</strong>
        <span className="progress-count">
          {jobs.length > 0 && `요약 ${done}/${jobs.length}`}
          {errors > 0 && ` · 오류 ${errors}`}
          {reports.length > 0 && `${jobs.length > 0 ? ' · ' : ''}보고서 ${reports.filter((j) => j.status === 'done').length}/${reports.length}`}
        </span>
        {!open && done + errors + finishedReports.length > 0 && (
          <button type="button" className="icon-btn" onClick={clearAll} title="완료 지우기">
            지우기
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => setExpanded(!open)} aria-label={open ? '접기' : '펼치기'}>
          {open ? '▾' : '▴'}
        </button>
      </div>

      {jobs.length > 0 && (
        <>
          <Gauge value={overall} status={active ? 'running' : 'done'} />
          <p className="progress-sub">
            {active ? `요약 ${overall}% · 남은 시간 약 ${seconds(remainingMs)} (예상)` : '모든 요약이 끝났어요'}
          </p>
        </>
      )}

      {open && reports.length > 0 && (
        <ReportJobs jobs={reports} onAnswer={onAnswer} onCancel={onCancel} onOpenReport={onOpenReport} onHide={(id) => setHidden((h) => [...h, id])} />
      )}

      {open && jobs.length > 0 && (
        <>
          <ul className="progress-list">
            {jobs.map((job) => {
              const value = progressOf(job)
              return (
                <li key={job.id} className={`progress-item status-${job.status}`}>
                  <div className="progress-row">
                    <span className="progress-title" title={job.title}>
                      {job.title}
                    </span>
                    <span className="progress-status">
                      {STATUS_LABEL[job.status]}
                      {job.status === 'running' && ` ${value}%`}
                    </span>
                    {job.status === 'error' && (
                      <button type="button" className="icon-btn" onClick={() => retry(job.id)} title="다시 요약">
                        ↻
                      </button>
                    )}
                    {job.status !== 'running' && (
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => remove(job.id)}
                        aria-label={job.status === 'queued' ? '대기 취소' : '목록에서 지우기'}
                        title={job.status === 'queued' ? '대기 취소' : '목록에서 지우기'}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <Gauge value={value} status={job.status} />
                  {job.status === 'error' && <p className="progress-error">{job.error}</p>}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {open && (
        <div className="progress-foot">
          <span className="hint">{jobs.length > 0 ? '게이지는 평균 요약 시간으로 계산한 예상치예요' : ''}</span>
          <button type="button" className="btn" onClick={clearAll} disabled={done + errors + finishedReports.length === 0}>
            완료된 작업 모두 닫기
          </button>
        </div>
      )}
    </aside>
  )
}

export default ProgressPanel
