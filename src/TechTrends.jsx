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
const COMPOSITE_SOURCES = ['naver', 'wiki', 'reddit', 'openalex']
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

// 출처를 성격(관심 · 현장 반응 · 연구 · 개발·투자)별로 묶는다. 서버가 준 순서를 지킨다
function groupByAxis(sources) {
  const groups = new Map()
  for (const s of sources) groups.set(s.axis, [...(groups.get(s.axis) ?? []), s])
  return [...groups]
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
function Mini({ points, curFrom, floor = 1 }) {
  if (!points || points.length < 2) return <span className="tt-mini-empty" />
  const W = 96
  const H = 24
  const max = Math.max(...points.map((p) => p.v), floor) // 11/15: 출처마다 최소 의미 있는 값(src.min)까지는 축을 고정 — 적은 수가 급등처럼 안 보이게
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

// 1~3위 카드: 대시보드에서 눈이 먼저 가는 곳 (11/09 디자인 정리, 28 문서 4장)
// 출처마다 오름폭이 가장 큰 신호 하나를 같이 보여 준다 ("왜 떴나")
function TopThree({ rows, cols, onPick }) {
  return (
    <ol className="tt-top3" aria-label="종합 1~3위">
      {rows.slice(0, 3).map((r, i) => {
        const best = cols
          .map((s) => ({ s, p: r.parts[s.id] }))
          .filter(({ p }) => p && (p.change === null || p.change === undefined || p.change > 0))
          .sort((a, b) => (b.p.change ?? Infinity) - (a.p.change ?? Infinity))[0]
        return (
          <li key={r.key} className="tt-top3-card">
            <span className="tt-top3-rank">{i + 1}위</span>
            <button type="button" className="tt-top3-name" onClick={() => onPick(r.name)} title={`「${r.name}」 키워드 분석`}>
              {r.name}
            </button>
            <span className="tt-top3-meta">
              {r.category} · 종합 <b>{r.score}</b> · {r.grade}
              {r.stage ? ` · ${r.stage}` : ''}
            </span>
            {best && (
              <span className="tt-top3-why">
                {best.s.label} <Change change={best.p.change} growth={best.p.growth} cur={1} />
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// show: 처음 보일 줄 수 (11/17: 펼쳐 보기 판은 높이가 넉넉해 13줄 — 1440×900에서 스크롤 없이)
function Composite({ data, onPick, verdicts, onVerdict, show = SHOW }) {
  const [more, setMore] = useState(false)
  // 종합에 들어가는 출처만 (특허는 공개가 약 18개월 늦어 종합에서 뺐다, 11/11)
  // 11/17: 값이 하나도 없는 신호 칸은 숨긴다 (예: Reddit은 11/10부터 막혀 모두 「—」)
  const cols = data.sources.filter((s) => COMPOSITE_SOURCES.includes(s.id) && s.ranking.length >= 2 && data.composite.some((r) => r.parts?.[s.id]))
  if (data.composite.length === 0) return <p className="tt-empty">논문과 관심 신호(검색량 · 위키 · Reddit)가 모두 있는 용어가 아직 없어요. 하루 한 번 받는 값이 쌓이면 보여요.</p>
  const rows = more ? data.composite : data.composite.slice(0, show)
  const notable = data.composite.filter((r) => r.score >= 60).length
  return (
    <>
    <p className="tt-scale">
      점수는 <b>평소 대비</b>예요: 50 = 평소와 같음 · 60 = 약 1.3배 · 75 = 2배 (논문 절반 + 검색량 · 위키 · Reddit 절반, 평소 = 바로 앞 같은 길이 구간들의 평균).{' '}
      {notable ? `평소보다 뚜렷하게 오른 기술 ${notable}개.` : '이번 기간에는 평소보다 뚜렷하게(60점 이상) 오른 기술이 없어요. 아래는 그중 많이 오른 순서예요.'}
    </p>
    <TopThree rows={data.composite} cols={cols} onPick={onPick} />
    <div className="tt-table-wrap">
      <table className="tt-table">
        <thead>
          <tr>
            <th scope="col">순위</th>
            <th scope="col">기술</th>
            <th scope="col">종합 점수</th>
            <th scope="col">등급 · 단계</th>
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
            <tr key={r.key} className={i < 3 ? 'tt-row-top' : undefined}>
              <td className="tt-rank">{i + 1}</td>
              <td>
                <button type="button" className="tt-term" onClick={() => onPick(r.name)} title={`「${r.name}」 키워드 분석`}>
                  {r.name}
                </button>
                <span className="tt-cat">{r.category}</span>
                {/* 자사 위협 · 기회 (11/14): 누르면 설명 창 */}
                {verdicts?.[r.name]?.verdict && (
                  <button type="button" className={`tr-verdict tr-${verdicts[r.name].verdict === '위협' ? 'threat' : 'chance'}`} onClick={() => onVerdict?.(r.name, verdicts[r.name])}>
                    자사 {verdicts[r.name].verdict}
                  </button>
                )}
                <From from={r.from} />
              </td>
              <td>
                <span className="tt-score" title={`평소 대비 신호 점수 (50 = 평소, 75 = 2배). 지금 · 앞 구간 · 그 앞: ${(r.history ?? []).map((x) => x ?? '-').join(' · ')}`}>
                  <span className="tt-score-bar" style={{ width: `${r.score}%` }} />
                  <b>{r.score}</b>
                </span>
              </td>
              <td className="tt-grade">
                {r.grade}
                {r.stage && <small> · {r.stage}</small>}
              </td>
              {cols.map((s) => {
                const p = r.parts[s.id]
                return (
                  <td key={s.id} title={p ? `신호 ${p.signal} · 이번 ${p.cur} / 평소 ${p.base}` : undefined}>
                    {p ? <Change change={p.change} growth={p.growth} cur={p.cur} /> : <span className="tt-na">—</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {data.composite.length > show && (
        <button type="button" className="btn-text tt-more" onClick={() => setMore((v) => !v)}>
          {more ? '접기' : `${data.composite.length - show}개 더 보기`}
        </button>
      )}
      {/* 짧은 기간이면 논문 · 특허는 다른 기간으로 비교한 값이 들어간다 (탭과 같은 값). 아래 「기준 · 출처」에 접어 둠 */}
    </div>
    {/* 논문만 있는 용어(소재 · 공정처럼 일반인이 찾지 않는 기술)는 종합에 못 들어가므로, 논문이 오르면 따로 (11/11) */}
    {data.early?.length > 0 && (
      <p className="tt-early">
        <b>연구 초기 신호</b> (논문만 평소보다 오름, 검색 · 위키 신호 없음):{' '}
        {data.early.slice(0, 8).map((r, i) => (
          <span key={r.key}>
            {i > 0 && ' · '}
            <button type="button" className="tt-term" onClick={() => onPick(r.name)} title={`논문 신호 ${r.score} · 이번 3달 ${r.parts.openalex.cur}편 / 평소 ${r.parts.openalex.base}편`}>
              {r.name}
            </button>
          </span>
        ))}
      </p>
    )}
    </>
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
              <button type="button" className="tt-term" onClick={() => onPick(r.name)} title={`「${r.name}」 키워드 분석`}>
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
            <Mini points={r.points} curFrom={src.daily ? win.cur[0] : null} floor={src.min ?? 1} />
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

// onClose (11/17): 대시보드 「펼쳐 보기」 판 안에서 쓸 때 — 카드 테두리 없이, 제목 줄에 「접기」
function TechTrends({ onPick, verdicts, onVerdict, onClose, closeRef }) {
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
    <section className={onClose ? 'tt tt-embedded' : 'panel tt'} aria-labelledby="tt-title">
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
          {onClose && (
            <button ref={closeRef} type="button" className="trend-drawer-close" onClick={onClose}>
              <span aria-hidden="true">‹</span> 접기
            </button>
          )}
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
        <span className="tt-tab-group" role="presentation">
          <button type="button" role="tab" aria-selected={tab === 'composite'} className={tab === 'composite' ? 'tt-tab on' : 'tt-tab'} onClick={() => setTab('composite')}>
            종합
          </button>
        </span>
        {groupByAxis(data?.sources ?? []).map(([axis, list]) => (
          <span key={axis} className="tt-tab-group" role="presentation">
            <span className="tt-tab-axis" aria-hidden="true">
              {axis}
            </span>
            {list.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={tab === s.id} aria-label={`${s.label} (${axis})`} className={tab === s.id ? 'tt-tab on' : 'tt-tab'} onClick={() => setTab(s.id)} title={s.note}>
                {s.label}
              </button>
            ))}
          </span>
        ))}
      </div>

      {error && <p className="ai-error" role="alert">{error}</p>}
      {data && (data.terms === 0 ? (
        <p className="tt-empty">{data.status.running ? `기사에서 기술 용어를 찾는 중이에요 (${data.status.phase}). 처음 한 번은 30분쯤 걸려요.` : '아직 찾은 기술 용어가 없어요.'}</p>
      ) : tab === 'composite' ? (
        <Composite show={onClose ? 13 : SHOW} data={data} onPick={onPick} verdicts={verdicts} onVerdict={onVerdict} />
      ) : (
        src && <SourceList src={src} win={win} onPick={onPick} />
      ))}

      {/* 기준 설명은 접어 둔다 (11/09 디자인 정리: 회색 각주 두 줄 → 갱신 시각만 보이고 나머지는 펼쳐 봄) */}
      {data && (
        <details className="tt-notes">
          <summary>
            {data.updatedAt ? `${fmtAt(data.updatedAt)} 갱신 (하루 한 번)` : '갱신 전'}
            {data.status.running ? ` · 지금 갱신 중: ${data.status.phase}` : ''} · 기준 · 출처
          </summary>
          {tab === 'composite' && data.sources.some((s) => s.ranking.length >= 2 && s.basis) && (
            <p className="tt-foot">{data.sources.filter((s) => s.ranking.length >= 2 && s.basis).map((s) => s.basis.note).join(' · ')}</p>
          )}
        <p className="tt-foot">
          후보 {data.candidates}개 — 찾은 곳: 검색어 {data.searchStatus === 'no_key' ? '(네이버 검색광고 키 필요)' : `${data.from?.search ?? 0}개`} · 논문 신규 {data.from?.paper ?? 0}개 · 기사 {data.from?.article ?? 0}개
          {data.hidden ? ` · 제품명·넓은 말 ${data.hidden}개는 AI 검토로 숨김` : ''}
        </p>
        </details>
      )}
    </section>
  )
}

export default TechTrends
