// 수집 설정 아래 「자동 최신화」: 지금 최신화 버튼, 주기 설정, 마지막·다음 실행과 진행 상황
const MODE_LABEL = { off: '꺼짐', daily: '매일 정해진 시각', interval: '몇 시간마다' }
const PER_RUN_OPTIONS = [0, 3, 5, 10]

function formatTime(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function resultText(r) {
  if (!r) return ''
  if (r.error) return `실패: ${r.error}`
  const parts = [`새 기사 ${r.added}건`, `미리 요약 ${r.summarized}건`]
  if (r.summaryFailed) parts.push(`요약 실패 ${r.summaryFailed}건`)
  if (r.failedKeywords?.length) parts.push(`수집 실패 키워드: ${r.failedKeywords.join(', ')}`)
  if (r.note) parts.push(r.note)
  return parts.join(' · ')
}

function progressText(running) {
  if (running.phase === 'collect') return '기사 모으는 중…'
  if (running.total === 0) return '정리 중…'
  return `미리 요약 중 ${running.done}/${running.total}`
}

function RefreshPanel({ status, error, starting, disabled, onRun, onSave }) {
  const settings = status?.settings
  const running = status?.running
  const busy = starting || Boolean(running)

  function change(patch) {
    onSave({ ...settings, ...patch })
  }

  return (
    <div className="refresh">
      <button type="button" className="btn primary collect-btn" onClick={onRun} disabled={busy || disabled}>
        {busy ? '최신화 중…' : '지금 최신화'}
      </button>
      {running ? (
        <div className="refresh-progress">
          <p className="hint">
            {progressText(running)}
            {running.current && <span className="refresh-current"> · {running.current}</span>}
            {status.queue?.userFirst > 0 && running.phase === 'summarize' && (
              <span className="refresh-current"> · 사용자 요청 {status.queue.userFirst}건을 먼저 처리하는 중</span>
            )}
          </p>
          {running.total > 0 && (
            <div className="gauge">
              <div className="gauge-fill" style={{ width: `${(running.done / running.total) * 100}%` }} />
            </div>
          )}
        </div>
      ) : (
        <p className="hint">
          키워드마다 네이버 뉴스 최신 100건을 모으고, 제목에 키워드가 들어간 중요한 기사는 미리 요약해 둬요.
        </p>
      )}

      {settings && (
        <div className="refresh-settings">
          <h3>자동 최신화</h3>
          <label htmlFor="refresh-mode">주기</label>
          <select id="refresh-mode" value={settings.mode} onChange={(e) => change({ mode: e.target.value })}>
            {Object.entries(MODE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {settings.mode === 'daily' && (
            <>
              <label htmlFor="refresh-time">시각</label>
              <input
                id="refresh-time"
                type="time"
                value={settings.time}
                onChange={(e) => e.target.value && change({ time: e.target.value })}
              />
            </>
          )}
          {settings.mode === 'interval' && (
            <>
              <label htmlFor="refresh-hours">간격</label>
              <select id="refresh-hours" value={settings.hours} onChange={(e) => change({ hours: Number(e.target.value) })}>
                {status.hourOptions.map((h) => (
                  <option key={h} value={h}>
                    {h}시간마다
                  </option>
                ))}
              </select>
            </>
          )}
          <label htmlFor="refresh-per-run">미리 요약 (한 번에)</label>
          <select id="refresh-per-run" value={settings.perRun} onChange={(e) => change({ perRun: Number(e.target.value) })}>
            {PER_RUN_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? '하지 않음' : `최대 ${n}건`}
              </option>
            ))}
          </select>
          <dl className="refresh-info">
            <div>
              <dt>마지막 최신화</dt>
              <dd>{formatTime(status.lastRunAt)}</dd>
            </div>
            {status.lastResult && !running && (
              <div>
                <dt>결과</dt>
                <dd>{resultText(status.lastResult)}</dd>
              </div>
            )}
            <div>
              <dt>다음 예정</dt>
              <dd>{settings.mode === 'off' ? '자동 최신화 꺼짐' : formatTime(status.nextRunAt)}</dd>
            </div>
          </dl>
          <p className="hint">앱이 켜져 있을 때만 자동으로 돌아요. 꺼져 있던 동안 놓친 예정은 켜진 뒤 한 번 실행해요.</p>
        </div>
      )}
      {error && <p className="ai-error">{error}</p>}
    </div>
  )
}

export default RefreshPanel
