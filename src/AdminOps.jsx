// 관리 페이지 「운영」 (19 문서 6장)
// - 일반 화면 운영 상태: 정상 · 공지 · AI 기능 정지 · 점검 중 — 저장 막대와 별개로 「적용」하면 바로 바뀜 (급한 조치용)
// - 서버 다시 켜기: npm run serve로 켰을 때만. 서버 코드 · .env.local 변경 반영, 멈춘 대기열 풀기
import { useState } from 'react'
import { fetchHealth, restartServerApi, saveOpsApi } from './api.js'
import { OPS_LABEL } from './ops.js'

const MODES = [
  ['normal', '일반 화면을 그대로 써요.'],
  ['notice', '맨 위에 안내 띠만 보여요. 설정이 바뀌었을 때 알리기.'],
  ['ai_off', '기사 보기 · 찾기는 되고, 요약 · 보고서 버튼과 자동 요약을 멈춰요. AI 서버 고장 · 비용 초과 · 결과 이상.'],
  ['maintenance', '일반 화면 대신 점검 안내 화면이 떠요. 큰 설정 변경 · 데이터 정리 · 보안 문제.'],
]
const MESSAGE_HINT = {
  notice: '예: 오늘부터 자동 수집 키워드에 「폴더블」을 넣었어요.',
  ai_off: '예: AI 서버 점검 중이에요. 요약은 오후에 다시 열어요.',
  maintenance: '예: 수집 대상을 바꾸고 기사를 다시 모으고 있어요.',
}
const WAIT_MS = 90_000 // 다시 켜기를 기다리는 최대 시간

function formatAt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function uptime(iso) {
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000)
  if (min < 60) return `${min}분째`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}시간째` : `${Math.floor(h / 24)}일 ${h % 24}시간째`
}

// ops: 지금 운영 상태, onOps: 바뀐 상태 알림, health: 서버 정보, refreshRunning: 수집 중인지, dirtyCount: 저장 안 한 변경 수
// 외부 출처 상태 (11/12, server/sourceGuard.js): 오늘 호출 수 · 하루 한도 · 쉬는 중 · 마지막 오류. 한도의 80%면 자동 수집이 멈추고 98%면 찾기도 멈춤
function SourcesCard({ sources, llm, patentDb }) {
  if (!sources?.length) return null
  const time = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  return (
    <section className="adm-card">
      <h2>외부 출처 상태 (오늘)</h2>
      <p className="adm-desc">
        한도가 알려진 출처는 한도의 80%에서 자동 수집이, 98%에서 사람이 누른 찾기도 멈춰요. 막히면(한도 · 서버 오류) 잠시 쉬고, 그동안 찾기는 이미 모은 자료 · 논문으로 보여 줘요.
        {' '}AI 대체 서버: {llm?.fallback ? `${llm.fallback} (사람이 누른 요청만)` : '없음 (.env.local LLM_FALLBACK)'}
        {llm?.lastFallback && ` · 마지막 전환 ${time(llm.lastFallback.at)} ${llm.lastFallback.from} → ${llm.lastFallback.to}`}
      </p>
      <table className="adm-table">
        <thead>
          <tr>
            <th scope="col">출처</th>
            <th scope="col">오늘 호출</th>
            <th scope="col">실패</th>
            <th scope="col">하루 한도</th>
            <th scope="col">상태</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id}>
              <td title={s.note}>{s.label}</td>
              <td>{s.today.toLocaleString()}</td>
              <td>{s.fails}</td>
              <td>{s.daily ? `${s.daily.toLocaleString()} (${s.usedShare}%)` : '—'}</td>
              <td>
                {s.restingUntil ? <span className="adm-state bad">쉬는 중 ({time(s.restingUntil)}까지)</span> : s.usedShare >= 80 ? <span className="adm-state bad">한도 가까움</span> : '정상'}
                {s.lastError && <small title={s.lastError.message}> · 마지막 오류 {time(s.lastError.at)}</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="adm-desc">
        특허 자료 (기술 시계열 특허):{' '}
        {patentDb?.ready
          ? `디스플레이 특허 ${patentDb.rows.toLocaleString()}건 · 전 세계 특허 제목 ${(patentDb.titles ?? 0).toLocaleString()}건 · 마지막 공개일 ${String(patentDb.maxPub).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')} · 받은 날 ${new Date(patentDb.at).toLocaleDateString('ko-KR')}`
          : '아직 없음 — 특허는 키워드마다 BigQuery로 셈 (한 번 약 26GB)'}
        {patentDb?.loading && ' · 받는 중'}
        {patentDb?.lastError && ` · 마지막 받기 실패: ${patentDb.lastError}`}
        {' '}(같은 발명은 한 번. 분기에 한 번 서버에서 npm run patent-db, BigQuery 약 42GB)
      </p>
    </section>
  )
}

