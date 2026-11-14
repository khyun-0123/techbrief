// 연관 키워드 맵 (11/14 통합): 워드클라우드팀(박세현) 키워드 마인드맵 v2의 2단계 펼치기 · 교차선 · 워드클라우드를 main 데이터(/api/related)로
// - 데이터: server/related.js의 nodes(1단계) · edges(함께 나온 이슈 3개 이상 · NPMI 0.15 초과) · children(1단계 말마다 2단계 5개, 부품 속성 이름은 branches) · subcats(사업 6분류)
// - 클릭: 「범위 고르기」(main 11/12 흐름: 고른 말로 자료 찾기)와 「펼치기」(팀 맵) 중 고른다 — 회의 안건 「노드 클릭의 뜻」
// - 팀 맵은 force-graph(캔버스)였지만, 키보드로 고르기(체크박스 역할)와 토큰 색을 지키려고 SVG로 같은 배치 규칙을 다시 그림
// - 종류는 색이 아니라 모양: 기술 = 채움, 회사 = 점선, 일반 = 글자만. 레드는 쓰지 않음(20 문서 원칙 1)
// - 11/14 2차: 열지도(팀 v2 drawHeat — 맵과 같은 자리에 함께 나온 이슈 수만큼 번짐, 빨강 대신 먹색), large(크게 보기 판: 1단계 20개)
import { useEffect, useMemo, useRef, useState } from 'react'

// 그림판 크기 (11/14 2차): 칸 폭에 맞춰 고른다 — 960px 그림을 반 칸(약 480px)에 줄이면 글자가 6px로 작아졌음
const GEO = {
  compact: { W: 640, H: 440, rx: 230, ry: 150, ring: 12 }, // 칸 720px 미만
  normal: { W: 960, H: 560, rx: 300, ry: 175, ring: 14 },
  large: { W: 1280, H: 720, rx: 470, ry: 270, ring: 20 }, // 크게 보기 판
}
const RING1 = 14 // 1단계로 그리는 말 수 (보통)
const KIND_LABEL = { tech: '기술', company: '회사', general: '일반' }
const short = (t, n = 14) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
const textW = (t, px) => [...t].reduce((n, ch) => n + (/[가-힣]/.test(ch) ? px : px * 0.6), 0)

