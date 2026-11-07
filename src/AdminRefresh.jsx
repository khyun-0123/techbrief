// 관리 페이지 「자동 최신화」: 왼쪽은 ① 기사 모으기(AI 안 씀) · ② 자동 요약(AI 사용), 오른쪽은 상태와 「지금 최신화」
// 두 기능은 다르다: ①은 네이버에서 제목·150자 발췌·링크를 DB에 쌓고, ②는 그 발췌문으로 AI 6항목 요약을 만든다
// 일반 화면의 RefreshPanel(보기 전용)과 같은 서버 값을 쓰고, 화면 구성만 관리자용으로 다르다
// 주기·간격은 선택 상자 대신 버튼으로 (사파리가 선택 상자를 기본 모양으로만 그려 화면과 어울리지 않아서)
import { backlogText, formatTime, progressText, resultText } from './refreshText.js'

const MODES = [
  ['off', '꺼짐'],
  ['daily', '매일'],
  ['interval', '몇 시간마다'],
]

// keywords: 지금 자동 수집 키워드 (「지금 최신화」 전에 무엇을 모을지 보이게), onGoTargets: 수집 대상 메뉴로
function AdminRefresh({ status, starting, disabled, onRun, onSave, keywords = [], onGoTargets }) {
  const settings = status.settings
  const running = status.running
  const busy = starting || Boolean(running)
  const change = (patch) => onSave({ ...settings, ...patch })

  return (
    <div className="adm-cols adm-refresh-cols">
      <div className="adm-stack">
      <section className="adm-card">
        <h2>
          ① 기사 모으기 <span className="adm-tag adm-tag-muted">AI 안 씀</span>
        </h2>
        <p className="adm-desc">네이버 뉴스에서 키워드별 새 기사(제목 · 150자 발췌 · 링크)를 언제 DB에 모을지 정해요. 앱이 켜져 있을 때만 돌아요.</p>

        <span className="adm-field-label">주기</span>
        <div className="adm-segment adm-segment-wide" role="radiogroup" aria-label="자동 최신화 주기">
          {MODES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={settings.mode === value}
              onClick={() => settings.mode !== value && change({ mode: value })}
            >
              {label}
            </button>
          ))}
        </div>

        {settings.mode === 'daily' && (
          <>
            <label className="adm-field-label" htmlFor="refresh-time">
              시각
            </label>
            <input
              id="refresh-time"
              className="adm-time"
              type="time"
              value={settings.time}
              onChange={(e) => e.target.value && change({ time: e.target.value })}
            />
          </>
        )}

        {settings.mode === 'interval' && (
          <>
            <span className="adm-field-label">간격</span>
            <div className="adm-pills" role="radiogroup" aria-label="자동 최신화 간격">
              {status.hourOptions.map((h) => (
                <button
                  key={h}
                  type="button"
                  role="radio"
                  aria-checked={settings.hours === h}
                  onClick={() => settings.hours !== h && change({ hours: h })}
                >
                  {h}시간
                </button>
              ))}
            </div>
          </>
        )}

        {settings.mode === 'off' && <p className="adm-note">자동으로 모으지 않아요. 오른쪽 「지금 최신화」를 누를 때만 모아요.</p>}

      </section>

      <section className="adm-card">
        <div className="adm-switch-row">
          <div>
            <h2>
              ② 자동 요약 <span className="adm-tag adm-tag-warn">AI 사용</span>
            </h2>
            <span>
              모은 기사 중 관련도 낮은 기사(주식 · 판촉 등)를 뺀 전부를 중요도 높은 순으로, 원문(못 가져오면 발췌문)을 바탕으로 6항목 요약해요. 기사를 모을 때마다 대상이 새로 정해지고, 사람이 누른 요약이
              언제나 먼저예요.
            </span>
          </div>
          <label className="refresh-switch adm-switch" aria-label="자동 요약">
            <input
              type="checkbox"
              role="switch"
              checked={settings.autoSummary === 'all'}
              onChange={(e) => change({ autoSummary: e.target.checked ? 'all' : 'off' })}
            />
            <span className="refresh-switch-track" aria-hidden="true" />
            {settings.autoSummary === 'all' ? '켜짐' : '꺼짐'}
          </label>
        </div>
        {settings.autoSummary === 'all' && settings.mode === 'off' && (
          <p className="adm-note">기사 모으기가 꺼져 있어, 「지금 최신화」를 누를 때만 새 요약 대상이 생겨요.</p>
        )}
        {settings.autoSummary !== 'all' && <p className="adm-note">꺼져 있으면 사람이 「요약 추가」를 누른 기사만 요약해요.</p>}
        {settings.autoSummary === 'all' && (
          <label className="adm-field-inline">
            자동 요약할 기사 기간
            <select value={settings.summaryDays ?? 7} onChange={(e) => change({ summaryDays: Number(e.target.value) })}>
              {[3, 7, 14, 21].map((d) => (
                <option key={d} value={d}>
                  최근 {d}일{d === 7 ? ' (기본)' : ''}
                </option>
              ))}
            </select>
            <small>
              기사(네이버 · 전문매체)만이에요. 처음 켜면 이 기간의 기사를 중요도 순으로 요약하고, 그 뒤로는 새로 모은 기사를 이어서 요약해요. 네이버 검색 결과는 21일까지만 보관해요(23 문서). 논문은 따로 최근 7일.
            </small>
          </label>
        )}
      </section>
      </div>

      <section className="adm-card">
        <div className="adm-card-head">
          <h2>상태</h2>
          <button type="button" className="adm-btn primary" onClick={onRun} disabled={busy || disabled}>
            {busy ? '최신화 중…' : '지금 최신화'}
          </button>
        </div>
        <p className="adm-desc">키워드마다 지난번 이후 새 기사를 빠짐없이 모아요.</p>

        {running && (
          <div className="adm-progress">
            <span>
              {progressText(running)}
              {running.current && ` · ${running.current}`}
            </span>
            {running.total > 0 && (
              <div className="gauge">
                <div className="gauge-fill" style={{ width: `${(running.done / running.total) * 100}%` }} />
              </div>
            )}
          </div>
        )}

        <dl className="adm-status">
          <div>
            <dt>마지막 최신화</dt>
            <dd>{formatTime(status.lastRunAt)}</dd>
          </div>
          <div>
            <dt>다음 예정</dt>
            <dd>{settings.mode === 'off' ? '자동 최신화 꺼짐' : formatTime(status.nextRunAt)}</dd>
          </div>
          {status.lastResult && !running && (
            <div className="adm-status-wide">
              <dt>결과</dt>
              <dd className={status.lastResult.error ? 'bad' : undefined}>{resultText(status.lastResult)}</dd>
            </div>
          )}
          {status.backlog && (
            <div className="adm-status-wide">
              <dt>자동 요약</dt>
              <dd>
                {backlogText(status.backlog)}
                {status.backlog.current && ` · ${status.backlog.current}`}
                {status.backlog.note && ` · ${status.backlog.note}`}
              </dd>
            </div>
          )}
        </dl>
        <div className="adm-next-keywords">
          <div className="adm-card-head">
            <span className="adm-field-label">다음에 모을 키워드 {keywords.length}개</span>
            {onGoTargets && (
              <button type="button" className="adm-link-btn" onClick={onGoTargets}>
                수집 대상 바꾸기 →
              </button>
            )}
          </div>
          <div className="chips">
            {keywords.length === 0 && <span className="adm-empty">키워드가 없어 모을 수 없어요.</span>}
            {keywords.map((k) => (
              <span key={k} className="chip">
                {k}
              </span>
            ))}
          </div>
        </div>
        <p className="adm-note">꺼져 있던 동안 놓친 예정은 앱이 켜진 뒤 한 번 실행해요.</p>
      </section>
    </div>
  )
}

export default AdminRefresh
