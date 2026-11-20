// 테크브리프 보고서 PPT 양식 (11/14 담당자 확정 양식: 4:3 가로형 · 본문 1장 + 유첨 4장)
//
//   node scripts/report-template.mjs                         → templates/report-template.pptx (빈 양식)
//   node scripts/report-template.mjs data.json out.pptx      → data.json(보고서 프롬프트 STEP 1 JSON)으로 채운 보고서
//
// 빈 양식: 칸 · 제목 · 테두리 · 고정 글자는 슬라이드 레이아웃에, 내용 자리는 이름 붙은 개체 틀(placeholder)로 둔다.
//   PowerPoint에서 개체 틀을 눌러 AI 요약을 붙여 넣으면 같은 자리 · 같은 글자 크기로 들어간다.
// 채운 보고서: 같은 레이아웃 · 같은 자리에 JSON 값을 넣는다 → 같은 JSON이면 매번 같은 파일
//
// 규격 (docs/08 5-4): 글자 18 / 14 / 11 / 10pt만, 한글 LG 스마트체 · 영문 Arial Narrow(ea · latin 둘 다 지정),
//   색은 강조색(레드) + 기회(초록) / 위협(주황) 표시색만, 장식 아이콘 없음, 그래프는 단색(가로막대 · 세로막대 · 꺾은선)
// 화면 보고서(src/reportSlides.js)와 같은 칸 구성이다. 자리(인치)는 이 파일의 L 값이 기준
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FONT = { latin: 'Arial Narrow', ea: 'LG 스마트체' }
const SIZE = { title: 18, sub: 14, body: 11, note: 10 }
const C = { ink: '111111', sub: '555555', line: 'DDDDDD', accent: 'A50034', pink: 'FDECF0', gray: 'F2F2F3', opp: '1A7F37', threat: 'B54708', white: 'FFFFFF' }
const LH = (pt) => (pt * 1.35) / 72

// ── 자리 (인치) ──
const M = 0.5
const CW = 9
const GAP = 0.14
const CELL_W = (CW - GAP) / 2 // 4.43
const PAD = 0.15
const BAND_H = 0.33
const HEAD = 0.06 + BAND_H + 0.08 // 칸 위에서 글이 시작하는 곳
const L = {
  title: { x: M, y: 0.45, w: 6.4, h: 0.42 },
  byline: { x: 6.9, y: 0.45, w: 2.6, h: 0.42 },
  rule: 0.92,
  headline: { x: M, y: 1.04, w: CW, h: 0.64 },
  gridTop: 1.82,
  rows: [2.02, 2.28], // 위 줄(기술 개요 · 업계 동향) · 아래 줄(추이 · 시사점)
  source: { x: M, y: 6.4, w: CW, h: 0.2 },
  summary: { x: M, y: 6.64, w: CW, h: 0.4 },
  foot: 7.12,
}
const ROW_Y = [L.gridTop, L.gridTop + L.rows[0] + GAP]
const COL_X = [M, M + CELL_W + GAP]
const IN_W = CELL_W - 2 * PAD
const ROWS_SRC = 20 // 유첨 3 표 줄 수 (한 장)
const ROWS_SUM = 11 // 유첨 4 표 줄 수 (한 장)
const T5 = { textW: 4.2 } // 유첨 5 왼쪽 글 칸 폭

const base = { fontFace: FONT.latin, color: C.ink, margin: 0, valign: 'top', paraSpaceBefore: 0, paraSpaceAfter: 0, isTextBox: true }
const ph = (name, pos, size, prompt, opts = {}) => ({
  placeholder: { options: { name, type: 'body', ...pos, fontFace: FONT.latin, fontSize: size, color: C.ink, margin: 0, valign: 'top', ...opts }, text: prompt },
})
const box = (x, y, w, h, opts) => ({ rect: { x, y, w, h, ...opts } })
const label = (text, x, y, w, h, size, opts = {}) => ({ text: { text, options: { ...base, x, y, w, h, fontSize: size, ...opts } } })

// 칸: 둥근 테두리 + 연분홍 제목 띠 + 제목 (아이콘 없음). 레이아웃 objects의 rect는 모서리를 줄 수 없어 슬라이드에 그린다
function drawCard(slide, pres, x, y, w, h, title, note) {
  slide.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.1, line: { color: C.line, width: 1 }, fill: { color: C.white }, objectName: `칸 ${title}` })
  slide.addShape(pres.ShapeType.roundRect, { x: x + 0.06, y: y + 0.06, w: w - 0.12, h: BAND_H, rectRadius: 0.06, fill: { color: C.pink }, line: { type: 'none' }, objectName: `칸 제목 띠 ${title}` })
  slide.addText([{ text: title, options: { bold: true, fontSize: SIZE.sub } }, ...(note ? [{ text: `   ${note}`, options: { fontSize: SIZE.note, color: C.sub } }] : [])], { ...base, x: x + PAD + 0.05, y: y + 0.06 + 0.03, w: w - 2 * PAD, h: LH(SIZE.sub), objectName: `칸 제목 ${title}` })
}

