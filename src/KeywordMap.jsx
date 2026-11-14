// 연관 키워드 맵 (11/14 통합 → 11/14 3차 모양 교체): 워드클라우드팀(박세현) 키워드 마인드맵 v2의 모양을 그대로 — 점 + 아래 글자, 힘 배치, 떠 있는 「표시 설정」 판
// - 데이터: server/related.js의 nodes(1단계) · edges(함께 나온 이슈 3개 이상 · NPMI 0.15 초과) · children(1단계 말마다 2단계, 부품 속성 이름은 branches) · subcats(사업 6분류)
// - 모양 (팀 v2 값): 검색어 = 레드 점(11px), 1단계 = 짙은 점(12.5px 굵게), 2단계 = 회색 점(11px), 점 크기 3 + 9·√(함께 나온 수/최댓값), 가지 굵기 0.6 + 수/8(최대 6), 교차선 = 옅은 점선
// - 배치 (팀 v2 d3-force 값): 밀어내기 -140, 가지 길이 55 + 30/(1 + 수/10) · 세기 .6, 교차선 길이 120 · 세기 .03 — 캔버스 대신 SVG로 같은 계산(키보드로 고르기 · 토큰 색)
// - 화면: 끌기 = 옮겨 보기, 휠 = 확대(0.3~6배), 점 끌기 = 자리 옮기기, 점 누르기 = 「범위 고르기」(main 11/12 흐름) 또는 「펼치기 · 접기」(팀 맵)
// - 글자 · 점은 확대해도 같은 크기(자리만 벌어짐) — 반 칸(약 480px)에서도 글자가 작아지지 않게
// - 열지도 · 워드클라우드는 같은 판에서 「보기」로 바꿈. 열지도는 맵과 같은 자리에 번짐(먹색)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const short = (t, n = 14) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
const textW = (t, px) => [...t].reduce((n, ch) => n + (/[가-힣]/.test(ch) ? px : px * 0.6), 0)
const VIEWS = [
  ['map', '마인드맵'],
  ['cloud', '워드클라우드'],
  ['heat', '열지도'],
]

// 색은 토큰에서 읽어 SVG 속성으로 넣는다 — PNG로 저장할 때도 같은 색이 나오게
const TOKEN = {
  accent: ['--tb-color-accent', '#ea1917'],
  d1: ['--tb-color-surface-inverse', '#262626'],
  d2: ['--tb-color-text-faint', '#878580'],
  text: ['--tb-color-text', '#111111'],
  sub: ['--tb-color-text-sub', '#5c5b5a'],
  surface: ['--tb-color-surface', '#ffffff'],
}
function readColors() {
  const cs = typeof window === 'undefined' ? null : getComputedStyle(document.documentElement)
  const out = {}
  for (const [k, [v, fb]] of Object.entries(TOKEN)) out[k] = (cs?.getPropertyValue(v) || '').trim() || fb
  out.font = (cs && getComputedStyle(document.body).fontFamily) || 'sans-serif'
  return out
}

// 그릴 말 고르기: 1단계 = 위에서 가지 수만큼, 2단계 = 가지마다 돌아가며 하나씩(키워드 수까지). 같은 말은 한 번만
function pickGraph(nodes, branches, edges, branchN, totalN) {
  const l1 = nodes.slice(0, branchN)
  const seen = new Set(l1.map((n) => n.word.toLowerCase()))
  const lists = l1.map((n) => (branches?.[n.word] ?? []).filter((c) => !seen.has(c.word.toLowerCase())))
  const l2 = []
  for (let j = 0; l1.length + l2.length < totalN; j++) {
    let any = false
    for (let i = 0; i < l1.length && l1.length + l2.length < totalN; i++) {
      const c = lists[i][j]
      if (!c) continue
      any = true
      const key = c.word.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      l2.push({ ...c, parent: l1[i].word })
    }
    if (!any) break
  }
  const on = new Set(l1.map((n) => n.word))
  const cross = (edges ?? [])
    .filter((e) => on.has(e.a) && on.has(e.b))
    .sort((a, b) => b.npmi - a.npmi)
    .slice(0, 16)
  return { l1, l2, cross }
}

