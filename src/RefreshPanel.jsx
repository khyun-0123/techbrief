// 「자동 최신화」: 지금 최신화 버튼, 주기 설정, 마지막·다음 실행과 진행 상황
// 주기·자동 요약 설정은 모두에게 영향을 주므로 관리자 화면(canEdit)에서만 바꾼다. 일반 화면은 보기만 (17 문서)

import { backlogText, formatTime, MODE_LABEL, progressText, resultText } from './refreshText.js'
import Dropdown, { Seg } from './Dropdown.jsx'

// showRun: 「지금 최신화」 버튼을 보일지 (일반 화면은 실험 기능 refreshButton을 따름)
function RefreshPanel({ status, error, starting, disabled, onRun, onSave, canEdit = false, showRun = true }) {
  const settings = status?.settings
  const running = status?.running
  const busy = starting || Boolean(running)
  const locked = !canEdit

  function change(patch) {
    onSave({ ...settings, ...patch })
  }

  return (
    <div className="refresh">
      {showRun && (
        <button type="button" className="btn primary collect-btn" onClick={onRun} disabled={busy || disabled}>
          {busy ? '최신화 중…' : '지금 최신화'}
        </button>
      )}
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
          키워드마다 네이버 뉴스에서 지난번 이후 새 기사를 빠짐없이 모으고, 자동 요약을 켜 두면 관련도 낮은 기사를 뺀 전부를 뒤에서 중요도 점수가 높은 것부터 요약해요. 직접 누른 요약이 언제나 먼저예요.
        </p>
      )}

      {settings && (
        <div className="refresh-settings">
          <h3>자동 최신화{locked && <span className="refresh-lock"> 관리자가 정해요</span>}</h3>
          <span className="refresh-label">주기</span>
          <Seg value={settings.mode} onChange={(v) => change({ mode: v })} label="주기" disabled={locked} options={Object.entries(MODE_LABEL).map(([value, label]) => ({ value, label }))} />
          {settings.mode === 'daily' && (
            <>
              <label htmlFor="refresh-time">시각</label>
              <input
                id="refresh-time"
                type="time"
                disabled={locked}
                value={settings.time}
                onChange={(e) => e.target.value && change({ time: e.target.value })}
              />
            </>
          )}
          {settings.mode === 'interval' && (
            <>
              <span className="refresh-label">간격</span>
              <Dropdown value={settings.hours} onChange={(v) => change({ hours: Number(v) })} label="간격" disabled={locked} options={status.hourOptions.map((h) => ({ value: h, label: `${h}시간마다` }))} />
            </>
          )}
          {/* 자동 요약 켜기/끄기. 개발 중에는 끄고, 시연·테스트 때 켠다 (켜면 관련도 낮음을 뺀 기사 전부, 중요도 순) */}
          <label className="refresh-switch">
            <input
              type="checkbox"
              role="switch"
              disabled={locked}
              checked={settings.autoSummary === 'all'}
              onChange={(e) => change({ autoSummary: e.target.checked ? 'all' : 'off' })}
            />
            <span className="refresh-switch-track" aria-hidden="true" />
            자동 요약 {settings.autoSummary === 'all' ? '켜짐' : '꺼짐 (직접 누를 때만)'}
          </label>
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
            {status.backlog && (
              <div>
                <dt>자동 요약</dt>
                <dd>
                  {backlogText(status.backlog)}
                  {status.backlog.current && <span className="refresh-current"> · {status.backlog.current}</span>}
                  {status.backlog.note && <span className="refresh-current"> · {status.backlog.note}</span>}
                </dd>
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
      {error && <p className="ai-error" role="alert">{error}</p>}
    </div>
  )
}

export default RefreshPanel