function footer() {
  return [label('테크브리프', M, L.foot, 3, LH(SIZE.note), SIZE.note, { bold: true })]
}
const slideNumber = { x: CW + M - 1, y: L.foot, w: 1, h: LH(SIZE.note), fontFace: FONT.latin, fontSize: SIZE.note, color: C.ink, bold: true, align: 'right' }

// ── 레이아웃 (슬라이드 틀) ──
function defineLayouts(pres) {
  const cell = (r, c) => ({ x: COL_X[c] + PAD, y: ROW_Y[r] + HEAD, w: IN_W, h: L.rows[r] - HEAD - 0.1 })
  // 본문
  pres.defineSlideMaster({
    title: '본문',
    background: { color: C.white },
    objects: [
      { line: { x: M, y: L.rule, w: CW, h: 0, line: { color: C.ink, width: 1 } } },
      box(L.headline.x, L.headline.y, L.headline.w, L.headline.h, { fill: { color: C.pink }, line: { type: 'none' } }),
      box(L.headline.x, L.headline.y, 0.08, L.headline.h, { fill: { color: C.accent }, line: { type: 'none' } }),
      label('④ 출처', L.source.x, L.source.y, 0.7, L.source.h, SIZE.note, { bold: true }),
      box(L.summary.x, L.summary.y, L.summary.w, L.summary.h, { fill: { color: C.white }, line: { color: C.accent, width: 1.25 } }),
      label('한 줄 요약', L.summary.x + 0.15, L.summary.y + 0.09, 1.0, LH(SIZE.body), SIZE.body, { bold: true, color: C.accent }),
      ...footer(),
      ph('title', L.title, SIZE.title, '보고 제목 (18pt)', { bold: true, valign: 'bottom' }),
      ph('byline', L.byline, SIZE.note, '작성일 YYYY.MM.DD\n작성부서 ○○', { align: 'right', valign: 'bottom', color: C.sub }),
      ph('headline', { x: L.headline.x + 0.25, y: L.headline.y + 0.08, w: L.headline.w - 0.4, h: L.headline.h - 0.16 }, SIZE.sub, '① 헤드라인: 결론 핵심 1문장, 최대 2줄 (14pt 굵게)', { bold: true, color: C.accent, valign: 'middle' }),
      ph('facts_tech', cell(0, 0), SIZE.body, '② 핵심 사실 근거 — 기술 내용 · 원리 · 성능 · 공정\n• 사실 1문장 [#01, #04] (근거 기사 2건 이상만)'),
      ph('facts_industry', cell(0, 1), SIZE.body, '② 핵심 사실 근거 — 회사 · 제품 · 투자 · 공급 · 특허 · 시장\n• 사실 1문장 [#02, #03] (근거 기사 2건 이상만)'),
      ph('trend_caption', { x: COL_X[0] + PAD, y: ROW_Y[1] + L.rows[1] - 0.1 - LH(SIZE.note), w: IN_W, h: LH(SIZE.note) }, SIZE.note, '※ 출처 · 데이터 기간 (한 줄)', { color: C.sub }),
      ph('change_basis', { x: COL_X[0] + PAD + 2.85 + 0.1, y: ROW_Y[1] + HEAD + 0.1 + 0.36, w: 1.08, h: LH(SIZE.note) }, SIZE.note, '전일 대비', { color: C.sub }),
      ph('change_value', { x: COL_X[0] + PAD + 2.85 + 0.1, y: ROW_Y[1] + HEAD + 0.1 + 0.36 + LH(SIZE.note), w: 1.08, h: 0.42 }, SIZE.sub, '+00.0%', { bold: true, color: C.accent }),
      ph('judgment', { x: COL_X[1] + PAD, y: ROW_Y[1] + HEAD, w: IN_W, h: 2 * LH(SIZE.body) }, SIZE.body, '자사 판단  [기회 / 위협 / 기회·위협 공존 / 검토 필요] 판단 근거 1줄'),
      ph('actions', { x: COL_X[1] + PAD, y: ROW_Y[1] + HEAD + 2 * LH(SIZE.body) + 0.14 + LH(SIZE.body) + 0.04, w: IN_W, h: L.rows[1] - HEAD - (2 * LH(SIZE.body) + 0.14 + LH(SIZE.body) + 0.04) - 0.1 }, SIZE.body, '• 무엇을 — 우선순위 또는 시점 (2~3개)'),
      ph('source', { x: L.source.x + 0.7, y: L.source.y, w: L.source.w - 0.7, h: L.source.h }, SIZE.note, '수집 기간 YYYY.MM.DD~YYYY.MM.DD | 기사 N건 | 매체 M곳 | 키워드: ○○'),
      ph('summary', { x: L.summary.x + 1.15, y: L.summary.y + 0.09, w: L.summary.w - 1.3, h: L.summary.h - 0.14 }, SIZE.body, '본문 전체를 한 문장으로 (헤드라인과 다른 문장, 최대 2줄)', { bold: true }),
    ],
    slideNumber,
  })

  // 유첨 공통: 제목(18pt 고정 글자) + 아래 줄
  const appendix = (name, title, extra = []) =>
    pres.defineSlideMaster({
      title: name,
      background: { color: C.white },
      objects: [label(title, M, M, CW, LH(SIZE.title), SIZE.title, { bold: true }), { line: { x: M, y: M + LH(SIZE.title) + 0.06, w: CW, h: 0, line: { color: C.ink, width: 1 } } }, ...footer(), ...extra],
      slideNumber,
    })
  const top = M + LH(SIZE.title) + 0.18
  appendix('유첨 1', '유첨 1. 상세 분석', [
    ph('analysis', { x: M, y: top, w: CW, h: L.foot - 0.1 - top }, SIZE.note, '이슈별 배경 → 쟁점 → 전망 [#NN]\n· 배경  …\n· 쟁점  …\n· 전망  … (추정)\n근거 기사 1건뿐인 사실 · 본문에서 옮긴 사실'),
  ])
  appendix('유첨 3', '유첨 3. 출처 목록', [ph('omitted', { x: M, y: L.foot - 0.32, w: CW, h: LH(SIZE.note) }, SIZE.note, '외 N건 (한 장을 넘어 생략 · 본문에 쓴 번호는 모두 실음)', { color: C.sub })])
  appendix('유첨 4', '유첨 4. 기사 원문 요약', [ph('omitted', { x: M, y: L.foot - 0.32, w: CW, h: LH(SIZE.note) }, SIZE.note, '외 N건 (한 장을 넘어 생략 · 본문에 쓴 번호는 모두 실음)', { color: C.sub })])
  // 유첨 5 기술 시계열 (11/17, 40 문서 R5 — 양식 확장): 왼쪽 판정 글, 오른쪽 논문 · 특허 연도별 그래프
  appendix('유첨 5', '유첨 5. 기술 시계열', [
    ph('timeline_text', { x: M, y: top, w: T5.textW, h: L.foot - 0.1 - top }, SIZE.note, '기술 단계 [성장 · 상용화 진입 등] — 판정 이유\n관심 대 실질 · 연구 폭 · 떠오르는 세부 주제 · 예상 밖 급증 · 요즘 뜨는 기술 신호\n※ 규칙으로 센 숫자 (AI가 만든 숫자 아님)'),
    ph('timeline_caption', { x: M + T5.textW + 0.25, y: L.foot - 0.1 - 2 * LH(SIZE.note), w: CW - T5.textW - 0.25, h: 2 * LH(SIZE.note) }, SIZE.note, '출처: 테크브리프 논문 DB(OpenAlex) · 디스플레이 특허 DB | 끝난 해까지\n그래프: 꺾은선(구간 12개 넘음) · 세로막대 — 연도에 따른 추이', { color: C.sub }),
  ])
  const chartW = (CW - 0.25) / 2
  appendix('유첨 2', '유첨 2. 트렌드 그래프', [
    ph('caption_trend', { x: M + 0.15, y: L.foot - 0.12 - 3 * LH(SIZE.note) - 0.1, w: chartW - 0.3, h: 3 * LH(SIZE.note) }, SIZE.note, '데이터 기간: … | 단위: 건\n출처: …\n그래프: 세로막대(구간 12개 이하) · 꺾은선(넘으면)', { color: C.sub }),
    ph('caption_keyword', { x: M + chartW + 0.25 + 0.15, y: L.foot - 0.12 - 3 * LH(SIZE.note) - 0.1, w: chartW - 0.3, h: 3 * LH(SIZE.note) }, SIZE.note, '데이터 기간: … | 단위: 건\n출처: …\n그래프: 가로막대 (많은 순)', { color: C.sub }),
  ])
}

