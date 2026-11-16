// 요즘 뜨는 기술 막대 (11/14 조장): 실시간 검색어처럼 대시보드 왼쪽에 작게 — 내 보고서 왼쪽 막대와 같은 폭(--tb-rail-w)
// - 이번 주 종합 상위: 순위 · 이름(누르면 분석) · 단계 · 자사 위협/기회 표시(누르면 설명 창)
//   11/15: 10개 고정 → 화면 틀 안에서는 막대 높이에 다 들어가는 만큼(5~20개, QHD는 아래가 500px 비고 노트북은 잘렸음).
//   20개를 다 그려 두고 잘리는 줄부터 감춘다. 화면 틀 밖(휴대폰)은 10개
// - 「펼쳐 보기」를 누르면 왼쪽에서 판이 나오듯 지금의 「요즘 뜨는 기술」 전체 화면이 펼쳐진다 (Dashboard.jsx)
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchTechTrends, fetchTrendVerdicts } from './api.js'

const TOP = 10 // 화면 틀 밖
const MAX = 20 // 자사 위협 · 기회 판정도 20개까지 받음
const MIN = 5

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
  const listRef = useRef(null)
  const [framed, setFramed] = useState(false)
  const [fit, setFit] = useState(MAX)
  const all = (data?.composite ?? []).slice(0, MAX)
  useLayoutEffect(() => {
    const ol = listRef.current
    if (!ol) return undefined
    const decide = () => {
      const clip = getComputedStyle(ol).overflowY === 'hidden' // 화면 틀(App.css)에서만 막대 높이에 맞춤
      setFramed(clip)
      if (!clip) return
      const lis = [...ol.children]
      const room = ol.clientHeight
      let n = 0
      for (const li of lis) if (li.offsetTop - ol.offsetTop + li.offsetHeight <= room + 1) n += 1
      setFit(Math.max(MIN, n))
    }
    decide()
    const ro = new ResizeObserver(decide)
    ro.observe(ol)
    return () => ro.disconnect()
  }, [all.length])
  const list = framed ? all : all.slice(0, TOP)
  return (
    <aside className="panel trend-rail" aria-labelledby="tr-title">
      <div className="tr-head">
        <h2 id="tr-title">요즘 뜨는 기술</h2>
        <span className="tr-sub">{(data?.window?.label ?? '이번 주').replace(/\s*\(.*\)$/, '')} · 종합 점수</span>
      </div>
      {error && <p className="tr-empty">{error}</p>}
      {/* 11/17: 글자 한 줄 대신 목록 자리를 미리 그려 둔다 (빈 화면처럼 보이지 않게). 보통 1초 안 */}
      {!data && !error && (
        <ol className="tr-list tr-wait" aria-label="요즘 뜨는 기술을 불러오는 중">
          {[86, 70, 78, 62, 74, 58].map((w, i) => (
            <li key={i} aria-hidden="true">
              <span className="ka-bar" style={{ width: `${w}%` }} />
              <span className="ka-bar" style={{ width: `${w - 30}%`, height: 8 }} />
            </li>
          ))}
        </ol>
      )}
      {data && !list.length && <p className="tr-empty">아직 찾은 기술이 없어요</p>}
      <ol ref={listRef} className="tr-list">
        {list.map((r, i) => {
          const v = verdicts[r.name]
          return (
            <li key={r.key ?? r.name} className={framed && i >= fit ? 'is-clipped' : undefined} aria-hidden={framed && i >= fit ? true : undefined}>
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