function MapView({ g, keyword, nodes, edges, branches, isOn, onPick, clickMode, expanded, onExpand, ring = RING1 }) {
  const cx = g.W / 2
  const cy = g.H / 2
  const first = nodes.slice(0, ring)
  const max = Math.max(1, ...first.map((n) => n.score))
  // 1단계: 타원 고리 하나, 연관도 높은 말이 위쪽부터
  const pos = new Map()
  first.forEach((n, i) => {
    const a = (i / first.length) * Math.PI * 2 - Math.PI / 2
    pos.set(n.word, { x: cx + Math.cos(a) * g.rx, y: cy + Math.sin(a) * g.ry, a })
  })
  // 2단계: 펼친 말의 바깥쪽으로 부채꼴 (화면 안으로 자름)
  const kids = []
  for (const w of expanded) {
    const p = pos.get(w)
    const list = branches?.[w] ?? []
    if (!p) continue
    list.forEach((c, j) => {
      // 부채꼴: 말 사이 0.32라디안, 바깥으로 갈수록 반지름을 조금씩 늘려 글자가 겹치지 않게. 화면 가장자리 안으로
      const a = p.a + (j - (list.length - 1) / 2) * 0.32
      const r = 120 + (j % 2) * 26
      const x = Math.min(g.W - 70, Math.max(70, p.x + Math.cos(a) * r))
      const y = Math.min(g.H - 22, Math.max(22, p.y + Math.sin(a) * r * 0.8))
      kids.push({ ...c, x, y, parent: w })
    })
  }
  // 가장자리에 눌려 같은 높이에 모인 2단계 말은 옆으로 벌린다 (글자 폭 + 12px 간격)
  for (const w of expanded) {
    const row = kids.filter((k) => k.parent === w).sort((a, b) => a.x - b.x)
    for (let i = 1; i < row.length; i++) {
      const prev = row[i - 1]
      const k = row[i]
      const need = (textW(short(prev.word, 10), 11.5) + textW(short(k.word, 10), 11.5)) / 2 + 30
      if (Math.abs(k.y - prev.y) < 22 && k.x - prev.x < need) k.x = Math.min(g.W - 40, prev.x + need)
    }
  }
  // 교차선: 그린 1단계 말끼리, 가장 강한 것부터 16개
  const cross = (edges ?? []).filter((e) => pos.has(e.a) && pos.has(e.b)).sort((a, b) => b.npmi - a.npmi).slice(0, 16)
  const node = (n, x, y, level) => {
    const on = isOn(n.word)
    const label = short(n.word, level === 2 ? 10 : 14)
    const w = Math.max(48, textW(`${on ? '✓ ' : ''}${label}`, level === 2 ? 11.5 : 13) + 26)
    const h = level === 2 ? 24 : 28
    const canExpand = level === 1 && (branches?.[n.word]?.length ?? 0) > 0
    const act = () => (clickMode === 'expand' && canExpand ? onExpand(n.word) : onPick(n.word))
    const sub = (n.subcats ?? [])[0]
    return (
      <g
        key={`${level}-${n.word}`}
        className={`km-node km-${n.kind ?? 'general'} km-l${level}${on ? ' on' : ''}${expanded.has(n.word) ? ' open' : ''}`}
        role={clickMode === 'expand' && canExpand ? 'button' : 'checkbox'}
        aria-checked={clickMode === 'expand' && canExpand ? undefined : on}
        aria-expanded={canExpand ? expanded.has(n.word) : undefined}
        tabIndex={0}
        aria-label={`${n.word} · ${KIND_LABEL[n.kind] ?? '일반'} · 함께 나온 이슈 ${n.score}개${sub ? ` · ${sub}` : ''}`}
        onClick={act}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), act())}
      >
        <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={h / 2} />
        <text x={x} y={y + 4.5} textAnchor="middle">
          {on ? '✓ ' : ''}
          {label}
          {canExpand && clickMode === 'expand' ? (expanded.has(n.word) ? ' −' : ' +') : ''}
        </text>
        {level === 1 && sub && (
          <text className="km-sub" x={x} y={y + h / 2 + 12} textAnchor="middle">
            {sub}
          </text>
        )}
        <title>{`${n.word} · ${KIND_LABEL[n.kind] ?? '일반'} · 함께 나온 이슈 ${n.score}개${(n.subcats ?? []).length ? ` · ${n.subcats.join(' / ')}` : ''}`}</title>
      </g>
    )
  }
  return (
    <svg className="km-svg" viewBox={`0 0 ${g.W} ${g.H}`} role="group" aria-label={`「${keyword}」 연관 키워드 맵`}>
      {cross.map((e) => {
        const a = pos.get(e.a)
        const b = pos.get(e.b)
        return <line key={`x-${e.a}-${e.b}`} className="km-cross" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      })}
      {first.map((n) => {
        const p = pos.get(n.word)
        return <line key={`e-${n.word}`} className={isOn(n.word) ? 'km-edge on' : 'km-edge'} x1={cx} y1={cy} x2={p.x} y2={p.y} style={{ strokeWidth: 0.8 + 3 * (n.score / max) }} />
      })}
      {kids.map((k) => {
        const p = pos.get(k.parent)
        return <line key={`k-${k.parent}-${k.word}`} className="km-edge km-edge2" x1={p.x} y1={p.y} x2={k.x} y2={k.y} />
      })}
      <g className="km-center">
        {(() => {
          const t = short(keyword, 16)
          const w = Math.max(140, textW(t, 16) + 40)
          return (
            <>
              <rect x={cx - w / 2} y={cy - 19} width={w} height={38} rx={19} />
              <text x={cx} y={cy + 5.5} textAnchor="middle">
                {t}
              </text>
            </>
          )
        })()}
      </g>
      {first.map((n) => node(n, pos.get(n.word).x, pos.get(n.word).y, 1))}
      {kids.map((k) => node({ ...k, kind: 'general' }, k.x, k.y, 2))}
    </svg>
  )
}

