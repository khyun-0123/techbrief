// 관리 페이지 「판정 기준 › 초록으로도 세면?」 (11/22, server/abstractCompare.js)
// 특허를 제목(켠 기술은 + CPC)으로만 셀 때와 초록까지 볼 때 건수 · 위협/기회가 어떻게 바뀌는지, 초록으로만 잡힌 특허가 그 기술이 맞는지 본다
// 읽기만 한다 — 세는 방식은 이 결과를 보고 팀이 정한다 (33 문서)
import { useEffect, useState } from 'react'
import { fetchAbstractCompare, runAbstractCompare } from './api.js'

const n = (v) => (v == null ? '-' : Number(v).toLocaleString())
const pat = (s) => (s ? `${n(s.before)} → ${n(s.now)}` : '없음')
const ver = (s) => (s ? `${s.verdict ?? '판정 없음'} · 분야 ${s.ratio ?? '-'}배 · ${s.own?.name ?? '자사'} ${s.own?.ratio ?? '-'}배` : '—')

function Detail({ r }) {
  const comp = (s) =>
    s?.companies?.map((c) => `${c.name}${c.own ? '(자사)' : ''} ${c.before}→${c.now}${c.ratio != null ? ` ${c.ratio}배` : ''}${c.unsure ? ' 판단 제외' : ''}`).join(' · ') || '없음'
  return (
    <div>
      <p className="adm-desc">
        영문 검색어: <code>{r.terms.join(' | ')}</code> <span className="muted">({{ timeline: '기술 시계열 기억 값', set: '12개 기술 기본값', admin: '직접 넣음', keyword: '키워드 그대로' }[r.termsFrom]})</span>
        {r.tech && <> · CPC 연결표 「{r.tech.name}」 켬</>}
      </p>
      <p className="muted">제목만 — {comp(r.title)}</p>
      <p className="muted">제목 + 초록 — {comp(r.withAbstract)}</p>
      <p className="adm-desc">
        <b>초록으로만 잡힌 특허</b> (최근 3년 표본 {r.sample.length}건) — 그 기술이 맞는지 봐 주세요
      </p>
      <ul className="muted">
        {r.sample.map((s, i) => (
          <li key={i}>
            <b>{s.title}</b> · {s.year} · {s.owner}
            <div>{s.text}</div>
          </li>
        ))}
        {!r.sample.length && <li>없음</li>}
      </ul>
    </div>
  )
}

