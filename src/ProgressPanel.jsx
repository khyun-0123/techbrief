// AI 작업 진행 창 — 화면 오른쪽 아래, 모든 탭에서 보인다
// 11/08: 요약 대기열 + 보고서 작업 대기열(서버). 보고서 작업이 「요약 안 된 기사도 쓸까요?」를 물으면 여기서 답한다
// 11/11: 기술 시계열 「AI 흐름 정리」 — 키워드 분석을 보다가 떠난 말만 올린다 (보고 있는 말은 그 화면에서 보임, storyJobs.js)
import { useEffect, useState } from 'react'
import { dismissStory, retryStory } from './storyJobs.js'
import QueueView from './QueueView.jsx'
import { countBy, FILTERS, queueRows, useQueue } from './queue.js'

const STATUS_LABEL = { queued: '대기', running: '요약 중', done: '완료', error: '오류' }

function seconds(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`
}

// label: 무엇의 진행인지 (스크린리더가 「진행 표시줄 40%」만 읽지 않게)
function Gauge({ value, status, label }) {
  return (
    <div className={`gauge gauge-${status}`} role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="gauge-fill" style={{ width: `${value}%` }} />
    </div>
  )
}

// 진행률을 모르는 작업(AI 한 번 부르기)용: 값 없이 움직이는 막대
function BusyBar({ label }) {
  return (
    <div className="gauge gauge-running gauge-indeterminate" role="progressbar" aria-label={label}>
      <div className="gauge-fill" />
    </div>
  )
}

function StoryJobs({ jobs, onOpen }) {
  const [now, setNow] = useState(() => Date.now())
  const running = jobs.some((j) => j.status === 'running')
  useEffect(() => {
    if (!running) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])
  return (
    <ul className="progress-list story-jobs">
      {jobs.map((j) => (
        <li key={j.query} className={`progress-item story-job status-${j.status}${j.unseen ? ' is-unseen' : ''}`}>
          <div className="progress-row">
            <span className="progress-title" title={j.query}>
              「{j.query}」 기술 흐름 정리
            </span>
            <span className="progress-status">
              {j.status === 'running' ? `정리 중 ${seconds(now - j.startedAt)}` : j.status === 'done' ? '정리 끝' : '오류'}
            </span>
            <button type="button" className="icon-btn" onClick={() => dismissStory(j.query)} title={j.status === 'running' ? '알림 받지 않기 (정리는 계속돼요)' : '목록에서 지우기'} aria-label={j.status === 'running' ? `「${j.query}」 알림 받지 않기` : `「${j.query}」 목록에서 지우기`}>
              ×
            </button>
          </div>
          {j.status === 'running' && (
            <>
              <BusyBar label={`「${j.query}」 기술 흐름 정리 중`} />
              <p className="progress-sub">보통 30초 안팎 · 끝나면 여기서 알려 드려요</p>
            </>
          )}
          {j.status === 'done' && (
            <p className="progress-sub">
              전망 · 우리가 볼 것까지 정리됐어요 ·{' '}
              <button type="button" className="link-btn" onClick={() => onOpen(j.query)}>
                분석 보기
              </button>
            </p>
          )}
          {j.status === 'error' && (
            <p className="progress-error" role="alert">
              {j.error}{' '}
              <button type="button" className="link-btn" onClick={() => retryStory(j.query)}>
                다시 정리하기
              </button>
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

// 시:분 (오늘이 아니면 월/일도)
const hm = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.toDateString() === new Date().toDateString() ? t : `${d.getMonth() + 1}/${d.getDate()} ${t}`
}
const REPORT_STATUS = { queued: '대기', running: '작성 중', need_confirm: '확인 필요', done: '완성', error: '오류', cancelled: '취소됨' }

function ReportJobs({ jobs, onAnswer, onCancel, onOpenReport, onHide }) {
  return (
    <ul className="progress-list report-jobs">
      {jobs.map((j) => (
        <li key={j.id} className={`progress-item status-${j.status}`}>
          <div className="progress-row">
            <span className="progress-title" title={j.title}>
              보고서 「{j.title}」 <small>· 자료 {j.count}건 · {j.levelLabel}</small>
            </span>
            {/* 11/17: 주제어로 제목이 같아지면(「마이크로디스플레이 동향 브리핑」 둘) 같은 보고서로 보임 → 시작 · 끝 시각을 함께 */}
            <span className="progress-status" title={`시작 ${hm(j.createdAt)}${j.status === 'done' ? ` · 완성 ${hm(j.updatedAt)}` : ''}`}>
              {REPORT_STATUS[j.status]}
              {j.status === 'queued' && j.queuePos > 0 && ` ${j.queuePos}번째`}
              <small> · {hm(j.status === 'done' || j.status === 'error' ? j.updatedAt : j.createdAt)}</small>
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
              <Gauge value={j.progress ?? 0} status="running" label={`보고서 「${j.title}」 진행`} />
              <p className="progress-sub">{j.step}</p>
            </>
          )}
          {j.status === 'need_confirm' && j.question && (
            <div className="job-question">
              <p>
                보충에 쓸 만한 <strong>요약 안 된 자료 {j.question.count}건</strong>이 있어요. 요약해서 쓸까요? (약 {j.question.minutes}분 더 걸려요)
              </p>
              <ul>
                {j.question.items.slice(0, 4).map((it) => (
                  <li key={it.title}>
                    {it.external === 'news' ? '[새로 찾은 자료] ' : ''}
                    {it.title} <span className="hint">· {it.source}</span>
                  </li>
                ))}
                {j.question.items.length > 4 && <li className="hint">외 {j.question.items.length - 4}건</li>}
              </ul>
              {j.question.timeoutAt && <p className="hint">3분 안에 고르지 않으면 요약된 자료만 써서 이어 만들어요</p>}
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
                내 보고서에서 보기
              </button>
            </p>
          )}
          {j.status === 'error' && <p className="progress-error" role="alert">{j.error}</p>}
        </li>
      ))}
    </ul>
  )
}

// quiet: 선별·요약 화면처럼 오른쪽 아래를 가리면 안 될 때 기본으로 접어 둔다 (확인 질문이 있으면 펼침)
function ProgressPanel({ queue, reportJobs = [], storyJobs = [], onOpenStory, onAnswer, onCancel, onOpenReport, quiet = false }) {
  // 펼침 상태: 직접 누르기 전에는 '진행 중이면 펼치고, 다 끝나면 접는다'
  // 누른 값은 그때의 「안 본 흐름 정리」 목록과 함께 기억 → 새로 끝난 정리가 생기면 접어 둔 창도 다시 펼친다 (알림, 11/11)
  const [pressed, setPressed] = useState({ value: null, unseen: '' })
  const [hidden, setHidden] = useState([]) // 이 화면에서 지운 끝난 보고서 작업
  const { jobs, remove, clearFinished, retry, progressOf, overall, remainingMs } = queue
  const reports = reportJobs.filter((j) => !hidden.includes(j.id))
  const stories = storyJobs.filter((j) => j.listed || j.unseen)
  const storyActive = stories.some((j) => j.status === 'running')
  const storyUnseen = stories.some((j) => j.unseen)
  const unseenKey = stories.filter((j) => j.unseen).map((j) => j.query).join('|')
  const expanded = pressed.unseen === unseenKey || !unseenKey ? pressed.value : null
  const setExpanded = (value) => setPressed({ value, unseen: unseenKey })
  // 11/15: 늘 떠 있는 「AI 대기열」. 내 작업이 없어도 서버 대기열(자동 · 다른 사람)을 볼 수 있다
  const [filter, setFilter] = useState(null) // null이면 내 작업이 있을 때 「내 작업」, 없으면 「전체」
  const mineAny = jobs.length > 0 || reports.length > 0 || stories.length > 0
  const reportActive = reports.some((j) => ['queued', 'running', 'need_confirm'].includes(j.status))
  const asking = reports.some((j) => j.status === 'need_confirm')
  // 「완료 지우기」: 끝난 요약과 끝난 보고서 작업(완성 · 오류 · 취소)을 함께 닫는다 (11/08: 보고서는 안 닫히던 문제)
  const finishedReports = reports.filter((j) => ['done', 'error', 'cancelled'].includes(j.status))
  const clearAll = () => {
    clearFinished()
    stories.filter((j) => j.status !== 'running').forEach((j) => dismissStory(j.query))
    if (finishedReports.length) setHidden((h) => [...h, ...finishedReports.map((j) => j.id)])
  }

  const done = jobs.filter((j) => j.status === 'done').length
  const errors = jobs.filter((j) => j.status === 'error').length
  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running')
  const finishedStories = stories.filter((j) => j.status !== 'running').length
  const open = asking || (expanded ?? ((active || reportActive || storyActive || storyUnseen) && !quiet))
  const view = asking ? 'mine' : filter ?? (mineAny ? 'mine' : 'all')
  // 펼쳐 두면 더 자주 받아 온다
  const server = useQueue(open ? 3000 : 8000)
  const serverCounts = countBy(queueRows(server))
  const busy = server?.running ? 1 : 0
  const waitingN = (server?.waiting.length ?? 0) + (server?.backlog?.remaining ?? 0)

  // 내 작업도 서버 대기열도 없으면 작은 단추 하나만
  if (!mineAny && !open) {
    return (
      <button type="button" className="queue-fab" onClick={() => setExpanded(true)} aria-label="AI 대기열 열기">
        <span className={busy ? 'queue-dot is-busy' : 'queue-dot'} aria-hidden="true" />
        AI 대기열
        <span className="queue-fab-n">{busy || waitingN ? `처리 중 ${busy} · 대기 ${waitingN}` : '비어 있음'}</span>
      </button>
    )
  }

  return (
    <aside className="progress-panel" aria-label="AI 대기열">
      <div className="progress-head">
        <strong>AI 대기열</strong>
        <span className="progress-count" aria-live="polite">
          {!mineAny && (busy || waitingN ? `처리 중 ${busy} · 대기 ${waitingN}` : '비어 있음')}
          {jobs.length > 0 && `요약 ${done}/${jobs.length}`}
          {errors > 0 && ` · 오류 ${errors}`}
          {reports.length > 0 && `${jobs.length > 0 ? ' · ' : ''}보고서 ${reports.filter((j) => j.status === 'done').length}/${reports.length}`}
          {stories.length > 0 && `${jobs.length + reports.length > 0 ? ' · ' : ''}흐름 정리 ${stories.filter((j) => j.status === 'done').length}/${stories.length}`}
          {storyUnseen && ' · 새로 끝남'}
        </span>
        {!open && done + errors + finishedReports.length + finishedStories > 0 && (
          <button type="button" className="icon-btn" onClick={clearAll} title="완료 지우기">
            지우기
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => setExpanded(!open)} aria-label={open ? '접기' : '펼치기'}>
          {open ? '▾' : '▴'}
        </button>
      </div>

      {open && (
        <div className="queue-filter" role="group" aria-label="대기열 거르기">
          {FILTERS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={view === value} onClick={() => setFilter(value)}>
              {label}
              <span className="queue-filter-n">{value === 'mine' ? jobs.filter((j) => j.status !== 'done').length + reports.filter((j) => j.status !== 'done').length + stories.filter((j) => j.status === 'running').length : serverCounts[value]}</span>
            </button>
          ))}
        </div>
      )}

      {open && view !== 'mine' && <QueueView data={server} filter={view} hideFilter />}
      {open && view === 'mine' && !mineAny && <p className="queue-empty">내가 시킨 AI 작업이 없어요. 「전체」에서 자동 · 다른 사람 작업을 볼 수 있어요</p>}

      {jobs.length > 0 && (view === 'mine' || !open) && (
        <>
          <Gauge value={overall} status={active ? 'running' : 'done'} label="전체 요약 진행" />
          <p className="progress-sub">
            {active ? `요약 ${overall}% · 남은 시간 약 ${seconds(remainingMs)} (예상)` : '모든 요약이 끝났어요'}
          </p>
        </>
      )}

      {open && view === 'mine' && stories.length > 0 && <StoryJobs jobs={stories} onOpen={onOpenStory} />}

      {open && view === 'mine' && reports.length > 0 && (
        <ReportJobs jobs={reports} onAnswer={onAnswer} onCancel={onCancel} onOpenReport={onOpenReport} onHide={(id) => setHidden((h) => [...h, id])} />
      )}

      {open && view === 'mine' && jobs.length > 0 && (
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
                  <Gauge value={value} status={job.status} label={`요약 「${job.title ?? '기사'}」 진행`} />
                  {job.status === 'error' && <p className="progress-error" role="alert">{job.error}</p>}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {open && view === 'mine' && mineAny && (
        <div className="progress-foot">
          <span className="hint">{jobs.length > 0 ? '게이지는 평균 요약 시간으로 계산한 예상치예요' : ''}</span>
          <button type="button" className="btn" onClick={clearAll} disabled={done + errors + finishedReports.length + finishedStories === 0}>
            완료된 작업 모두 닫기
          </button>
        </div>
      )}
    </aside>
  )
}

export default ProgressPanel