// 열지도 (팀 v2 drawHeat): 맵과 같은 자리(고리)에 말마다 함께 나온 이슈 수만큼 크고 진한 번짐을 겹쳐 칠함 — 겹칠수록 진해짐
// 펼친 2단계 말도 함께 칠한다. 색은 먹색(토큰 글자색), 글자를 누르면 범위에 넣고 빼기
function HeatView({ g, keyword, nodes, branches, isOn, onPick, ring = RING1 }) {
  const cx = g.W / 2
  const cy = g.H / 2
  const first = nodes.slice(0, ring)
  const spots = []
  const seen = new Set(first.map((n) => n.word.toLowerCase())) // 같은 2단계 말이 여러 부모 아래 반복되지 않게
  first.forEach((n, i) => {
    const a = (i / first.length) * Math.PI * 2 - Math.PI / 2
    const x = cx + Math.cos(a) * g.rx
    const y = cy + Math.sin(a) * g.ry
    spots.push({ ...n, x, y, level: 1 })
    const kids = (branches?.[n.word] ?? []).filter((c) => !seen.has(c.word.toLowerCase())).slice(0, 3) // 부모마다 3개까지
    kids.forEach((c) => seen.add(c.word.toLowerCase()))
    kids.forEach((c, j, list) => {
      const b = a + (j - (list.length - 1) / 2) * 0.32
      spots.push({ ...c, x: Math.min(g.W - 60, Math.max(60, x + Math.cos(b) * 110)), y: Math.min(g.H - 20, Math.max(20, y + Math.sin(b) * 88)), level: 2 })
    })
  })
  const max = Math.max(1, ...spots.map((s) => s.score))
  return (
    <svg className="km-svg km-heat" viewBox={`0 0 ${g.W} ${g.H}`} role="group" aria-label={`「${keyword}」 열지도 — 진할수록 함께 나온 이슈가 많음`}>
      <defs>
        <radialGradient id="km-heat-g">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.38" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="km-heat-blobs">
        <circle cx={cx} cy={cy} r={150} fill="url(#km-heat-g)" />
        {spots.map((s) => (
          <circle key={`h-${s.level}-${s.word}`} cx={s.x} cy={s.y} r={(s.level === 1 ? 46 : 30) + 70 * Math.sqrt(s.score / max)} fill="url(#km-heat-g)" opacity={0.35 + 0.65 * (s.score / max)} />
        ))}
      </g>
      <text className="km-cloud-center" x={cx} y={cy + 8} textAnchor="middle" style={{ fontSize: 22 }}>
        {keyword}
      </text>
      {spots.map((s) => {
        const on = isOn(s.word)
        return (
          <text
            key={`t-${s.level}-${s.word}`}
            className={`km-word${s.level === 1 ? ' top' : ' mid'}${on ? ' on' : ''}`}
            x={s.x}
            y={s.y + 4}
            textAnchor="middle"
            style={{ fontSize: s.level === 1 ? 13 : 11 }}
            role="checkbox"
            aria-checked={on}
            tabIndex={0}
            onClick={() => onPick(s.word)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick(s.word))}
          >
            {on ? '✓' : ''}
            {short(s.word, 12)}
            <title>{`${s.word} · 함께 나온 이슈 ${s.score}개${s.level === 2 ? ' · 2단계' : ''}`}</title>
          </text>
        )
      })}
    </svg>
  )
}