// 힘 배치 (팀 v2 d3-force 값으로 같은 계산, 300번 돌려 멈춘 자리). 검색어는 가운데 고정
function simulate(keyword, l1, l2, cross) {
  const P = new Map()
  P.set(keyword, { x: 0, y: 0, vx: 0, vy: 0, fixed: true })
  l1.forEach((n, i) => {
    const a = (i / Math.max(1, l1.length)) * Math.PI * 2 - Math.PI / 2
    P.set(n.word, {
      x: Math.cos(a) * 110,
      y: Math.sin(a) * 110,
      vx: 0,
      vy: 0,
      a,
    })
  })
  l2.forEach((n, j) => {
    const p = P.get(n.parent)
    const a = p.a + ((j % 5) - 2) * 0.35
    P.set(n.word, {
      x: p.x + Math.cos(a) * 60,
      y: p.y + Math.sin(a) * 60,
      vx: 0,
      vy: 0,
    })
  })
  const links = [
    ...l1.map((n) => ({
      s: keyword,
      t: n.word,
      d: 55 + 30 / (1 + n.score / 10),
      k: 0.6,
    })),
    ...l2.map((n) => ({
      s: n.parent,
      t: n.word,
      d: 55 + 30 / (1 + n.score / 10),
      k: 0.6,
    })),
    ...cross.map((e) => ({ s: e.a, t: e.b, d: 120, k: 0.03 })),
  ]
  const pts = [...P.values()]
  let alpha = 1
  for (let tick = 0; tick < 300; tick++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i]
        const b = pts[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) {
          dx = Math.random() - 0.5
          dy = Math.random() - 0.5
          d2 = 1
        }
        const f = (-140 * alpha) / d2
        // 글자가 덮이지 않게 가까우면 조금 더 밀어냄 (팀 맵에는 없음, 반 칸에서 겹침이 잦아 더함)
        const c = d2 < 34 * 34 ? (34 - Math.sqrt(d2)) * 0.5 * alpha : 0
        const s = f - c / Math.sqrt(d2)
        a.vx += dx * s * 0.5
        a.vy += dy * s * 0.5
        b.vx -= dx * s * 0.5
        b.vy -= dy * s * 0.5
      }
    }
    for (const l of links) {
      const a = P.get(l.s)
      const b = P.get(l.t)
      const dx = b.x + b.vx - a.x - a.vx
      const dy = b.y + b.vy - a.y - a.vy
      const len = Math.sqrt(dx * dx + dy * dy) || 1
      const m = ((len - l.d) / len) * alpha * l.k
      b.vx -= dx * m * 0.5
      b.vy -= dy * m * 0.5
      a.vx += dx * m * 0.5
      a.vy += dy * m * 0.5
    }
    for (const p of pts) {
      if (p.fixed) {
        p.vx = p.vy = 0
        continue
      }
      p.vx *= 0.6
      p.vy *= 0.6
      p.x += p.vx
      p.y += p.vy
    }
    alpha *= 0.985
  }
  const out = new Map()
  for (const [w, p] of P) out.set(w, { x: p.x, y: p.y })
  return out
}

// 모든 점이 판 안에 들어오는 확대 · 위치 (팀 zoomToFit(400, 40))
function fitView(pos, W, H, minK = 0.3) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pos.values()) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  if (!Number.isFinite(x0)) return { k: 1, tx: W / 2, ty: H / 2 }
  // 위 56px(접힌 표시 설정 판) · 아래 40px(범례 · 버튼)는 비우고 그 사이에 맞춤. 글자가 점 옆 · 아래로 나가므로 가로 100px · 세로 40px 더 남김
  const top = 56
  const bottom = 40
  const side = 24
  const bw = x1 - x0 + 100
  const bh = y1 - y0 + 40
  const k = Math.max(minK, Math.min(6, Math.min((W - side * 2) / bw, (H - top - bottom) / bh)))
  return { k, tx: W / 2 - ((x0 + x1) / 2) * k, ty: top + (H - top - bottom) / 2 - ((y0 + y1) / 2 + 10) * k }
}

