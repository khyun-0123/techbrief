// 관리 페이지 「AI 모델」 아래 칸: 모델 이름 · 예비 AI (11/20, 관리자 인수인계 — server/llm/client.js setModelOverrides)
// 빈 칸은 서버 설정 파일 값. AI 서버 주소 · 열쇠(API 키)는 여기서 바꾸지 않는다
import { Unsaved } from './unsaved.js'
import { useState } from 'react'
import { saveLlmModels } from './api.js'

export default function AdminLlmModels({ llm, onSaved, onToast }) {
  const init = () => ({
    models: Object.fromEntries(
      llm.providers.map((p) => [
        p.id,
        { model: p.model && p.model !== p.envModel ? p.model : '', reportModel: p.reportModel && p.reportModel !== p.envReportModel ? p.reportModel : '' },
      ]),
    ),
    fallback: llm.fallbackSetting ?? '',
  })
  const [draft, setDraft] = useState(init)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (id, k, v) => setDraft((d) => ({ ...d, models: { ...d.models, [id]: { ...d.models[id], [k]: v } } }))
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const out = await saveLlmModels(draft)
      onToast?.('AI 모델 설정을 저장했어요 — 다음 요청부터 바로 써요')
      onSaved?.(out)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="adm-card">
      <Unsaved id="llmModels" label="모델 이름 · 예비 AI" when={JSON.stringify(draft) !== JSON.stringify(init())} />
      <h2>모델 이름 · 예비 AI</h2>
      <p className="adm-desc">기본 AI 서버마다 쓸 모델 이름을 바꿀 수 있어요. 비워 두면 서버 설정 파일 값을 써요. 주소 · API 키는 위 「AI 연결 · API 키」에서, 새 연결의 모델은 그 연결의 「바꾸기」에서 바꿔요.</p>
      <table className="adm-table adm-llm-table">
        <thead>
          <tr>
            <th scope="col">AI 서버</th>
            <th scope="col">요약 모델</th>
            <th scope="col">보고서 모델</th>
          </tr>
        </thead>
        <tbody>
          {llm.providers.filter((p) => !p.custom).map((p) => (
            <tr key={p.id}>
              <th scope="row">
                {p.label}
                {!p.ready && <span className="muted"> · 설정 없음</span>}
              </th>
              <td>
                <input type="text" value={draft.models[p.id]?.model ?? ''} placeholder={p.envModel || '설정 파일에 없음'} onChange={(e) => set(p.id, 'model', e.target.value)} aria-label={`${p.label} 요약 모델`} />
              </td>
              <td>
                <input type="text" value={draft.models[p.id]?.reportModel ?? ''} placeholder={p.envReportModel || '요약 모델과 같음'} onChange={(e) => set(p.id, 'reportModel', e.target.value)} aria-label={`${p.label} 보고서 모델`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="adm-field-inline">
        예비 AI
        <select value={draft.fallback} onChange={(e) => setDraft((d) => ({ ...d, fallback: e.target.value }))}>
          <option value="">서버 설정 파일 값 ({llm.envFallback ?? '없음'})</option>
          <option value="none">쓰지 않음</option>
          {llm.providers.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.ready}>
              {p.label}
            </option>
          ))}
        </select>
        <small>지금 AI 서버가 응답하지 않을 때, 사람이 누른 요청(요약 · 보고서)만 예비 AI로 한 번 더 보내요. 자동 요약은 넘기지 않아요 (유료 모델 요금이 쌓이지 않게).</small>
      </label>
      {error && <p className="adm-error">{error}</p>}
      <div className="adm-actions">
        <button type="button" className="adm-btn primary" onClick={save} disabled={busy}>
          {busy ? '저장 중…' : '저장'}
        </button>
        <button type="button" className="adm-link-btn" onClick={() => setDraft(init())}>
          되돌리기
        </button>
      </div>
    </section>
  )
}