// 워드클라우드 (팀 layoutCloud 규칙): 큰 말부터 가운데에서 나선을 따라 겹치지 않는 첫 자리. 글자 크기 ∝ √(값/최댓값)
function CloudView({ g, keyword, nodes, branches, isOn, onPick }) {
  const words = useMemo(() => {
    const all = new Map()
    for (const n of nodes) all.set(n.word, { word: n.word, score: n.score, kind: n.kind })
    for (const list of Object.values(branches ?? {})) for (const c of list) if (!all.has(c.word)) all.set(c.word, { word: c.word, score: c.score, kind: 'general', second: true })
    return [...all.values()].sort((a, b) => b.score - a.score).slice(0, 40)
  }, [nodes, branches])
  const placed = useMemo(() => {
    const max = Math.max(1, ...words.map((w) => w.score))
    const boxes = []
    const out = []
    const cx = g.W / 2
    const cy = g.H / 2
    const hit = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)
    const centerSize = 40
    const cw = textW(keyword, centerSize) + 12
    boxes.push({ x: cx - cw / 2, y: cy - centerSize * 0.6, w: cw, h: centerSize * 1.1 })
    words.forEach((w, i) => {
      const size = Math.round(14 + 22 * Math.sqrt(w.score / max))
      const bw = textW(w.word, size) + 10
      const bh = size * 1.15
      for (let t = 0; t < 900; t++) {
        const a = t * 0.35
        const r = 6 + t * 1.6
        const x = cx + Math.cos(a) * r * 1.55 - bw / 2
        const y = cy + Math.sin(a) * r * 0.85 - bh / 2
        const b = { x, y, w: bw, h: bh }
        if (x < 8 || y < 8 || x + bw > g.W - 8 || y + bh > g.H - 8 || hit(b)) continue
        boxes.push(b)
        out.push({ ...w, size, x: x + bw / 2, y: y + bh * 0.8, rank: i })
        break
      }
    })
    return out
  }, [words, keyword, g.W, g.H])
  return (
    <svg className="km-svg km-cloud" viewBox={`0 0 ${g.W} ${g.H}`} role="group" aria-label={`「${keyword}」 워드클라우드`}>
      <text className="km-cloud-center" x={g.W / 2} y={g.H / 2 + 14} textAnchor="middle" style={{ fontSize: 40 }}>
        {keyword}
      </text>
      {placed.map((w) => {
        const on = isOn(w.word)
        return (
          <text
            key={w.word}
            className={`km-word${w.rank < 10 ? ' top' : w.rank < 26 ? ' mid' : ''}${on ? ' on' : ''}`}
            x={w.x}
            y={w.y}
            textAnchor="middle"
            style={{ fontSize: w.size }}
            role="checkbox"
            aria-checked={on}
            tabIndex={0}
            onClick={() => onPick(w.word)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick(w.word))}
          >
            {on ? '✓' : ''}
            {w.word}
            <title>{`${w.word} · 함께 나온 이슈 ${w.score}개${w.second ? ' · 2단계' : ''}`}</title>
          </text>
        )
      })}
    </svg>
  )
}

export default function KeywordMap({ keyword, nodes, edges, branches, isOn, onToggle, large = false, initialView = 'map', onView }) {
  const box = useRef(null)
  const [width, setWidth] = useState(960)
  useEffect(() => {
    const el = box.current
    if (!el) return undefined
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const g = large ? GEO.large : width < 720 ? GEO.compact : GEO.normal
  const ring = g.ring
  const [view, setViewState] = useState(initialView)
  const setView = (v) => {
    setViewState(v)
    onView?.(v)
  }
  const [clickMode, setClickMode] = useState('scope')
  const [expanded, setExpanded] = useState(() => new Set())
  const onExpand = (w) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(w)) n.delete(w)
      else n.add(w)
      return n
    })
  const hasKids = Object.values(branches ?? {}).some((l) => l.length)
  return (
    <div ref={box} className={large ? 'km km-large' : 'km'}>
      <div className="km-bar">
        <div className="segmented" role="radiogroup" aria-label="보기">
          <button type="button" role="radio" aria-checked={view === 'map'} onClick={() => setView('map')}>
            맵
          </button>
          <button type="button" role="radio" aria-checked={view === 'cloud'} onClick={() => setView('cloud')}>
            워드클라우드
          </button>
          <button type="button" role="radio" aria-checked={view === 'heat'} onClick={() => setView('heat')}>
            열지도
          </button>
        </div>
        {view === 'map' && hasKids && (
          <div className="segmented" role="radiogroup" aria-label="말을 누르면">
            <button type="button" role="radio" aria-checked={clickMode === 'scope'} onClick={() => setClickMode('scope')}>
              누르면 범위 고르기
            </button>
            <button type="button" role="radio" aria-checked={clickMode === 'expand'} onClick={() => setClickMode('expand')}>
              누르면 펼치기
            </button>
          </div>
        )}
      </div>
      {view === 'map' ? (
        <div className="km-scroll">
          <MapView g={g} keyword={keyword} nodes={nodes} edges={edges} branches={branches} isOn={isOn} onPick={onToggle} clickMode={clickMode} expanded={expanded} onExpand={onExpand} ring={ring} />
        </div>
      ) : view === 'heat' ? (
        <HeatView g={g} keyword={keyword} nodes={nodes} branches={branches} isOn={isOn} onPick={onToggle} ring={ring} />
      ) : (
        <CloudView g={g} keyword={keyword} nodes={nodes} branches={branches} isOn={isOn} onPick={onToggle} />
      )}
    </div>
  )
}
