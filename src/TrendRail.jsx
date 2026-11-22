// 요즘 뜨는 기술 막대 (11/14 조장): 실시간 검색어처럼 대시보드 왼쪽에 작게 — 내 보고서 왼쪽 막대와 같은 폭(--tb-rail-w)
// - 이번 주 종합 상위: 순위 · 이름(누르면 분석) · 단계 · 자사 위협/기회 표시(누르면 설명 창)
//   11/15: 10개 고정 → 화면 틀 안에서는 막대 높이에 다 들어가는 만큼(5~20개, QHD는 아래가 500px 비고 노트북은 잘렸음).
//   20개를 다 그려 두고 잘리는 줄부터 감춘다. 화면 틀 밖(휴대폰)은 10개
// - 11/22: 받으면 1위를 대시보드에 알린다(onFirst) — 첫 화면은 1위를 저절로 분석. 지금 분석 중인 기술(active)은 줄을 칠해 둔다
// - 11/22 시안 2차: 「접기 «」 · 「펼쳐 보기 ›」 두 단추 → 오른쪽 가장자리 손잡이 하나(RailHandle)로 넣기 · 기본 · 넓게 세 단계.
//   넣기 = 좁은 띠(세로 「요즘 뜨는 기술」, 누르면 기본) · 넓게 = 예전 「펼쳐 보기」 전체 표 (Dashboard.jsx drawer)
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchTechTrends, fetchTrendVerdicts } from './api.js'

const TOP = 10 // 화면 틀 밖
const MAX = 20 // 자사 위협 · 기회 판정도 20개까지 받음

