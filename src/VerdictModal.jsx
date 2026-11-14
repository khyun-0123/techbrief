// 자사 위협 · 기회 설명 창 (11/14 조장): 요즘 뜨는 기술의 위협 · 기회 표시를 누르면 판정 이유와 그 세부 기술의 경쟁사 특허 표
// 대시보드에서 뺀 「세부 기술 × 경쟁사 특허」(CategoryGlance)를 필요한 기술 하나만 여기서 보여 준다. 판정 규칙은 server/keywordBundle.js (33 문서)
import { useEffect, useRef } from 'react'

const fmt = (r) => (r == null ? '—' : `${r.toFixed(2)}배`)

export default function VerdictModal({ term, info, threatFactor = 1.5, onClose, onAnalyze }) {
  const closeRef = useRef(null)
  useEffect(() => {
    closeRef.current?.focus()
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const c = info.competitors
  const rows = [{ name: '분야 전체', before: c.field?.before, now: c.field?.now, ratio: c.field?.ratio, intl: c.field?.intl, field: true }, ...(c.companies ?? []).filter((x) => !x.unsure)]
  const why =
    info.verdict === '위협'
      ? `「${c.name}」에서 경쟁사 특허가 분야 전체보다 ${threatFactor}배 이상 빠르게 늘었는데, 자사는 분야보다 느려요.`
      : info.verdict === '기회'
        ? `「${c.name}」에서 자사 특허가 분야 이상으로 늘었고, 비교한 경쟁사 모두보다 빨라요.`
        : `「${c.name}」에서 위협 · 기회 어느 쪽 조건에도 들지 않아요.`
  return (
    <div className="modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel modal verdict-modal" role="dialog" aria-modal="true" aria-labelledby="vm-title">
        <div className="vm-head">
          <h2 id="vm-title">
            {term} {info.verdict && <span className={`vm-tag vm-${info.verdict === '위협' ? 'threat' : 'chance'}`}>자사 {info.verdict}</span>}
          </h2>
          <button ref={closeRef} type="button" className="split-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <p className="vm-why">{why}</p>
        <p className="vm-sub">
          세부 기술 「{c.name}」 · {c.years} · 이 기술 이름이 든 특허 {info.category.patents.toLocaleString()}건이 가장 많이 걸친 세부 기술로 연결
        </p>
        <div className="table-scroll">
          <table className="vm-table">
            <thead>
              <tr>
                <th scope="col">회사</th>
                <th scope="col" className="cg-num">
                  앞 3년
                </th>
                <th scope="col" className="cg-num">
                  최근 3년
                </th>
                <th scope="col" className="cg-num">
                  증가
                </th>
                <th scope="col" className="cg-num" title="최근 3년 특허 중 같은 발명을 2개 나라 이상에 낸 몫 (11/15 팀 회의: 해외 특허가 더 중요할 수 있음 — 판정에는 아직 안 넣음)">
                  해외 출원
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className={r.own ? 'vm-own' : r.field ? 'vm-field' : ''}>
                  <th scope="row">{r.own && !r.name.includes('자사') ? `${r.name} (자사)` : r.name}</th>
                  <td className="cg-num">{r.before?.toLocaleString() ?? '—'}</td>
                  <td className="cg-num">{r.now?.toLocaleString() ?? '—'}</td>
                  <td className="cg-num">{fmt(r.ratio)}</td>
                  <td className="cg-num">{r.intl == null ? '—' : `${Math.round(r.intl * 100)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="vm-note">특허 수는 테크브리프 디스플레이 특허 DB(같은 발명은 한 번)에서 규칙으로 센 값이에요. 판정 기준은 팀이 정한 값이라 담당자 확인이 필요해요. 증가 배수는 적은 건수가 부풀지 않게 앞 · 뒤에 5건씩 더해 계산하고(1→5건은 5배가 아니라 1.7배), 두 기간 합이 10건 미만이면 「—」(판정에서 뺌)로 둬요. 「해외 출원」은 최근 3년 특허 중 2개 나라 이상에 낸 몫이에요(판정에는 아직 안 넣음). CSOT는 출원인 이름 확인 전이라 뺐어요.</p>
        <div className="vm-actions">
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          <button type="button" className="btn primary" onClick={() => onAnalyze(term)}>
            「{term}」 분석하기
          </button>
        </div>
      </div>
    </div>
  )
}
