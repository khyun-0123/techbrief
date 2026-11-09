// 대시보드 「키워드 분석」 (11/10 조장): 키워드로 찾으면 → 연관 키워드 맵 + 기술 시계열 요약 → 범위를 골라 자료 현황에서 선별
// - 왼쪽 맵은 **임시 모양**이다. 워드클라우드팀 키워드 맵이 오면 이 자리를 바꾼다 (지금은 논문 DB의 핵심어 · 회사로 노드만 그림)
// - 오른쪽은 기술 시계열 요약(단계 · 논문 수 · 기업 저자 비율 · 특허 · 새로 늘어난 핵심어). 「자세히 · AI 흐름 정리」는 TechTimeline 창
// 예전 「추적 중인 키워드 추이」(뉴스 수 · 검색량 · 위키 · GDELT)는 11/10 조장 결정으로 대시보드에서 뺐다 — 키워드 하나를 제대로 분석하는 쪽으로
import { useEffect, useMemo, useState } from 'react'
import { fetchTimeline, fetchTimelineStory } from './api.js'
import { Spark } from './KeywordTrends.jsx'
import TechTimeline from './TechTimeline.jsx'

const THIS_YEAR = new Date().getFullYear() // 올해는 안 끝나 줄어 보이므로 그래프에서 뺀다
const W = 520
const H = 360

