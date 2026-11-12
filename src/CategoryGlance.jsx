// 대시보드 「이번 주 한눈에」 (11/12 조장): 세부 기술 카테고리 × 경쟁사 특허 — 들어오자마자 「우리에게 무엇이 위협 · 기회인지」
// 생성형 AI가 만들 수 없는 숫자(우리 특허 DB 127만 건을 규칙으로 셈, 교수님 의견 R9 · R11, 35 문서)
// 위협 · 기회 판정은 규칙 [우리 판단] (33 문서 4장). CSOT는 출원인 이름 확인 전이라 판정 · 표에서 뺀다 (33 문서 W25)
import { useEffect, useState } from 'react'
import { fetchCategoryCompetitors } from './api.js'

const SHOWN = ['sdc', 'lgd', 'boe']
const ratioClass = (r, field) => (r == null ? '' : r / field >= 1.2 ? 'cg-up' : r / field < 0.85 ? 'cg-down' : '')
const TAG = { 위협: 'threat', 기회: 'chance' }

export default function CategoryGlance() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let on = true
    fetchCategoryCompetitors()
      .then((d) => on && setData(d))
      .catch((err) => on && setError(err.message))
    return () => {
      on = false
    }
  }, [])
  const rows = (data?.categories ?? []).filter((c) => c.field?.before > 0)
  const head = rows[0]?.companies.filter((c) => SHOWN.includes(c.id)) ?? []
  return (
    <section className="panel cg" aria-labelledby="cg-title">
      <div className="cg-head">
        <h2 id="cg-title" className="dash-title">
          세부 기술 × 경쟁사 특허
        </h2>
        <span className="hint">{rows[0]?.years ?? '최근 3년 대 앞 3년'} · 같은 발명은 한 번 · 디스플레이 특허 DB</span>
      </div>
      {error && <p className="hint">특허 표를 불러오지 못했어요: {error}</p>}
      {!data && !error && <p className="hint">특허를 세는 중…</p>}
      {rows.length > 0 && (
        <div className="cg-scroll">
          <table className="cg-table">
            <thead>
              <tr>
                <th scope="col">세부 기술</th>
                <th scope="col">분야 전체</th>
                {head.map((c) => (
                  <th key={c.id} scope="col">
                    {c.name}
                  </th>
                ))}
                <th scope="col">자사에</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.name}</th>
                  <td>{r.field.ratio}배</td>
                  {r.companies
                    .filter((c) => SHOWN.includes(c.id))
                    .map((c) => (
                      <td key={c.id} className={ratioClass(c.ratio, r.field.ratio)} title={`${c.before.toLocaleString()} → ${c.now.toLocaleString()}건`}>
                        {c.ratio != null ? `${c.ratio}배` : '-'}
                      </td>
                    ))}
                  <td>{r.verdict ? <span className={`report-tag report-tag-${TAG[r.verdict]}`}>{r.verdict}</span> : <span className="hint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <p className="hint cg-note">
          굵은 파랑 = 분야보다 1.2배 이상 빠름 · 주황 = 분야보다 느림. {data.rule}. 판정 기준은 팀이 정한 값(33 문서). CSOT는 출원인 이름 확인 전이라 뺐어요. 터치 · 접는 기기 등 세부 코드 카테고리는 11/13 특허를 다시 받은 뒤 정확해져요.
        </p>
      )}
    </section>
  )
}
