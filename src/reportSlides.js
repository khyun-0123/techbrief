// 11/14 통합: 보고서팀(김동현) techbrief-ui-report의 4:3 쪽 엔진을 main 보고서(#109 담당자 양식) 데이터에 맞춰 옮김
//   - briefFromMain: main 헤드라인 + 시사점 글머리 tag(기회 · 위협 · 할 일)를 엔진의 brief 모양으로, 근거 번호 유지
//   - 쪽 구성: 1페이지 + 유첨 1 상세 분석(기술 개요 · 업계 동향) · 유첨 2 분석 자료(특허 · 경쟁사 그래프) · 유첨 3 근거 기사
//   - [분석] 근거(analysis)는 기사 수 · 매체 계산에서 뺌
// 보고서 4:3 가로형 양식 (11/12 시안: docs/images/ui/08-report-format.png · 09-report-pages.png · 10-chart-types.png)
// 이 파일이 쪽마다 글 상자 · 도형 · 표 · 그래프의 자리(인치)와 글자 크기를 정하고,
// 화면 미리보기 · PDF(ReportSlide.jsx)와 PPT(reportExport.js)는 그 자리에 그대로 그린다 → 셋이 같은 모양
//
// 구성 (5쪽): 1 핵심 요약 · 2 기술 개요 · 3 업계 동향 · 4 시사점 및 제언 · 5 근거 기사(부록). 넘치면 「(계속)」 쪽
// 글자: 18pt(제목 · 헤드라인) · 14pt(소주제) · 11pt(본문) · 10pt(주석) 네 가지만 (1차 인터뷰 사내 규칙). 넘치면 줄이지 않고 다음 쪽으로
// 문체: 개조식 — 금지 어미(~합니다 · ~한다 · ~이다 …)는 규칙으로 고치고, 못 고친 것은 체크리스트에 남긴다
// 그래프 (11/12 규칙): 데이터 성격에 맞춰 고른다 (chooseChart)
//   - 제품 · 기업 간 비교 → 묶음 막대 · 시간에 따른 변화 → 선 · 점유율 · 구성비(5개 이하) → 도넛 · 순위 → 가로 막대 · 두 지표 관계 → 산점도
//   - 자료에 있는 수치만 쓴다. 수치가 모자라면 그래프 없이 글로 쓴다 (chartBox)
//   - 그래프마다 출처 · 기준 시점 한 줄 (11/25: 선택 이유 · 다른 형태로 보기 줄은 뺌). 맞는 그래프가 둘 이상이면 추천안 하나를 그림
//   - 지금 보고서 데이터에는 여러 계열 비교 · 두 지표 짝이 없어 묶음 막대 · 산점도는 고르는 규칙만 있고 쓰는 쪽이 없다
// 근거: 뺀 줄(excluded)은 넣지 않는다. 기사 확인 사실(✓ · 근거 번호)과 AI 해설·제안은 섞지 않는다
import { ACCESS_LABEL, PAID_NOTICE, paperAccess } from './paperAccess.js'
import { analysisUrl, evidenceLabel, kindOf } from './reportStore.js'

export const PAGE = { w: 10, h: 7.5, m: 0.5 }
export const SIZE = { title: 18, sub: 14, body: 11, note: 10 }
export const FONT = { latin: 'Arial Narrow', ea: 'LG 스마트체' }
export const COLOR = {
  ink: '111111',
  sub: '555555',
  line: 'DDDDDD',
  accent: 'A50034',
  pink: 'FDECF0',
  pinkLine: 'F2C4D1',
  gray: 'F2F2F3',
  grayInk: '333333',
  aiBg: 'FFF5E6',
  aiInk: 'B45309',
}
export const PIE_COLORS = ['A50034', 'D9577E', 'F2A7BC', '6B6B6B', 'B5B5B5']
export const SUPPLEMENT_LABEL = { data: '수집 자료', wiki: '위키백과', 'data+wiki': '수집 자료 · 위키백과' }

let LINE = 1.35 // 줄 간격 (글자 크기의 몇 배)
export const LH = (pt) => (pt * LINE) / 72 // 줄 높이 (인치)
export const lineGap = () => LINE
let M = PAGE.m
let CW = PAGE.w - 2 * M
const FOOT_Y = PAGE.h - 0.42 // 쪽 아래 줄 (제목 · 쪽 번호)
const BOTTOM = FOOT_Y - 0.12 // 내용이 내려올 수 있는 끝

// ── 보고서 양식 (11/20, 관리 페이지 「보고서 양식」 · server/reportStyle.js) ──
// 글꼴 · 글자 크기 · 강조색 · 여백 · 줄 간격을 관리자가 정한다. 화면이 켜질 때 /api/report-style을 받아 여기에 넣고,
// 그 뒤 그리는 미리보기 · PDF · PPT가 모두 이 값을 쓴다. 쪽 크기(4:3, 10×7.5in)는 담당자 양식이라 바꾸지 않는다
export function applyReportStyle(style) {
  if (!style) return
  if (style.fonts) Object.assign(FONT, style.fonts)
  if (style.sizes) Object.assign(SIZE, style.sizes)
  if (/^[0-9A-Fa-f]{6}$/.test(style.accent ?? '')) COLOR.accent = style.accent.toUpperCase()
  if (Number.isFinite(style.margin)) PAGE.m = style.margin
  if (Number.isFinite(style.lineGap)) LINE = style.lineGap
  M = PAGE.m
  CW = PAGE.w - 2 * M
}
export const currentReportStyle = () => ({ fonts: { ...FONT }, sizes: { ...SIZE }, accent: COLOR.accent, margin: PAGE.m, lineGap: LINE })

// ── 글자 폭 어림 (한글 1em, 영문 · 숫자 · 기호는 좁게) → 줄 수 ──
// 11/25 팀 검수 「박스 밖으로 넘침」: Arial Narrow(0.47em)가 없는 PC · 미리보기에서는 영문 · 숫자가 Pretendard로 그려져
// 20~25% 넓어진다. 글꼴이 없는 쪽 기준(0.55)으로 넉넉하게 세고, 줄 폭은 3% 남긴다 (FIT)
const FIT = 0.97
function units(text) {
  let u = 0
  for (const ch of String(text)) {
    if (/[ㄱ-힝一-鿿]/.test(ch)) u += 1
    else if (ch === ' ') u += 0.3
    else if (/[A-Za-z0-9]/.test(ch)) u += 0.55
    else u += 0.45
  }
  return u
}
// 한 줄에 들어가는지 (pt 크기 · 폭 in)
const fitsLine = (text, pt, widthIn) => units(text) <= (widthIn * FIT) / (pt / 72)
// 낱말 단위로 줄이기 (담당자 양식 PPT와 같은 규칙, server/reportToTemplate.js cutWords)
export function cutWords(t, n) {
  const s = String(t ?? '').replace(/[.。]$/, '')
  if ([...s].length <= n) return s
  const head = s.slice(0, n - 1)
  const at = head.lastIndexOf(' ')
  return `${(at > n * 0.6 ? head.slice(0, at) : head).replace(/[,\s·]+$/, '')}…`
}
export function linesOf(text, pt, widthIn) {
  return String(text)
    .split('\n')
    .reduce((n, part) => n + Math.max(1, Math.ceil(units(part) / ((widthIn * FIT) / (pt / 72)))), 0)
}
const runsText = (runs) => runs.map((r) => r.text).join('')

// ── 문체: 금지 어미 → 개조식 종결 ──
const TAIL = /(\s*\(추정\))?\s*[.。]?\s*$/
const FIXES = [
  [/(했|하였)습니다$/, '함'],
  [/합니다$/, '함'],
  [/됩니다$/, '됨'],
  [/입니다$/, '임'],
  [/있습니다$/, '있음'],
  [/없습니다$/, '없음'],
  [/해요$/, '함'],
  [/(했|하였)다$/, '함'],
  [/한다$/, '함'],
  [/된다$/, '됨'],
  [/됐다$/, '됨'],
  [/있다$/, '있음'],
  [/없다$/, '없음'],
  [/었다$/, '었음'],
  [/았다$/, '았음'],
  [/였다$/, '였음'],
  [/이다$/, '임'],
]
export const FORBIDDEN = /(합니다|습니다|입니다|해요|한다|이다|했다)$/
function core(text) {
  const m = String(text).match(TAIL)
  return { body: String(text).slice(0, m.index).trim(), est: Boolean(m[1]) }
}
let fixedCount = 0
function fixEnding(text) {
  const { body, est } = core(text)
  let out = body
  for (const [re, to] of FIXES) {
    if (re.test(out)) {
      out = out.replace(re, to)
      fixedCount++
      break
    }
  }
  return est ? `${out} (추정)` : out
}
const forbiddenIn = (text) => FORBIDDEN.test(core(text).body)
const clean = (t) => String(t ?? '').replace(/\s*\[\d+\](\[\d+\])*\s*$/, '').trim()
const refLabel = (refs) => (refs?.length ? ` [${refs.join('][')}]` : '')
const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s\-·_]/g, '')

