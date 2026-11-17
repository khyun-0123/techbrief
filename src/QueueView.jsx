// AI 대기열 보기 (11/15): 오른쪽 아래 「AI 대기열」 창과 관리 페이지 「운영」이 같이 쓴다
// 서버(/api/queue)의 지금 처리 중 · 기다리는 AI 요청, 보고서 작업, 자동 요약 대기를 한 줄씩 보여 주고
// 「전체 · 내 작업 · 자동 · 다른 사람」으로 거른다. 내 작업은 이 브라우저 번호(쿠키 tb_client)로 가린다
import { useState } from 'react'
import { countBy, FILTERS, moveQueueJob, queueRows, STEP_LABEL, WHO_LABEL } from './queue.js'

// rows를 받아 거르기 단추 + 목록을 그린다. filter · onFilter를 넘기면 바깥에서 고른 값을 쓴다
// admin: 관리 페이지 — 모든 기다리는 일의 단계 올리기 · 내리기 · 맨 앞. 아니면 내 작업끼리 순서만 (11/17)
function QueueView({ data: polled, filter: outer, onFilter, hideFilter = false, empty, admin = false }) {
  const [inner, setInner] = useState('all')
  // 순서를 바꾸면 서버가 준 새 대기열을 다음 받아 오기 전까지 보여 줌
  const [moved, setMoved] = useState(null)
  const [moveError, setMoveError] = useState('')
  const data = moved && moved.base === polled ? { ...polled, ...moved.value } : polled
  async function move(id, action) {
    setMoveError('')
    try {
      setMoved({ base: polled, value: await moveQueueJob(id, action) })
    } catch (err) {
      setMoveError(err.message)
    }
  }
  const filter = outer ?? inner
  const setFilter = onFilter ?? setInner
  const rows = queueRows(data)
  const counts = countBy(rows)
  const shown = filter === 'all' ? rows : rows.filter((r) => r.who === filter)
  return (
    <div className="queue-view">
      {!hideFilter && (
        <div className="queue-filter" role="group" aria-label="대기열 거르기">
          {FILTERS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label}
              <span className="queue-filter-n">{counts[value]}</span>
            </button>
          ))}
        </div>
      )}
      {moveError && (
        <p className="queue-empty" role="alert">
          {moveError}
        </p>
      )}
      {!data ? (
        <p className="queue-empty">대기열을 불러오는 중…</p>
      ) : shown.length === 0 ? (
        <p className="queue-empty">{empty ?? (filter === 'all' ? '지금 AI가 하는 일이 없어요' : `${WHO_LABEL[filter]} 작업이 없어요`)}</p>
      ) : (
        <ul className="queue-list">
          {shown.map((r) => (
            <li key={r.key} className={r.busy ? 'queue-row is-busy' : 'queue-row'}>
              <span className={`queue-who who-${r.who}`}>{WHO_LABEL[r.who]}</span>
              <span className="queue-title" title={r.title}>
                {r.title}
              </span>
              <span className="queue-kind">{r.kind}</span>
              <span className="queue-state" title={r.state}>
                {r.state}
                {r.waiting && r.step && (
                  <span className="queue-step" title={`AI 순서 ${r.step}단계${r.manual ? ' · 손으로 바꿈' : ''}${r.demoted ? ' · 다른 키워드를 열어 뒤로 감' : ''}`}>
                    {' '}
                    · {r.step}단계 {STEP_LABEL[r.step]}
                  </span>
                )}
              </span>
              {r.waiting && (admin || r.mine) && (
                <span className="queue-move" role="group" aria-label={`${r.title} 순서`}>
                  <button type="button" onClick={() => move(r.id, 'up')} aria-label="먼저" title={admin ? '한 단계 올리기' : '내 작업 중 하나 앞으로'}>
                    ▲
                  </button>
                  <button type="button" onClick={() => move(r.id, 'down')} aria-label="나중에" title={admin ? '한 단계 내리기' : '내 작업 중 하나 뒤로'}>
                    ▼
                  </button>
                  {admin && (
                    <button type="button" onClick={() => move(r.id, 'first')} title="1단계 · 가장 먼저">
                      맨 앞
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default QueueView