// ── 그래프 (단색, 축 이름 · 단위) ──
function addBarOrLine(slide, pres, kind, pos, labels, values, xTitle, yTitle) {
  const axis = { fontFace: FONT.latin, size: SIZE.note }
  const max = Math.max(1, ...values)
  const common = {
    ...pos,
    chartColors: [C.accent],
    showLegend: false,
    showTitle: false,
    catAxisLabelFontSize: axis.size,
    catAxisLabelFontFace: axis.fontFace,
    catAxisLabelColor: C.ink,
    valAxisLabelFontSize: axis.size,
    valAxisLabelFontFace: axis.fontFace,
    valAxisLabelColor: C.ink,
    valAxisMinVal: 0,
    valAxisMajorUnit: max <= 5 ? 1 : undefined,
    valGridLine: { color: 'E5E5E5', size: 0.5 },
    catGridLine: { style: 'none' },
    showValAxisTitle: true,
    valAxisTitle: yTitle,
    valAxisTitleFontSize: axis.size,
    valAxisTitleFontFace: axis.fontFace,
    valAxisTitleColor: C.sub,
    showCatAxisTitle: kind !== 'hbar',
    catAxisTitle: xTitle,
    catAxisTitleFontSize: axis.size,
    catAxisTitleFontFace: axis.fontFace,
    catAxisTitleColor: C.sub,
  }
  if (kind === 'line') {
    slide.addChart(pres.ChartType.line, [{ name: yTitle, labels, values }], { ...common, lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 5 })
    return
  }
  const hbar = kind === 'hbar'
  slide.addChart(pres.ChartType.bar, [{ name: yTitle, labels: hbar ? [...labels].reverse() : labels, values: hbar ? [...values].reverse() : values }], {
    ...common,
    barDir: hbar ? 'bar' : 'col',
    showValue: values.some((v) => v > 0), // 빈 양식(값이 모두 0)은 숫자를 띄우지 않음
    dataLabelPosition: 'outEnd',
    dataLabelFontSize: axis.size,
    dataLabelFontFace: axis.fontFace,
    dataLabelColor: C.ink,
  })
}
const trendKind = (n) => (n <= 12 ? 'vbar' : 'line')