function ymd(t, sep = '.') {
  const d = new Date(t)
  return `${d.getFullYear()}${sep}${String(d.getMonth() + 1).padStart(2, '0')}${sep}${String(d.getDate()).padStart(2, '0')}`
}
const md = (t) => {
  const d = new Date(t)
  return `${d.getMonth() + 1}. ${d.getDate()}.`
}

// 보고서의 분석 키워드: 쓴 기사 요약의 핵심 키워드 중 많이 나온 것
function keywordCounts(saved) {
  const count = new Map()
  for (const a of saved.inputs ?? []) {
    for (const k of new Set((a.summary?.keywords ?? []).map((x) => String(x).trim()).filter(Boolean))) count.set(k, (count.get(k) ?? 0) + 1)
  }
  return [...count].sort((a, b) => b[1] - a[1])
}
export function reportKeywords(saved, max = 3) {
  return keywordCounts(saved).slice(0, max).map(([k]) => k)
}

// ── 그래프 고르기 (차트 가이드) ──
export const CHART_NAME = { grouped: '묶음 막대 그래프', line: '선 그래프', donut: '도넛 차트', hbar: '가로 막대 그래프', scatter: '산점도' }
// intent: compare(제품 · 기업 간 비교) · trend(추이) · share(점유율 · 구성비) · rank(순위) · relation(두 지표 관계)
export function chooseChart(intent, n) {
  if (intent === 'compare') return 'grouped'
  if (intent === 'trend') return 'line'
  if (intent === 'share') return n <= 5 ? 'donut' : 'hbar' // 5개를 넘으면 도넛 대신 순위로
  if (intent === 'relation') return 'scatter'
  return 'hbar'
}
// 그래프에 쓸 수치가 충분한지: 항목 2개 이상, 0이 아닌 값이 있어야 (구성비는 두 항목 이상에 값이 있어야)
function enoughData(kind, values) {
  const nonzero = values.filter((v) => v > 0).length
  if (values.length < 2 || nonzero === 0) return false
  if (kind === 'donut') return nonzero >= 2
  return true
}

// ── 요소 만들기 ──
const text = (x, y, w, h, size, runs, opts = {}) => ({ t: 'text', x, y, w, h, size, runs: typeof runs === 'string' ? [{ text: runs }] : runs, ...opts })
const rect = (x, y, w, h, opts = {}) => ({ t: 'rect', x, y, w, h, ...opts })

// 모든 쪽 공통 틀: 왼쪽 위 로고 글자 · 오른쪽 위 레드 띠 · 아래 제목 줄 · 오른쪽 아래 쪽 번호와 레드 모서리
function chrome(els, meta, rightTop) {
  els.push(rect(M, 0.24, 0.16, 0.16, { fill: COLOR.accent }))
  els.push(text(M + 0.24, 0.2, 2.5, LH(SIZE.sub), SIZE.sub, '테크브리프', { bold: true }))
  els.push(rect(PAGE.w - 3.6, 0, 3.6, 0.1, { fill: COLOR.accent }))
  if (rightTop) els.push(text(PAGE.w - M - 5, 0.24, 5, LH(SIZE.note), SIZE.note, rightTop, { align: 'right', color: COLOR.sub }))
  els.push(text(M, FOOT_Y, 6, LH(SIZE.note), SIZE.note, [{ text: '테크브리프', bold: true }, { text: `  |  ${meta.title}`, color: COLOR.sub }]))
  els.push({ t: 'tri', x: PAGE.w - 1.7, y: PAGE.h - 0.3, w: 1.7, h: 0.3, fill: COLOR.accent })
  els.push({ t: 'pageno' })
}

// 쪽 제목: 레드 세로 막대 + 18pt
function pageTitle(els, label, y = 0.62) {
  els.push(rect(M, y + 0.04, 0.07, LH(SIZE.title) - 0.06, { fill: COLOR.accent }))
  els.push(text(M + 0.18, y, 5, LH(SIZE.title), SIZE.title, label, { bold: true }))
  return y + LH(SIZE.title) + 0.18
}

// 사실 한 줄: 레드 원 ✓ + 글 (내어쓰기). 반환: 높이
// 유첨 글머리 칸 표시 (11/25): AI가 정한 배경 · 쟁점 · 전망을 글 앞에 굵게
const roleText = (b) => (b.role ? `${b.role}  ` : '')
const roleRun = (b) => (b.role ? [{ text: roleText(b), bold: true }] : [])
function factLine(els, x, y, w, f, size = SIZE.body) {
  const runs = [...roleRun(f), { text: f.text }, { text: refLabel(f.refs), color: COLOR.sub }]
  if (f.supplement) runs.push({ text: `  (근거 보충 · ${SUPPLEMENT_LABEL[f.supplement] ?? f.supplement})`, color: COLOR.sub, size: SIZE.note })
  const n = linesOf(runsText(runs), size, w - 0.3)
  els.push({ t: 'check', x, y: y + 0.03, d: 0.17 })
  els.push(text(x + 0.27, y, w - 0.27, n * LH(size), size, runs))
  return n * LH(size)
}
function factHeight(w, f, size = SIZE.body) {
  return linesOf(`${roleText(f)}${f.text}${refLabel(f.refs)}${f.supplement ? '  (근거 보충 · 수집 자료 · 위키백과)' : ''}`, size, w - 0.3) * LH(size)
}
function bulletLine(els, x, y, w, runs, size = SIZE.body, mark = '•') {
  const n = linesOf(runsText(runs), size, w - 0.18)
  els.push(text(x, y, 0.18, LH(size), size, mark))
  els.push(text(x + 0.18, y, w - 0.18, n * LH(size), size, runs))
  return n * LH(size)
}
const bulletHeight = (w, t, size = SIZE.body) => linesOf(t, size, w - 0.18) * LH(size)

// AI 해설·제안 상자 (옅은 주황 바탕, 기사 밖 내용이라 따로)
function aiBoxHeight(w, list) {
  return list.length ? 0.14 + LH(SIZE.body) + list.reduce((h, b) => h + bulletHeight(w - 0.3, `${roleText(b)}${b.text}`, SIZE.body) + 0.03, 0) + 0.06 : 0
}
function aiBox(els, x, y, w, list) {
  if (!list.length) return 0
  const h = aiBoxHeight(w, list)
  els.push(rect(x, y, w, h, { fill: COLOR.aiBg, radius: 0.08 }))
  els.push(text(x + 0.15, y + 0.08, w - 0.3, LH(SIZE.body), SIZE.body, [{ text: 'AI 해설·제안', bold: true, color: COLOR.aiInk }, { text: '  기사 확인 사실 아님 · 검토 필요', color: COLOR.aiInk, size: SIZE.note }]))
  let yy = y + 0.1 + LH(SIZE.body) + 0.02
  for (const b of list) yy += bulletLine(els, x + 0.15, yy, w - 0.3, [...roleRun(b), { text: b.text }]) + 0.03
  return h
}

// 그래프 상자: 제목 · 그래프 · 설명(단위 · 기간 · 출처 · 고른 그래프)
// ── 그래프 가독성 (11/12 규칙) ──
// 가로축 라벨: 최대 7개, 일정 간격으로 건너뛰되 첫 · 마지막은 꼭 표시. 겹칠 것 같으면 45도로 기울이고,
// 그래도 겹치면 라벨 수를 줄인다. 기울이면 라벨 아래 · 축 제목 사이 여백을 그만큼 둔다
// 화면/PDF(ReportSlide.jsx) · PPT(reportExport.js)가 이 값(ticks · rotate · labelPad)을 그대로 쓴다
export const MAX_TICKS = 7
const labelW = (t, pt = SIZE.note) => (units(t) * pt) / 72 // 라벨 글자 폭 (인치)
function pickTicks(n, k) {
  if (n <= k) return [...Array(n).keys()]
  return [...new Set(Array.from({ length: k }, (_, i) => Math.round((i * (n - 1)) / (k - 1))))]
}
export function axisLayout(labels, plotW) {
  const n = labels.length
  const longest = Math.max(0, ...labels.map((l) => labelW(l)))
  const textH = LH(SIZE.note)
  for (let k = Math.min(n, MAX_TICKS); k >= 2; k--) {
    const ticks = pickTicks(n, k)
    const gap = Math.min(...ticks.slice(1).map((t, i) => t - ticks[i])) || n
    const spacing = (plotW * gap) / n // 보이는 라벨끼리 떨어진 거리 (인치)
    if (longest + 0.08 <= spacing) return { ticks, rotate: false, labelPad: textH + 0.06, ok: true }
    // 45도로 기울이면 가로로 차지하는 폭은 글자 높이 / sin45 정도
    if (textH * 1.42 + 0.04 <= spacing) return { ticks, rotate: true, labelPad: longest * 0.71 + textH * 0.71 + 0.1, ok: true }
  }
  const ticks = pickTicks(n, Math.min(n, 2))
  return { ticks, rotate: true, labelPad: longest * 0.71 + textH * 0.71 + 0.1, ok: false }
}
// 가로 막대: 항목 이름이 왼쪽 칸(폭 42%)에 들어가는지
function sideFits(c, w) {
  if (c.kind === 'hbar') return c.labels.every((l) => labelW(l.length > 12 ? `${l.slice(0, 11)}…` : l) <= w * 0.42)
  return true
}
// 도넛 범례: 그래프 그림과 따로 글 상자로 놓는다 (화면 · PPT가 같은 자리). 오른쪽에 들어가면 오른쪽, 아니면 아래
function donutLayout(els, c, x, y, w, h) {
  const total = c.values.reduce((a, b) => a + b, 0)
  const sw = 0.12 // 색 칸
  const rowH = LH(SIZE.note) + 0.04
  for (const maxLen of [16, 11, 8]) {
    const items = c.labels.map((l, i) => `${l.length > maxLen ? `${l.slice(0, maxLen - 1)}…` : l} ${c.values[i]}${c.unit} (${Math.round((c.values[i] / total) * 100)}%)`)
    const legendW = Math.max(...items.map((t) => labelW(t))) + sw + 0.1
    const legendH = items.length * rowH
    // 오른쪽에 범례
    let d = Math.min(h - 0.1, w - legendW - 0.2)
    let side = true
    if (d < 1.3) {
      // 아래에 범례 (두 줄 이상이면 그만큼 높이를 뺀다)
      side = false
      d = Math.min(w - 0.1, h - legendH - 0.15)
    }
    if (d < 1.1 || legendH > h) continue
    const ring = side ? { x, y: y + (h - d) / 2 } : { x: x + (w - d) / 2, y }
    const lx = side ? x + d + 0.2 : x + Math.max(0, (w - legendW) / 2)
    const ly = side ? y + (h - legendH) / 2 : y + d + 0.15
    const legend = items.flatMap((t, i) => [
      rect(lx, ly + i * rowH + 0.04, sw, sw, { fill: PIE_COLORS[i % PIE_COLORS.length] }),
      text(lx + sw + 0.08, ly + i * rowH, legendW - sw - 0.08 + 0.05, LH(SIZE.note), SIZE.note, t),
    ])
    return { ring: { ...ring, w: d, h: d }, legend, ok: true }
  }
  return { ring: { x, y, w: Math.min(w, h), h: Math.min(w, h) }, legend: [], ok: false }
}

