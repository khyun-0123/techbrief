// 관리 페이지 「중요도 기준」 (11/15 팀 회의: 중요도 기준을 관리자 페이지에서 수정) — server/importanceRule.js
// 다섯 칸 배점(합 100)과 「중요」 기준 점수를 바꾼다. 저장 전에 미리보기(지금 자료로 중요 몇 건이 되는지 · 새로 들어오고 빠지는 이슈)를 먼저 보게 한다
// 칸마다 계산 규칙은 그대로이고 칸 점수만 「새 배점 ÷ 기본 배점」만큼 늘리거나 줄인다. 저장하면 다음 목록부터 바로 반영
import { useCallback, useEffect, useState } from 'react'
import { fetchImportanceRule, previewImportanceRule, saveImportanceRuleApi } from './api.js'

const same = (a, b) => a && b && a.high === b.high && Object.keys(a.weights).every((k) => a.weights[k] === b.weights[k])
const fmtAt = (iso) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function AdminImportance({ onToast, onChanged }) {
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null)
  const [preview, setPreview] = useState(null)
  const [previewed, setPreviewed] = useState(null) // 미리보기한 값 (이 값이어야 저장 가능)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    fetchImportanceRule()
      .then((d) => {
        setData(d)
        setDraft(structuredClone(d.rule))
      })
      .catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])
  if (error && !data) return <p className="adm-error">{error}</p>
  if (!data || !draft) return <p className="adm-desc">불러오는 중…</p>

  const sum = Object.values(draft.weights).reduce((a, b) => a + (Number(b) || 0), 0)
  const changed = !same(draft, data.rule)
  const valid = sum === 100 && draft.high >= 20 && draft.high <= 80
  const setW = (k, v) => {
    setDraft((d) => ({ ...d, weights: { ...d.weights, [k]: Math.max(0, Math.min(50, Math.round(Number(v) || 0))) } }))
    setPreview(null)
  }
  const runPreview = async () => {
    setBusy(true)
    setError('')
    try {
      setPreview(await previewImportanceRule(draft))
      setPreviewed(structuredClone(draft))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const out = await saveImportanceRuleApi(draft)
      setData((d) => ({ ...d, rule: out.rule, history: out.history }))
      setPreview(null)
      onToast?.('중요도 기준을 저장했어요 — 다음 목록부터 반영돼요')
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const canSave = changed && valid && same(previewed, draft) && preview && !busy
  return (
    <div className="adm-stack">
      <section className="adm-card">
        <h2>
          중요도 배점 <span className="adm-tag adm-tag-muted">AI 안 씀</span>
        </h2>
        <p className="adm-desc">
          기사 · 이슈의 중요도(0~100)는 다섯 칸을 더해요. 칸마다 계산 규칙은 그대로이고, 여기서 바꾼 배점만큼 그 칸 점수를 늘리거나 줄여요(0이면 그 칸을 안 봄). 합계는 100이어야 해요. 논문은 따로 논문 점수를 써요.
        </p>
        <table className="adm-table adm-imp-table">
          <thead>
            <tr>
              <th scope="col">칸</th>
              <th scope="col">무엇을 보나</th>
              <th scope="col">기본</th>
              <th scope="col">배점</th>
            </tr>
          </thead>
          <tbody>
            {data.parts.map(([k, label, desc]) => (
              <tr key={k}>
                <th scope="row">{label}</th>
                <td className="muted">{desc}</td>
                <td>{data.defaults.weights[k]}</td>
                <td>
                  <input type="number" min="0" max="50" step="1" value={draft.weights[k]} onChange={(e) => setW(k, e.target.value)} aria-label={`${label} 배점`} className="adm-imp-input" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                합계
              </th>
              <td className={sum === 100 ? 'adm-imp-sum ok' : 'adm-imp-sum bad'}>{sum} / 100</td>
            </tr>
          </tfoot>
        </table>
        <label className="adm-field-inline">
          「중요」 기준 점수
          <input
            type="number"
            min="20"
            max="80"
            value={draft.high}
            onChange={(e) => {
              setDraft((d) => ({ ...d, high: Math.round(Number(e.target.value) || 0) }))
              setPreview(null)
            }}
            className="adm-imp-input"
          />
          <small>이 점수 이상이면 목록에 「중요」 배지가 붙고, 「뉴스·논문에서 찾기」 결과 중 이 점수 이상 뉴스는 자동으로 요약돼요 — 낮추면 AI 요약이 늘어나요. 기본 {data.defaults.high}점.</small>
        </label>
        {error && <p className="adm-error">{error}</p>}
        <div className="adm-actions">
          <button type="button" className="adm-btn" onClick={runPreview} disabled={!valid || busy}>
            {busy && !preview ? '세는 중…' : '미리보기'}
          </button>
          <button type="button" className="adm-btn primary" onClick={save} disabled={!canSave} title={canSave ? '' : '바꾼 값으로 미리보기를 먼저 해 주세요'}>
            저장
          </button>
          <button
            type="button"
            className="adm-link-btn"
            onClick={() => {
              setDraft(structuredClone(data.defaults))
              setPreview(null)
            }}
          >
            기본값으로
          </button>
          {changed && <span className="muted">바뀐 값이 있어요 — 미리보기 뒤 저장</span>}
        </div>
        {preview && (
          <div className="adm-imp-preview" aria-live="polite">
            <p>
              지금 목록의 이슈 {preview.total.toLocaleString()}개 중 「중요」 — 지금 기준 <b>{preview.nowHigh}개</b> → 바꾼 기준 <b>{preview.nextHigh}개</b> (새로 들어옴 {preview.enteringCount} · 빠짐 {preview.leavingCount})
            </p>
            {[
              ['새로 「중요」가 되는 이슈', preview.entering],
              ['「중요」에서 빠지는 이슈', preview.leaving],
            ].map(([title, list]) =>
              list.length ? (
                <div key={title}>
                  <h3>{title}</h3>
                  <ul>
                    {list.map((x) => (
                      <li key={x.id}>
                        {x.title} <span className="muted">· {x.source} · {x.before} → {x.after}점</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
        )}
      </section>
      <section className="adm-card">
        <h2>바꾼 기록</h2>
        {data.history?.length ? (
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">언제</th>
                <th scope="col">누가</th>
                <th scope="col">배점 (신규 · 사업 · 출처 · 최신 · 보도량)</th>
                <th scope="col">중요 기준</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((h) => (
                <tr key={h.at}>
                  <td>{fmtAt(h.at)}</td>
                  <td>{h.name}</td>
                  <td>{data.parts.map(([k]) => h.rule.weights[k]).join(' · ')}</td>
                  <td>{h.rule.high}점</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="adm-desc">아직 바꾼 적이 없어요. 지금은 기본값({data.parts.map(([k]) => data.defaults.weights[k]).join(' · ')}, {data.defaults.high}점)이에요.</p>
        )}
      </section>
    </div>
  )
}