// ── 채우기 도우미 ──
const NN = (r) => (typeof r === 'number' ? `#${String(r).padStart(2, '0')}` : String(r))
const refRuns = (refs) => (refs?.length ? [{ text: ` [${refs.map(NN).join(', ')}]`, options: { bold: true, color: C.accent } }] : [])
// 글머리 문단들: items = [[runs], ...] → 한 개체 틀에 넣을 runs 배열. runs.sub = true면 한 단계 들여 쓴 「·」 글머리
function bullets(items, size = SIZE.body) {
  const out = []
  items.forEach((runs, i) => {
    runs.forEach((r, j) => {
      const last = j === runs.length - 1
      out.push({ text: r.text, options: { fontSize: size, ...(r.options ?? {}), ...(j === 0 ? { bullet: runs.sub ? { code: '00B7', indent: 12 } : { indent: 12 }, ...(runs.sub ? { indentLevel: 1 } : {}), paraSpaceAfter: 3 } : {}), ...(last && i < items.length - 1 ? { breakLine: true } : {}) } })
    })
  })
  return out
}
const fitLine = (t, max) => (String(t ?? '').length > max ? `${String(t).slice(0, max - 1)}…` : String(t ?? ''))

// 한 장에 들어가는 만큼: 본문에 쓴 번호 먼저, 나머지 번호 순
function pickRows(rows, cited, cap) {
  const must = rows.filter((r) => cited.has(r.no))
  const rest = rows.filter((r) => !cited.has(r.no))
  const picked = [...must, ...rest.slice(0, Math.max(0, cap - must.length))]
  return { rows: picked.sort((a, b) => a.no.localeCompare(b.no)), omitted: rows.length - picked.length }
}

