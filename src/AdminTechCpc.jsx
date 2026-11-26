// 관리 페이지 「판정 기준 › 기술 ↔ CPC 연결표」 (11/21, server/techCpc.js)
// 특허 제목에 그 말이 드문 기술(탠덤 OLED 등)도 세부 기술 분류(CPC)로 센다. 켠 기술은 특허 수 · 단계 · 자사 위협 · 기회를 그 기술 특허로 계산
// CPC를 잘못 고르면 엉뚱한 특허가 섞이므로 「미리 세기」로 건수와 표본 제목을 본 뒤 켠다
import { Unsaved } from './unsaved.js'
import { useCallback, useEffect, useState } from 'react'
import { fetchTechCpc, previewTechCpc, saveTechCpcApi } from './api.js'

const FIELDS = [
  ['cpc', 'CPC', '예: ^(H10K50/19|H01L51/5278)'],
  ['with', '함께 있어야 하는 CPC', '넓은 CPC일 때만'],
  ['withTitle', '또는 제목에', '예: quantum[ -]?dot'],
  ['exclude', '빼는 제목', '예: solar|photovolt'],
]

function Row({ t, onChange }) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => {
    onChange({ ...t, [k]: v })
    setPreview(null)
  }
  const check = async () => {
    setBusy(true)
    setError('')
    try {
      setPreview(await previewTechCpc(t))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <tr>
        <td>
          <input type="checkbox" checked={t.on} onChange={(e) => set('on', e.target.checked)} aria-label={`${t.name} 켜기`} />
        </td>
        <th scope="row">
          {t.name}
          <div className="muted">찾는 말: {t.match}</div>
        </th>
        <td>
          <code>{t.cpc}</code>
          {t.with && <div className="muted">+ CPC {t.with}</div>}
          {t.withTitle && <div className="muted">또는 제목 {t.withTitle}</div>}
        </td>
        <td className="muted">{t.note}</td>
        <td>
          <div className="adm-actions">
            <button type="button" className="adm-btn" onClick={check} disabled={busy}>
              {busy ? '세는 중…' : '미리 세기'}
            </button>
            <button type="button" className="adm-link-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? '닫기' : '고치기'}
            </button>
          </div>
        </td>
      </tr>
      {(open || preview || error) && (
        <tr>
          <td />
          <td colSpan={4}>
            {open && (
              <div className="adm-judge-owner">
                {FIELDS.map(([k, label, ph]) => (
                  <label key={k} className="muted">
                    {label}
                    <input type="text" value={t[k] ?? ''} placeholder={ph} onChange={(e) => set(k, e.target.value)} />
                  </label>
                ))}
              </div>
            )}
            {error && <p className="adm-error">{error}</p>}
            {preview && (
              <div>
                <p className="adm-desc">
                  CPC 조건만으로 {preview.years}: <b>{preview.before}건 → {preview.now}건</b> (제목으로 잡히는 특허는 여기에 더해져요). 아래 표본이 그 기술이 맞는지 봐 주세요.
                </p>
                <ul className="muted">
                  {preview.sample.map((s, i) => (
                    <li key={i}>
                      {s.title} <span className="muted">· {s.year} · {s.owner}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export default function AdminTechCpc({ onToast }) {
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    fetchTechCpc()
      .then((d) => {
        setData(d)
        setDraft(d.list)
      })
      .catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])
  if (!data) return <section className="adm-card">{error ? <p className="adm-error">{error}</p> : <p className="adm-desc">불러오는 중…</p>}</section>
  const changed = JSON.stringify(draft) !== JSON.stringify(data.list)
  const save = async (reset = false) => {
    setBusy(true)
    setError('')
    try {
      const out = await saveTechCpcApi(reset ? { reset: true } : { list: draft })
      setData((d) => ({ ...d, list: out.list, version: out.version }))
      setDraft(out.list)
      onToast?.('연결표를 저장했어요 — 켠 기술은 키워드를 열 때 특허를 다시 세고 단계 · 위협/기회도 다시 판정해요')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="adm-card">
      <Unsaved id="techCpc" label="기술 ↔ CPC 연결표" when={changed} />
      <h2>
        기술 ↔ CPC 연결표 <span className="adm-tag adm-tag-muted">AI 안 씀</span>
      </h2>
      <p className="adm-desc">
        특허 제목에 그 말이 드문 기술(예: 탠덤 OLED — 제목 기준 4건)은 세부 기술 분류(CPC)로도 세요. 켠 기술은 특허 수 · 기술 단계 · 「자사 위협 · 기회」를 <b>그 기술 특허 안에서</b> 계산해요 (끈 기술은 예전처럼 제목 + 넓은 분류). CPC를 잘못 고르면 엉뚱한 특허가 섞이니 「미리 세기」로 표본 제목을 보고 켜 주세요.
      </p>
      <table className="adm-table adm-judge-table">
        <thead>
          <tr>
            <th scope="col">켬</th>
            <th scope="col">기술</th>
            <th scope="col">CPC 조건</th>
            <th scope="col">근거</th>
            <th scope="col">확인</th>
          </tr>
        </thead>
        <tbody>
          {draft.map((t, i) => (
            <Row key={t.id} t={t} onChange={(next) => setDraft((d) => d.map((x, j) => (j === i ? next : x)))} />
          ))}
        </tbody>
      </table>
      {error && <p className="adm-error">{error}</p>}
      <div className="adm-actions">
        <button type="button" className="adm-btn primary" onClick={() => save(false)} disabled={!changed || busy}>
          {busy ? '저장 중…' : '저장'}
        </button>
        <button type="button" className="adm-link-btn" onClick={() => save(true)} disabled={busy}>
          처음 값으로
        </button>
        {changed && <span className="muted">바뀐 값이 있어요</span>}
      </div>
    </section>
  )
}