function chartBox(els, x, y, w, h, c) {
  // 11/25 팀 검수: 「선택 이유」 · 「다른 형태로 보기」 줄은 뺌 — 그래프 밑은 출처 · 기준 시점 한 줄만 (보고서팀 양식과 같게)
  const caption = `출처: ${c.source} · 기준 시점: ${c.asOf}`
  els.push(rect(x, y, w, h, { line: COLOR.line, radius: 0.1 }))
  els.push(text(x + 0.15, y + 0.1, w - 0.3, LH(SIZE.body), SIZE.body, c.title, { bold: true }))
  const capH = linesOf(caption, SIZE.note, w - 0.3) * LH(SIZE.note)
  const top = y + 0.18 + LH(SIZE.body)
  const chartH = h - 0.36 - LH(SIZE.body) - capH
  if (enoughData(c.kind, c.values)) {
    const cw = w - 0.24
    const el = { t: 'chart', kind: c.kind, x: x + 0.12, y: top, w: cw, h: chartH, labels: c.labels, values: c.values, xTitle: c.xTitle, yTitle: c.yTitle, unit: c.unit, empty: c.empty }
    if (c.kind === 'donut') {
      const lay = donutLayout(els, c, x + 0.12, top, cw, chartH)
      Object.assign(el, lay.ring, { ok: lay.ok, legendOutside: true })
      els.push(el, ...lay.legend)
      els.push(text(x + 0.15, y + h - 0.1 - capH, w - 0.3, capH, SIZE.note, caption, { color: COLOR.sub }))
      return
    } else if (c.kind === 'line' || c.kind === 'vbar' || c.kind === 'grouped') {
      const ax = axisLayout(c.labels, cw - 0.55) // 세로축 숫자 · 제목 자리 빼고
      Object.assign(el, ax)
      // 그림 영역이 너무 작아지면(라벨 여백 때문에) 겹침으로 본다
      el.ok = ax.ok && chartH - ax.labelPad - LH(SIZE.note) - 0.2 >= 1.0
    } else el.ok = sideFits(c, cw)
    els.push(el)
  } else {
    // 수치가 모자라면 그래프 없이 글로 (수치를 만들어 내지 않음)
    const lines = c.values.length ? c.labels.map((l, i) => `${l}: ${c.values[i]}${c.unit}`) : [c.empty]
    const body = `수치가 부족해 그래프 없이 씀\n${lines.join('\n')}`
    els.push(text(x + 0.15, top + 0.1, w - 0.3, Math.min(chartH, linesOf(body, SIZE.body, w - 0.3) * LH(SIZE.body)), SIZE.body, [{ text: '수치가 부족해 그래프 없이 씀\n', color: COLOR.sub }, { text: lines.join('\n') }]))
    c.kind = 'text'
  }
  els.push(text(x + 0.15, y + h - 0.1 - capH, w - 0.3, capH, SIZE.note, caption, { color: COLOR.sub }))
}

// main 보고서 → 엔진 brief (11/14 통합). 사실/AI 구분과 근거 번호를 지우지 않게 문장 뒤에 붙인다
function briefFromMain(report) {
  const imp = (report.sections?.implications?.bullets ?? []).filter((b) => !b.excluded)
  const h = report.headline
  if (!h?.text && !imp.some((b) => b.tag)) return null
  const line = (b) => `${fixEnding(clean(b.text))}${refLabel(b.refs)}${kindOf(b) === 'fact' ? '' : ' (AI 해설)'}`
  const pick = (tag) => imp.filter((b) => b.tag === tag)
  return {
    fromMain: true,
    headline: h?.text ? `${clean(h.text)}${refLabel(h.refs)}${!h.refs?.length || h.kind === 'ai' || h.numCheck?.length ? ' (AI 해설 · 확인 필요)' : ''}` : '',
    opportunities: pick('기회').map(line),
    threats: pick('위협').map(line),
    actions: pick('할 일').map((b) => ({ what: line(b), when: b.when ?? '' })),
    usedTexts: imp.filter((b) => b.tag).map((b) => fixEnding(clean(b.text))),
  }
}

