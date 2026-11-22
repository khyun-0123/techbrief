// 연관 키워드 맵 (11/14 통합 → 11/14 3차: 마인드맵팀 「키워드 마인드맵 디자인 가이드」 값 그대로)
// - 데이터: server/related.js의 nodes(1단계, score = 함께 나온 이슈 수) · edges(NPMI 0.15 초과) · children(1단계 말마다 2단계, 2단계 말마다 3단계 — 11/15, 부품 속성 이름은 branches) · subcats(사업 6분류)
// - 3단계(11/15): 2단계 회색 점 옆 「+n」을 누르면 펼침(옅은 점). 처음엔 접힘
// - 점 · 선 (가이드 「점과 선」): 검색어 = 레드 점 11px · 15px 600 글자, 1단계 = 짙은 점 · 12.5px 600, 2단계 = 회색 점 · 11px 400,
//   점 반지름 3 + 9·√(수/최댓값), 가지 굵기 min(6, 0.6 + 수/8), 가지 사이 = 0.6px 점선(3, 3). 글자는 확대해도 같은 크기, 흰 3px 테두리
// - 움직임 (가이드 「움직임」, force-graph 값을 같은 식으로): 밀어내기 -140, 가지 길이 55 + 30/(1 + 수/10) · 세기 .6, 점선 120 · .03,
//   계산 150번 뒤 멈춤. 점을 끌면 이어진 점이 따라오고(세기 유지 .3), 놓으면 고정 없이 다시 자리 잡음. 화면은 그래프 가장자리 20% 밖으로 못 나감. 확대 0.3~6배
// - 색은 가이드 대신 Storybook 토큰(CLAUDE.md 디자인 기준) — 값이 거의 같음. SVG 속성으로 넣어 PNG에도 같은 색
// - 누르기 (11/14 조장): 점 · 글자 = 볼 범위에 넣기/빼기, 검정 점 옆 「+n」 배지 = 그 가지 펼치기/접기 (모드 전환 없앰). 처음엔 위 3개 가지만 펼침
//   키보드: Enter = 넣기/빼기, → = 펼치기, ← = 접기. 펼치거나 접어도 다른 점은 제자리에서 조금만 움직임
// - 가이드에서 아직 안 옮긴 것: 보고서에 넣기(초안 6장), 키워드 편집, 불용어 · 예외 단어 관리(지금은 서버 CSV), 관련 기사 칸
// - 기술 분류 (11/15 맵팀 요청): 표시 설정에서 사업 6분류(subcats) 하나를 고르면 1 · 2 · 3단계 모두 그 분류 말만 남김. 처음엔 「전체」
// - 종류 (11/17, 37 문서 Q2): 기술 · 회사 · 일반으로도 거름 — 사업 분류가 붙은 말이 11%뿐이라 어떤 검색어에서도 쓸 수 있게 (맵팀 지시문에 없던 것, 32 문서 근거)
// - 고르는 기준 (11/17, 37 문서 Q1): 함께 나온 순(처음 값) | 중요도순 = 그 말이 든 이슈 중요도의 **평균**(이슈 3개 이상, server/related.js impOf).
//   중요도순은 말의 순서만 바꾸고 점 · 글자 크기는 그대로 함께 나온 수 (맵팀 제안 「합」과 다름, 32 문서 근거)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from './theme.js'
import Dropdown, { Seg } from './Dropdown.jsx'
import { pageZoom } from './utils.js'

const short = (t, n = 14) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)
const textW = (t, px) => [...t].reduce((n, ch) => n + (/[가-힣]/.test(ch) ? px : px * 0.6), 0)
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// 색은 토큰에서 읽어 SVG 속성으로 넣는다 — PNG로 저장할 때도 같은 색이 나오게
const TOKEN = {
  accent: ['--tb-color-accent', '#ea1917'],
  d1: ['--tb-color-map-node', '#262626'], // 11/22 다크: 어두운 바탕에서도 보이는 점 색 (tokens.css)
  d2: ['--tb-color-text-faint', '#878580'],
  d3: ['--tb-color-line', '#cbc8c2'],
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

// 그릴 말 고르기 (가이드 「단어 고르기」): 함께 나온 이슈 minCo개 이상인 말 중 1단계 = 위에서 가지 수만큼,
// 2단계 = 가지마다 돌아가며 하나씩(키워드 수까지). 같은 말은 한 번만
// extra: 고른 말인데 위 기준에 안 들어 맵에 없던 1단계 말 — 늘 그린다 (11/14: 레버가 고른 8위 이하 말이 칩에만 있고 맵에 안 보였음)
function pickGraph(nodes, branches, edges, branchN, totalN, minCo, extra = []) {
  const base = nodes.filter((n) => n.score >= minCo).slice(0, branchN)
  const l1 = [...base, ...nodes.filter((n) => extra.includes(n.word) && !base.includes(n))]
  const seen = new Set(l1.map((n) => n.word.toLowerCase()))
  const lists = l1.map((n) => (branches?.[n.word] ?? []).filter((c) => c.score >= minCo && !seen.has(c.word.toLowerCase())))
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
      l2.push({ ...c, parent: l1[i].word, lv: 2 })
    }
    if (!any) break
  }
  // 3단계 (11/15): 2단계 말마다 함께 나온 말 4개까지 (함께 나온 이슈 2개 이상). 키워드 수와 따로 — 「+n」을 눌러 펼칠 때만 보임
  for (const n of l2.filter((x) => x.lv === 2)) {
    for (const c of (branches?.[n.word] ?? []).filter((x) => x.score >= 2).slice(0, 4)) {
      const key = c.word.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      l2.push({ ...c, parent: n.word, lv: 3 })
    }
  }
  const on = new Set(l1.map((n) => n.word))
  const cross = (edges ?? []).filter((e) => on.has(e.a) && on.has(e.b) && (e.n ?? 3) >= 3).sort((a, b) => b.npmi - a.npmi).slice(0, 16)
  return { l1, l2, cross }
}

