// 대시보드 「이번 주 한눈에」 (11/12 조장): 세부 기술 카테고리 × 경쟁사 특허 — 들어오자마자 「우리에게 무엇이 위협 · 기회인지」
// 생성형 AI가 만들 수 없는 숫자(우리 특허 DB 127만 건을 규칙으로 셈, 교수님 의견 R9 · R11, 35 문서)
// 위협 · 기회 판정은 규칙 [우리 판단] (33 문서 4장). CSOT는 출원인 이름 확인 전이라 판정 · 표에서 뺀다 (33 문서 W25)
// 11/14 디자인: 「요즘 뜨는 기술」 카드와 같은 짜임(제목 + 설명 한 줄 · 같은 표 양식 · 기준은 접기). 판정을 세부 기술 옆에,
// 숫자는 오른쪽 정렬 · 소수 둘째 자리, 빠름 = 굵게 ▲ · 느림 = 회색 ▼ (뜨는 기술 표와 같은 표시), 레드는 「위협」에만
import { useEffect, useState } from 'react'
import { fetchCategoryCompetitors } from './api.js'

// 11/20: 자사는 서버가 알려 준 own(관리 페이지 「자사」), 열은 자사 + 경쟁사 앞 두 곳 (삼성D · BOE가 있으면 먼저)
const PREFER = ['sdc', 'boe']
const shownOf = (companies = []) => {
  const own = companies.find((c) => c.own)
  const rivals = companies.filter((c) => !c.own && !c.unsure).sort((a, b) => (PREFER.indexOf(a.id) + 1 || 9) - (PREFER.indexOf(b.id) + 1 || 9)).slice(0, 2)
  return [own, ...rivals].filter(Boolean).map((c) => c.id) // 예전과 같은 순서: 자사 · 삼성D · BOE
}
const FAST = 1.2 // 분야보다 1.2배 이상 빠름
const SLOW = 0.85 // 분야의 0.85배 미만
const pace = (r, field) => (r == null || !field ? '' : r / field >= FAST ? 'up' : r / field < SLOW ? 'down' : '')
// 「배」는 휴대폰에서 숨김(칸 폭) — 대신 설명 줄에 「단위: 배」
const fmt = (r) => (r == null ? '—' : <>{r.toFixed(2)}<span className="cg-unit">배</span></>)
const SHORT = { sdc: '삼성D', lgd: '자사', boe: 'BOE' }
const Label = ({ long, short }) => (
  <>
    <span className="cg-long">{long}</span>
    <span className="cg-short">{short}</span>
  </>
)
const TAG = { 위협: 'threat', 기회: 'chance' }

function Ratio({ value, field }) {
  const p = pace(value, field)
  return (
    <span className={p ? `cg-ratio cg-${p}` : 'cg-ratio'}>
      {p === 'up' && <span aria-label="분야보다 빠름">▲ </span>}
      {p === 'down' && <span aria-label="분야보다 느림">▼ </span>}
      {fmt(value)}
    </span>
  )
}

function Verdict({ v }) {
  return v ? <span className={`cg-tag cg-tag-${TAG[v]}`}>{v}</span> : <span className="cg-none">—</span>
}

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
  const SHOWN = shownOf(rows[0]?.companies)
  const SELF = rows[0]?.companies.find((c) => c.own)?.id
  const head = SHOWN.map((id) => rows[0]?.companies.find((c) => c.id === id)).filter(Boolean)
  return (
    <section className="panel cg" aria-labelledby="cg-title">
      <div className="cg-head">
        <h2 id="cg-title">세부 기술 × 경쟁사 특허</h2>
        <p className="cg-sub">
          {rows[0]?.years ?? '최근 3년 대 앞 3년'} 특허가 몇 배 늘었나(단위: 배) · 같은 발명은 한 번 · 디스플레이 특허 DB
        </p>
      </div>
      {error && <p className="cg-empty">특허 표를 불러오지 못했어요: {error}</p>}
      {!data && !error && <p className="cg-empty">특허를 세는 중…</p>}
      {rows.length > 0 && (
        <div className="cg-scroll">
          <table className="cg-table">
            <thead>
              <tr>
                <th scope="col">세부 기술</th>
                <th scope="col" className="cg-verdict">
                  자사 판정
                </th>
                <th scope="col" className="cg-num">
                  <Label long="분야 전체" short="분야" />
                </th>
                {head.map((c) => (
                  <th key={c.id} scope="col" className={c.id === SELF ? 'cg-num cg-self' : 'cg-num'}>
                    {c.id === SELF ? '자사' : <Label long={c.name} short={SHORT[c.id] ?? c.name} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    {r.name}
                    {/* 휴대폰: 판정 칸을 숨기고 이름 아래에 */}
                    {r.verdict && (
                      <span className="cg-verdict-inline">
                        <Verdict v={r.verdict} />
                      </span>
                    )}
                  </th>
                  <td className="cg-verdict">
                    <Verdict v={r.verdict} />
                  </td>
                  <td className="cg-num cg-field">{fmt(r.field.ratio)}</td>
                  {SHOWN.map((id) => r.companies.find((c) => c.id === id))
                    .filter(Boolean)
                    .map((c) => (
                      <td key={c.id} className={c.id === SELF ? 'cg-num cg-self' : 'cg-num'} title={`${c.before.toLocaleString()} → ${c.now.toLocaleString()}건`}>
                        <Ratio value={c.ratio} field={r.field.ratio} />
                      </td>
                    ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <details className="tt-notes cg-notes">
          <summary>읽는 법 · 판정 기준</summary>
          <p className="tt-foot">
            ▲ 굵게 = 분야 전체보다 1.2배 이상 빨리 늘었음 · ▼ 회색 = 분야의 0.85배보다 느림. {data.rule}. 판정 기준은 팀이 정한 값(33 문서). CSOT는 출원인 이름 확인 전이라 뺐어요. 터치 · 접는 기기 등 세부 코드 카테고리는 11/13 특허를 다시 받은 뒤 정확해져요.
          </p>
        </details>
      )}
    </section>
  )
}