export function reportPages(saved, extra = {}) {
  fixedCount = 0
  const { report } = saved
  const brief = report.brief ?? briefFromMain(report)
  const usedTagged = new Set(brief?.usedTexts ?? [])
  const base = saved.articles.filter((a) => !a.supplement && !a.analysis)
  const added = saved.articles.filter((a) => a.supplement).length // 보충 자료만 ([분석] 근거는 세지 않음)
  const sources = [...new Set(base.map((a) => a.source).filter(Boolean))]
  // 수집 기간은 기사 날짜로만, 논문은 연도 범위를 따로 (11/17, 40 문서 R8: 논문이 섞이면 「2024-06-01 ~ 2026-06-01」처럼 보였음)
  const nt = base.filter((a) => !a.paper).map((a) => Date.parse(a.publishedAt)).filter(Number.isFinite)
  const py = base.filter((a) => a.paper).map((a) => new Date(a.publishedAt).getFullYear()).filter(Number.isFinite)
  const paperPart = py.length ? `${base.some((a) => a.patent) ? (base.some((a) => a.paper && !a.patent) ? '논문 · 특허' : '특허') : '논문'} ${Math.min(...py)}${Math.max(...py) !== Math.min(...py) ? `~${Math.max(...py)}` : ''}` : ''
  const withPapers = (t) => [t, paperPart].filter(Boolean).join(' · ')
  const period = nt.length ? withPapers(`${md(Math.min(...nt))} ~ ${md(Math.max(...nt))}`) : paperPart || String(saved.periodLabel ?? '').replace(/\s*기사$/, '') || '-'
  const periodFull = nt.length ? withPapers(`${ymd(Math.min(...nt))} ~ ${ymd(Math.max(...nt))}`) : period
  const meta = {
    title: report.title || '테크 동향 브리핑',
    date: ymd(saved.createdAt ?? Date.now()),
    dept: report.dept ?? '',
    period,
    periodFull,
    base: base.length,
    added,
    media: sources.length,
    sources,
    keywords: reportKeywords(saved),
    direction: report.direction ?? '',
  }
  const notes = []

  // ── 섹션별 사실 · AI 줄 ──
  const seen = new Set()
  const sec = {}
  for (const key of ['summary', 'tech', 'industry', 'implications']) {
    sec[key] = { facts: [], ai: [] }
    for (const b of report.sections[key]?.bullets ?? []) {
      if (b.excluded) continue
      const t = fixEnding(clean(b.text))
      if (!t || seen.has(t)) continue
      if (key === 'implications' && usedTagged.has(t)) continue // 1페이지 기회 · 위협 · 할 일로 이미 씀
      seen.add(t)
      const line = { text: t, refs: b.refs ?? [], supplement: b.supplement ?? null, ...((key === 'tech' || key === 'industry') && b.role ? { role: b.role } : {}) }
      if (kindOf(b) === 'fact') sec[key].facts.push(line)
      else sec[key].ai.push(line)
    }
  }
  // 유첨은 배경 → 쟁점 → 전망 순으로 (칸 표시가 없는 줄은 뒤, 원래 순서 유지)
  const ROLE_ORDER = { 배경: 0, 쟁점: 1, 전망: 2 }
  for (const key of ['tech', 'industry']) for (const part of ['facts', 'ai']) sec[key][part].sort((a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3))
  const allFacts = Object.values(sec).flatMap((s) => s.facts)
  const headline = fixEnding(brief?.headline || sec.summary.facts[0]?.text || allFacts[0]?.text || meta.title)
  const judgment = brief?.judgment?.type ? { type: brief.judgment.type, reason: fixEnding(brief.judgment.reason || '판단 근거 검토 필요') } : null
  const opps = (brief?.opportunities ?? []).map(fixEnding)
  const threats = (brief?.threats ?? []).map(fixEnding)
  const actions = (brief?.actions ?? []).map((a) => ({ what: brief.fromMain ? a.what : fixEnding(a.what), when: a.when || (brief.fromMain ? '' : '시점 검토 필요') }))
  if (!brief) notes.push('예전 형식 보고서라 헤드라인 · 기회/위협 · 할 일이 없어 사실 줄로 대신함')

  const pages = []
  const factN = Object.values(sec).reduce((n, s) => n + s.facts.length, 0)
  const aiN = Object.values(sec).reduce((n, s) => n + s.ai.length, 0)

  // ════ 1쪽 핵심 요약 ════
  {
    const els = []
    chrome(els, meta, null)
    els.push(text(PAGE.w - M - 3, 0.5, 3, LH(SIZE.note), SIZE.note, `보고일 ${meta.date}${meta.dept ? ` · ${meta.dept}` : ''}`, { align: 'right', color: COLOR.sub }))
    els.push(text(M, 0.72, 5.2, LH(SIZE.title), SIZE.title, meta.title, { bold: true }))
    els.push(text(PAGE.w - M - 3.8, 0.72 + LH(SIZE.title) - LH(SIZE.note), 3.8, LH(SIZE.note), SIZE.note, `수집 기간 ${meta.period}  |  ${evidenceLabel(saved)}`, { align: 'right', color: COLOR.sub }))
    els.push({ t: 'line', x: M, y: 0.72 + LH(SIZE.title) + 0.08, w: CW, color: COLOR.line })
    let y = 0.72 + LH(SIZE.title) + 0.18
    if (meta.direction) {
      const n = linesOf(`방향: ${meta.direction}`, SIZE.body, CW - 0.2)
      els.push(rect(M, y, 0.05, n * LH(SIZE.body), { fill: COLOR.ink }))
      els.push(text(M + 0.15, y, CW - 0.15, n * LH(SIZE.body), SIZE.body, [{ text: '방향: ', bold: true }, { text: meta.direction }]))
      y += n * LH(SIZE.body) + 0.12
    }
    // 11/20: 3줄까지는 칸을 늘려 글이 칸 밖으로 나가지 않게 (관리 페이지에서 제목 글자를 키우면 2줄을 넘기 쉬움). 2줄 넘음 표시(hlOver)는 그대로
    const hlLines = Math.min(3, linesOf(headline, SIZE.title, CW - 0.4))
    const hlH = hlLines * LH(SIZE.title) + 0.22
    els.push(rect(M, y, CW, hlH, { fill: COLOR.pink, radius: 0.1 }))
    els.push(rect(M + 0.15, y + 0.13, 0.07, hlH - 0.26, { fill: COLOR.accent }))
    els.push(text(M + 0.32, y + 0.11, CW - 0.45, hlLines * LH(SIZE.title), SIZE.title, headline, { bold: true, color: COLOR.accent }))
    const hlOver = linesOf(headline, SIZE.title, CW - 0.4) > 2
    y += hlH + 0.14

    const srcY = FOOT_Y - 0.5
    // 한 줄 요약 (11/17, 보고서팀 양식 본문 맨 아래 칸): 있으면 출처 줄 위에 한 줄. 양식처럼 50자(낱말 단위)로 줄임
    const oneLine = report.oneLine ? cutWords(report.oneLine, 50) : ''
    const oneY = srcY - 0.46
    const colTop = y
    const colH = (oneLine ? oneY : srcY) - 0.1 - colTop
    const colW = (CW - 0.2) / 2
    const innerW = colW - 0.3

    // 왼쪽: 핵심 사실 및 근거 (근거 2건 이상 먼저) + AI 해설
    // 핵심 요약 사실을 근거 많은 순으로. 2줄이 안 되면 업계 동향 · 기술 개요 사실로 채움 (그 쪽에도 그대로 남음)
    const byRefs = (a, b) => Math.min(b.refs.length, 2) - Math.min(a.refs.length, 2)
    // 헤드라인과 같은 문장은 1쪽 목록에서 빼고 (기술 개요 등 다른 쪽에는 그대로)
    const sameAsHead = (f) => norm(f.text) === norm(headline) || norm(headline).includes(norm(f.text)) || norm(f.text).includes(norm(headline))
    const ranked = sec.summary.facts.filter((f) => !sameAsHead(f)).sort(byRefs)
    if (ranked.length < 2) ranked.push(...[...sec.industry.facts, ...sec.tech.facts].filter((f) => !sameAsHead(f)).sort(byRefs).slice(0, 2 - ranked.length))
    const leftAi = sec.summary.ai.slice(0, 2)
    const aiH = aiBoxHeight(innerW, leftAi)
    const room = colH - 0.6 - (aiH ? aiH + 0.1 : 0)
    const leftFacts = []
    let used = 0
    for (const f of ranked) {
      const h = factHeight(innerW, f) + 0.07
      if (leftFacts.length >= 4 || used + h > room) break
      leftFacts.push(f)
      used += h
    }
    const movedFacts = sec.summary.facts.filter((f) => !leftFacts.includes(f) && !sameAsHead(f))
    els.push(rect(M, colTop, colW, colH, { line: COLOR.pinkLine, radius: 0.12 }))
    els.push(text(M + 0.15, colTop + 0.12, innerW, LH(SIZE.sub), SIZE.sub, '핵심 사실 및 근거', { bold: true }))
    els.push({ t: 'line', x: M + 0.15, y: colTop + 0.18 + LH(SIZE.sub), w: innerW, color: COLOR.line })
    let ly = colTop + 0.3 + LH(SIZE.sub)
    if (!leftFacts.length) {
      els.push(text(M + 0.15, ly, innerW, LH(SIZE.body), SIZE.body, '기사로 확인된 사실 없음', { color: COLOR.sub }))
    }
    for (const f of leftFacts) ly += factLine(els, M + 0.15, ly, innerW, f) + 0.07
    if (leftAi.length) aiBox(els, M + 0.15, colTop + colH - 0.12 - aiH, innerW, leftAi)

    // 오른쪽: 시사점 및 제언 — 기회 / 위협 + AI 해설
    const rx = M + colW + 0.2
    els.push(rect(rx, colTop, colW, colH, { line: COLOR.pinkLine, radius: 0.12 }))
    els.push(text(rx + 0.15, colTop + 0.12, innerW, LH(SIZE.sub), SIZE.sub, '시사점 및 제언', { bold: true }))
    els.push({ t: 'line', x: rx + 0.15, y: colTop + 0.18 + LH(SIZE.sub), w: innerW, color: COLOR.line })
    let ry = colTop + 0.3 + LH(SIZE.sub)
    const labelW = 1.05
    const rows = brief
      ? [
          ['↑ 기회', '(Opportunities)', opps, COLOR.pink, COLOR.accent],
          ['↓ 위협', '(Threats)', threats, COLOR.gray, COLOR.grayInk],
          // 담당자 양식: 1페이지에 할 일까지 (11/14 통합)
          ...(brief.fromMain ? [['→ 할 일', '(Actions)', actions.map((a) => (a.when ? `${a.what} — ${a.when}` : a.what)), COLOR.gray, COLOR.ink]] : []),
        ]
      : []
    const rightAi = sec.implications.ai.slice(0, 2)
    const raiH = aiBoxHeight(innerW, rightAi)
    for (const [lab, en, list, bg, fg] of rows) {
      const items = list.length ? list : ['기사에 근거 없음 — 검토 필요']
      const h = Math.max(0.62, items.reduce((s, t) => s + bulletHeight(innerW - labelW - 0.1, t) + 0.03, 0) + 0.12)
      if (ry + h > colTop + colH - 0.12 - (raiH ? raiH + 0.08 : 0)) break
      els.push(rect(rx + 0.15, ry, labelW, h, { fill: bg, radius: 0.08 }))
      els.push(text(rx + 0.15, ry + h / 2 - LH(SIZE.body) + 0.02, labelW, LH(SIZE.body), SIZE.body, lab, { bold: true, color: fg, align: 'center' }))
      els.push(text(rx + 0.15, ry + h / 2 + 0.02, labelW, LH(SIZE.note), SIZE.note, en, { color: fg, align: 'center' }))
      let iy = ry + 0.06
      for (const t of items) iy += bulletLine(els, rx + 0.25 + labelW, iy, innerW - labelW - 0.1, [{ text: t, color: list.length ? undefined : COLOR.sub }]) + 0.03
      ry += h + 0.1
    }
    if (!brief) {
      const fallback = [...sec.implications.facts].slice(0, 3)
      for (const f of fallback) ry += factLine(els, rx + 0.15, ry, innerW, f) + 0.07
      if (judgment === null) els.push(text(rx + 0.15, ry, innerW, LH(SIZE.note), SIZE.note, '기회/위협 판단: 이 보고서 형식에는 없음 — 다시 만들면 들어감', { color: COLOR.sub }))
    }
    if (rightAi.length) aiBox(els, rx + 0.15, colTop + colH - 0.12 - raiH, innerW, rightAi)

    if (oneLine) {
      els.push(rect(M, oneY, CW, 0.38, { line: COLOR.accent, radius: 0.08 }))
      els.push(text(M + 0.15, oneY + 0.09, CW - 0.3, LH(SIZE.body), SIZE.body, [{ text: '한 줄 요약   ', bold: true, color: COLOR.accent }, { text: oneLine, bold: true }]))
    }
    // 출처 정보 줄
    els.push(rect(M, srcY, CW, 0.38, { fill: COLOR.gray, radius: 0.08 }))
    const srcRuns = [
      { text: '출처 정보   ', bold: true, color: COLOR.accent },
      { text: '수집 기간 ', bold: true },
      { text: `${meta.period}   ` },
      { text: '근거 자료 ', bold: true },
      { text: `${evidenceLabel(saved)}   ` },
      { text: '주요 출처 ', bold: true },
      { text: '' },
    ]
    // 한 줄에 들어가게 (11/17: 학술지 이름이 길어 두 줄로 넘침 · 11/25: 글자 수만 세서 여전히 띠 밖으로 넘침)
    // → 실제 폭을 재서 출처 수(3 → 1) · 곳마다 글자 수(20 → 10)를 줄인다
    const srcW = CW - 0.3
    const head = srcRuns.map((r) => r.text).join('')
    const srcList = (k, n) => `${sources.slice(0, k).map((x) => (x.length > n ? `${x.slice(0, n - 1)}…` : x)).join(', ')}${sources.length > k ? ` 외 ${sources.length - k}곳` : ''}`
    let srcText = srcList(1, 10)
    outer: for (const k of [3, 2, 1]) for (const n of [20, 14, 10]) if (fitsLine(head + srcList(k, n), SIZE.note, srcW)) { srcText = srcList(k, n); break outer }
    srcRuns[srcRuns.length - 1].text = srcText
    els.push(text(M + 0.15, srcY + 0.19 - LH(SIZE.note) / 2, CW - 0.3, LH(SIZE.note), SIZE.note, srcRuns, { color: COLOR.sub }))
    pages.push({ kind: 'cover', label: '1페이지 · 핵심 요약', els, fit: { hlOver, moved: movedFacts.length } })
    if (movedFacts.length) notes.push(`1쪽 분량으로 핵심 요약 사실 ${movedFacts.length}줄을 2쪽(기술 개요) 앞에 옮김`)

    sec.tech.facts.unshift(...movedFacts.map((f) => ({ ...f, from: 'summary' })))
  }

  // ════ 2 · 3 · 4쪽: 왼쪽 글 + 오른쪽 그래프 ════
  const kws = keywordCounts(saved).slice(0, 6)
  const bySource = new Map()
  for (const a of base) bySource.set(a.source || '매체 미상', (bySource.get(a.source || '매체 미상') ?? 0) + 1)
  const srcShare = [...bySource].sort((a, b) => b[1] - a[1])
  const kwKind = chooseChart('rank', kws.length)
  const srcKind = chooseChart('share', srcShare.length)
  const basisKind = chooseChart('share', 2)
  const asOf = `${meta.date} 보고서 (기사 ${meta.periodFull})`
  const charts = {
    tech: {
      title: '핵심 키워드 언급 빈도',
      kind: kwKind,
      labels: kws.map(([k]) => k),
      values: kws.map(([, n]) => n),
      xTitle: '핵심 키워드',
      yTitle: '언급 기사 수 (건)',
      unit: '건',
      empty: '요약 키워드 없음',
      reason: `많이 언급된 순위를 보여 주므로 ${CHART_NAME[kwKind]}`,
      source: `근거 기사 ${meta.base}건의 AI 요약 핵심 키워드 (기사 1건에 같은 말은 1번)`,
      asOf,
    },
    industry: {
      title: '매체별 기사 비중',
      kind: srcKind,
      labels: srcShare.map(([k]) => k),
      values: srcShare.map(([, n]) => n),
      xTitle: '매체',
      yTitle: '기사 수 (건)',
      unit: '건',
      empty: '매체 정보 없음',
      reason: srcKind === 'donut' ? `매체별 구성비(${srcShare.length}개)라 ${CHART_NAME.donut}` : `매체가 ${srcShare.length}개로 5개를 넘어 도넛 대신 순위를 보여 주는 ${CHART_NAME.hbar}`,
      source: `보고서 근거 기사 ${meta.base}건의 매체`,
      asOf,
      alt: srcKind === 'donut' ? `${CHART_NAME.hbar} (매체 순위 강조)` : '',
    },
    implications: {
      title: '보고서 문장 근거 비중',
      kind: basisKind,
      labels: ['기사 확인 사실', 'AI 해설·제안'],
      values: [factN, aiN],
      xTitle: '근거 종류',
      yTitle: '문장 수 (줄)',
      unit: '줄',
      empty: '문장 없음',
      reason: `보고서 문장 중 기사 확인 사실과 AI 해설의 구성비라 ${CHART_NAME.donut}`,
      source: '이 보고서 4개 섹션 문장 (뺀 줄 제외)',
      asOf: `${meta.date} 보고서`,
      alt: `${CHART_NAME.hbar} (줄 수 비교 강조)`,
    },
  }

  const sectionPage = (key, no, label) => {
    const leftW = 5.25
    const chartX = M + leftW + 0.25
    const chartW = CW - leftW - 0.25
    // 왼쪽 흐름: 쪽이 넘치면 「(계속)」 쪽으로
    const blocks = []
    if (key === 'implications') {
      if (judgment) {
        const tagColor = judgment.type === '기회' ? COLOR.accent : judgment.type === '위협' ? COLOR.grayInk : judgment.type === '검토 필요' ? COLOR.sub : COLOR.accent
        blocks.push({ head: '자사 판단' }, { runs: [{ text: `[${judgment.type}] `, bold: true, color: tagColor }, { text: judgment.reason }] })
      }
      if (brief) {
        blocks.push({ head: '↑ 기회 (Opportunities)' }, ...(opps.length ? opps : ['기사에 근거 없음 — 검토 필요']).map((t) => ({ runs: [{ text: t }] })))
        blocks.push({ head: '↓ 위협 (Threats)' }, ...(threats.length ? threats : ['기사에 근거 없음 — 검토 필요']).map((t) => ({ runs: [{ text: t }] })))
        blocks.push({ head: '할 일' }, ...actions.map((a) => ({ runs: [{ text: a.what }, ...(a.when ? [{ text: ` — ${a.when}`, bold: true }] : [])] })))
      }
      if (sec.implications.facts.length) blocks.push({ head: '기사 확인 사실' }, ...sec.implications.facts.map((f) => ({ fact: f })))
    } else {
      if (sec[key].facts.length) blocks.push(...sec[key].facts.map((f) => ({ fact: f })))
      else blocks.push({ runs: [{ text: '기사로 확인된 사실 없음', color: COLOR.sub }] })
    }
    // 상세 분석 (유첨 → 이 쪽 아래): 이슈별 배경 → 쟁점 → 전망
    if (key === 'industry' && brief?.analysis?.length) {
      blocks.push({ head: '이슈 분석 (배경 → 쟁점 → 전망)' })
      for (const a of brief.analysis) {
        blocks.push({ runs: [{ text: a.issue, bold: true }, { text: refLabel(a.refs), color: COLOR.sub }] })
        if (a.background) blocks.push({ runs: [{ text: '배경 ', bold: true }, { text: fixEnding(a.background) }], indent: true })
        if (a.point) blocks.push({ runs: [{ text: '쟁점 ', bold: true }, { text: fixEnding(a.point) }], indent: true })
        if (a.outlook) blocks.push({ runs: [{ text: '전망 ', bold: true }, { text: /\(추정\)$/.test(a.outlook) ? fixEnding(a.outlook) : `${fixEnding(a.outlook)} (추정)` }], indent: true })
      }
    }
    const ai = sec[key].ai
    const made = []
    let els = null
    let y = 0
    const start = () => {
      els = []
      made.push(els)
      chrome(els, meta, `${meta.title}  |  ${no}. ${label}`)
      y = pageTitle(els, made.length > 1 ? `${label} (계속)` : label)
    }
    start()
    for (const b of blocks) {
      const h = b.head ? LH(SIZE.sub) + 0.08 : b.fact ? factHeight(leftW, b.fact) + 0.08 : bulletHeight(leftW - (b.indent ? 0.25 : 0), runsText(b.runs)) + 0.05
      if (y + h > BOTTOM) start()
      if (b.head) {
        els.push(text(M, y, leftW, LH(SIZE.sub), SIZE.sub, b.head, { bold: true }))
        y += LH(SIZE.sub) + 0.08
      } else if (b.fact) y += factLine(els, M, y, leftW, b.fact) + 0.08
      else y += bulletLine(els, M + (b.indent ? 0.25 : 0), y, leftW - (b.indent ? 0.25 : 0), b.runs, SIZE.body, b.indent ? '·' : '•') + 0.05
    }
    if (ai.length) {
      const h = aiBoxHeight(leftW, ai)
      if (y + 0.06 + h > BOTTOM) start()
      aiBox(els, M, y + 0.06, leftW, ai)
    }
    // 첫 쪽 오른쪽에 그래프
    chartBox(made[0], chartX, 1.2, chartW, Math.min(4.6, BOTTOM - 1.2), charts[key])
    made.forEach((e, i) => pages.push({ kind: key, label: i ? `${label} (계속)` : label, els: e }))
  }
  sectionPage('tech', '유첨 1', '기술 개요')
  sectionPage('industry', '유첨 1', '업계 동향')
  // main 보고서는 시사점이 1페이지에 모두 있음 → 따로 쪽을 두지 않음 (예전 형식만)
  if (!brief?.fromMain) sectionPage('implications', '유첨', '시사점 및 제언')

  // ════ 유첨 2 분석 자료 (11/14 통합): 대시보드 분석 묶음의 규칙 숫자를 그래프로 — 35 문서 R3 · R6 · R9 ════
  // 11/17 (40 문서 R4): 기술 시계열 재료(v3 묶음)는 다음 장 「기술 시계열」로 — 한 장에 그래프 3개를 넣으니 축 · 글이 겹쳤음
  const drawBlocks = (els, y, leftW, blocks) => {
    for (const b of blocks) {
      // 굵은 글 · 영문 낱말 줄바꿈 때문에 어림보다 길어진다 → 폭을 90%로 잡아 높이를 어림 (11/17 렌더: 「주요 기업」 줄이 아래 제목과 겹침)
      const h = b.head ? LH(SIZE.sub) + 0.08 : bulletHeight(leftW * 0.9, runsText(b.runs)) + 0.05
      if (y + h > BOTTOM) break
      if (b.head) {
        els.push(text(M, y, leftW, LH(SIZE.sub), SIZE.sub, b.head, { bold: true }))
        y += LH(SIZE.sub) + 0.08
      } else y += Math.max(bulletLine(els, M, y, leftW, b.runs), h - 0.05) + 0.05
    }
  }
  // 연도별 수: 0인 해는 빠져 오므로 0으로 채우고 끝난 해까지 최근 12개
  const fillYears = (list, last) => {
    const have = new Map((list ?? []).filter((p) => p.y <= last).map((p) => [p.y, p.n]))
    if (!have.size) return []
    const from = Math.min(...have.keys())
    return Array.from({ length: last - from + 1 }, (_, i) => ({ y: from + i, n: have.get(from + i) ?? 0 })).slice(-12)
  }
  // 11/17 전 보고서는 묶음에 기술 시계열 칸이 없다 → 기억해 둔 묶음(extra.analysis)으로 채운다 (「분석 기준일」이 보고서 날짜와 다를 수 있음)
  const analysisList = (report.analysis ?? []).map((x) => (x && !x.papers && extra.analysis?.[x.keyword] ? { ...extra.analysis[x.keyword], ...x } : x))
  for (const an of analysisList.filter((x) => x && (x.patentYears?.length || x.competitors || x.stage || x.papers))) {
    const last = new Date(saved.createdAt ?? Date.now()).getFullYear() - 1
    const leftW = 4.3
    const cx = M + leftW + 0.25
    const cw = CW - leftW - 0.25
    const cv = an.competitors
    {
      const els = []
      chrome(els, meta, `${meta.title}  |  유첨 2. 분석 자료`)
      const y = pageTitle(els, `분석 자료 · ${an.keyword}`)
      const blocks = []
      if (an.stage?.stage) blocks.push({ head: '기술 단계 (규칙 판정)' }, { runs: [{ text: `[${an.stage.stage}] `, bold: true, color: COLOR.accent }, { text: an.stage.why ?? '' }] })
      if (an.stage?.thin) blocks.push({ runs: [{ text: '논문이 적어 참고용', color: COLOR.sub }] })
      if (cv?.verdict) blocks.push({ head: '자사 판정 (세부 기술 × 경쟁사 특허)' }, { runs: [{ text: `[${cv.verdict}] `, bold: true, color: COLOR.accent }, { text: `${cv.name} — ${cv.years}` }] })
      if (an.owners?.length) blocks.push({ head: '특허 출원인 상위' }, { runs: [{ text: an.owners.slice(0, 5).map((o) => `${o.word} ${o.count ?? ''}건`.trim()).join(' · ') }] })
      if (an.quotes?.length) {
        blocks.push({ head: '상용화 시점 언급 (원문 인용)' })
        for (const q of an.quotes.slice(0, 3)) blocks.push({ runs: [{ text: `「${String(q.text ?? '').slice(0, 90)}」`, color: COLOR.ink }, { text: ` — ${q.source ?? ''}`, color: COLOR.sub }] })
      }
      blocks.push({ runs: [{ text: '숫자는 테크브리프 특허 · 논문 DB에서 규칙으로 센 값 (AI가 만든 숫자 아님)', color: COLOR.sub }] })
      drawBlocks(els, y, leftW, blocks)
      const py = fillYears(an.patentYears, last)
      const patKind = chooseChart('trend', py.length)
      chartBox(els, cx, 1.2, cw, 2.75, {
        title: `「${an.keyword}」 특허 공개 수 (연도별)`,
        kind: patKind,
        labels: py.map((p) => String(p.y)),
        values: py.map((p) => p.n),
        xTitle: '연도',
        yTitle: '특허 수 (건)',
        unit: '건',
        empty: '특허 자료 없음',
        reason: `연도에 따른 변화(추이)라 ${CHART_NAME[patKind]}`,
        source: '테크브리프 디스플레이 특허 DB (같은 발명은 한 번 · 첫 공개 연도)',
        asOf: `${last}년까지`,
      })
      const comp = cv ? [{ name: '분야 전체', ratio: cv.field?.ratio }, ...(cv.companies ?? []).filter((c) => !c.unsure)].filter((c) => c.ratio != null) : []
      const compKind = chooseChart('rank', comp.length)
      chartBox(els, cx, 4.1, cw, BOTTOM - 4.1, {
        title: cv ? `${cv.name} 특허 증가 배수 (회사별)` : '경쟁사 특허 증가 배수',
        kind: compKind,
        labels: comp.map((c) => (c.own ? `${c.name} (자사)` : c.name)),
        values: comp.map((c) => c.ratio),
        xTitle: '회사',
        yTitle: '앞 3년 대비 (배)',
        unit: '배',
        empty: '경쟁사 특허 자료 없음',
        reason: `회사별 값을 나란히 비교하므로 ${CHART_NAME[compKind]}`,
        source: '테크브리프 디스플레이 특허 DB · 세부 기술 CPC',
        asOf: cv?.years ?? '-',
      })
      pages.push({ kind: 'analysis', label: `유첨 2 분석 자료 · ${an.keyword}`, els })
    }

    // 기술 시계열 (v3 묶음이 있는 보고서만): 논문 추이 · 늘어난 세부 주제 · 연구 폭 · 관심 대 실질 · 급증 · 신호 — 담당자 양식 PPT 유첨 5와 같은 내용
    const papY = fillYears(an.papers?.years, last)
    const pp = an.papers
    const up = (an.rising ?? []).filter((x) => x.recent >= 2)
    const br = an.breadth
    if (papY.length >= 2 || up.length || br?.institutions || an.attention || an.signal) {
      const els = []
      chrome(els, meta, `${meta.title}  |  유첨 2. 기술 시계열`)
      const y = pageTitle(els, `기술 시계열 · ${an.keyword}`)
      const blocks = []
      if (pp?.recent != null) {
        const span = String(pp.span ?? '').split(' 대 ')[0] || '최근 3년'
        blocks.push({ head: '논문 추이' }, { runs: [{ text: `${span} ${pp.recent}편` }, ...(pp.recent >= 10 && pp.growth != null ? [{ text: ` · 앞 3년의 ${pp.growth}배${pp.relGrowth != null ? ` (분야 전체보다 ${pp.relGrowth}배)` : ''}`, bold: true }] : [{ text: ` (앞 3년 ${pp.before ?? '-'}편 — 편수가 적어 배수는 쓰지 않음)`, color: COLOR.sub }])] })
      }
      if (up.length) {
        blocks.push({ head: '최근 논문에서 늘어난 세부 주제' })
        for (const x of up.slice(0, 4)) blocks.push({ runs: [{ text: `${x.name} ` }, { text: `${x.before}→${x.recent}편`, bold: true }] })
        if (an.makers?.length) blocks.push({ runs: [{ text: '주요 기업: ', bold: true }, { text: an.makers.slice(0, 3).map((m) => (m.length > 24 ? `${m.slice(0, 23)}…` : m)).join(' · ') }] })
      }
      if (br?.institutions) blocks.push({ head: `연구 폭 (${br.years})` }, { runs: [{ text: `논문 낸 기관 ${br.institutions}곳${br.companyShare != null ? ` · 기업 저자 ${Math.round(br.companyShare * 100)}%` : ''}${br.fwci != null ? ` · FWCI ${br.fwci}(참고)` : ''}` }] })
      if (an.attention?.label || an.surges?.length || an.signal?.score != null) blocks.push({ head: '관심 신호 (네이버 검색 관심도 · AI 입력 안 함)' })
      if (an.attention?.label) blocks.push({ runs: [{ text: an.attention.label, bold: true }, { text: ` — ${an.attention.basis}`, color: COLOR.sub }] })
      for (const x of an.surges ?? []) blocks.push({ runs: [{ text: `예상 밖 급증 ${x.t}: `, bold: true }, { text: `예상 최대 ${x.hi} → 실제 ${x.v}` }] })
      if (an.signal?.score != null) blocks.push({ runs: [{ text: '요즘 뜨는 기술 신호: ', bold: true }, { text: `${an.signal.score}점 · ${an.signal.grade}${an.signal.stage ? ` · ${an.signal.stage}` : ''}` }] })
      blocks.push({ runs: [{ text: `규칙으로 센 값 (AI가 만든 숫자 아님)${an.at ? ` · 분석 ${String(an.at).slice(0, 10)}` : ''} · 판단 기준 33 문서`, color: COLOR.sub }] })
      drawBlocks(els, y, leftW, blocks)
      const papKind = chooseChart('trend', papY.length)
      chartBox(els, cx, 1.2, cw, BOTTOM - 1.2, {
        title: `「${an.keyword}」 논문 수 (연도별)`,
        kind: papKind,
        labels: papY.map((p) => String(p.y)),
        values: papY.map((p) => p.n),
        xTitle: '연도',
        yTitle: '논문 수 (편)',
        unit: '편',
        empty: '논문 자료 없음',
        reason: `연도에 따른 변화(추이)라 ${CHART_NAME[papKind]}`,
        source: an.papers?.basis === 'openalex' ? 'OpenAlex 논문 수 (기술 단계 판정과 같은 값)' : '테크브리프 논문 DB (디스플레이 논문)',
        asOf: `${last}년까지`,
      })
      pages.push({ kind: 'analysis', label: `유첨 2 기술 시계열 · ${an.keyword}`, els })
    }
  }

  // ════ 5쪽 근거 기사 (부록) ════
  // 기사 수 추이: 수집 키워드 중 이 보고서와 맞는 것의 날짜별 기사 수(/api/trends) — 없으면 근거 기사 날짜별 수
  // 기간: 근거 기사 가장 이른 날 3일 전 ~ 보고서 만든 날 (최대 26주). 30일을 넘으면 주별로 묶는다 (11/12 가독성 규칙)
  const DAY = 86_400_000
  const dayOf = (t) => Date.parse(`${ymd(t, '-')}T00:00:00`)
  // 11/17: 제목 · 기사 제목에 든 말로 맞추면 「디스플레이」가 「마이크로디스플레이」 안에서 맞아 디스플레이 기사 전체가 그려짐
  // → 보고서 주제어(sources.topics · 분석 키워드)와 같거나 그것을 품은 수집 키워드만 (담당자 양식 PPT도 같은 규칙, server/reportToTemplate.js)
  const topics = [...(saved.report?.sources?.topics ?? []), ...(saved.report?.analysis ?? []).map((x) => x?.keyword)].map(norm).filter(Boolean)
  // 주제어가 든 모은 기사 수(/api/topic-trend)가 있으면 그것을 먼저 — 주제어가 수집 키워드가 아니어도 그릴 수 있음 (11/17)
  const topicItems = (extra.topic?.items ?? []).filter((it) => (it.news ?? []).length)
  const topicTotal = topicItems.reduce((n, it) => n + it.news.reduce((m, p) => m + p.v, 0), 0)
  const matched = topicTotal > 0 ? topicItems : (extra.trends?.items ?? []).filter((it) => it.keyword && (it.news ?? []).length && topics.some((t) => norm(it.keyword).includes(t)))
  const daily = new Map() // 'YYYY-MM-DD' → 기사 수 (빈 날은 0)
  // 논문 날짜(몇 해 전)는 기사 수 추이에서 뺀다 — 섞이면 기간이 몇 해로 늘어 막대가 수백 개가 됨 (11/17)
  const newsTimes = base.filter((a) => !a.paper).map((a) => Date.parse(a.publishedAt)).filter(Number.isFinite)
  let trendFrom = ''
  let start = 0
  let end = 0
  if (matched.length) {
    end = dayOf(saved.createdAt ?? Date.now()) - DAY // 끝난 날까지 (만든 날은 반나절, 11/17)
    // 시작: 근거 기사 가장 이른 날 3일 전 (논문 날짜는 빼고, 11/17). 기사가 없으면 주제어 기사 수는 28일 · 수집 키워드는 7일
    start = Math.max(newsTimes.length ? dayOf(Math.min(...newsTimes)) - 3 * DAY : end - (topicTotal > 0 ? 27 : 7) * DAY, end - 181 * DAY)
    for (let t = start; t <= end; t += DAY) daily.set(ymd(t, '-'), 0)
    for (const it of matched) for (const p of it.news) if (daily.has(p.t)) daily.set(p.t, daily.get(p.t) + p.v)
    trendFrom = topicTotal > 0 ? `「${matched.map((it) => it.keyword).join(', ')}」 든 모은 기사 수` : `수집 키워드 「${matched.map((it) => it.keyword).join(', ')}」 기사 수`
  } else if (newsTimes.length) {
    start = dayOf(Math.min(...newsTimes))
    end = dayOf(Math.max(...newsTimes))
    for (let t = start; t <= end; t += DAY) daily.set(ymd(t, '-'), 0)
    for (const a of base) if (!a.paper && a.publishedAt && daily.has(ymd(a.publishedAt, '-'))) daily.set(ymd(a.publishedAt, '-'), daily.get(ymd(a.publishedAt, '-')) + 1)
    trendFrom = '근거 기사 발행일별 수 (맞는 수집 키워드 없음)'
  }
  const mdShort = (key) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}` // M/D (예: 10/19)
  const weekly = daily.size > 30
  let trendLabels = []
  let trendValues = []
  if (weekly) {
    const keys = [...daily.keys()]
    for (let i = 0; i < keys.length; i += 7) {
      trendLabels.push(mdShort(keys[i]))
      trendValues.push(keys.slice(i, i + 7).reduce((n, k) => n + daily.get(k), 0))
    }
  } else {
    trendLabels = [...daily.keys()].map(mdShort)
    trendValues = [...daily.values()]
  }
  const trendKind = chooseChart('trend', trendValues.length)
  const trendChart = {
    title: '기사 수 추이',
    kind: trendKind,
    labels: trendLabels,
    values: trendValues,
    xTitle: weekly ? '주 (시작일 M/D)' : '날짜 (M/D)',
    yTitle: weekly ? '주간 기사 수 (건)' : '기사 수 (건)',
    unit: '건',
    empty: '날짜가 있는 기사 없음',
    reason: `날짜에 따른 기사 수 변화(추이)라 ${CHART_NAME.line}${weekly ? ` · 기간이 30일을 넘어(${daily.size}일) 주별로 묶음` : ''}`,
    source: `${trendFrom}${weekly ? ' · 주별 합계' : ' · 일별'}`,
    asOf: daily.size ? `${ymd(start)} ~ ${ymd(end)}` : meta.periodFull,
    alt: '가로 막대 (날짜별 개수 강조)',
  }
  {
    const listW = 5.35
    // 논문은 유료 여부 표시. 유료면 제목 · 저자 · 출처까지만 쓰고 그 뒤 자리에 안내 문구 + 원문 링크 (11/12 유료 논문 처리)
    const items = saved.articles.map((a, i) => {
      const access = paperAccess(a)
      const badge = a.analysis ? 'DB 분석 · 규칙 계산' : access ? ACCESS_LABEL[access] : a.supplement ? `보충 · ${a.supplement === 'wiki' ? '위키백과' : '수집 자료'}` : a.fulltext === false ? '발췌문 기준' : a.fulltext ? '원문 반영' : ''
      const who = a.authors?.length ? `${a.authors.slice(0, 3).join(', ')}${a.authors.length > 3 ? ' 외' : ''}  |  ` : ''
      // [분석] 근거: 날짜 · 링크 없음 → 출처만 (11/14)
      const metaText = a.analysis ? a.source ?? '테크브리프 분석' : `${who}${a.source ?? '-'}  |  ${a.publishedAt ? md(a.publishedAt) : '-'}`
      return { n: i + 1, title: a.title, meta: metaText, badge, url: a.analysis ? analysisUrl(saved, a) : (a.url ?? ''), analysis: Boolean(a.analysis), paid: access === 'paid' }
    })
    const made = []
    let els = null
    let y = 0
    const startRef = () => {
      els = []
      made.push(els)
      chrome(els, meta, `${meta.title}  |  유첨 3. 근거 자료`)
      y = pageTitle(els, made.length > 1 ? '근거 자료 (계속)' : '근거 자료')
      if (made.length === 1) {
        const note = 'AI 작성 초안 — 근거 자료 확인 후 수정 필요'
        els.push(rect(PAGE.w - M - 3.9, 0.6, 3.9, LH(SIZE.body) + 0.14, { fill: COLOR.pink, radius: 0.08 }))
        els.push(text(PAGE.w - M - 3.9, 0.67, 3.9, LH(SIZE.body), SIZE.body, note, { color: COLOR.accent, align: 'center' }))
      }
    }
    startRef()
    for (const it of items) {
      // 제목은 두 줄까지 (11/17: 세 줄 제목이 아래 출처 줄과 겹쳤음) — 넘치면 줄여 「…」
      let title = it.title
      // 굵은 영문 제목은 낱말 단위 줄바꿈 때문에 어림보다 길어진다 → 폭을 75%로 잡아 어림 (11/17 렌더 확인)
      const titleW = (listW - 0.45) * 0.75
      while (title.length > 10 && linesOf(title, SIZE.body, titleW) > 2) title = `${title.slice(0, -4).trimEnd()}…`
      const tl = Math.min(2, linesOf(title, SIZE.body, titleW))
      const notice = it.paid ? `${PAID_NOTICE}${it.url || '링크 없음'}` : ''
      const nl = notice ? linesOf(notice, SIZE.note, listW - 0.45) : 0
      const h = tl * LH(SIZE.body) + LH(SIZE.note) + nl * LH(SIZE.note) + 0.2
      if (y + h > BOTTOM) startRef()
      els.push(text(M, y, 0.4, LH(SIZE.body), SIZE.body, `[${it.n}]`, { bold: true }))
      els.push(text(M + 0.42, y, listW - 0.45, tl * LH(SIZE.body), SIZE.body, title, { bold: true }))
      const metaRuns = [{ text: it.meta, color: COLOR.sub }]
      if (it.badge) metaRuns.push({ text: `   ${it.badge}`, color: COLOR.accent, bold: true })
      els.push(text(M + 0.42, y + tl * LH(SIZE.body) + 0.03, listW - (it.url && !it.paid ? 1.45 : 0.45), LH(SIZE.note), SIZE.note, metaRuns)) // 링크 없는 줄은 「원문 열기」 자리까지 씀 (11/14)
      if (it.url && !it.paid) els.push(text(M + listW - 1.0, y + tl * LH(SIZE.body) + 0.03, 1.0, LH(SIZE.note), SIZE.note, [{ text: it.analysis ? '분석 열기 ↗' : '원문 열기 ↗', color: COLOR.accent, link: it.url }], { align: 'right' }))
      if (notice)
        els.push(
          text(M + 0.42, y + tl * LH(SIZE.body) + LH(SIZE.note) + 0.06, listW - 0.45, nl * LH(SIZE.note), SIZE.note, [
            { text: PAID_NOTICE, color: COLOR.sub },
            it.url ? { text: it.url, color: COLOR.accent, link: it.url } : { text: '링크 없음', color: COLOR.sub },
          ]),
        )
      els.push({ t: 'line', x: M, y: y + h - 0.06, w: listW, color: COLOR.line })
      y += h
    }
    // 오른쪽: 기사 수 추이 + 수집 · 분석 정보 (첫 쪽)
    const rx = M + listW + 0.25
    const rw = CW - listW - 0.25
    chartBox(made[0], rx, 1.2, rw, 3.55, trendChart)
    const info = [
      ['수집 기간', meta.periodFull],
      // 11/17: 「분석 기사 수」는 기사 · 논문 · 우리 분석이 섞인 이름이라 나눠 씀
      ['근거 자료', `${evidenceLabel(saved)} (총 ${saved.articles.length}건)`],
      ['주요 출처', `${sources.slice(0, 4).join(', ')}${sources.length > 4 ? ` 외 ${sources.length - 4}곳` : ''}`],
    ]
    const iy = 4.9
    const rowHs = info.map(([, v]) => Math.max(1, linesOf(v, SIZE.note, rw - 1.25)) * LH(SIZE.note) + 0.1)
    const ih = 0.2 + LH(SIZE.body) + rowHs.reduce((a, b) => a + b, 0) + 0.1
    made[0].push(rect(rx, iy, rw, Math.min(ih, BOTTOM - iy), { line: COLOR.line, radius: 0.1 }))
    made[0].push(text(rx + 0.15, iy + 0.1, rw - 0.3, LH(SIZE.body), SIZE.body, '수집·분석 정보', { bold: true }))
    made[0].push({ t: 'table', x: rx + 0.12, y: iy + 0.2 + LH(SIZE.body), w: rw - 0.24, cols: [1.0, rw - 1.24], rows: info.map((cells, i) => ({ cells, h: rowHs[i] })), size: SIZE.note, headCol: true })
    made.forEach((e, i) => pages.push({ kind: 'refs', label: i ? '근거 자료 (계속)' : '유첨 3 근거 자료', els: e }))
  }

  // 쪽 번호
  pages.forEach((p, i) => p.els.forEach((e) => e.t === 'pageno' && Object.assign(e, { no: i + 1 })))

  // ── 자체 검증 체크리스트 ──
  const cover = pages[0]
  const allText = pages.flatMap((p) => p.els.filter((e) => e.t === 'text').map((e) => runsText(e.runs)))
  const bad = allText.filter((t) => t.length > 6 && forbiddenIn(t) && !/^\[|^출처|수집|보고일/.test(t))
  const coverFacts = cover.els.filter((e) => e.t === 'check').length
  const usedRefs = [...new Set(Object.values(sec).flatMap((s) => s.facts.flatMap((f) => f.refs)))]
  const chartsAll = pages.flatMap((p) => p.els.filter((e) => e.t === 'chart'))
  const textCharts = [charts.tech, charts.industry, charts.implications, trendChart].filter((c) => c.kind === 'text').length
  const multiOnCover = [...sec.summary.facts, ...sec.industry.facts, ...sec.tech.facts].filter((f) => f.refs.length >= 2).length
  const checks = [
    { label: '슬라이드 비율 4:3, 가로형', ok: true, note: '10 × 7.5in' },
    { label: '핵심 요약이 1장', ok: !cover.fit.hlOver, note: cover.fit.moved ? `넘친 사실 ${cover.fit.moved}줄은 2쪽으로` : '' },
    { label: '18/14/11/10pt 외 크기 없음', ok: pages.every((p) => p.els.every((e) => (!e.size || Object.values(SIZE).includes(e.size)) && (!e.runs || e.runs.every((r) => !r.size || Object.values(SIZE).includes(r.size))))) },
    { label: '모든 텍스트에 latin=Arial Narrow, ea=LG 스마트체 지정', ok: true, note: 'PPT는 글자마다 지정 · 화면/PDF는 그 글꼴이 설치된 PC에서 적용' },
    { label: '금지 어미(~합니다/~습니다/~입니다/~한다/~이다) 0건', ok: bad.length === 0, note: `${fixedCount ? `규칙으로 ${fixedCount}건 고침` : ''}${bad.length ? `${fixedCount ? ' · ' : ''}남은 ${bad.length}건: 「${bad[0].slice(-20)}」` : ''}` },
    { label: '핵심 사실에 근거 기사 번호 포함', ok: coverFacts > 0 && allFacts.every((f) => f.refs.length), note: `1쪽 사실 ${coverFacts}개 · 근거 2건 이상 사실 ${multiOnCover}개` },
    { label: '사실의 기사 번호가 전부 근거 기사 목록에 존재', ok: usedRefs.every((n) => n >= 1 && n <= saved.articles.length) },
    { label: '기회/위협 + 할 일 2~3개 존재', ok: Boolean(brief) && opps.length + threats.length > 0 && actions.length >= 2 && actions.length <= 3, note: brief ? `기회 ${opps.length} · 위협 ${threats.length} · 할 일 ${actions.length}` : '예전 형식 — 다시 만들면 들어감' },
    { label: '출처에 수집 기간·기사 수 존재', ok: meta.period !== '-' && meta.base > 0 },
    { label: '그래프마다 출처 · 기준 시점 · 축 단위 표기', ok: chartsAll.every((c) => c.xTitle && c.yTitle), note: [...chartsAll.map((c) => CHART_NAME[c.kind]), ...(textCharts ? [`수치 부족으로 글 ${textCharts}개`] : [])].join(' · ') },
    {
      label: '그래프 라벨 · 축 제목 · 범례 · 값 겹침 없음 (가로축 라벨 7개 이하)',
      ok: chartsAll.every((c) => c.ok !== false && (!c.ticks || c.ticks.length <= MAX_TICKS)),
      note: chartsAll
        .filter((c) => c.ticks)
        .map((c) => `${c.labels.length}점 중 라벨 ${c.ticks.length}개${c.rotate ? ' · 45도' : ''}`)
        .join(' · '),
    },
    { label: '텍스트 박스 밖으로 넘친 글자 없음', ok: !cover.fit.hlOver, note: cover.fit.hlOver ? '헤드라인이 2줄을 넘음' : '' },
  ]
  // moved: 1쪽에 못 들어가 2쪽(기술 개요)으로 옮긴 핵심 사실 — 서버 「PPT로 저장」은 1쪽만 쓰므로 유첨 1로 받는다 (11/25)
  return { meta, pages, checks, notes, trendChart, moved: sec.tech.facts.filter((f) => f.from === 'summary') }
}
