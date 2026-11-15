// AI 대기열 보기 (11/15): 오른쪽 아래 「AI 대기열」 창과 관리 페이지 「운영」이 같이 쓴다
// 서버(/api/queue)의 지금 처리 중 · 기다리는 AI 요청, 보고서 작업, 자동 요약 대기를 한 줄씩 보여 주고
// 「전체 · 내 작업 · 자동 · 다른 사람」으로 거른다. 내 작업은 이 브라우저 번호(쿠키 tb_client)로 가린다
import { useState } from 'react'
import { countBy, FILTERS, queueRows, WHO_LABEL } from './queue.js'

// rows를 받아 거르기 단추 + 목록을 그린다. filter · onFilter를 넘기면 바깥에서 고른 값을 쓴다
function QueueView({ data, filter: outer, onFilter, hideFilter = false, empty }) {
  const [inner, setInner] = useState('all')
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
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default QueueView