export default function TrendRail({ active, onFirst, onPick, onVerdicts, onVerdict, collapsed = false, onToggle }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [verdicts, setVerdicts] = useState({})
  useEffect(() => {
    let on = true
    fetchTechTrends({ period: 'week' })
      .then((d) => {
        if (!on) return
        setData(d)
        onFirst?.(d.composite?.[0]?.name ?? null)
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
      .catch((err) => {
        if (!on) return
        setError(err.message)
        onFirst?.(null)
      })
    return () => {
      on = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const listRef = useRef(null)
  const [framed, setFramed] = useState(false)
  const [gap, setGap] = useState(0)
  // 촘촘 모드 (11/22): 두 줄(이름 / 단계)로 다 안 들어가면 한 줄(이름 · 위협 표시)로 — 20개를 숨기지 않고 다 보이게. 단계는 이름에 마우스를 올리면
  const [dense, setDense] = useState(false)
  const twoLine = useRef(0) // 두 줄일 때 줄 하나 높이 (한 줄에서 다시 두 줄로 돌아갈 수 있는지 셈)
  const all = (data?.composite ?? []).slice(0, MAX)
  // 11/18 조장: 조금이라도 잘리는 줄은 빼고, 남는 아래 여백은 줄 사이에 고르게 나눈다 (하단을 비워 두지 않게)
  // 예전엔 처음 그린 높이로만 셌다 → 위협 · 기회 표시가 붙거나 글꼴이 늦게 들어와 줄이 높아지면 마지막 줄이 잘렸음.
  // 이제 줄마다 높이가 바뀌면 다시 센다. 줄 높이만 더해 세므로(사이 여백 제외) 여백을 넣어도 셈이 흔들리지 않는다
  useLayoutEffect(() => {
    const ol = listRef.current
    if (!ol) return undefined
    const decide = () => {
      const clip = getComputedStyle(ol).overflowY !== 'visible' // 화면 틀(App.css)에서만 막대 높이에 맞춤
      setFramed(clip)
      if (!clip) return setGap(0)
      // 11/22 검수 「세로 크기에 맞춰 다 보여 줘」: 줄을 감추지 않는다. 다 들어가면 남는 높이를 줄 사이에 나누고, 모자라면 막대 안에서 스크롤
      const room = ol.clientHeight
      let used = 0
      for (const li of ol.children) used += li.offsetHeight
      const n = ol.children.length
      if (!n) return setGap(0)
      if (!ol.classList.contains('is-dense')) {
        twoLine.current = used / n
        if (used > room) return setDense(true)
      } else if (twoLine.current && twoLine.current * n <= room) return setDense(false)
      setGap(n > 1 && used < room ? Math.min(12, (room - used) / n) : 0)
    }
    decide()
    const ro = new ResizeObserver(decide)
    ro.observe(ol)
    for (const li of ol.children) ro.observe(li)
    return () => ro.disconnect()
  }, [all.length, verdicts])
  const list = framed ? all : all.slice(0, TOP)
  if (collapsed)
    return (
      <aside className="panel trend-rail is-collapsed" aria-label="요즘 뜨는 기술 (접힘)">
        <button type="button" className="tr-unfold" onClick={onToggle} aria-expanded="false" title="요즘 뜨는 기술 보이기">
          <span className="tr-unfold-text">요즘 뜨는 기술</span>
        </button>
      </aside>
    )
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
      <ol ref={listRef} className={dense ? 'tr-list is-dense' : 'tr-list'} style={framed ? { '--tr-gap': `${gap}px` } : undefined}>
        {list.map((r, i) => {
          const v = verdicts[r.name]
          return (
            <li
              key={r.key ?? r.name}
              className={r.name === active ? 'is-on' : undefined}
              aria-current={r.name === active ? 'true' : undefined}
            >
              <span className={i < 3 ? 'tr-rank top' : 'tr-rank'}>{i + 1}</span>
              <span className="tr-body">
                <button type="button" className="tr-name" onClick={() => onPick(r.name)} title={`「${r.name}」 분석 · ${r.stage || r.grade} · 종합 ${r.score}점`}>
                  {r.name}
                </button>
                <span className="tr-meta">
                  <span className="tr-stage">{r.stage || r.grade}</span>
                  {v?.verdict && (
                    <button type="button" className={`tr-verdict tr-${v.verdict === '위협' ? 'threat' : 'chance'}`} onClick={() => onVerdict(r.name, v)} title="왜 위협 · 기회인지 보기">
                      <span className="tr-own">자사 </span>
                      {v.verdict}
                    </button>
                  )}
                </span>
              </span>
              <span className="tr-score">{r.score}</span>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}

// 막대 오른쪽 가장자리 손잡이 (11/22 시안 2차): 넣기 · 기본 · 넓게 세 단계
// - 11/22 팀 검수: 가운데 끌기 손잡이는 끄는 동안 손잡이만 따로 움직여 어색 → 없애고 ‹ › 단추 두 개만
// - 단추에 초점을 두고 ← → Home End 로도 바꿈
// - 화면 읽기 프로그램: 단추 이름 「좁게 (넣기)」 · 「넓게 (넓게)」, 묶음 이름에 지금 단계
const STEPS = ['넣기', '기본', '넓게']
export function RailHandle({ step, onStep }) {
  const go = (n) => onStep(Math.max(0, Math.min(2, n)))
  const key = (e) => {
    const n = { ArrowRight: step + 1, ArrowLeft: step - 1, Home: 0, End: 2 }[e.key]
    if (n === undefined) return
    e.preventDefault()
    go(n)
  }
  return (
    <div className="rail-handle" role="group" aria-label={`요즘 뜨는 기술 보기 크기: ${STEPS[step]} (3단계 중 ${step + 1})`} onKeyDown={key}>
      <button type="button" className="rail-step" onClick={() => go(step - 1)} disabled={step <= 0} aria-label={`좁게 (${STEPS[Math.max(0, step - 1)]})`} title="좁게">
        <span aria-hidden="true">‹</span>
      </button>
      <button type="button" className="rail-step" onClick={() => go(step + 1)} disabled={step >= 2} aria-label={`넓게 (${STEPS[Math.min(2, step + 1)]})`} title="넓게">
        <span aria-hidden="true">›</span>
      </button>
    </div>
  )
}
