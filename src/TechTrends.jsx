// 요즘 뜨는 기술 (25 문서, 11/07): 대시보드 첫 칸
// 기간을 고르면 바로 전 같은 길이 기간과 비교해 출처마다 순위를 보여 주고, 출처별 순위를 합친 「종합」을 맨 앞에 둔다
// 기사 수는 순위에 넣지 않는다 (담당자 "기사 많음 ≠ 중요"). 기사는 기술 용어를 찾는 데만 쓴다
// 오르내림은 화살표 글자 + 퍼센트로 (색만으로 구분하지 않음)
import { useEffect, useState } from 'react'
import { fetchTechTrends } from './api.js'

const PERIODS = [
  { id: 'week', label: '이번 주' },
  { id: 'lastweek', label: '지난주' },
  { id: 'month', label: '이번 달' },
  { id: 'custom', label: '직접 설정' },
]
const SHOW = 10
const FROM_LABEL = { search: '검색', paper: '논문 신규', article: '기사' }

// 이 용어를 어디서 찾았는지 (검색어 · 논문 신규 키워드 · 기사). 기사만이면 표시 안 함
function From({ from }) {
  const shown = (from ?? []).filter((f) => f !== 'article')
  if (!shown.length) return null
  return shown.map((f) => (
    <span key={f} className={`tt-from tt-from-${f}`} title={f === 'paper' ? '최근 6개월 디스플레이 논문에서 새로 늘어난 키워드' : '네이버 연관 검색어에서 찾은 용어'}>
      {FROM_LABEL[f]}
    </span>
  ))
}

const fmtAt = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const fmtDay = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const fmtNum = (v) => (v >= 10000 ? `${Math.round(v / 1000)}천` : v >= 1000 ? `${(v / 1000).toFixed(1)}천` : String(Math.round(v * 10) / 10))

function Change({ change, growth, cur }) {
  if (change === null || change === undefined) return <span className="tt-chg up">{cur > 0 ? '▲ 신규' : '—'}</span>
  const dir = growth >= 1.15 ? 'up' : growth <= 0.87 ? 'down' : 'flat'
  return (
    <span className={`tt-chg ${dir}`}>
      {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '→'} {change > 0 ? '+' : ''}
      {change}%
    </span>
  )
}