function AdminOps({ ops, onOps, onToast, health, refreshRunning, dirtyCount }) {
  const [form, setForm] = useState({ mode: ops.mode, message: ops.message ?? '', until: ops.until ?? '' })
  const [applying, setApplying] = useState(false)
  const [confirm, setConfirm] = useState(null) // 'maintenance' | 'restart'
  const [restart, setRestart] = useState(null) // { phase: 'waiting' | 'failed', error }

  const changed = form.mode !== ops.mode || (form.mode !== 'normal' && (form.message.trim() !== (ops.message ?? '') || form.until.trim() !== (ops.until ?? '')))
  const server = health?.server

  async function apply() {
    setConfirm(null)
    setApplying(true)
    try {
      const saved = await saveOpsApi(form)
      onOps(saved)
      setForm({ mode: saved.mode, message: saved.message, until: saved.until })
      onToast({ text: `운영 상태를 「${OPS_LABEL[saved.mode]}」(으)로 바꿨어요. 일반 화면에는 30초 안에 반영돼요.` })
    } catch (err) {
      onToast({ text: err.message, error: true })
    } finally {
      setApplying(false)
    }
  }

  async function resume() {
    setForm({ mode: 'normal', message: '', until: '' })
    setApplying(true)
    try {
      const saved = await saveOpsApi({ mode: 'normal' })
      onOps(saved)
      onToast({ text: '일반 화면 운영을 재개했어요.' })
    } catch (err) {
      onToast({ text: err.message, error: true })
    } finally {
      setApplying(false)
    }
  }

  async function doRestart() {
    setConfirm(null)
    const before = server?.startedAt
    setRestart({ phase: 'waiting' })
    try {
      await restartServerApi()
    } catch (err) {
      setRestart({ phase: 'failed', error: err.message })
      return
    }
    // 새로 켜진 서버는 켜진 시각이 다르다. 그때 새로고침 (로그인이 풀려 로그인 화면이 뜸)
    const started = Date.now()
    const poll = async () => {
      if (Date.now() - started > WAIT_MS) {
        setRestart({ phase: 'failed', error: '90초가 지나도 다시 켜지지 않았어요. 서버 PC에서 npm run serve 창을 확인해 주세요.' })
        return
      }
      try {
        const h = await fetchHealth()
        if (h.server?.startedAt && h.server.startedAt !== before) {
          window.location.reload()
          return
        }
      } catch {
        // 꺼져 있는 동안은 연결이 안 됨 → 계속 기다림
      }
      setTimeout(poll, 1500)
    }
    setTimeout(poll, 1500)
  }

  return (
    <>
      <section className="adm-card">
        <div className="adm-ops-head">
          <div>
            <h2>일반 화면 운영 상태</h2>
            <p className="adm-desc">
              지금 <strong className={`adm-ops-now ops-${ops.mode}`}>{OPS_LABEL[ops.mode]}</strong>
              {ops.updatedAt && ops.mode !== 'normal' && ` · ${formatAt(ops.updatedAt)}부터`}
              {ops.until && ` · ${ops.until} 재개 예정`}
            </p>
          </div>
          {ops.mode !== 'normal' && (
            <button type="button" className="adm-btn primary" onClick={resume} disabled={applying}>
              정상으로 재개
            </button>
          )}
        </div>
        <p className="adm-note">
          일반 화면(/)만 바뀌어요. 관리 페이지와 테스트 페이지는 어떤 상태에서도 그대로 쓸 수 있어 고친 것을 확인하고 재개하면 돼요. 화면만 가리는 게 아니라 서버가 요청을
          막아요.
        </p>

        <div className="adm-choices adm-ops-choices" role="radiogroup" aria-label="운영 상태">
          {MODES.map(([mode, desc]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              className="adm-choice"
              aria-checked={form.mode === mode}
              aria-pressed={form.mode === mode}
              onClick={() => setForm((f) => ({ ...f, mode }))}
            >
              <strong>
                <span className={`adm-ops-dot ops-${mode}`} aria-hidden="true" />
                {OPS_LABEL[mode]}
                {ops.mode === mode && <span className="adm-choice-badge">지금</span>}
              </strong>
              <span>{desc}</span>
            </button>
          ))}
        </div>

        {form.mode !== 'normal' && (
          <div className="adm-ops-fields">
            <label htmlFor="ops-message">
              {form.mode === 'maintenance' ? '점검 화면 문구' : '안내 띠 문구'} <span className="adm-optional">선택</span>
            </label>
            <textarea
              id="ops-message"
              rows={2}
              maxLength={200}
              value={form.message}
              placeholder={MESSAGE_HINT[form.mode]}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            />
            <label htmlFor="ops-until">
              재개 예정 <span className="adm-optional">선택</span>
            </label>
            <input
              id="ops-until"
              type="text"
              maxLength={40}
              value={form.until}
              placeholder="예: 오늘 15:00"
              onChange={(e) => setForm((f) => ({ ...f, until: e.target.value }))}
            />
          </div>
        )}

        <div className="adm-ops-actions">
          <span className="adm-note">「적용」하면 바로 바뀌어요 (아래 저장 막대와 별개). 변경 기록에 남아요.</span>
          <button
            type="button"
            className="adm-btn primary"
            disabled={!changed || applying}
            onClick={() => (form.mode === 'maintenance' && ops.mode !== 'maintenance' ? setConfirm('maintenance') : apply())}
          >
            {applying ? '적용 중…' : '적용'}
          </button>
        </div>
      </section>

      <SourcesCard sources={health?.sources} llm={health?.llm} patentDb={health?.patentDb} />

      <section className="adm-card">
        <div className="adm-ops-head">
          <div>
            <h2>서버 다시 켜기</h2>
            <p className="adm-desc">서버를 끄고 바로 다시 켜요. npm run을 다시 하는 것과 같아요.</p>
          </div>
          <button
            type="button"
            className="adm-btn"
            onClick={() => setConfirm('restart')}
            disabled={!server?.supervised || dirtyCount > 0 || Boolean(restart)}
          >
            서버 다시 켜기
          </button>
        </div>
        <dl className="adm-usage-dl">
          <dt>켜진 시각</dt>
          <dd>{server ? `${formatAt(server.startedAt)} · ${uptime(server.startedAt)}` : '—'}</dd>
          <dt>실행 방식</dt>
          <dd>
            {!server ? '—' : server.supervised ? 'npm run serve · 여기서 다시 켤 수 있어요' : 'npm run dev · 여기서 다시 켤 수 없어요'}
          </dd>
        </dl>
        {server && !server.supervised && (
          <p className="adm-alert-inline">서버 PC에서 npm run dev 대신 <code>npm run serve</code>로 켜면 이 버튼을 쓸 수 있어요. (npm run dev로 켠 서버는 끄면 다시 켜 줄 것이 없어 막아 뒀어요)</p>
        )}
        {dirtyCount > 0 && <p className="adm-alert-inline">저장하지 않은 변경 {dirtyCount}개를 먼저 저장하거나 되돌려 주세요.</p>}
        <h3 className="adm-sub">이럴 때 써요</h3>
        <ul className="adm-ops-list">
          <li>머지 뒤 서버 코드(server/)가 바뀌었을 때 — 화면 코드는 저절로 반영되지만 서버 코드는 다시 켜야 해요</li>
          <li>.env.local(AI · 네이버 키, 관리자 비밀번호)을 바꿨을 때</li>
          <li>「수집 중」이나 AI 대기열이 오래 풀리지 않을 때, DB를 껐다 켠 뒤 연결이 끊겼을 때</li>
        </ul>
        <p className="adm-note">서버가 아예 꺼져 있으면 이 페이지도 열리지 않아요. 그때는 서버 PC에서 직접 켜야 해요.</p>
      </section>

      {confirm && (
        <div className="adm-modal-backdrop" onClick={() => setConfirm(null)}>
          <div
            className="adm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ops-confirm-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setConfirm(null)}
          >
            {confirm === 'maintenance' ? (
              <>
                <h2 id="ops-confirm-title">일반 화면을 점검 중으로 바꿀까요?</h2>
                <p>지금 쓰고 있는 사람도 30초 안에 점검 화면으로 바뀌어요.</p>
                <ul>
                  <li>만들던 선별 · 보고서는 각자 브라우저에 남아 있어요</li>
                  <li>자동 요약도 멈춰요 (자동 수집은 계속)</li>
                  <li>관리 · 테스트 페이지는 그대로 쓸 수 있어요</li>
                </ul>
              </>
            ) : (
              <>
                <h2 id="ops-confirm-title">서버를 다시 켤까요?</h2>
                <p>보통 10초 안에 다시 켜지고, 이 페이지가 저절로 새로고침돼요.</p>
                <ul>
                  {refreshRunning && <li>지금 기사를 모으는 중이에요 — 끊기고 다음 최신화 때 이어서 해요</li>}
                  <li>진행 중인 요약 · 보고서 만들기가 끊겨요 (사용자는 다시 누르면 돼요)</li>
                  <li>모든 관리자 로그인이 풀려요 — 다시 로그인해 주세요</li>
                  <li>로그인 잠금(5번 틀림)도 풀려요</li>
                </ul>
              </>
            )}
            <div className="adm-modal-actions">
              <span className="adm-modal-spacer" />
              <button type="button" className="adm-btn" onClick={() => setConfirm(null)} autoFocus>
                취소
              </button>
              <button type="button" className="adm-btn primary" onClick={confirm === 'maintenance' ? apply : doRestart}>
                {confirm === 'maintenance' ? '점검 중으로 바꾸기' : '다시 켜기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {restart && (
        <div className="adm-modal-backdrop">
          <div className="adm-modal adm-restart" role="alertdialog" aria-modal="true" aria-labelledby="restart-title">
            {restart.phase === 'waiting' ? (
              <>
                <span className="adm-spinner" aria-hidden="true" />
                <h2 id="restart-title">서버를 다시 켜는 중…</h2>
                <p>켜지면 이 페이지가 저절로 새로고침돼요. 다시 로그인해 주세요.</p>
              </>
            ) : (
              <>
                <h2 id="restart-title">다시 켜지 못했어요</h2>
                <p>{restart.error}</p>
                <div className="adm-modal-actions">
                  <span className="adm-modal-spacer" />
                  <button type="button" className="adm-btn" onClick={() => setRestart(null)} autoFocus>
                    닫기
                  </button>
                  <button type="button" className="adm-btn primary" onClick={() => window.location.reload()}>
                    새로고침
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export default AdminOps