// 임시 맵: 가운데 키워드, 둘레에 기술(핵심어) · 회사 노드. 종류는 색이 아니라 모양(채움 / 테두리)으로 구분
function MapPlaceholder({ keyword, data, count, selected, onToggle }) {
  const nodes = useMemo(() => {
    const p = data?.corpus?.periods ?? []
    const tech = [...new Map([...(data?.corpus?.rising ?? []).map((r) => r.name), ...(p[2]?.keywords ?? []).map((k) => k.name), ...(p[1]?.keywords ?? []).map((k) => k.name)].map((n) => [n.toLowerCase(), n])).values()]
    const firms = [...new Map([...(p[2]?.companies ?? []), ...(p[1]?.companies ?? [])].map((c) => [c.name, c.name])).values()]
    const pickTech = tech.slice(0, Math.ceil(count * 0.7))
    const pickFirm = firms.slice(0, count - pickTech.length)
    return [...pickTech.map((name) => ({ name, kind: 'tech' })), ...pickFirm.map((name) => ({ name, kind: 'firm' }))]
  }, [data, count])
  const cx = W / 2
  const cy = H / 2
  const placed = nodes.map((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 ? 150 : 118
    return { ...n, x: cx + Math.cos(a) * r * 1.35, y: cy + Math.sin(a) * r }
  })
  const label = (t) => (t.length > 22 ? `${t.slice(0, 21)}…` : t)
  return (
    <svg className="ka-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`「${keyword}」 연관 키워드 임시 맵: ${nodes.map((n) => n.name).join(', ') || '없음'}`}>
      {placed.map((n) => (
        <line key={`l-${n.name}`} x1={cx} y1={cy} x2={n.x} y2={n.y} className="ka-edge" />
      ))}
      <g className="ka-center">
        <rect x={cx - 70} y={cy - 18} width={140} height={36} rx={18} />
        <text x={cx} y={cy + 5} textAnchor="middle">
          {label(keyword)}
        </text>
      </g>
      {placed.map((n) => {
        const on = selected.includes(n.name)
        const w = Math.min(170, 18 + label(n.name).length * 6.6)
        return (
          <g
            key={n.name}
            className={`ka-node ka-${n.kind}${on ? ' on' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={on}
            aria-label={`${n.kind === 'firm' ? '회사' : '기술'} ${n.name}${on ? ' (고름)' : ''}`}
            onClick={() => onToggle(n.name)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle(n.name))}
          >
            <rect x={n.x - w / 2} y={n.y - 14} width={w} height={28} rx={14} />
            <text x={n.x} y={n.y + 4} textAnchor="middle">
              {label(n.name)}
            </text>
            <title>{n.name}</title>
          </g>
        )
      })}
    </svg>
  )
}

// 「한눈에」: AI 흐름 정리 중 전망 · 우리가 볼 것 앞부분 (전체는 「자세히」 창)
// stage: 단계 배지와 같은 말을 되풀이하는 글머리는 뺀다
function Glance({ story, error, stage }) {
  if (error) return <p className="hint">AI 흐름 정리를 받지 못했어요 ({error}). 「자세히」에서 다시 해 보세요.</p>
  if (!story) return <p className="hint ka-glance-wait">AI가 흐름을 정리하는 중이에요 (미리 분석된 말은 바로, 처음이면 30초 안팎)…</p>
  const pick = [
    ['전망', (story.story.outlook ?? []).filter((b) => !(stage && b.text.includes(stage)))],
    ['우리가 볼 것', story.story.research ?? []],
  ]
  return (
    <div className="ka-glance">
      {pick.map(([label, list]) =>
        list.length ? (
          <div key={label}>
            <h4>{label}</h4>
            <ul>
              {list.slice(0, 2).map((b, i) => (
                <li key={i}>
                  <span className={b.kind === 'fact' ? 'tl-kind fact' : 'tl-kind ai'}>{b.kind === 'fact' ? '사실' : b.unverified ? 'AI 해설 · 확인 필요' : 'AI 해설'}</span> {b.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  )
}

// 대시보드 「키워드 분석」 패널 안(검색창 아래)에 펼쳐진다. 기간은 「자료 찾기 →」로 자료 현황에서 찾을 때만 쓴다
function KeywordAnalysis({ keyword, onSearch, periods = [], period, onPeriod }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [count, setCount] = useState(8)
  const [selected, setSelected] = useState([])
  const [open, setOpen] = useState(false)
  const [story, setStory] = useState(null)
  const [storyError, setStoryError] = useState('')

  // 숫자를 받은 뒤 AI 흐름 정리도 바로 (미리 분석해 둔 말은 곧바로 옴, 아니면 30초 안팎)
  useEffect(() => {
    if (!keyword) return undefined
    let alive = true
    fetchTimeline(keyword)
      .then((d) => {
        if (!alive) return
        setData(d)
        fetchTimelineStory(keyword)
          .then((st) => alive && setStory(st))
          .catch((err) => alive && setStoryError(err.message))
      })
      .catch((err) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [keyword])

  if (!keyword) return null
  const full = (list) => (list ?? []).filter((x) => x.y < THIS_YEAR)
  const toggle = (name) => setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]))

  return (
    <div className="ka" aria-label={`「${keyword}」 분석`}>
      <div className="ka-head">
        <p className="ka-for">
          <b>{keyword}</b> — 연관 키워드에서 볼 범위를 고르고 기술의 흐름을 확인한 뒤 자료를 찾아요
        </p>
        <div className="ka-actions">
          {periods.length > 0 && (
            <select value={period} onChange={(e) => onPeriod?.(e.target.value)} aria-label="자료 찾을 기간">
              {periods.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn primary" onClick={() => onSearch(keyword)}>
            「{keyword}」 자료 찾기 →
          </button>
        </div>
      </div>

      <div className="ka-grid">
        <div className="ka-pane">
          <div className="ka-pane-head">
            <h3>연관 키워드 맵</h3>
            <span className="ka-temp">임시 모양 · 워드클라우드팀 맵이 들어올 자리</span>
          </div>
          {data ? (
            <>
              <MapPlaceholder keyword={keyword} data={data} count={count} selected={selected} onToggle={toggle} />
              <div className="ka-controls">
                <label>
                  연관 키워드 <b>{count}</b>개
                  <input type="range" min={4} max={14} value={count} onChange={(e) => setCount(Number(e.target.value))} />
                </label>
                <span className="ka-legend">
                  <span className="ka-key ka-key-tech" aria-hidden="true" /> 기술 <span className="ka-key ka-key-firm" aria-hidden="true" /> 회사
                </span>
              </div>
              <p className="hint">
                {selected.length ? `고른 범위: ${selected.join(', ')}` : '노드를 눌러 볼 범위를 골라요.'} 지금은 모양만 있고, 고른 범위로 자료를 거르는 것은 맵이 들어온 뒤 붙여요.
              </p>
            </>
          ) : (
            <p className="hint">{error || '연관 키워드를 모으는 중…'}</p>
          )}
        </div>

        <div className="ka-pane">
          <div className="ka-pane-head">
            <h3>기술 시계열</h3>
            {data && (
              <button type="button" className="btn" onClick={() => setOpen(true)}>
                자세히 · AI 흐름 정리
              </button>
            )}
          </div>
          {error && (
            <p className="ai-error" role="alert">
              {error}
            </p>
          )}
          {!data && !error && <p className="hint">논문 · 특허를 모으는 중이에요 (처음엔 10초 안팎)…</p>}
          {data && (
            <>
              <div className="tl-stage">
                <span className="tl-stage-badge">{data.stage.stage}</span>
                <span>{data.stage.why}</span>
              </div>
              <div className="ka-sparks">
                <Spark title="논문 수" unit="편" monthly="year" series={full(data.long).map((x) => ({ t: `${x.y}-01-01`, v: x.n }))} source="OpenAlex" note={data.longError ?? '논문이 없어요.'} />
                <Spark
                  title="기업 저자 비율"
                  unit="%"
                  monthly="year"
                  series={full(data.corpus?.years).map((x) => ({ t: `${x.y}-01-01`, v: Math.round(x.companyShare * 100) }))}
                  source="논문 DB · 2018년~"
                  note="맞는 논문이 없어요."
                />
                <Spark
                  title="특허 공개 수"
                  unit="건"
                  monthly="year"
                  series={data.patents.status === 'ok' ? full(data.patents.years).map((x) => ({ t: `${x.y}-01-01`, v: x.n })) : []}
                  source="Google Patents · 제목"
                  note="특허가 없거나 받지 못했어요."
                />
              </div>
              <Glance story={story} error={storyError} stage={data.stage.stage} />
              <dl className="ka-facts">
                {(() => {
                  const last = data.corpus?.periods?.[2]
                  const firms = (last?.companies ?? []).slice(0, 4).map((c) => c.name)
                  const owners = data.patents.status === 'ok' ? data.patents.topOwners.slice(0, 3).map((o) => o.name) : []
                  const origin = data.origins?.[0]
                  return (
                    <>
                      {firms.length > 0 && (
                        <div>
                          <dt>논문 낸 회사 (2024~)</dt>
                          <dd>{firms.join(', ')}</dd>
                        </div>
                      )}
                      {owners.length > 0 && (
                        <div>
                          <dt>특허 많은 출원인</dt>
                          <dd>{owners.join(', ')}</dd>
                        </div>
                      )}
                      {data.corpus?.rising?.length > 0 && (
                        <div>
                          <dt>새로 늘어난 핵심어</dt>
                          <dd>{data.corpus.rising.slice(0, 6).map((r) => r.name).join(', ')}</dd>
                        </div>
                      )}
                      {origin && (
                        <div>
                          <dt>출발점 논문</dt>
                          <dd>
                            {origin.year} · {origin.title}
                            {origin.companies?.length ? ` (${origin.companies.join(', ')})` : ''}
                          </dd>
                        </div>
                      )}
                    </>
                  )
                })()}
              </dl>
            </>
          )}
        </div>
      </div>
      {open && <TechTimeline query={keyword} initialData={data} initialStory={story} onClose={() => setOpen(false)} />}
    </div>
  )
}

export default KeywordAnalysis

// ── 검색 전 「분석하면 이렇게 보여요」 (11/10 조장: 검색 전엔 무슨 분석을 해 주는지 와닿지 않음, 자리는 적게) ──
// 미리 분석된 실제 키워드 하나로 4칸 축소판: 연관 키워드 → 기술 단계 → 논문 · 특허 흐름 → AI 전망. 누르면 그 예시가 열린다
function MiniLine({ series }) {
  const pts = series.filter((p) => p.v != null)
  if (pts.length < 2) return null
  const max = Math.max(...pts.map((p) => p.v), 1)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * 116 + 2).toFixed(1)},${(30 - (p.v / max) * 26).toFixed(1)}`).join('')
  return (
    <svg className="kp-line" viewBox="0 0 120 32" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

function MiniMap({ names }) {
  const spots = [
    [20, 10],
    [100, 10],
    [12, 34],
    [108, 34],
    [60, 44],
  ]
  return (
    <svg className="kp-map" viewBox="0 0 120 48" aria-hidden="true">
      {spots.slice(0, Math.max(3, names.length)).map(([x, y], i) => (
        <g key={i}>
          <line x1={60} y1={24} x2={x} y2={y} />
          <circle cx={x} cy={y} r={4} className={i % 3 === 2 ? 'firm' : ''} />
        </g>
      ))}
      <circle cx={60} cy={24} r={7} className="center" />
    </svg>
  )
}

export function AnalysisPreview({ example, onOpen }) {
  const [data, setData] = useState(null)
  const [story, setStory] = useState(null)
  useEffect(() => {
    if (!example) return undefined
    let alive = true
    // 미리 분석된 말이라 둘 다 기억해 둔 값이 바로 온다
    fetchTimeline(example)
      .then((d) => alive && setData(d))
      .catch(() => {})
    fetchTimelineStory(example)
      .then((st) => alive && setStory(st))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [example])
  if (!example || !data) return null
  const p = data.corpus?.periods ?? []
  const names = [...(data.corpus?.rising ?? []).map((r) => r.name), ...(p[2]?.keywords ?? []).map((k) => k.name)].slice(0, 3)
  const firms = (p[2]?.companies ?? []).slice(0, 2).map((c) => c.name)
  const ai = [...(story?.story?.research ?? []), ...(story?.story?.outlook ?? [])].find((b) => !b.text.includes(data.stage.stage))
  const series = (data.long ?? []).filter((x) => x.y < THIS_YEAR).slice(-12).map((x) => ({ v: x.n }))
  return (
    <button type="button" className="kp" onClick={() => onOpen(example)} aria-label={`분석 예시 「${example}」 열기`}>
      <span className="kp-title">
        분석하면 이렇게 보여요 · 예: <b>{example}</b> <span className="kp-open">열어 보기 →</span>
      </span>
      <span className="kp-steps">
        <span className="kp-step">
          <span className="kp-label">① 연관 키워드</span>
          <MiniMap names={names} />
          <span className="kp-text">{[...names.slice(0, 2), ...firms.slice(0, 1)].join(' · ') || '기술 · 회사'}</span>
        </span>
        <span className="kp-step">
          <span className="kp-label">② 기술 단계</span>
          <span className="tl-stage-badge kp-badge">{data.stage.stage}</span>
          <span className="kp-text">{data.stage.growth ? `논문 앞 3년의 ${data.stage.growth}배` : ''}{data.stage.companyShareNow != null ? ` · 기업 저자 ${Math.round(data.stage.companyShareNow * 100)}%` : ''}</span>
        </span>
        <span className="kp-step">
          <span className="kp-label">③ 논문 · 특허 흐름</span>
          <MiniLine series={series} />
          <span className="kp-text">해마다 논문 · 특허 수, 낸 회사</span>
        </span>
        <span className="kp-step">
          <span className="kp-label">④ AI 전망 · 연구 제안</span>
          <span className="kp-text kp-ai">{ai ? (ai.text.length > 70 ? `${ai.text.slice(0, 69)}…` : ai.text) : '근거 논문으로 배경 · 성장 · 적용 · 전망 정리'}</span>
        </span>
      </span>
    </button>
  )
}