// ── 만들기 ──
export function build(data) {
  const pres = new PptxGenJS()
  pres.layout = 'LAYOUT_4x3' // 10 × 7.5in
  pres.title = data?.title ?? '테크브리프 보고서 양식'
  pres.author = '테크브리프'
  pres.theme = { headFontFace: FONT.latin, bodyFontFace: FONT.latin }
  defineLayouts(pres)
  const filled = Boolean(data)
  const put = (slide, name, value) => slide.addText(filled ? value : '', { placeholder: name })
  const cited = new Set((data?.facts ?? []).flatMap((f) => f.refs.map(NN)))

  // ════ 본문 ════
  pres.addSection({ title: '본문' })
  const s1 = pres.addSlide({ masterName: '본문', sectionTitle: '본문' })
  drawCard(s1, pres, COL_X[0], ROW_Y[0], CELL_W, L.rows[0], '기술 개요', '핵심 사실 근거')
  drawCard(s1, pres, COL_X[1], ROW_Y[0], CELL_W, L.rows[0], '업계 동향', '핵심 사실 근거')
  drawCard(s1, pres, COL_X[0], ROW_Y[1], CELL_W, L.rows[1], '기술 언급량 추이')
  drawCard(s1, pres, COL_X[1], ROW_Y[1], CELL_W, L.rows[1], '③ 시사점 및 제언', 'AI 판단 · 검토 후 사용')
  // 변화 요약 상자 + 시사점 칸 안 구분선 · 「할 일」
  const sx = COL_X[0] + PAD + 2.85
  s1.addShape(pres.ShapeType.roundRect, { x: sx, y: ROW_Y[1] + HEAD + 0.1, w: IN_W - 2.85, h: 1.0, rectRadius: 0.08, fill: { color: C.pink }, line: { type: 'none' }, objectName: '변화 요약 상자' })
  s1.addText('변화 요약', { ...base, x: sx + 0.1, y: ROW_Y[1] + HEAD + 0.18, w: IN_W - 3.05, h: LH(SIZE.body), fontSize: SIZE.body, bold: true, objectName: '변화 요약 제목' })
  const jy = ROW_Y[1] + HEAD + 2 * LH(SIZE.body) + 0.07
  s1.addShape(pres.ShapeType.line, { x: COL_X[1] + PAD, y: jy, w: IN_W, h: 0, line: { color: C.line, width: 0.75 }, objectName: '시사점 구분선' })
  s1.addText('할 일', { ...base, x: COL_X[1] + PAD, y: jy + 0.07, w: IN_W, h: LH(SIZE.body), fontSize: SIZE.body, bold: true, objectName: '할 일 제목' })

  put(s1, 'title', data?.title)
  put(s1, 'byline', [data?.date && `작성일 ${data.date}`, data?.dept && `작성부서 ${data.dept}`].filter(Boolean).join('\n'))
  put(s1, 'headline', data?.headline)
  for (const [name, area] of [
    ['facts_tech', '기술'],
    ['facts_industry', '업계'],
  ]) {
    const list = (data?.facts ?? []).filter((f) => f.area === area)
    put(s1, name, list.length ? bullets(list.map((f) => [{ text: f.text }, ...refRuns(f.refs)])) : [{ text: '근거 기사 2건 이상으로 확인된 사실 없음 — 유첨 1 참고', options: { color: C.sub } }])
  }
  // 추이 그래프 (빈 양식은 0으로 된 틀 — 차트에서 「데이터 편집」으로 채움)
  const tr = data?.trend ?? { unit: '일', labels: [' ', '  ', '   ', '    ', '     '], values: [0, 0, 0, 0, 0] } // 빈 양식: 눈금 이름 없이 틀만
  addBarOrLine(s1, pres, trendKind(tr.labels.length), { x: COL_X[0] + PAD - 0.05, y: ROW_Y[1] + HEAD, w: 2.85, h: L.rows[1] - HEAD - 0.1 - LH(SIZE.note) - 0.06 }, tr.labels, tr.values, tr.unit === '주' ? '주 (시작일 M/D)' : '날짜 (M/D)', tr.unit === '주' ? '주간 기사 수 (건)' : '기사 수 (건)')
  const last = tr.values.at(-1) ?? 0
  const prev = tr.values.length >= 2 ? tr.values.at(-2) : null
  const change = prev == null ? '비교할 구간 없음' : prev > 0 ? `${last >= prev ? '+' : ''}${(((last - prev) / prev) * 100).toFixed(1)}%` : `${prev}건 → ${last}건`
  put(s1, 'change_basis', `${tr.unit === '주' ? '전주' : '전일'} 대비`)
  put(s1, 'change_value', change)
  put(s1, 'trend_caption', `※ ${tr.source ?? ''} · ${tr.period ?? ''}`)
  const jt = data?.judgment?.type ?? '검토 필요'
  const tag = { 기회: C.opp, 위협: C.threat, '기회·위협 공존': C.ink, '검토 필요': C.sub }[jt] ?? C.ink
  put(s1, 'judgment', [{ text: '자사 판단  ', options: { bold: true } }, { text: `[${jt}] `, options: { bold: true, color: tag } }, { text: data?.judgment?.reason ?? '' }])
  put(s1, 'actions', bullets((data?.actions ?? []).map((a) => [{ text: a.what }, ...(a.priority_or_due ? [{ text: ` — ${a.priority_or_due}`, options: { bold: true } }] : [])])))
  const src = data?.source
  put(s1, 'source', src ? `수집 기간 ${src.period} | ${src.counts ?? `기사 ${src.article_count}건`} | 매체 ${src.media_count}곳 | 키워드: ${(src.keywords ?? []).join(', ') || '-'}` : '')
  // 원본에 한 줄 요약이 없으면 (다른 서버 보고서) 지어내지 않고 회색으로 「없음」
  put(s1, 'summary', data?.one_line_summary || [{ text: '없음 — 원본 보고서에 한 줄 요약 칸이 없음 (직접 입력)', options: { bold: false, color: C.sub } }])
  s1.addNotes('본문 1장. 개체 틀을 눌러 AI 결과(templates/report-prompt.md 프롬프트의 「붙여 넣기용」 블록)를 칸 이름대로 붙여 넣는다: title · byline · headline · facts_tech(area=기술) · facts_industry(area=업계) · judgment · actions · source · summary(one_line_summary). 추이 그래프는 차트 → 데이터 편집에서 trend.labels / values로 바꾸고, 변화 요약은 마지막 구간을 바로 앞 구간과 비교. 글자 크기를 줄이지 말고, 넘치면 문장을 줄이거나 유첨 1로 옮긴다.')

  // ════ 유첨 1. 상세 분석 ════
  pres.addSection({ title: '유첨' })
  const s2 = pres.addSlide({ masterName: '유첨 1', sectionTitle: '유첨' })
  const an = data?.appendix?.analysis ?? []
  const single = data?.appendix?.single_facts ?? []
  const anItems = []
  for (const a of an) {
    anItems.push([{ text: a.issue, options: { bold: true } }, ...refRuns(a.refs)])
    const sub = (head, body) => Object.assign([{ text: `${head}  `, options: { bold: true } }, { text: body }], { sub: true })
    if (a.background) anItems.push(sub('배경', a.background))
    if (a.point) anItems.push(sub('쟁점', a.point))
    if (a.outlook) anItems.push(sub('전망', a.outlook))
  }
  if (single.length) {
    anItems.push([{ text: '근거 기사 1건뿐인 사실 · 본문에서 옮긴 사실', options: { bold: true, color: C.accent } }])
    for (const f of single) anItems.push([{ text: f.text }, ...refRuns(f.refs)])
  }
  put(s2, 'analysis', anItems.length ? bullets(anItems, SIZE.note) : [{ text: '상세 분석 없음', options: { color: C.sub } }])
  s2.addNotes('유첨 1. appendix.analysis(이슈 · 배경 · 쟁점 · 전망 · refs)와 appendix.single_facts를 붙여 넣는다. 한 장을 넘으면 마지막 줄에 「외 N건」.')

  // ════ 유첨 2. 트렌드 그래프 ════
  const top = M + LH(SIZE.title) + 0.18
  const s5 = pres.addSlide({ masterName: '유첨 2', sectionTitle: '유첨' })
  const cw = (CW - 0.25) / 2
  const ch = L.foot - 0.12 - top
  const kw = (data?.appendix?.charts ?? []).find((c) => c.type === '가로막대') ?? { labels: [' ', '  ', '   '], values: [0, 0, 0], period: '', source: '' }
  for (const [i, title] of ['기간별 기사량', '키워드 빈도'].entries()) {
    const x = M + i * (cw + 0.25)
    s5.addShape(pres.ShapeType.roundRect, { x, y: top, w: cw, h: ch, rectRadius: 0.06, line: { color: C.line, width: 1 }, fill: { color: C.white }, objectName: `그래프 칸 ${title}` })
    s5.addText(title, { ...base, x: x + 0.15, y: top + 0.1, w: cw - 0.3, h: LH(SIZE.body), fontSize: SIZE.body, bold: true, objectName: `그래프 제목 ${title}` })
  }
  const chartPos = (i) => ({ x: M + i * (cw + 0.25) + 0.1, y: top + 0.2 + LH(SIZE.body), w: cw - 0.2, h: ch - 0.2 - LH(SIZE.body) - 3 * LH(SIZE.note) - 0.3 })
  addBarOrLine(s5, pres, trendKind(tr.labels.length), chartPos(0), tr.labels, tr.values, tr.unit === '주' ? '주 (시작일 M/D)' : '날짜 (M/D)', tr.unit === '주' ? '주간 기사 수 (건)' : '기사 수 (건)')
  addBarOrLine(s5, pres, 'hbar', chartPos(1), kw.labels, kw.values, '키워드', '언급 기사 수 (건)')
  put(s5, 'caption_trend', `데이터 기간: ${tr.period ?? ''} | 단위: 건\n출처: ${tr.source ?? ''}\n그래프: ${trendKind(tr.labels.length) === 'vbar' ? '세로막대' : '꺾은선'} — 시간에 따른 추이, 구간 ${tr.labels.length}개`)
  put(s5, 'caption_keyword', `데이터 기간: ${kw.period ?? ''} | 단위: 건\n출처: ${kw.source ?? ''}\n그래프: 가로막대 — 키워드 간 비교 (많은 순)`)
  s5.addNotes('유첨 2. 왼쪽은 trend(기간별 기사량: 구간 12개 이하 세로막대 · 넘으면 꺾은선), 오른쪽은 appendix.charts의 가로막대(키워드 빈도). 차트 → 데이터 편집에서 바꾼다. 단색만, 축 이름 · 단위 · 데이터 기간 표기.')

  // ════ 유첨 3. 출처 목록 / 유첨 4. 기사 원문 요약 (표) ════
  const head = (labels) => labels.map((t) => ({ text: t, options: { bold: true, fill: { color: C.gray } } }))
  const tableOpts = (colW, rowH) => ({ x: M, y: top, w: CW, colW, rowH, fontFace: FONT.latin, fontSize: SIZE.note, color: C.ink, valign: 'middle', margin: 0.04, border: { type: 'solid', pt: 0.75, color: C.line }, autoPage: false })

  const s3 = pres.addSlide({ masterName: '유첨 3', sectionTitle: '유첨' })
  const srcPick = pickRows((data?.appendix?.sources ?? []).map((r) => ({ ...r, no: NN(r.no) })), cited, ROWS_SRC)
  const srcRows = Array.from({ length: ROWS_SRC }, (_, i) => {
    const r = srcPick.rows[i]
    if (!r) return ['', '', '', '', '']
    return [
      { text: r.no, options: { bold: true } },
      r.date ?? '',
      fitLine(r.media, 14),
      fitLine(r.title, 34),
      r.url ? { text: fitLine(r.url.replace(/^https?:\/\//, ''), 30), options: { color: C.accent, hyperlink: { url: r.url } } } : { text: '링크 없음', options: { color: C.sub } },
    ]
  })
  s3.addTable([head(['번호', '날짜', '매체', '제목', 'URL']), ...srcRows], tableOpts([0.5, 0.9, 1.35, 3.65, 2.6], [0.27, ...Array(ROWS_SRC).fill(0.25)]))
  put(s3, 'omitted', srcPick.omitted ? `외 ${srcPick.omitted}건 (한 장을 넘어 생략 · 본문에 쓴 번호는 모두 실음)` : '')
  s3.addNotes(`유첨 3. appendix.sources를 표에 붙여 넣는다 (번호 | 날짜 | 매체 | 제목 | URL, 칸마다 한 줄). 표는 ${ROWS_SRC}줄 고정 — 넘치면 본문에 쓴 번호를 먼저 싣고 아래 「외 N건」.`)

  const s4 = pres.addSlide({ masterName: '유첨 4', sectionTitle: '유첨' })
  const sumPick = pickRows((data?.appendix?.summaries ?? []).map((r) => ({ ...r, no: NN(r.no) })), cited, ROWS_SUM)
  const sumRows = Array.from({ length: ROWS_SUM }, (_, i) => {
    const r = sumPick.rows[i]
    if (!r) return ['', '', '']
    const pre = r.basis === '발췌문' ? '발췌문 기준: ' : r.basis === '초록' ? '초록 기준: ' : ''
    return [{ text: r.no, options: { bold: true } }, fitLine(r.title, 60), fitLine(`${pre}${r.summary ?? ''}`, 110)]
  })
  s4.addTable([head(['번호', '제목', '요약 (1~2줄)']), ...sumRows], tableOpts([0.5, 3.1, 5.4], [0.27, ...Array(ROWS_SUM).fill(0.45)]))
  put(s4, 'omitted', sumPick.omitted ? `외 ${sumPick.omitted}건 (한 장을 넘어 생략 · 본문에 쓴 번호는 모두 실음)` : '')
  s4.addNotes(`유첨 4. appendix.summaries를 표에 붙여 넣는다 (번호 | 제목 | 요약 1~2줄). 발췌문 · 초록으로 만든 요약은 앞에 「발췌문 기준」 · 「초록 기준」. 표는 ${ROWS_SUM}줄 고정 — 넘치면 「외 N건」.`)

  // ════ 유첨 5. 기술 시계열 (키워드마다 한 장, 최대 2장 · 빈 양식은 틀 한 장) ════
  const tls = filled ? (data?.appendix?.timeline ?? []).slice(0, 2) : [null]
  for (const t of tls) {
    const s6 = pres.addSlide({ masterName: '유첨 5', sectionTitle: '유첨' })
    const lines = []
    if (t) {
      lines.push([{ text: `「${t.keyword}」 기술 단계  `, options: { bold: true } }, { text: `[${t.stage ?? '판정 없음'}]`, options: { bold: true, color: C.accent } }])
      if (t.why) lines.push(Object.assign([{ text: t.why }], { sub: true }))
      for (const l of t.lines ?? []) {
        lines.push([{ text: l.head, options: { bold: true } }])
        lines.push(Object.assign([{ text: l.text }], { sub: true }))
      }
      lines.push([{ text: t.note ?? '규칙으로 센 숫자 (AI가 만든 숫자 아님)', options: { color: C.sub } }])
    }
    put(s6, 'timeline_text', lines.length ? bullets(lines, SIZE.note) : '')
    const rx = M + T5.textW + 0.25
    const rw = CW - T5.textW - 0.25
    const capH = 2 * LH(SIZE.note) + 0.1
    const gh = (L.foot - 0.1 - capH - top - 0.1) / 2
    const blank = { labels: [' ', '  ', '   ', '    '], values: [0, 0, 0, 0] }
    for (const [i, [title, series, unit]] of [
      ['논문 수 (연도별)', t?.papers ?? blank, '논문 수 (편)'],
      ['특허 수 (연도별 · 같은 발명 한 번)', t?.patents ?? blank, '특허 수 (건)'],
    ].entries()) {
      const y = top + i * (gh + 0.1)
      s6.addShape(pres.ShapeType.roundRect, { x: rx, y, w: rw, h: gh, rectRadius: 0.06, line: { color: C.line, width: 1 }, fill: { color: C.white }, objectName: `그래프 칸 ${title}` })
      s6.addText(title, { ...base, x: rx + 0.12, y: y + 0.08, w: rw - 0.24, h: LH(SIZE.body), fontSize: SIZE.body, bold: true, objectName: `그래프 제목 ${title}` })
      if (series.labels?.length >= 2) addBarOrLine(s6, pres, trendKind(series.labels.length), { x: rx + 0.08, y: y + 0.12 + LH(SIZE.body), w: rw - 0.16, h: gh - 0.2 - LH(SIZE.body) }, series.labels, series.values, '연도', unit)
      else s6.addText('자료 부족 — 그래프 없이 씀', { ...base, x: rx + 0.12, y: y + 0.2 + LH(SIZE.body), w: rw - 0.24, h: LH(SIZE.note), fontSize: SIZE.note, color: C.sub })
    }
    put(s6, 'timeline_caption', t ? `출처: ${t.source ?? '테크브리프 논문 DB(OpenAlex) · 디스플레이 특허 DB'} | ${t.as_of ?? ''}\n그래프: 연도에 따른 추이 — 구간 12개 이하 세로막대 · 넘으면 꺾은선` : '')
    s6.addNotes('유첨 5. appendix.timeline(키워드마다: stage · why · lines[head, text] · papers · patents)을 붙여 넣는다. 숫자는 규칙 계산 그대로, 관심도 · 급증은 네이버 검색 관심도라 AI 입력에 쓰지 않는다 (23 문서).')
  }

  return pres
}

// pptxgenjs는 글꼴을 하나만 넣으므로, 만든 뒤 XML에서 동아시아 글꼴(ea)을 LG 스마트체로 넣는다 (src/reportExport.js와 같은 방식)
export async function fixFonts(buf) {
  const zip = await JSZip.loadAsync(buf)
  const ea = `<a:ea typeface="${FONT.ea}"/>`
  await Promise.all(
    Object.keys(zip.files)
      .filter((n) => /^ppt\/(slides|charts|theme|slideMasters|slideLayouts)\/[^/]+\.xml$/.test(n))
      .map(async (n) => {
        let xml = await zip.file(n).async('string')
        // pptxgenjs가 한 문단 안 두 번째 글 조각 앞에 문단 설정(<a:pPr>…buNone)을 또 넣어 글머리가 사라지는 문제 → 문장 중간의 문단 설정은 지운다
        xml = xml.replace(/(<\/a:r>)<a:pPr[^>]*?(?:\/>|>(?:<a:buNone\/>)?<\/a:pPr>)/g, '$1')
        xml = xml.replace(new RegExp(`<a:ea typeface="${FONT.latin}"[^>]*/>`, 'g'), ea).replace(new RegExp(`(<a:latin typeface="${FONT.latin}"[^>]*/>)(?!<a:ea)`, 'g'), `$1${ea}`)
        if (n.includes('/theme/')) xml = xml.replace(/(<a:(?:major|minor)Font>\s*<a:latin typeface=")[^"]*(")/g, `$1${FONT.latin}$2`).replace(/(<a:(?:major|minor)Font>\s*<a:latin[^>]*\/>\s*<a:ea typeface=")[^"]*(")/g, `$1${FONT.ea}$2`)
        if (n.includes('/theme/')) xml = xml.replace(/<a:font script="Hang" typeface="[^"]*"\/>/g, `<a:font script="Hang" typeface="${FONT.ea}"/>`)
        // 11/20: 글 조각 언어를 한국어로 (src/reportExport.js koreanLang과 같음) — en-US면 한국어 PowerPoint 글꼴 칸에 Arial Narrow만 보임
        xml = xml.replace(/ lang="en-US"(?! altLang)/g, ' lang="ko-KR" altLang="en-US"')
        zip.file(n, xml)
      }),
  )
  // 폴더 항목은 빼고 묶는다 (폴더 항목이 있으면 클라우드에서 열거나 함께 고칠 때 실패하는 일이 있음)
  for (const n of Object.keys(zip.files)) if (zip.files[n].dir) delete zip.files[n]
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

// 다른 서버 보고서로 만들기 (scripts/report-from-server.mjs):
//   node scripts/report-template.mjs --from http://localhost:3038 [--index 0] out.pptx   (index 0 = 가장 최근 보고서)
//   node scripts/report-template.mjs --from reports.json [--index 0] out.pptx           (/api/reports 응답을 저장한 파일)
//   변환한 JSON도 out.pptx 옆에 out.json으로 남긴다 (칸에 무엇이 들어갔는지 확인 · 손으로 고친 뒤 다시 만들기)
// 11/17 (테크브리프 앱): 서버가 build · fixFonts를 가져다 쓰므로, 명령줄로 직접 실행할 때만 아래가 돈다
// 데이터 → 완성된 pptx 버퍼 (서버 · 명령줄 공용)
export async function renderPptx(data) {
  return fixFonts(await build(data).write({ outputType: 'nodebuffer' }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const opt = (name) => {
    const i = args.indexOf(name)
    return i < 0 ? null : args.splice(i, 2)[1]
  }
  const from = opt('--from')
  const index = Number(opt('--index') ?? 0)
  const [input, output] = args
  let data = null
  if (from) {
    const { reportToTemplate, loadFromServer } = await import('./report-from-server.mjs')
    const { entry, trends, total } = await loadFromServer(from, index)
    data = reportToTemplate(entry, { trends })
    console.log(`보고서 ${index}번 / ${total}건: 「${entry.report?.title}」 (${entry.createdAt})`)
    for (const n of data._notes) console.log(`  · ${n}`)
  } else if (input) data = JSON.parse(readFileSync(input, 'utf8'))
  const out = resolve((from ? input : output) ?? (input && !from ? input.replace(/\.json$/, '.pptx') : from ? `${ROOT}/templates/report-from-server.pptx` : `${ROOT}/templates/report-template.pptx`))
  if (from) writeFileSync(out.replace(/\.pptx$/, '.json'), JSON.stringify(data, null, 2))
  const raw = await build(data).write({ outputType: 'nodebuffer' })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, await fixFonts(raw))
  console.log(`만듦: ${out}`)
}