// 작은 그래프: 비교 기간(앞)은 흐리게, 고른 기간(뒤)은 진하게
function Mini({ points, curFrom }) {
  if (!points || points.length < 2) return <span className="tt-mini-empty" />
  const W = 96
  const H = 24
  const max = Math.max(...points.map((p) => p.v), 1)
  const xy = points.map((p, i) => [(i / (points.length - 1)) * W, H - 2 - (p.v / max) * (H - 4)])
  const split = curFrom ? points.findIndex((p) => p.t >= curFrom) : -1
  const path = (arr) => arr.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  return (
    <svg className="tt-mini" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {split > 0 ? (
        <>
          <path d={path(xy.slice(0, split + 1))} className="tt-mini-prev" vectorEffect="non-scaling-stroke" />
          <path d={path(xy.slice(split))} className="tt-mini-cur" vectorEffect="non-scaling-stroke" />
        </>
      ) : (
        <path d={path(xy)} className="tt-mini-cur" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  )
}

function Composite({ data, onPick }) {
  const [more, setMore] = useState(false)
  const cols = data.sources.filter((s) => s.ranking.length >= 2)
  if (data.composite.length === 0) return <p className="tt-empty">출처 2곳 이상에 값이 있는 용어가 아직 없어요. 하루 한 번 받는 값이 쌓이면 보여요.</p>
  const rows = more ? data.composite : data.composite.slice(0, SHOW)
  return (
    <div className="tt-table-wrap">
      <table className="tt-table">
        <thead>
          <tr>
            <th scope="col">순위</th>
            <th scope="col">기술</th>
            <th scope="col">종합 점수</th>
            {cols.map((s) => (
              <th scope="col" key={s.id} title={`${s.axis} · ${s.note}${s.basis ? ` · ${s.basis.note}` : ''}`}>
                {s.label}
                {s.basis && <small className="tt-th-basis"> ({s.basis.short})</small>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key}>
              <td className="tt-rank">{i + 1}</td>
              <td>
                <button type="button" className="tt-term" onClick={() => onPick(r.name)} title={`「${r.name}」 자료 찾기`}>
                  {r.name}
                </button>
                <span className="tt-cat">{r.category}</span>
                <From from={r.from} />
              </td>
              <td>
                <span className="tt-score" title="출처마다 순위를 0~100으로 바꿔 평균">
                  <span className="tt-score-bar" style={{ width: `${r.score}%` }} />
                  <b>{r.score}</b>
                </span>
              </td>
              {cols.map((s) => {
                const p = r.parts[s.id]
                return <td key={s.id}>{p ? <Change change={p.change} growth={p.growth} cur={1} /> : <span className="tt-na">—</span>}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {data.composite.length > SHOW && (
        <button type="button" className="btn-text tt-more" onClick={() => setMore((v) => !v)}>
          {more ? '접기' : `${data.composite.length - SHOW}개 더 보기`}
        </button>
      )}
      {/* 짧은 기간이면 논문 · 특허는 다른 기간으로 비교한 값이 들어간다 (탭과 같은 값) */}
      {cols.some((s) => s.basis) && <p className="tt-foot">{cols.filter((s) => s.basis).map((s) => s.basis.note).join(' · ')}</p>}
    </div>
  )
}

function SourceList({ src, win, onPick }) {
  const [more, setMore] = useState(false)
  if (src.unavailable) return <p className="tt-empty">{src.unavailable}</p>
  // 월별 출처를 짧은 기간에 볼 때: 어느 기간끼리 비교했는지 표 위에 적는다 (조장 11/08)
  const basis = src.basis && <p className="tt-basis">{src.basis.note}</p>
  if (src.ranking.length === 0)
    return (
      <>
        {basis}
        <p className="tt-empty">
          {src.empty ?? (src.skipped.length ? `아직 비교할 만큼 쌓이지 않았어요 (${src.skipped.length}개 용어 대기).` : '아직 받은 값이 없어요.')}
        </p>
      </>
    )
  const rows = more ? src.ranking : src.ranking.slice(0, SHOW)
  return (
    <>
      {basis}
      <ol className="tt-list">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="tt-namecell">
              <button type="button" className="tt-term" onClick={() => onPick(r.name)} title={`「${r.name}」 자료 찾기`}>
                {r.name}
              </button>
              <From from={r.from} />
            </span>
            <span className="tt-cat">{r.category}</span>
            <Change change={r.change} growth={r.growth} cur={r.cur} />
            <span className="tt-vals">
              {fmtNum(r.cur)}
              {src.unit} <small>← {fmtNum(r.prev)}{src.unit}</small>
            </span>
            <Mini points={r.points} curFrom={src.daily ? win.cur[0] : null} />
            {r.stale && <span className="tt-stale" title="이번에 새로 받지 못해 지난 값으로 셈">지난 값</span>}
          </li>
        ))}
      </ol>
      <p className="tt-foot">
        {src.note}
        {src.ranking[0]?.basis && !src.basis ? ` · ${src.ranking[0].basis}` : ''}
        {src.at ? ` · ${fmtAt(src.at)} 받음` : ''}
        {src.skipped.length ? ` · 비교할 값이 모자라 빠진 용어 ${src.skipped.length}개` : ''}
      </p>
      {src.ranking.length > SHOW && (
        <button type="button" className="btn-text tt-more" onClick={() => setMore((v) => !v)}>
          {more ? '접기' : `${src.ranking.length - SHOW}개 더 보기`}
        </button>
      )}
    </>
  )
}

function TechTrends({ onPick }) {
  const [period, setPeriod] = useState('week')
  const [range, setRange] = useState({ from: '', to: '' })
  const [applied, setApplied] = useState(null)
  const [tab, setTab] = useState('composite')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  // 서버는 DB에 저장된 마지막 값을 바로 준다. 지금 갱신 중이면 1분마다 다시 불러 새 값으로 바꾼다 (11/08)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (period === 'custom' && !applied) return
    let alive = true
    setError('')
    fetchTechTrends(period === 'custom' ? { period, ...applied } : { period })
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [period, applied, tick])
  useEffect(() => {
    if (!data?.status?.running) return undefined
    const t = setTimeout(() => setTick((n) => n + 1), 60_000)
    return () => clearTimeout(t)
  }, [data])

  const win = data?.window
  const src = data?.sources.find((s) => s.id === tab)

  return (
    <section className="panel tt" aria-labelledby="tt-title">
      <div className="tt-head">
        <div>
          <h2 id="tt-title">요즘 뜨는 기술</h2>
          <p className="tt-sub">
            {win ? `${win.label} ${fmtDay(win.cur[0])}~${fmtDay(win.cur[1])} · 그 전 ${win.days}일과 비교` : '불러오는 중…'}
            {' · '}기사 수는 순위에 넣지 않아요 (기술 용어를 찾는 데만 써요)
          </p>
        </div>
        <div className="tt-periods" role="group" aria-label="기간">
          {PERIODS.map((p) => (
            <button key={p.id} type="button" className={period === p.id ? 'tt-chip on' : 'tt-chip'} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {period === 'custom' && (
        <form
          className="tt-custom"
          onSubmit={(e) => {
            e.preventDefault()
            if (range.from && range.to) setApplied({ ...range })
          }}
        >
          <label>
            시작 <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          </label>
          <label>
            끝 <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </label>
          <button type="submit" className="btn" disabled={!range.from || !range.to}>
            적용
          </button>
          <span className="tt-note">4주보다 짧으면 논문·특허(월별)는 최근 4주 · 마지막 달 기준으로 비교해요</span>
        </form>
      )}

      <div className="tt-tabs" role="tablist" aria-label="출처">
        <button type="button" role="tab" aria-selected={tab === 'composite'} className={tab === 'composite' ? 'tt-tab on' : 'tt-tab'} onClick={() => setTab('composite')}>
          종합
        </button>
        {(data?.sources ?? []).map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={tab === s.id} className={tab === s.id ? 'tt-tab on' : 'tt-tab'} onClick={() => setTab(s.id)} title={s.note}>
            {s.label}
            <small>{s.axis}</small>
          </button>
        ))}
      </div>

      {error && <p className="ai-error">{error}</p>}
      {data && (data.terms === 0 ? (
        <p className="tt-empty">{data.status.running ? `기사에서 기술 용어를 찾는 중이에요 (${data.status.phase}). 처음 한 번은 30분쯤 걸려요.` : '아직 찾은 기술 용어가 없어요.'}</p>
      ) : tab === 'composite' ? (
        <Composite data={data} onPick={onPick} />
      ) : (
        src && <SourceList src={src} win={win} onPick={onPick} />
      ))}

      {data && (
        <p className="tt-foot">
          후보 {data.candidates}개 — 찾은 곳: 검색어 {data.searchStatus === 'no_key' ? '(네이버 검색광고 키 필요)' : `${data.from?.search ?? 0}개`} · 논문 신규 {data.from?.paper ?? 0}개 · 기사 {data.from?.article ?? 0}개
          {data.hidden ? ` · 제품명·넓은 말 ${data.hidden}개는 AI 검토로 숨김` : ''}
          {data.updatedAt ? ` · ${fmtAt(data.updatedAt)} 갱신 (하루 한 번)` : ''}
          {data.status.running ? ` · 지금 갱신 중: ${data.status.phase}` : ''}
        </p>
      )}
    </section>
  )
}

export default TechTrends
