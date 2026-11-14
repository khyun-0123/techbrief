// 요즘 뜨는 기술 막대 (11/14 조장): 실시간 검색어처럼 대시보드 왼쪽에 작게 — 내 보고서 왼쪽 막대와 같은 폭(--tb-rail-w)
// - 이번 주 종합 상위 10개: 순위 · 이름(누르면 분석) · 단계 · 자사 위협/기회 표시(누르면 설명 창)
// - 「펼쳐 보기」를 누르면 왼쪽에서 판이 나오듯 지금의 「요즘 뜨는 기술」 전체 화면이 펼쳐진다 (Dashboard.jsx)
import { useEffect, useState } from 'react'
import { fetchTechTrends, fetchTrendVerdicts } from './api.js'

const TOP = 10

export default function TrendRail({ onPick, onOpen, onVerdicts, onVerdict }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [verdicts, setVerdicts] = useState({})
  useEffect(() => {
    let on = true
    fetchTechTrends({ period: 'week' })
      .then((d) => {
        if (!on) return
        setData(d)
        const names = (d.composite ?? []).slice(0, 20).map((r) => r.name)
        if (names.length)
          fetchTrendVerdicts(names)
            .then((v) => {
              if (!on) return
              setVerdicts(v.verdicts ?? {})
              onVerdicts?.(v)
            })
            .catch(() => {})
      })
      .catch((err) => on && setError(err.message))
    return () => {
      on = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const list = (data?.composite ?? []).slice(0, TOP)
  return (
    <aside className="panel trend-rail" aria-labelledby="tr-title">
      <div className="tr-head">
        <h2 id="tr-title">요즘 뜨는 기술</h2>
        <span className="tr-sub">{(data?.window?.label ?? '이번 주').replace(/\s*\(.*\)$/, '')} · 종합 점수</span>
      </div>
      {error && <p className="tr-empty">{error}</p>}
      {!data && !error && <p className="tr-empty">불러오는 중…</p>}
      {data && !list.length && <p className="tr-empty">아직 찾은 기술이 없어요</p>}
      <ol className="tr-list">
        {list.map((r, i) => {
          const v = verdicts[r.name]
          return (
            <li key={r.key ?? r.name}>
              <span className={i < 3 ? 'tr-rank top' : 'tr-rank'}>{i + 1}</span>
              <span className="tr-body">
                <button type="button" className="tr-name" onClick={() => onPick(r.name)} title={`「${r.name}」 분석 · 종합 ${r.score}점 · ${r.grade}`}>
                  {r.name}
                </button>
                <span className="tr-meta">
                  {r.stage || r.grade}
                  {v?.verdict && (
                    <button type="button" className={`tr-verdict tr-${v.verdict === '위협' ? 'threat' : 'chance'}`} onClick={() => onVerdict(r.name, v)} title="왜 위협 · 기회인지 보기">
                      자사 {v.verdict}
                    </button>
                  )}
                </span>
              </span>
              <span className="tr-score">{r.score}</span>
            </li>
          )
        })}
      </ol>
      <button type="button" className="tr-open" onClick={onOpen} aria-haspopup="dialog">
        펼쳐 보기 <span aria-hidden="true">›</span>
      </button>
    </aside>
  )
}
