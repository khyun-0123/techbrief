// AI 요약 진행 창 — 화면 오른쪽 아래, 모든 탭에서 보인다
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

function ProgressPanel({ queue }) {
  // 펼침 상태: 직접 누르기 전에는 '진행 중이면 펼치고, 다 끝나면 접는다'
  const [expanded, setExpanded] = useState(null)
  const { jobs, remove, clearFinished, retry, progressOf, overall, remainingMs } = queue
  if (jobs.length === 0) return null

  const done = jobs.filter((j) => j.status === 'done').length
  const errors = jobs.filter((j) => j.status === 'error').length
  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running')
  const open = expanded ?? active

  return (
    <aside className="progress-panel" aria-label="AI 요약 진행">
      <div className="progress-head">
        <strong>AI 요약 진행</strong>
        <span className="progress-count">
          완료 {done} / 전체 {jobs.length}
          {errors > 0 && ` · 오류 ${errors}`}
        </span>
        {!open && done + errors > 0 && (
          <button type="button" className="icon-btn" onClick={clearFinished} title="완료 지우기">
            지우기
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => setExpanded(!open)} aria-label={open ? '접기' : '펼치기'}>
          {open ? '▾' : '▴'}
        </button>
      </div>

      <Gauge value={overall} status={active ? 'running' : 'done'} />
      <p className="progress-sub">
        {active ? `전체 ${overall}% · 남은 시간 약 ${seconds(remainingMs)} (예상)` : '모든 요약이 끝났어요'}
      </p>

      {open && (
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
          <div className="progress-foot">
            <span className="hint">게이지는 평균 요약 시간으로 계산한 예상치예요</span>
            <button type="button" className="btn" onClick={clearFinished} disabled={done + errors === 0}>
              완료 지우기
            </button>
          </div>
        </>
      )}
    </aside>
  )
}

export default ProgressPanel