const radius = (score, max) => 3 + 9 * Math.sqrt(score / max)

function MapStage({ mode, W, H, keyword, graph, pos, setPos, view, setView, colors, isOn, onPick, clickMode, collapsed, onCollapse, svgRef }) {
  const { l1, l2, cross } = graph
  const kidsOf = useMemo(() => {
    const m = new Map()
    for (const n of l2) m.set(n.parent, (m.get(n.parent) ?? 0) + 1)
    return m
  }, [l2])
  const shown2 = l2.filter((n) => !collapsed.has(n.parent))
  const max = Math.max(1, ...l1.map((n) => n.score), ...l2.map((n) => n.score))
  const S = (w) => {
    const p = pos.get(w)
    return p ? { x: p.x * view.k + view.tx, y: p.y * view.k + view.ty } : null
  }
  const drag = useRef(null)
  const toWorld = (e) => {
    const r = svgRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const onDown = (e, word) => {
    if (e.button !== 0) return
    const at = toWorld(e)
    drag.current = {
      word,
      sx: at.x,
      sy: at.y,
      moved: false,
      view0: view,
      p0: word ? pos.get(word) : null,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.stopPropagation()
  }
  const onMove = (e) => {
    const d = drag.current
    if (!d) return
    const at = toWorld(e)
    const dx = at.x - d.sx
    const dy = at.y - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    d.moved = true
    if (d.word && d.word !== keyword)
      setPos((m) =>
        new Map(m).set(d.word, {
          x: d.p0.x + dx / view.k,
          y: d.p0.y + dy / view.k,
        }),
      )
    else setView({ ...d.view0, tx: d.view0.tx + dx, ty: d.view0.ty + dy })
  }
  const onUp = (e, word) => {
    const d = drag.current
    drag.current = null
    if (!d || d.moved || !word || word !== d.word) return
    e.stopPropagation()
    act(word)
  }
  const level = (w) => (w === keyword ? 0 : l1.some((n) => n.word === w) ? 1 : 2)
  const act = (w) => {
    if (w === keyword) return
    if (clickMode === 'expand' && level(w) === 1 && kidsOf.get(w)) onCollapse(w)
    else onPick(w)
  }
  const edge = (a, b, c, key) => {
    const p = S(a)
    const q = S(b)
    if (!p || !q) return null
    return <line key={key} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="rgba(17,17,17,.2)" strokeWidth={Math.min(6, 0.6 + c / 8)} />
  }
  const node = (n, lv) => {
    const p = S(n.word)
    if (!p) return null
    const on = lv > 0 && isOn(n.word)
    const r = lv === 0 ? 11 : radius(n.score, max)
    const fill = lv === 0 ? colors.accent : lv === 1 ? colors.d1 : colors.d2
    const fs = lv === 0 ? 15 : lv === 1 ? 12.5 : 11
    const hidden = lv === 1 && collapsed.has(n.word) && kidsOf.get(n.word)
    const label = `${on ? '✓ ' : ''}${short(n.word, lv === 0 ? 18 : lv === 1 ? 14 : 11)}`
    const sub = lv === 1 ? (n.subcats ?? [])[0] : null
    const role = lv === 0 ? undefined : clickMode === 'expand' && lv === 1 && kidsOf.get(n.word) ? 'button' : 'checkbox'
    return (
      <g
        key={`n-${n.word}`}
        className={`km-dot km-d${lv}${on ? ' on' : ''}`}
        role={role}
        aria-checked={role === 'checkbox' ? on : undefined}
        aria-expanded={role === 'button' ? !hidden : undefined}
        aria-label={lv === 0 ? `검색어 ${n.word}` : `${n.word} · 함께 나온 이슈 ${n.score}개${sub ? ` · ${sub}` : ''}${lv === 2 ? ` · ${n.parent}의 가지` : ''}`}
        tabIndex={lv === 0 ? -1 : 0}
        onPointerDown={(e) => onDown(e, n.word)}
        onPointerUp={(e) => onUp(e, n.word)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), act(n.word))}
      >
        {mode === 'heat' ? null : <circle cx={p.x} cy={p.y} r={r} fill={fill} />}
        {on && <circle cx={p.x} cy={p.y} r={r + 3.5} fill="none" stroke={colors.text} strokeWidth="2" />}
        {hidden && mode !== 'heat' && (
          <text x={p.x} y={p.y + 3.6} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">
            +
          </text>
        )}
        <text
          x={p.x}
          y={p.y + (mode === 'heat' ? 4 : r + 2 + fs * 0.85)}
          textAnchor="middle"
          fontSize={fs}
          fontWeight={lv === 2 && !on ? 400 : lv === 0 ? 700 : on ? 700 : 600}
          fill={lv === 2 && !on ? colors.sub : colors.text}
          stroke="#fff"
          strokeWidth="3"
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {label}
        </text>
        <title>{lv === 0 ? n.word : `${n.word} · 함께 나온 이슈 ${n.score}개${(n.subcats ?? []).length ? ` · ${n.subcats.join(' / ')}` : ''}`}</title>
      </g>
    )
  }
  return (
    <svg
      ref={svgRef}
      className={`km-svg km-stage-svg${mode === 'heat' ? ' km-heat' : ''}`}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      fontFamily={colors.font}
      role="group"
      aria-label={mode === 'heat' ? `「${keyword}」 열지도 — 진할수록 함께 나온 이슈가 많음` : `「${keyword}」 연관 키워드 마인드맵`}
      onPointerDown={(e) => onDown(e, null)}
      onPointerMove={onMove}
      onPointerUp={(e) => onUp(e, null)}
    >
      <rect width={W} height={H} fill={colors.surface} />
      {mode === 'heat' ? (
        <>
          <defs>
            <radialGradient id="km-heat-g">
              <stop offset="0%" stopColor={colors.text} stopOpacity="0.38" />
              <stop offset="100%" stopColor={colors.text} stopOpacity="0" />
            </radialGradient>
          </defs>
          <g style={{ mixBlendMode: 'multiply' }}>
            {[{ word: keyword, score: max }, ...l1, ...shown2].map((n) => {
              const p = S(n.word)
              return p && <circle key={`h-${n.word}`} cx={p.x} cy={p.y} r={26 + 60 * Math.sqrt(n.score / max)} fill="url(#km-heat-g)" opacity={0.35 + 0.65 * (n.score / max)} />
            })}
          </g>
        </>
      ) : (
        <>
          {cross.map((e) => {
            const p = S(e.a)
            const q = S(e.b)
            return p && q && <line key={`x-${e.a}-${e.b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="rgba(17,17,17,.07)" strokeWidth="0.6" strokeDasharray="4 4" />
          })}
          {l1.map((n) => edge(keyword, n.word, n.score, `e-${n.word}`))}
          {shown2.map((n) => edge(n.parent, n.word, n.score, `e2-${n.word}`))}
        </>
      )}
      {shown2.map((n) => node(n, 2))}
      {l1.map((n) => node(n, 1))}
      {node({ word: keyword, score: max }, 0)}
    </svg>
  )
}

// 워드클라우드 (팀 layoutCloud 규칙): 큰 말부터 가운데에서 나선을 따라 겹치지 않는 첫 자리. 글자 크기 ∝ √(값/최댓값)
function CloudView({ g, keyword, nodes, branches, isOn, onPick, total = 40, avoid = null }) {
  const words = useMemo(() => {
    const all = new Map()
    for (const n of nodes) all.set(n.word, { word: n.word, score: n.score, kind: n.kind })
    for (const list of Object.values(branches ?? {}))
      for (const c of list)
        if (!all.has(c.word))
          all.set(c.word, {
            word: c.word,
            score: c.score,
            kind: 'general',
            second: true,
          })
    return [...all.values()].sort((a, b) => b.score - a.score).slice(0, total)
  }, [nodes, branches, total])
  const placed = useMemo(() => {
    const max = Math.max(1, ...words.map((w) => w.score))
    const boxes = []
    const out = []
    const cx = g.W / 2
    const cy = g.H / 2
    const hit = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)
    const centerSize = 40
    const cw = textW(keyword, centerSize) + 12
    boxes.push({
      x: cx - cw / 2,
      y: cy - centerSize * 0.6,
      w: cw,
      h: centerSize * 1.1,
    })
    if (avoid) boxes.push(avoid) // 떠 있는 표시 설정 판 자리는 비움
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
  }, [words, keyword, g.W, g.H, avoid])
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

// 지금 판을 PNG로 (팀 v2 「PNG 저장」). 색 · 글꼴은 SVG 속성에 들어 있어 그대로 그려진다
function savePng(svg, keyword) {
  if (!svg) return
  const W = svg.width.baseVal.value
  const H = svg.height.baseVal.value
  const xml = new XMLSerializer().serializeToString(svg)
  const img = new Image()
  img.onload = () => {
    const c = document.createElement('canvas')
    c.width = W * 2
    c.height = H * 2
    const ctx = c.getContext('2d')
    ctx.scale(2, 2)
    ctx.drawImage(img, 0, 0, W, H)
    const a = document.createElement('a')
    a.download = `연관키워드_${keyword}.png`
    a.href = c.toDataURL('image/png')
    a.click()
  }
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
}

export default function KeywordMap({ keyword, nodes, edges, branches, isOn, onToggle, large = false, initialView = 'map', onView }) {
  const box = useRef(null)
  const svgRef = useRef(null)
  const [size, setSize] = useState({ W: 640, H: large ? 640 : 460 })
  useEffect(() => {
    const el = box.current
    if (!el) return undefined
    const ro = new ResizeObserver(([e]) =>
      setSize({
        W: Math.round(e.contentRect.width),
        H: Math.round(e.contentRect.height),
      }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const { W, H } = size
  const colors = useMemo(() => readColors(), [])
  const [mode, setModeState] = useState(initialView === 'map' || initialView === 'cloud' || initialView === 'heat' ? initialView : 'map')
  const setMode = (v) => {
    setModeState(v)
    onView?.(v)
  }
  // 기본값: 팀 v2는 가지 7 · 키워드 40. 반 칸은 좁아 키워드 30, 휴대폰(720px 미만)은 가지 6 · 키워드 18 (390px에서 글자가 겹쳤음)
  const phone = typeof window !== 'undefined' && window.innerWidth < 720
  const maxBranch = Math.max(3, Math.min(15, nodes.length))
  const [branchN, setBranchN] = useState(Math.min(phone ? 6 : large ? 10 : 7, maxBranch))
  const [totalN, setTotalN] = useState(phone ? 18 : large ? 50 : 30)
  const [clickMode, setClickMode] = useState('scope')
  const [panelOpen, setPanelOpen] = useState(large)
  const [collapsed, setCollapsed] = useState(() => new Set())
  const graph = useMemo(() => pickGraph(nodes, branches, edges, branchN, totalN), [nodes, branches, edges, branchN, totalN])
  const base = useMemo(() => simulate(keyword, graph.l1, graph.l2, graph.cross), [keyword, graph])
  const [pos, setPos] = useState(base)
  const minK = phone ? 0.75 : 0.3 // 휴대폰은 0.75배 아래로 줄이지 않음 — 다 안 들어오면 끌어서 봄
  const [view, setView] = useState(() => fitView(base, W, H, minK))
  const fit = useCallback(() => setView(fitView(pos, W, H, minK)), [pos, W, H, minK])
  // 말이 바뀌면 새 배치 + 전체 보기, 판 크기가 바뀌면 전체 보기만 (그리는 중에 맞춤 — effect로 하면 한 번 더 그림)
  const [seen, setSeen] = useState({ base, W, H })
  if (seen.base !== base) {
    setSeen({ base, W, H })
    setPos(base)
    setView(fitView(base, W, H, minK))
  } else if (seen.W !== W || seen.H !== H) {
    setSeen({ base, W, H })
    setView(fitView(pos, W, H, minK))
  }
  // 휠 확대 (0.3~6배, 마우스 자리를 중심으로). 페이지가 같이 굴러가지 않게 passive 끔
  useEffect(() => {
    const el = box.current
    if (!el || mode === 'cloud') return undefined
    const onWheel = (e) => {
      if (e.target.closest?.('.km-panel')) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      setView((v) => {
        const k = Math.max(0.3, Math.min(6, v.k * Math.exp(-e.deltaY * 0.0015)))
        return {
          k,
          tx: mx - ((mx - v.tx) * k) / v.k,
          ty: my - ((my - v.ty) * k) / v.k,
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [mode])
  const onCollapse = (w) =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(w)) n.delete(w)
      else n.add(w)
      return n
    })
  const hasKids = graph.l2.length > 0
  // 워드클라우드는 표시 설정 판(왼쪽 위) · 범례 줄 자리를 피해 놓는다 (판 크기는 대략값)
  const cloudAvoid = useMemo(() => (panelOpen ? { x: 0, y: 0, w: Math.min(330, W), h: 300 } : { x: 0, y: 0, w: 180, h: 60 }), [panelOpen, W])
  return (
    <div className={large ? 'km km-large' : 'km'}>
      <div ref={box} className="km-stage">
        {mode === 'cloud' ? (
          <CloudView g={{ W, H }} keyword={keyword} nodes={nodes} branches={branches} isOn={isOn} onPick={onToggle} total={totalN} avoid={cloudAvoid} />
        ) : (
          <MapStage
            mode={mode}
            W={W}
            H={H}
            keyword={keyword}
            graph={graph}
            pos={pos}
            setPos={setPos}
            view={view}
            setView={setView}
            colors={colors}
            isOn={isOn}
            onPick={onToggle}
            clickMode={clickMode}
            collapsed={collapsed}
            onCollapse={onCollapse}
            svgRef={svgRef}
          />
        )}
        <section className="km-panel" data-collapsed={!panelOpen} aria-label="표시 설정">
          <div className="km-phead">
            <h3>표시 설정</h3>
            <button type="button" className="km-ptoggle" aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>
              {panelOpen ? '숨기기' : '펼치기'}
            </button>
          </div>
          {panelOpen && (
            <div className="km-pbody">
              <div className="km-ctl">
                <span className="km-lbl">보기</span>
                <div className="segmented" role="radiogroup" aria-label="보기">
                  {VIEWS.map(([v, t]) => (
                    <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="km-prow">
                <label className="km-ctl">
                  <span className="km-lbl">
                    가지 수 <output>{branchN}</output>
                  </span>
                  <input type="range" min="3" max={maxBranch} value={branchN} onChange={(e) => setBranchN(Number(e.target.value))} />
                </label>
                <label className="km-ctl">
                  <span className="km-lbl">
                    키워드 수 <output>{totalN}</output>
                  </span>
                  <input type="range" min="10" max="60" step="5" value={totalN} onChange={(e) => setTotalN(Number(e.target.value))} />
                </label>
              </div>
              {mode !== 'cloud' && hasKids && (
                <div className="km-ctl">
                  <span className="km-lbl">점을 누르면</span>
                  <div className="segmented" role="radiogroup" aria-label="점을 누르면">
                    <button type="button" role="radio" aria-checked={clickMode === 'scope'} onClick={() => setClickMode('scope')}>
                      범위 고르기
                    </button>
                    <button type="button" role="radio" aria-checked={clickMode === 'expand'} onClick={() => setClickMode('expand')}>
                      펼치기 · 접기
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
        {mode !== 'cloud' && <p className="km-hint">끌기 · 휠 확대 · 점 누르기 = {clickMode === 'expand' ? '펼치기/접기' : '범위에 넣기/빼기'}</p>}
        {mode !== 'cloud' && (
          <div className="km-legend" aria-hidden="true">
            <span>
              <i className="km-lg km-lg0" />
              검색어
            </span>
            <span>
              <i className="km-lg km-lg1" />
              1단계
            </span>
            <span>
              <i className="km-lg km-lg2" />
              2단계
            </span>
            <span>
              <i className="km-lg km-lg-on" />
              고른 범위
            </span>
          </div>
        )}
        {mode !== 'cloud' && (
          <div className="km-actions">
            <button type="button" className="km-act km-act-png" onClick={() => savePng(svgRef.current, keyword)}>
              PNG 저장
            </button>
            <button type="button" className="km-act" onClick={fit}>
              전체 보기
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