// 힘 계산 (d3-force 식: manyBody · link(차수로 나눔) · center, 속도 감쇠 .4, alpha 감쇠 .0228)
function makeSim(keyword, l1, l2, cross, hidden, seed = null, alpha0 = 1) {
  const P = new Map()
  const add = (w, x, y) => {
    const q = seed?.get(w) // 펼치기 · 접기: 있던 점은 있던 자리에서 시작
    P.set(w, { w, x: q ? q.x : x, y: q ? q.y : y, vx: 0, vy: 0, fx: null, fy: null, cr: Math.max(16, Math.min(56, textW(short(w, 14), 12.5) / 2 + 6)) }) // cr: 글자 반폭
  }
  add(keyword, 0, 0)
  l1.forEach((n, i) => {
    const a = (i / Math.max(1, l1.length)) * Math.PI * 2 - Math.PI / 2
    add(n.word, Math.cos(a) * 30, Math.sin(a) * 30)
  })
  l2.forEach((n, j) => {
    if (hidden.has(n.parent) || !P.has(n.parent)) return // 3단계는 2단계 부모가 보일 때만
    const p = P.get(n.parent)
    const out = seed ? 1.15 : 1.4 // 새로 펼친 2단계는 부모 바로 바깥에서 나옴
    add(n.word, p.x * out + ((j % 5) - 2) * 6, p.y * out + ((j % 3) - 1) * 6)
  })
  const links = [
    ...l1.map((n) => ({ s: keyword, t: n.word, d: 55 + 30 / (1 + n.score / 10), k: 0.6 })),
    ...l2.filter((n) => P.has(n.word)).map((n) => ({ s: n.parent, t: n.word, d: 55 + 30 / (1 + n.score / 10), k: 0.6 })),
    ...cross.map((e) => ({ s: e.a, t: e.b, d: 120, k: 0.03 })),
  ]
  const deg = new Map()
  for (const l of links) {
    deg.set(l.s, (deg.get(l.s) ?? 0) + 1)
    deg.set(l.t, (deg.get(l.t) ?? 0) + 1)
  }
  const pts = [...P.values()]
  const sim = { P, pts, alpha: alpha0, target: 0, left: 150 }
  sim.tick = () => {
    sim.alpha += (sim.target - sim.alpha) * 0.0228
    const alpha = sim.alpha
    for (const a of pts) {
      for (const b of pts) {
        if (a === b) continue
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) {
          dx = (a.w < b.w ? 1 : -1) * 0.5
          dy = 0.5
          d2 = 1
        }
        const w = (-140 * alpha) / d2
        a.vx += dx * w
        a.vy += dy * w
        // 글자 폭만큼 겹치지 않게 (팀 맵에는 없음 — 반 칸에서 긴 영문 말 · 고른 말 알약이 겹쳤음, 11/14)
        const need = a.cr + b.cr
        if (d2 < need * need) {
          const d = Math.sqrt(d2)
          const push = ((need - d) / d) * 0.25 * Math.max(alpha, 0.15)
          a.vx -= dx * push
          a.vy -= dy * push * 0.6
        }
      }
    }
    for (const l of links) {
      const a = P.get(l.s)
      const b = P.get(l.t)
      const dx = b.x + b.vx - a.x - a.vx || 0.01
      const dy = b.y + b.vy - a.y - a.vy || 0.01
      const len = Math.sqrt(dx * dx + dy * dy)
      const m = ((len - l.d) / len) * alpha * l.k
      const bias = deg.get(l.s) / (deg.get(l.s) + deg.get(l.t))
      b.vx -= dx * m * bias
      b.vy -= dy * m * bias
      a.vx += dx * m * (1 - bias)
      a.vy += dy * m * (1 - bias)
    }
    let mx = 0
    let my = 0
    for (const p of pts) {
      if (p.fx != null) {
        p.x = p.fx
        p.y = p.fy
        p.vx = p.vy = 0
      } else {
        p.vx *= 0.6
        p.vy *= 0.6
        p.x += p.vx
        p.y += p.vy
      }
      mx += p.x
      my += p.y
    }
    // forceCenter: 끄는 중이 아니면 무게중심을 0에 (끄는 점이 튀지 않게)
    if (!pts.some((p) => p.fx != null)) {
      mx /= pts.length
      my /= pts.length
      for (const p of pts) {
        p.x -= mx
        p.y -= my
      }
    }
  }
  return sim
}
const snapshot = (sim) => new Map(sim.pts.map((p) => [p.w, { x: p.x, y: p.y }]))
function settled(keyword, g, hidden) {
  const s = makeSim(keyword, g.l1, g.l2, g.cross, hidden)
  for (let i = 0; i < 150; i++) s.tick()
  return snapshot(s)
}

function bboxOf(pos) {
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
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null
}
// 전체 보기 (zoomToFit, 여백 pad). 아래 40px는 범례 · 단추 줄, 글자가 점 옆 · 아래로 나가므로 가로 100 · 세로 40 더 남김
function fitView(pos, W, H, pad = 40, minK = 0.3) {
  const b = bboxOf(pos)
  if (!b) return { k: 1, tx: W / 2, ty: H / 2 }
  const top = pad
  const bottom = Math.max(pad, 44)
  const bw = b.x1 - b.x0 + 100
  const bh = b.y1 - b.y0 + 40
  const k = Math.max(minK, Math.min(6, Math.min((W - pad * 2) / bw, (H - top - bottom) / bh)))
  return { k, tx: W / 2 - ((b.x0 + b.x1) / 2) * k, ty: top + (H - top - bottom) / 2 - ((b.y0 + b.y1) / 2 + 10) * k }
}
// 화면 이동 제한 (가이드 clampView): 화면 가운데가 그래프 가장자리 20% 안쪽을 벗어나지 않게
function clampView(v, pos, W, H) {
  const b = bboxOf(pos)
  if (!b) return v
  const ix = (b.x1 - b.x0) * 0.2
  const iy = (b.y1 - b.y0) * 0.2
  const cx = (W / 2 - v.tx) / v.k
  const cy = (H / 2 - v.ty) / v.k
  const x = Math.max(b.x0 + ix, Math.min(b.x1 - ix, cx))
  const y = Math.max(b.y0 + iy, Math.min(b.y1 - iy, cy))
  return x === cx && y === cy ? v : { k: v.k, tx: W / 2 - x * v.k, ty: H / 2 - y * v.k }
}

const radius = (score, max) => 3 + 9 * Math.sqrt(score / max)
// 글자 크기 (11/16 검수: 「어디를 봐야 할지 모르겠다」): 토큰 단계에 맞춤 — 검색어 17(--fs-lg) · 1단계 13(--fs-sm) · 2 · 3단계와 배지 12(--fs-xs).
// 가이드 값(검색어 11px · 1단계 12.5 · 2단계 11)에서 바꿈 — 검색어가 가장 먼저 보이게 (32 문서)
const FS = [17, 13, 12, 12]
const BADGE_FS = 12
const CENTER_R = 13

