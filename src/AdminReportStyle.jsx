// 관리 페이지 「보고서 양식」 (11/20, 관리자 인수인계 — server/reportStyle.js)
// 보고서(화면 미리보기 · PDF · PPT)의 글꼴 · 글자 크기 · 강조색 · 여백 · 줄 간격을 정한다. 바꾸는 동안 가장 최근 보고서로 미리 본다
// 미리보기는 reportSlides.js의 값을 잠깐 바꿔 그리고, 이 화면을 떠나면 저장된 값으로 되돌린다
import { Unsaved } from './unsaved.js'
import { useCallback, useEffect, useState } from 'react'
import { fetchReportStyleAdmin, saveReportStyleApi } from './api.js'
import { SlideFrame } from './ReportSlide.jsx'
import { applyReportStyle, reportPages } from './reportSlides.js'

const fmtAt = (iso) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const clone = (s) => ({ ...s, fonts: { ...s.fonts }, sizes: { ...s.sizes } })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// 숫자 칸은 글자로 들고 있다가 그릴 때만 숫자로 (지우는 중에 0으로 바뀌지 않게)
function toStyle(d) {
  const n = (v) => Number(v)
  return {
    fonts: { ea: d.fonts.ea.trim(), latin: d.fonts.latin.trim() },
    sizes: Object.fromEntries(Object.entries(d.sizes).map(([k, v]) => [k, n(v)])),
    accent: String(d.accent).replace(/^#/, '').toUpperCase(),
    margin: n(d.margin),
    lineGap: n(d.lineGap),
  }
}
const drawable = (s) =>
  s.fonts.ea && s.fonts.latin && /^[0-9A-F]{6}$/.test(s.accent) && [...Object.values(s.sizes), s.margin, s.lineGap].every((v) => Number.isFinite(v) && v > 0)

export default function AdminReportStyle({ onToast }) {
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null)
  const [sample, setSample] = useState(null)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    fetchReportStyleAdmin()
      .then((d) => {
        setData(d)
        setDraft(clone(d.style))
      })
      .catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    fetch('/api/reports')
      .then((r) => r.json())
      .then((d) => setSample((d.reports ?? d ?? [])[0] ?? null))
      .catch(() => setSample(null))
  }, [])
  // 화면을 떠나면 저장된 값으로 되돌린다 (미리보기 값이 다른 화면에 남지 않게)
  useEffect(() => () => data && applyReportStyle(data.style), [data])

  const style = draft ? toStyle(draft) : null
  // 미리보기: 지금 칸 값으로 쪽을 다시 계산 (보고서 한 건이라 그릴 때마다 계산해도 가볍다)
  let deck = null
  if (sample && style && drawable(style)) {
    applyReportStyle(style)
    try {
      deck = reportPages(sample, {})
    } catch {
      deck = null
    }
  }

  if (error && !data) return <p className="adm-error">{error}</p>
  if (!data || !draft) return <p className="adm-desc">불러오는 중…</p>

  const changed = !same(style, data.style)
  const setSize = (k, v) => setDraft((d) => ({ ...d, sizes: { ...d.sizes, [k]: v } }))
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const out = await saveReportStyleApi(style)
      setData((d) => ({ ...d, style: out.style, history: out.history }))
      setDraft(clone(out.style))
      applyReportStyle(out.style)
      onToast?.('보고서 양식을 저장했어요 — 사용자는 새로고침하면 새 양식으로 보고 내려받아요')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const pages = deck?.pages.length ?? 0

  // 11/26: 넓은 화면에서는 설정(왼쪽)과 미리보기(오른쪽, 따라 내려옴)를 나란히 — 예전엔 위아래로 화면 두 개 반
  return (
    <div className="adm-stack">
      <Unsaved id="reportStyle" label="보고서 양식" when={changed} />
      <div className="adm-style-split">
      <div className="adm-stack">
      <section className="adm-card">
        <h2>글꼴</h2>
        <p className="adm-desc">
          PPT에는 글꼴 이름만 들어가요. 보는 PC에 그 글꼴이 깔려 있어야 그 모양으로 보이고, 없으면 PowerPoint가 비슷한 글꼴로 대신 보여 줘요. 이름은 Windows 「설정 › 개인 설정 › 글꼴」에 보이는 그대로(띄어쓰기까지) 넣어 주세요.
        </p>
        <div className="adm-sec-grid">
          <label className="adm-field">
            한글 글꼴
            <input type="text" value={draft.fonts.ea} maxLength={40} onChange={(e) => setDraft((d) => ({ ...d, fonts: { ...d.fonts, ea: e.target.value } }))} />
            <small className="muted">처음 값: {data.defaults.fonts.ea} (1차 인터뷰 사내 규칙)</small>
          </label>
          <label className="adm-field">
            영문 · 숫자 글꼴
            <input type="text" value={draft.fonts.latin} maxLength={40} onChange={(e) => setDraft((d) => ({ ...d, fonts: { ...d.fonts, latin: e.target.value } }))} />
            <small className="muted">처음 값: {data.defaults.fonts.latin}</small>
          </label>
        </div>
      </section>

      <section className="adm-card">
        <h2>글자 크기 · 배치</h2>
        <p className="adm-desc">
          보고서는 이 네 가지 크기만 써요. 글이 넘치면 글자를 줄이지 않고 다음 쪽 「(계속)」으로 넘겨요. 쪽 크기(4:3 가로, 10×7.5인치)는 담당자 양식이라 바꾸지 않아요.
        </p>
        <table className="adm-table adm-imp-table">
          <thead>
            <tr>
              <th scope="col">칸</th>
              <th scope="col">어디에 쓰나</th>
              <th scope="col">처음</th>
              <th scope="col">지금</th>
            </tr>
          </thead>
          <tbody>
            {data.sizeFields.map(([k, label, desc, min, max, step]) => (
              <tr key={k}>
                <th scope="row">{label}</th>
                <td className="muted">{desc}</td>
                <td>{data.defaults.sizes[k]}pt</td>
                <td>
                  <input type="number" className="adm-imp-input" min={min} max={max} step={step} value={draft.sizes[k]} onChange={(e) => setSize(k, e.target.value)} aria-label={`${label} 글자 크기 (pt)`} />
                </td>
              </tr>
            ))}
            {data.layoutFields.map(([k, label, desc, min, max, step]) => (
              <tr key={k}>
                <th scope="row">{label}</th>
                <td className="muted">{desc}</td>
                <td>{data.defaults[k]}</td>
                <td>
                  <input type="number" className="adm-imp-input" min={min} max={max} step={step} value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} aria-label={label} />
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row">강조색</th>
              <td className="muted">헤드라인 띠 · 칸 제목 · 쪽 위 막대</td>
              <td>#{data.defaults.accent}</td>
              <td>
                <span className="adm-color-field">
                  <input type="color" value={`#${/^[0-9A-Fa-f]{6}$/.test(String(draft.accent).replace(/^#/, '')) ? String(draft.accent).replace(/^#/, '') : data.defaults.accent}`} onChange={(e) => setDraft((d) => ({ ...d, accent: e.target.value.slice(1).toUpperCase() }))} aria-label="강조색 고르기" />
                  <input type="text" className="adm-imp-input" value={`#${String(draft.accent).replace(/^#/, '')}`} maxLength={7} onChange={(e) => setDraft((d) => ({ ...d, accent: e.target.value.replace(/^#/, '') }))} aria-label="강조색 값" />
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="adm-note">「PPT (담당자 양식 · 본문 1장 + 유첨)」(내 보고서 메뉴, 칸 이름이 붙은 것)는 칸 자리가 정해져 있어 글꼴 · 강조색만 따라요. 그래프 안 글자는 10pt 그대로예요.</p>
        {error && <p className="adm-error">{error}</p>}
        <div className="adm-actions">
          <button type="button" className="adm-btn primary" onClick={save} disabled={!changed || busy}>
            {busy ? '저장 중…' : '저장'}
          </button>
          <button type="button" className="adm-link-btn" onClick={() => setDraft(clone(data.style))} disabled={!changed}>
            되돌리기
          </button>
          <button type="button" className="adm-link-btn" onClick={() => setDraft(clone(data.defaults))}>
            처음 값으로
          </button>
          {changed && <span className="muted">저장하지 않은 변경이 있어요</span>}
        </div>
      </section>
      <section className="adm-card">
        <h2>바꾼 기록</h2>
        {data.history?.length ? (
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">언제</th>
                <th scope="col">누가</th>
                <th scope="col">글꼴 · 크기</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((h) => (
                <tr key={h.at}>
                  <td>{fmtAt(h.at)}</td>
                  <td>{h.name}</td>
                  <td>
                    {h.style.fonts.ea} · {h.style.fonts.latin} · {h.style.sizes.title}/{h.style.sizes.sub}/{h.style.sizes.body}/{h.style.sizes.note}pt · #{h.style.accent} · 여백 {h.style.margin} · 줄 간격 {h.style.lineGap}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="adm-desc">아직 바꾼 적이 없어요. 지금은 처음 값(사내 규칙)이에요.</p>
        )}
      </section>
      </div>

      <section className="adm-card adm-style-preview">
        <div className="adm-ops-head">
          <div>
            <h2>미리보기</h2>
            <p className="adm-desc">{sample ? `가장 최근 보고서 「${sample.report?.title ?? ''}」를 지금 값으로 그렸어요 (저장 전 값 포함).` : '아직 보고서가 없어 미리 볼 수 없어요.'}</p>
          </div>
          {pages > 0 && (
            <div className="adm-actions">
              <button type="button" className="adm-btn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                ← 앞 쪽
              </button>
              <span className="muted">
                {Math.min(page, pages - 1) + 1} / {pages}쪽
              </span>
              <button type="button" className="adm-btn" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>
                다음 쪽 →
              </button>
            </div>
          )}
        </div>
        {deck ? <SlideFrame deck={deck} index={Math.min(page, pages - 1)} /> : sample && <p className="adm-alert-inline">값을 다 채우면 미리보기가 나와요.</p>}
      </section>
      </div>

    </div>
  )
}