export default function AdminAbstractCompare() {
  const [info, setInfo] = useState(null)
  const [rows, setRows] = useState({}) // keyword → 결과 | { error }
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(null) // 세는 키워드
  const [kw, setKw] = useState('')
  const [terms, setTerms] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    fetchAbstractCompare()
      .then(setInfo)
      .catch((err) => setError(err.message))
  }, [])

  const one = async (keyword, t) => {
    setBusy(keyword)
    try {
      const r = await runAbstractCompare({ keyword, ...(t?.length ? { terms: t } : {}) })
      setRows((m) => ({ ...m, [r.keyword]: r }))
      return r
    } catch (err) {
      setRows((m) => ({ ...m, [keyword]: { keyword, error: err.message } }))
      return null
    } finally {
      setBusy(null)
    }
  }
  const all = async () => {
    for (const t of info.set) await one(t.keyword)
  }
  const custom = async (e) => {
    e.preventDefault()
    if (!kw.trim()) return
    const r = await one(kw.trim().toLowerCase(), terms.split(',').map((s) => s.trim()).filter(Boolean))
    if (r) setOpen(r.keyword)
  }

  const ab = info?.abstracts
  const list = [...(info?.set ?? []).map((t) => ({ label: t.label, keyword: t.keyword })), ...Object.keys(rows).filter((k) => !info?.set.some((t) => t.keyword === k)).map((k) => ({ label: k, keyword: k }))]
  return (
    <section className="adm-card">
      <h2>
        초록으로도 세면? <span className="adm-tag adm-tag-muted">읽기만 · AI 안 씀</span>
      </h2>
      <p className="adm-desc">
        특허를 지금처럼 <b>제목</b>(CPC 연결표를 켠 기술은 제목 + CPC)으로만 셀 때와 <b>초록까지</b> 볼 때 건수 · 위협/기회가 어떻게 바뀌는지 비교해요. 두 쪽 모두 그 특허 안에서 회사별로 비교하고, 초록으로만 잡힌 특허는 초록에 태양전지 · 광검출기 말이 있으면 빼요. 화면 판정은 바꾸지 않아요.
      </p>
      {error && <p className="adm-error">{error}</p>}
      {ab && (
        <p className="muted">
          받은 초록 {n(ab.rows)}건{ab.at ? ` · ${ab.at.slice(0, 10)}` : ''}
          {!ab.ready && ' — 아직 받지 않았어요'}
        </p>
      )}
      {info && (
        <>
          <div className="adm-actions">
            <button type="button" className="adm-btn primary" onClick={all} disabled={Boolean(busy) || !ab?.ready}>
              {busy ? `세는 중… (${busy})` : '12개 기술 한 번에 세기'}
            </button>
            <span className="muted">기술마다 수십 초 걸려요 (한 번 센 것은 기억)</span>
          </div>
          <form className="adm-actions" onSubmit={custom}>
            <input type="text" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="다른 키워드 (예: 투명 디스플레이)" aria-label="키워드" />
            <input type="text" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="영문 검색어, 쉼표로 (비우면 기억 값)" aria-label="영문 검색어" />
            <button type="submit" className="adm-btn" disabled={Boolean(busy) || !ab?.ready}>
              세기
            </button>
          </form>
          <table className="adm-table adm-judge-table">
            <thead>
              <tr>
                <th scope="col">기술</th>
                <th scope="col">특허 (제목만)</th>
                <th scope="col">특허 (제목 + 초록)</th>
                <th scope="col">위협 · 기회 (제목만)</th>
                <th scope="col">위협 · 기회 (제목 + 초록)</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {list.map(({ label, keyword }) => {
                const r = rows[keyword]
                const changed = r && !r.error && (r.title?.verdict ?? null) !== (r.withAbstract?.verdict ?? null)
                return [
                  <tr key={keyword}>
                    <th scope="row">
                      {label}
                      {r?.tech && <div className="muted">CPC 연결표 켬</div>}
                    </th>
                    {r?.error ? (
                      <td colSpan={4} className="adm-error">
                        {r.error}
                      </td>
                    ) : r ? (
                      <>
                        <td>{pat(r.title)}</td>
                        <td>
                          {pat(r.withAbstract)}
                          {r.title && r.withAbstract && <div className="muted">최근 3년 +{n(r.withAbstract.now - r.title.now)}건</div>}
                        </td>
                        <td>{ver(r.title)}</td>
                        <td>
                          {changed ? <b>{ver(r.withAbstract)}</b> : ver(r.withAbstract)}
                        </td>
                      </>
                    ) : (
                      <td colSpan={4} className="muted">
                        {busy === keyword ? '세는 중…' : '아직 안 셈'}
                      </td>
                    )}
                    <td>
                      {r && !r.error ? (
                        <button type="button" className="adm-link-btn" onClick={() => setOpen((o) => (o === keyword ? null : keyword))} aria-expanded={open === keyword}>
                          {open === keyword ? '닫기' : '자세히'}
                        </button>
                      ) : (
                        <button type="button" className="adm-link-btn" onClick={() => one(keyword)} disabled={Boolean(busy) || !ab?.ready}>
                          세기
                        </button>
                      )}
                    </td>
                  </tr>,
                  open === keyword && r && !r.error && (
                    <tr key={keyword + ':d'}>
                      <td colSpan={6}>
                        <Detail r={r} />
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
          {Object.keys(rows).length > 0 && <p className="muted">기간: {Object.values(rows).find((r) => r.years)?.years} · 굵은 글씨 = 초록을 넣으면 판정이 바뀜</p>}
        </>
      )}
    </section>
  )
}