function MapStage({ W, H, keyword, issues, graph, pos, view, setView, colors, isOn, onPick, hidden, onHide, svgRef, onDragNode, onHover, impOn = false }) {
  const { l1, l2, cross } = graph
  const kidsOf = useMemo(() => {
    const m = new Map()
    for (const n of l2) m.set(n.parent, (m.get(n.parent) ?? 0) + 1)
    return m
  }, [l2])
  const shown2 = l2.filter((n) => !hidden.has(n.parent) && pos.has(n.word))
  const max = Math.max(1, ...l1.map((n) => n.score), ...l2.map((n) => n.score))
  const S = (w) => {
    const p = pos.get(w)
    return p ? { x: p.x * view.k + view.tx, y: p.y * view.k + view.ty } : null
  }
  const drag = useRef(null)
  const local = (e) => {
    const r = svgRef.current.getBoundingClientRect()
    const z = pageZoom() // 작은 노트북 배율 (utils.js): 화면 픽셀 → 그림 좌표
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z }
  }
  const act = (w) => {
    if (w !== keyword) onPick(w)
  }
  const onDown = (e, word) => {
    if (e.button !== 0) return
    const at = local(e)
    drag.current = { word, sx: at.x, sy: at.y, moved: false, view0: view }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.stopPropagation()
  }
  const onMove = (e) => {
    const d = drag.current
    if (!d) return
    const at = local(e)
    const dx = at.x - d.sx
    const dy = at.y - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved && d.word) onHover(null)
    d.moved = true
    if (d.word) onDragNode(d.word, (at.x - view.tx) / view.k, (at.y - view.ty) / view.k)
    else setView(clampView({ ...d.view0, tx: d.view0.tx + dx, ty: d.view0.ty + dy }, pos, W, H))
  }
  const onUp = (e, word) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.word && d.moved) onDragNode(d.word, null)
    if (d.moved || !word || word !== d.word) return
    e.stopPropagation()
    act(word)
  }
  const edge = (a, b, c, key) => {
    const p = S(a)
    const q = S(b)
    if (!p || !q) return null
    return <line key={key} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={colors.text} strokeOpacity={0.2} strokeWidth={Math.min(6, 0.6 + c / 8)} />
  }
  const node = (n, lv) => {
    const p = S(n.word)
    if (!p) return null
    const on = lv > 0 && isOn(n.word)
    const r = lv === 0 ? CENTER_R : radius(n.score, max)
    const fill = lv === 0 ? colors.accent : lv === 1 ? colors.d1 : lv === 2 ? colors.d2 : colors.d3
    const fs = FS[lv] ?? FS[2]
    const folded = (lv === 1 || lv === 2) && hidden.has(n.word) && kidsOf.get(n.word)
    const label = `${on ? '✓ ' : ''}${short(n.word, lv === 0 ? 18 : lv === 1 ? 14 : 11)}`
    const sub = lv === 1 ? (n.subcats ?? [])[0] : null
    const role = lv === 0 ? undefined : 'checkbox'
    const info = lv === 0 ? { word: n.word, tag: '검색어', rows: [['함께 나온 이슈', `${issues ?? '-'}개`]] } : { word: n.word, tag: `${lv}단계`, rows: [[lv >= 2 ? `「${n.parent}」와 함께` : `「${keyword}」와 함께`, `이슈 ${n.score}개`], ...(impOn && n.imp != null ? [['평균 중요도', `${n.imp}점 · 이슈 ${n.impN}개`]] : []), ...((n.subcats ?? []).length ? [['분류', n.subcats.join(' · ')]] : []), ['볼 범위', on ? '넣음' : '안 넣음']] }
    return (
      <g
        key={`n-${n.word}`}
        className={`km-dot km-d${lv}${on ? ' on' : ''}`}
        role={role}
        aria-checked={role === 'checkbox' ? on : undefined}
        aria-expanded={(lv === 1 || lv === 2) && kidsOf.get(n.word) ? !folded : undefined}
        aria-label={lv === 0 ? `검색어 ${n.word}` : `${n.word} · 함께 나온 이슈 ${n.score}개${sub ? ` · ${sub}` : ''}${lv >= 2 ? ` · ${n.parent}의 가지` : ''}`}
        tabIndex={lv === 0 ? -1 : 0}
        onPointerDown={(e) => onDown(e, n.word)}
        onPointerUp={(e) => onUp(e, n.word)}
        onPointerEnter={() => !drag.current && onHover({ ...info, x: p.x, y: p.y + r })}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover({ ...info, x: p.x, y: p.y + r })}
        onBlur={() => onHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            act(n.word)
          } else if ((lv === 1 || lv === 2) && kidsOf.get(n.word) && ((e.key === 'ArrowRight' && folded) || (e.key === 'ArrowLeft' && !folded))) {
            e.preventDefault()
            onHide(n.word)
          }
        }}
      >
        <circle cx={p.x} cy={p.y} r={r + 3} fill="transparent" />
        <circle cx={p.x} cy={p.y} r={r} fill={fill} />
        {/* 고른 말 (11/14): 점 둘레 테두리는 1단계 점과 헷갈려서, 글자를 알약으로. 글자는 알약 가운데(central, 11/15 실측 2.3px 위로 떠 있었음)
            11/16 검수: 검정 알약 6개가 검색어보다 먼저 눈에 들어와 → 흰 바탕 + 진한 테두리 (✓ 표시는 그대로) */}
        {on && <rect x={p.x - (textW(label, fs) + 14) / 2} y={p.y + r + 2} width={textW(label, fs) + 14} height={fs + 7} rx={(fs + 7) / 2} fill={colors.surface} stroke={colors.text} strokeWidth="1.5" />}
        <text x={p.x} y={on ? p.y + r + 2 + (fs + 7) / 2 : p.y + r + 2 + fs * 0.85} dominantBaseline={on ? 'central' : undefined} textAnchor="middle" fontSize={fs} fontWeight={lv === 0 || on ? 700 : lv >= 2 ? 400 : 600} fill={lv >= 2 && !on ? colors.sub : colors.text} stroke={on ? 'none' : colors.surface} strokeWidth="3" strokeLinejoin="round" paintOrder="stroke">
          {label}
        </text>
      </g>
    )
  }
  // 펼치기 배지: 검정 점 오른쪽 위 「+n」(접힘) · 「−」(펼침). 점과 따로 누름 (점 누르기 = 범위)
  const badge = (n) => {
    const kids = kidsOf.get(n.word)
    const p = S(n.word)
    if (!kids || !p) return null
    const r = radius(n.score, max)
    const folded = hidden.has(n.word)
    const t = folded ? `+${kids}` : '−'
    const w = 12 + t.length * 7
    const x = p.x + r * 0.7 + 3
    const y = p.y - r * 0.7 - 17
    const stop = (e) => e.stopPropagation()
    return (
      <g
        key={`b-${n.word}`}
        className="km-badge"
        role="button"
        tabIndex={-1}
        aria-label={`${n.word} 가지 ${folded ? `펼치기 (${kids}개)` : '접기'}`}
        onPointerDown={stop}
        onPointerUp={stop}
        onClick={(e) => {
          e.stopPropagation()
          onHide(n.word)
        }}
      >
        <title>{folded ? `「${n.word}」와 함께 나온 말 ${kids}개 펼치기` : '접기'}</title>
        <rect x={x - 3} y={y - 3} width={w + 6} height={24} fill="transparent" />
        {/* 11/16 검수: 검정 배지가 눈을 끌어 → 흰 바탕 · 연한 테두리 · 회색 글자 (접힘 · 펼침 같은 모양, 글자로 구분) */}
        <rect x={x} y={y} width={w} height={18} rx={9} fill={colors.surface} stroke={colors.d3} />
        <text x={x + w / 2} y={y + 13} textAnchor="middle" fontSize={BADGE_FS} fontWeight="600" fill={colors.sub}>
          {t}
        </text>
      </g>
    )
  }
  return (
    <svg
      ref={svgRef}
      className="km-svg km-stage-svg"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      fontFamily={colors.font}
      role="group"
      aria-label={`「${keyword}」 연관 키워드 마인드맵`}
      onPointerDown={(e) => onDown(e, null)}
      onPointerMove={onMove}
      onPointerUp={(e) => onUp(e, null)}
    >
      <g className="km-content">
        {cross.map((e) => {
          const p = S(e.a)
          const q = S(e.b)
          return p && q && <line key={`x-${e.a}-${e.b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={colors.text} strokeOpacity={0.07} strokeWidth="0.6" strokeDasharray="3 3" />
        })}
        {l1.map((n) => edge(keyword, n.word, n.score, `e-${n.word}`))}
        {shown2.map((n) => edge(n.parent, n.word, n.score, `e2-${n.word}`))}
        {shown2.map((n) => node(n, n.lv ?? 2))}
        {l1.map((n) => node(n, 1))}
        {node({ word: keyword, score: max }, 0)}
        <g className="km-badges" data-export="skip">
          {l1.map(badge)}
          {shown2.filter((n) => n.lv === 2).map(badge)}
        </g>
      </g>
    </svg>
  )
}

// 워드클라우드 (가이드 「워드클라우드」): 굵기 700, 검색어 레드 · 1~10위 검정 · 11~26위 회색 · 그 아래 옅은 회색.
// 가장 큰 글자 = min(46, 폭/11) × min(1.15, √(40/단어 수)), 가장 작은 글자 = max(11, 큰 글자 × 0.3), 그 사이는 값의 제곱근,
// 검색어 = min(60, 큰 글자 × 1.3). 큰 말부터 가운데에서 나선을 따라 겹치지 않는 첫 자리. 표시 설정 창 자리 · 아래 36px는 비움
// 11/15: 비우는 자리는 접힌 창 크기만. 창을 펼쳐도 단어를 다시 놓지 않음 (펼친 창은 그림 위에 떠서 가려도 됨)
const CLOUD_AVOID = { x: 0, y: 0, w: 180, h: 60 }
// 종류 이름 (server/related.js kindOf)
const KIND_LABEL = { tech: '기술', company: '회사', general: '일반' }
// by (11/17): 'imp'면 평균 중요도 순으로 놓고(가운데 · 진한 색부터), 평균이 없는 말(이슈 3개 미만)은 뺀다. 글자 크기는 늘 함께 나온 수
function CloudView({ W, H, keyword, nodes, branches, isOn, onPick, total, avoid, colors, svgRef, onHover, by = 'co' }) {
  const words = useMemo(() => {
    const all = new Map()
    for (const n of nodes) all.set(n.word, { word: n.word, score: n.score, subcats: n.subcats, imp: n.imp, impN: n.impN })
    for (const [p, list] of Object.entries(branches ?? {})) for (const c of list) if (!all.has(c.word)) all.set(c.word, { word: c.word, score: c.score, parent: p, imp: c.imp, impN: c.impN })
    const list = [...all.values()]
    if (by === 'imp') return list.filter((w) => w.imp != null).sort((a, b) => b.imp - a.imp || b.score - a.score).slice(0, total)
    return list.sort((a, b) => b.score - a.score).slice(0, total)
  }, [nodes, branches, total, by])
  const placed = useMemo(() => {
    const max = Math.max(1, ...words.map((w) => w.score))
    const big = Math.min(46, W / 11) * Math.min(1.15, Math.sqrt(40 / Math.max(1, words.length)))
    const small = Math.max(11, big * 0.3)
    const centerSize = Math.min(60, big * 1.3)
    const boxes = []
    const out = []
    const cx = W / 2
    const cy = (H - 36) / 2
    const hit = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y)
    const cw = textW(keyword, centerSize) + 12
    boxes.push({ x: cx - cw / 2, y: cy - centerSize * 0.6, w: cw, h: centerSize * 1.1 })
    if (avoid) boxes.push(avoid)
    words.forEach((w, i) => {
      const size = Math.round(small + (big - small) * Math.sqrt(w.score / max))
      const bw = textW(w.word, size) + 10
      const bh = size * 1.15
      for (let t = 0; t < 1400; t++) {
        const a = t * 0.35
        const r = 6 + t * 1.2
        const x = cx + Math.cos(a) * r * 1.55 - bw / 2
        const y = cy + Math.sin(a) * r * 0.85 - bh / 2
        const b = { x, y, w: bw, h: bh }
        if (x < 8 || y < 8 || x + bw > W - 8 || y + bh > H - 36 || hit(b)) continue
        boxes.push(b)
        out.push({ ...w, size, x: x + bw / 2, y: y + bh * 0.8, rank: i })
        break
      }
    })
    return { out, centerSize, cy }
  }, [words, keyword, W, H, avoid])
  const fillOf = (rank) => (rank < 10 ? colors.text : rank < 26 ? colors.d2 : colors.d3)
  return (
    <svg ref={svgRef} className="km-svg km-cloud" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fontFamily={colors.font} role="group" aria-label={`「${keyword}」 워드클라우드`}>
      <g className="km-content">
        <text x={W / 2} y={placed.cy + placed.centerSize * 0.35} textAnchor="middle" fontSize={placed.centerSize} fontWeight="700" fill={colors.accent}>
          {keyword}
        </text>
        {placed.out.map((w) => {
          const on = isOn(w.word)
          const fill = fillOf(w.rank)
          return (
            <text
              key={w.word}
              className={`km-word${on ? ' on' : ''}`}
              x={w.x}
              y={w.y}
              textAnchor="middle"
              fontSize={w.size}
              fontWeight="700"
              fill={fill}
              stroke={on ? fill : 'none'}
              strokeWidth={on ? 1.2 : 0}
              paintOrder="stroke fill"
              role="checkbox"
              aria-checked={on}
              aria-label={`${w.word} · 함께 나온 이슈 ${w.score}개`}
              tabIndex={0}
              onMouseDown={(e) => e.preventDefault()} // 11/15: 마우스로 누를 때는 초점이 안 가게 (네모 테두리가 생기던 문제). 키보드 Tab · Enter는 그대로
              onClick={() => onPick(w.word)}
              onPointerEnter={() => onHover({ word: w.word, tag: w.parent ? '2단계' : '1단계', rows: [[w.parent ? `「${w.parent}」와 함께` : `「${keyword}」와 함께`, `이슈 ${w.score}개`], ...(by === 'imp' && w.imp != null ? [['평균 중요도', `${w.imp}점 · 이슈 ${w.impN}개`]] : []), ['볼 범위', on ? '넣음' : '안 넣음']], x: w.x, y: w.y + 4 })}
              onPointerLeave={() => onHover(null)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPick(w.word))}
            >
              {on ? '✓' : ''}
              {w.word}
            </text>
          )
        })}
      </g>
    </svg>
  )
}

// PNG 저장 (가이드 「보고서 · PNG」): 설정 창 · 단추 없이 그림만, 흰 바탕, 그림 크기에 맞춰 잘라 2배 해상도. 파일 이름: 마인드맵_검색어_날짜.png
function savePng(svg, name, colors) {
  return new Promise((resolve) => {
    if (!svg) return resolve(false)
    const box = svg.querySelector('.km-content')?.getBBox()
    if (!box || !box.width) return resolve(false)
    const pad = 24
    const x = box.x - pad
    const y = box.y - pad
    const w = Math.ceil(box.width + pad * 2)
    const h = Math.ceil(box.height + pad * 2)
    const clone = svg.cloneNode(true)
    clone.querySelectorAll('[data-export="skip"]').forEach((el) => el.remove()) // 펼치기 배지는 그림에 안 넣음
    clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`)
    clone.setAttribute('width', w)
    clone.setAttribute('height', h)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    for (const [k, v] of Object.entries({ x, y, width: w, height: h, fill: colors.surface })) bg.setAttribute(k, v)
    clone.insertBefore(bg, clone.firstChild)
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = w * 2
        c.height = h * 2
        const ctx = c.getContext('2d')
        ctx.scale(2, 2)
        ctx.drawImage(img, 0, 0, w, h)
        const a = document.createElement('a')
        a.download = name
        a.href = c.toDataURL('image/png')
        a.click()
        resolve(true)
      } catch {
        resolve(false)
      }
    }
    img.onerror = () => resolve(false)
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`
  })
}

// view: 보기(마인드맵 · 워드클라우드)는 칸 머리 칩에서 바꾸고 바깥(KeywordAnalysis)이 가짐 (11/17: 표시 설정 창의 같은 단추는 뺐음)
// 빽빽함 (11/14 조장): 멈춘 자리(final)와 지금 확대로 글자 상자끼리 겹치는 쌍을 센다. 많으면 「크게 보기」 안내
function countOverlaps(final, view, graph, hidden, keyword, isOn) {
  const max = Math.max(1, ...graph.l1.map((n) => n.score), ...graph.l2.map((n) => n.score))
  const items = [
    { word: keyword, fs: FS[0], r: CENTER_R },
    ...graph.l1.map((n) => ({ word: n.word, fs: FS[1], r: radius(n.score, max), max: 14 })),
    ...graph.l2.filter((n) => !hidden.has(n.parent)).map((n) => ({ word: n.word, fs: FS[2], r: radius(n.score, max), max: 11, lv: n.lv })),
  ]
  const boxes = []
  for (const it of items) {
    const p = final.get(it.word)
    if (!p) continue
    const x = p.x * view.k + view.tx
    const y = p.y * view.k + view.ty
    const on = it.word !== keyword && isOn(it.word)
    const w = textW(`${on ? '✓ ' : ''}${short(it.word, it.max ?? 18)}`, it.fs) + (on ? 14 : 4) // 고른 말은 알약 폭
    boxes.push({ x0: x - w / 2, x1: x + w / 2, y0: y + it.r + 2, y1: y + it.r + (on ? 9 : 4) + it.fs, dot: { x0: x - it.r, x1: x + it.r, y0: y - it.r, y1: y + it.r } })
    // 펼치기 배지 (검정 점 오른쪽 위)도 글자처럼 센다
    const kids = it.max === 14 || it.lv === 2 ? graph.l2.filter((c) => c.parent === it.word).length : 0
    if (kids) {
      const bw = 12 + (hidden.has(it.word) ? `+${kids}`.length : 1) * 7
      const bx = x + it.r * 0.7 + 3
      const by = y - it.r * 0.7 - 17
      boxes.push({ x0: bx, x1: bx + bw, y0: by, y1: by + 18, dot: { x0: 0, x1: 0, y0: 0, y1: 0 } })
    }
  }
  // 글자 ↔ 글자, 글자 ↔ 다른 점이 겹치는 곳을 센다
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
  let n = 0
  for (let i = 0; i < boxes.length; i++)
    for (let j = 0; j < boxes.length; j++) {
      if (i === j) continue
      if (j > i && hit(boxes[i], boxes[j])) n++
      if (hit(boxes[i], boxes[j].dot)) n++
    }
  return n
}
// 1단계 말의 「함께 나온 이슈」 처음 값 (맵팀 가이드 6). 맵팀이 바꾸면 여기 한 곳만 (38 문서 5장에 6 · 5 · 4일 때 차이)
const MIN_CO_DEFAULT = 6
const CROWDED = 6 // 글자 · 알약 · 배지 겹침이 이만큼 이상이면 안내 (11/14 3038 실측: 1440 반 칸 ai 안경 10 · 탠덤 OLED 4 · QD-OLED 2, 크게 보기 ai 안경 4)

export default function KeywordMap({ keyword, issues, nodes: rawNodes, edges, branches: rawBranches, isOn, onToggle, large = false, view: mode = 'map', onEnlarge }) {
  const box = useRef(null)
  const svgRef = useRef(null)
  const [size, setSize] = useState({ W: 640, H: 520 })
  useEffect(() => {
    const el = box.current
    if (!el) return undefined
    let t
    const ro = new ResizeObserver(([e]) => {
      clearTimeout(t)
      t = setTimeout(() => setSize({ W: Math.round(e.contentRect.width), H: Math.round(e.contentRect.height) }), 200) // 가이드: 0.2초 기다렸다 맞춤
    })
    ro.observe(el)
    return () => {
      clearTimeout(t)
      ro.disconnect()
    }
  }, [])
  const { W, H } = size
  const theme = useTheme() // 11/21 다크모드: 테마가 바뀌면 토큰 색을 다시 읽음
  const colors = useMemo(() => readColors(), [theme]) // eslint-disable-line react-hooks/exhaustive-deps
  // 기술 분류 (11/15): 서버가 붙인 사업 6분류(subcats)로 1 · 2 · 3단계를 모두 거름. 분류별 수 = 1~3단계의 서로 다른 말 수
  const catCounts = useMemo(() => {
    const seen = new Map()
    for (const n of rawNodes) seen.set(n.word, n.subcats ?? [])
    for (const list of Object.values(rawBranches ?? {})) for (const c of list) if (!seen.has(c.word)) seen.set(c.word, c.subcats ?? [])
    const count = new Map()
    for (const subs of seen.values()) for (const s of subs) count.set(s, (count.get(s) ?? 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1])
  }, [rawNodes, rawBranches])
  const [catPick, setCatPick] = useState('all')
  const cat = catCounts.some(([c]) => c === catPick) ? catPick : 'all' // 검색어가 바뀌어 그 분류가 없으면 「전체」
  // 종류 (11/17): 1 · 2 · 3단계의 서로 다른 말을 종류별로 셈 (서버가 2 · 3단계에도 kind를 붙임)
  const kindCounts = useMemo(() => {
    const seen = new Map()
    for (const n of rawNodes) seen.set(n.word, n.kind)
    for (const list of Object.values(rawBranches ?? {})) for (const c of list) if (!seen.has(c.word)) seen.set(c.word, c.kind)
    const count = new Map()
    for (const k of seen.values()) if (KIND_LABEL[k]) count.set(k, (count.get(k) ?? 0) + 1)
    return Object.keys(KIND_LABEL).filter((k) => count.has(k)).map((k) => [k, count.get(k)])
  }, [rawNodes, rawBranches])
  const [kindPick, setKindPick] = useState('all')
  const kind = kindCounts.some(([k]) => k === kindPick) ? kindPick : 'all'
  // 고르는 기준 (11/17): 중요도 정보(imp)가 하나도 없으면 「함께 나온 순」으로 고정
  const hasImp = rawNodes.some((n) => n.imp != null)
  const [byPick, setByPick] = useState('co')
  const by = hasImp ? byPick : 'co'
  const keep = useCallback((n) => (cat === 'all' || (n.subcats ?? []).includes(cat)) && (kind === 'all' || n.kind === kind), [cat, kind])
  // 중요도순: 평균 중요도 높은 순, 같으면 함께 나온 순. 평균이 없는 말(이슈 3개 미만)은 뒤로
  const order = useCallback((list) => (by === 'imp' ? [...list].sort((a, b) => (b.imp ?? -1) - (a.imp ?? -1) || b.score - a.score) : list), [by])
  const nodes = useMemo(() => order(cat === 'all' && kind === 'all' ? rawNodes : rawNodes.filter(keep)), [cat, kind, rawNodes, keep, order])
  const branches = useMemo(
    () => (cat === 'all' && kind === 'all' && by === 'co' ? rawBranches : Object.fromEntries(Object.entries(rawBranches ?? {}).map(([p, list]) => [p, order(list.filter(keep))]))),
    [cat, kind, by, rawBranches, keep, order],
  )
  const filterName = cat !== 'all' ? `「${cat}」` : kind !== 'all' ? `「${KIND_LABEL[kind]}」` : null
  const filterReset = cat !== 'all' ? '기술 분류' : '종류'
  const cloudEmpty = nodes.length === 0 && !Object.values(branches ?? {}).some((l) => l.length)
  // 처음 값 (가이드): 가지 7 · 키워드 40 · 함께 나온 이슈 6개 이상. 휴대폰(720px 미만)은 가지 6 · 키워드 18 (390px에서 글자가 겹쳤음, 11/14 실측)
  const phone = typeof window !== 'undefined' && window.innerWidth < 720
  const maxBranch = Math.max(3, Math.min(15, nodes.length))
  const [branchN, setBranchN] = useState(Math.min(phone ? 6 : 7, maxBranch))
  const [totalN, setTotalN] = useState(phone ? 18 : 40)
  const [minCo, setMinCo] = useState(MIN_CO_DEFAULT)
  const [panelOpen, setPanelOpen] = useState(false) // 가이드: 처음엔 접힘
  const [openSet, setOpenSet] = useState({}) // 손으로 펼치거나 접은 가지 { 말: true | false }. 없으면 위 3개만 펼침
  const [hover, setHover] = useState(null)
  const [saveMsg, setSaveMsg] = useState('')
  const [crowdOff, setCrowdOff] = useState(false) // 안내를 닫았으면 이 맵에서는 다시 안 띄움
  // 고른 1단계 말 중 기준(가지 수 · 함께 나온 이슈)에 안 들어 빠진 것은 덧붙여 그린다. 맵 안 점을 고를 때는 그래프가 그대로라 배치가 안 흔들림
  const extraKey = useMemo(() => {
    const base = new Set(nodes.filter((n) => n.score >= minCo).slice(0, branchN).map((n) => n.word))
    return nodes
      .filter((n) => !base.has(n.word) && isOn(n.word))
      .map((n) => n.word)
      .join('\u0001')
  }, [nodes, minCo, branchN, isOn])
  // 한 번 그린 말은 빼도 맵에 남긴다 (11/14: 영문 말을 눌러 빼면 점이 사라져 다시 고를 수 없었음)
  const [kept, setKept] = useState('')
  const keptList = kept ? kept.split('\u0001') : []
  const newExtra = extraKey ? extraKey.split('\u0001').filter((w) => !keptList.includes(w)) : []
  if (newExtra.length) setKept([...keptList, ...newExtra].join('\u0001'))
  const extraAll = [...keptList, ...newExtra].join('\u0001')
  const graph = useMemo(() => pickGraph(nodes, branches, edges, branchN, totalN, minCo, extraAll ? extraAll.split('\u0001') : []), [nodes, branches, edges, branchN, totalN, minCo, extraAll])
  // 펼침: 처음엔 모두 접힘 — 「+n」으로 펼침 (11/16 검수: 「맵에 글이 너무 많다」 → 처음엔 검색어 + 1단계 말만 글자, 24개 → 8개 안팎.
  // 예전: 1단계 위 3개를 처음부터 펼침)
  const isOpen = useCallback((w) => openSet[w] ?? false, [openSet])
  const hidden = useMemo(() => new Set([...graph.l1, ...graph.l2.filter((n) => n.lv === 2)].filter((n) => !isOpen(n.word)).map((n) => n.word)), [graph, isOpen])
  const minK = phone ? 0.75 : 0.3 // 휴대폰은 0.75배 아래로 줄이지 않음 — 다 안 들어오면 끌어서 봄
  // 힘 계산: 말 · 접힘이 바뀌면 새로. 끝 자리를 미리 계산해 화면을 맞춰 두고, 점들은 가운데서 퍼지며 그 자리로 감
  const final = useMemo(() => settled(keyword, graph, hidden), [keyword, graph, hidden])
  const [pos, setPos] = useState(final)
  const [view, setView] = useState(() => fitView(final, W, H, 40, minK))
  // 화면 맞춤은 말이 바뀌거나 판 크기가 바뀔 때만 (펼치기 · 접기로는 화면이 움직이지 않게)
  const [seen, setSeen] = useState({ graph, W, H })
  if (seen.graph !== graph || seen.W !== W || seen.H !== H) {
    setSeen({ graph, W, H })
    setView(fitView(final, W, H, 40, minK))
  }
  const posRef = useRef(pos)
  useEffect(() => {
    posRef.current = pos
  }, [pos])
  const simRef = useRef(null)
  const lastSim = useRef({ graph: null, keyword: null })
  const raf = useRef(0)
  const run = useCallback(() => {
    cancelAnimationFrame(raf.current)
    const step = () => {
      const s = simRef.current
      if (!s || s.left <= 0) return
      s.tick()
      s.left -= 1
      setPos(snapshot(s))
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }, [])
  useEffect(() => {
    if (reduceMotion()) {
      simRef.current = null
      raf.current = requestAnimationFrame(() => setPos(final))
    } else {
      // 같은 말에서 펼치기 · 접기만 바뀌었으면 지금 자리에서 약하게(.5) 다시 자리 잡음
      const keep = lastSim.current.graph === graph && lastSim.current.keyword === keyword
      simRef.current = makeSim(keyword, graph.l1, graph.l2, graph.cross, hidden, keep ? posRef.current : null, keep ? 0.5 : 1)
      lastSim.current = { graph, keyword }
      run()
    }
    return () => cancelAnimationFrame(raf.current)
  }, [keyword, graph, hidden, final, run])
  // 점 끌기: 끄는 동안 세기 .3 유지(이어진 점이 따라옴), 놓으면 고정을 풀고 150번 더 계산해 다시 자리 잡음
  const onDragNode = (word, x, y) => {
    let s = simRef.current
    if (!s) {
      // 동작 줄이기: 움직이는 계산 없이 끈 점만 옮김
      if (x != null) setPos((m) => new Map(m).set(word, { x, y }))
      return
    }
    const p = s.P.get(word)
    if (!p) return
    if (x == null) {
      p.fx = p.fy = null
      s.target = 0
      s.left = 150
    } else {
      p.fx = x
      p.fy = y
      s.target = 0.3
      if (s.alpha < 0.3) s.alpha = 0.3
      s.left = Infinity
    }
    run()
  }
  // 「전체 보기」: 0.4초 동안 부드럽게 (가이드 zoomToFit(400, 50))
  const anim = useRef(0)
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])
  const fit = () => {
    const to = fitView(posRef.current, W, H, 50, minK)
    const from = viewRef.current
    cancelAnimationFrame(anim.current)
    if (reduceMotion()) return setView(to)
    const t0 = performance.now()
    const step = (t) => {
      const u = Math.min(1, (t - t0) / 400)
      const e = 1 - (1 - u) ** 3
      setView({ k: from.k + (to.k - from.k) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e })
      if (u < 1) anim.current = requestAnimationFrame(step)
    }
    anim.current = requestAnimationFrame(step)
  }
  // 휠 확대 (0.3~6배, 마우스 자리 중심). 페이지가 같이 굴러가지 않게 passive 끔
  useEffect(() => {
    const el = box.current
    if (!el || mode !== 'map') return undefined
    const onWheel = (e) => {
      if (e.target.closest?.('.km-panel')) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const z = pageZoom()
      const mx = (e.clientX - r.left) / z
      const my = (e.clientY - r.top) / z
      setView((v) => {
        const k = Math.max(0.3, Math.min(6, v.k * Math.exp(-e.deltaY * 0.0015)))
        return clampView({ k, tx: mx - ((mx - v.tx) * k) / v.k, ty: my - ((my - v.ty) * k) / v.k }, posRef.current, W, H)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [mode, W, H])
  // 펼치기 · 접기. 펼친 뒤 점이 판 밖(또는 표시 설정 창 밑)으로 나가면 자리를 잡은 뒤 전체 보기로 맞춤 (11/15: 3단계가 위로 펼쳐져 가려졌음)
  const refitTimer = useRef(0)
  useEffect(() => () => clearTimeout(refitTimer.current), [])
  const onHide = (w) => {
    setOpenSet((o) => ({ ...o, [w]: !isOpen(w) }))
    clearTimeout(refitTimer.current)
    refitTimer.current = setTimeout(() => {
      const v = viewRef.current
      const out = [...posRef.current.values()].some((p) => {
        const x = p.x * v.k + v.tx
        const y = p.y * v.k + v.ty
        return x < 24 || x > W - 24 || y < 64 || y > H - 48
      })
      if (out) fit()
    }, 1300)
  }
  const msgTimer = useRef(0)
  const onSave = async () => {
    clearTimeout(msgTimer.current)
    setSaveMsg('만드는 중…')
    const d = new Date()
    const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const ok = await savePng(svgRef.current, `${mode === 'cloud' ? '워드클라우드' : '마인드맵'}_${keyword.replace(/\s+/g, '_')}_${day}.png`, colors)
    setSaveMsg(ok ? '저장했어요' : '저장하지 못했어요')
    msgTimer.current = setTimeout(() => setSaveMsg(''), 4500)
  }
  useEffect(() => () => clearTimeout(msgTimer.current), [])
  const cardLeft = hover ? Math.max(8, Math.min(W - 200, hover.x - 90)) : 0
  const cardTop = hover ? (hover.y + 120 > H ? Math.max(8, hover.y - 130) : hover.y + 22) : 0
  const overlaps = useMemo(() => (mode === 'map' ? countOverlaps(final, view, graph, hidden, keyword, isOn) : 0), [mode, final, view, graph, hidden, keyword, isOn])
  return (
    <div className={large ? 'km km-large' : 'km'}>
      <div ref={box} className="km-stage" data-overlaps={overlaps}>
        {mode === 'cloud' ? (
          <CloudView W={W} H={H} keyword={keyword} nodes={nodes} branches={branches} isOn={isOn} onPick={onToggle} total={totalN} avoid={CLOUD_AVOID} colors={colors} svgRef={svgRef} onHover={setHover} by={by} />
        ) : (
          <MapStage W={W} H={H} keyword={keyword} issues={issues} graph={graph} pos={pos} view={view} setView={setView} colors={colors} isOn={isOn} onPick={onToggle} hidden={hidden} onHide={onHide} svgRef={svgRef} onDragNode={onDragNode} onHover={setHover} impOn={by === 'imp'} />
        )}
        {hover && (
          <div className="km-card" role="note" style={{ left: cardLeft, top: cardTop }}>
            <b>{hover.word}</b>
            <span className={hover.tag === '검색어' ? 'km-card-tag accent' : 'km-card-tag'}>{hover.tag}</span>
            <dl>
              {hover.rows.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
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
              {/* 11/17 조장: 「보기(마인드맵 · 워드클라우드)」는 칸 머리 단추와 같아 뺐다 (맵팀 가이드와 다름, 38 문서) */}
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
                  <input type="range" min="10" max="80" step="5" value={totalN} onChange={(e) => setTotalN(Number(e.target.value))} />
                </label>
              </div>
              {mode === 'map' && (
                <label className="km-ctl">
                  <span className="km-lbl">
                    함께 나온 이슈 <output>{minCo}</output>개 이상만
                  </span>
                  <input type="range" min="1" max="20" value={minCo} onChange={(e) => setMinCo(Number(e.target.value))} />
                </label>
              )}
              <div className="km-ctl">
                <span className="km-lbl">고르는 기준</span>
                <Seg
                  value={by}
                  onChange={setByPick}
                  label="고르는 기준"
                  size="md"
                  disabled={!hasImp}
                  options={[
                    { value: 'imp', label: '중요도순' },
                    { value: 'co', label: '함께 나온 순' },
                  ]}
                />
                {hasImp ? (
                  by === 'imp' && <span className="km-note">말이 든 이슈들의 평균 중요도 순 (이슈 3개 이상). 점 · 글자 크기는 함께 나온 수 그대로</span>
                ) : (
                  <span className="km-note">중요도 정보가 아직 없어 함께 나온 순으로 보여요</span>
                )}
              </div>
              {/* 11/17: 기술 분류 · 종류는 한 줄에 (창 높이를 줄여 대시보드 칸에서도 아래가 잘리지 않게) */}
              {(catCounts.length > 0 || kindCounts.length > 1) && (
                <div className="km-prow">
                  {catCounts.length > 0 && (
                    <div className="km-ctl">
                      <span className="km-lbl">기술 분류</span>
                      <Dropdown value={cat} onChange={setCatPick} label="기술 분류" size="sm" options={[{ value: 'all', label: '전체' }, ...catCounts.map(([c, n]) => ({ value: c, label: `${c} (${n})` }))]} />
                    </div>
                  )}
                  {kindCounts.length > 1 && (
                    <div className="km-ctl">
                      <span className="km-lbl">종류</span>
                      <Dropdown value={kind} onChange={setKindPick} label="종류" size="sm" options={[{ value: 'all', label: '전체' }, ...kindCounts.map(([k, n]) => ({ value: k, label: `${KIND_LABEL[k]} (${n})` }))]} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
        {/* 11/17: 표시 설정 창을 펼쳤을 때는 안 띄운다 (둘이 겹쳤음, 창에서 가지 수를 줄이면 바로 줄어듦) */}
        {mode === 'map' && !crowdOff && !panelOpen && overlaps >= CROWDED && (
          <div className="km-crowd" role="status">
            <span>점이 많아 글자가 겹쳐요{large ? ` · ${phone ? '두 손가락으로 벌려 확대' : '휠로 확대'}하거나 표시 설정에서 가지 수를 줄여 보세요` : ''}</span>
            {!large && onEnlarge && (
              <button type="button" className="km-crowd-go" onClick={onEnlarge}>
                ⤢ 크게 보기
              </button>
            )}
            <button type="button" className="km-crowd-x" onClick={() => setCrowdOff(true)} aria-label="안내 닫기">
              ×
            </button>
          </div>
        )}
        {mode === 'map' && graph.l1.length === 0 && (
          <p className="km-empty">{filterName ? `${filterName}에 드는 말이 없어요. ${filterReset}를 「전체」로 바꿔 보세요.` : `함께 나온 이슈가 ${minCo}개 이상인 말이 없어요. 「함께 나온 이슈」 기준을 낮춰 보세요.`}</p>
        )}
        {mode === 'cloud' && filterName && cloudEmpty && <p className="km-empty">{filterName}에 드는 말이 없어요. {filterReset}를 「전체」로 바꿔 보세요.</p>}
        <div className="km-legend">
          {mode === 'cloud' ? (
            <span>「{keyword}」와 함께 나온 말 · 누르면 볼 범위에 넣기</span>
          ) : (
            <>
              <span>
                <i style={{ background: colors.accent }} />
                검색어
              </span>
              {/* 11/16 검수: 범례 6칸 → 4칸 (1 · 2 · 3단계는 「진할수록 가까움」 한 칸) */}
              <span>
                <i style={{ background: colors.d1 }} />
                <i style={{ background: colors.d2 }} />
                함께 나온 말 · 진할수록 가까움
              </span>
              <span>
                <b className="km-lg-on">✓ 볼 범위</b>
              </span>
              <span>
                <b className="km-lg-badge">+n</b>
                펼치기
              </span>
            </>
          )}
        </div>
        <div className="km-actions">
          <span className="km-savemsg" aria-live="polite">
            {saveMsg}
          </span>
          <button type="button" className="km-act km-act-png" onClick={onSave}>
            PNG 저장
          </button>
          {mode === 'map' && (
            <button type="button" className="km-act" onClick={fit}>
              전체 보기
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
