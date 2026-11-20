// 보고서 PPT(.pptx) 내보내기 — 4:3 가로형 (11/12 실무자 확정 양식)
// 자리 · 글자 크기는 reportSlides.js가 정한 값 그대로 (화면 미리보기 · PDF와 같은 모양)
// 글꼴: 글자마다 latin = Arial Narrow, ea(한글) = LG 스마트체 — pptxgenjs는 한 글꼴만 넣으므로 파일을 만든 뒤 XML에서 ea를 바꾼다
// 장식 이미지 · 아이콘 · 애니메이션 없음. 글자 크기 18/14/11/10pt만 (자동 줄이기도 쓰지 않음)
import { COLOR, FONT, LH, PAGE, PIE_COLORS, reportPages } from './reportSlides.js'

function fileName(saved, ext) {
  const date = (saved.createdAt ?? new Date().toISOString()).slice(0, 10)
  const title = (saved.report.title || '보고서').replace(/[\\/:*?"<>|]/g, '').slice(0, 40)
  return `${title}_${date}.${ext}`
}

const runOpts = (r) => ({ ...(r.color ? { color: r.color } : {}), ...(r.bold ? { bold: true } : {}) })

// 모든 XML의 글꼴 지정: latin = Arial Narrow, ea = LG 스마트체 (ea가 없는 곳 · 테마에도 넣는다)
// 11/20: 글 조각 언어를 한국어(ko-KR, 보조 en-US)로 — pptxgenjs가 모두 en-US로 넣어, 한국어 PowerPoint가 글꼴 칸에
// 영문 글꼴(Arial Narrow)만 보여 주고 「LG 스마트체」가 안 보였다. 한국어 PowerPoint가 직접 저장한 파일과 같은 표기
export const koreanLang = (xml) => xml.replace(/ lang="en-US"(?! altLang)/g, ' lang="ko-KR" altLang="en-US"')
function fixFonts(xml) {
  const ea = `<a:ea typeface="${FONT.ea}"/>`
  return koreanLang(
    xml
      .replace(new RegExp(`<a:ea typeface="${FONT.latin}"[^>]*/>`, 'g'), ea)
      .replace(new RegExp(`(<a:latin typeface="${FONT.latin}"[^>]*/>)(?!<a:ea)`, 'g'), `$1${ea}`),
  )
}
// 테마: 본문 · 제목 글꼴 + 한글(Hang) 대체 글꼴도 LG 스마트체 (예전엔 맑은 고딕이 남아 있었음)
function fixTheme(xml) {
  return xml
    .replace(/(<a:(?:major|minor)Font>\s*<a:latin typeface=")[^"]*(")/g, `$1${FONT.latin}$2`)
    .replace(/(<a:(?:major|minor)Font>\s*<a:latin[^>]*\/>\s*<a:ea typeface=")[^"]*(")/g, `$1${FONT.ea}$2`)
    .replace(/<a:font script="Hang" typeface="[^"]*"\/>/g, `<a:font script="Hang" typeface="${FONT.ea}"/>`)
}

// .pptx 파일 내용(ArrayBuffer)을 만든다. 화면에서는 exportPptx가 내려받기로 넘긴다
// extra: 화면이 받아 둔 추가 데이터 (기사 수 추이용 /api/trends) — 미리보기와 같은 그래프가 되게
export async function buildPptx(saved, { PptxGenJS, JSZip, extra } = {}) {
  PptxGenJS ??= (await import('pptxgenjs')).default
  JSZip ??= (await import('jszip')).default // pptxgenjs가 함께 설치하는 압축 도구
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_4x3' // 10 × 7.5 in
  pptx.title = saved.report.title
  pptx.theme = { headFontFace: FONT.latin, bodyFontFace: FONT.latin }
  const deck = reportPages(saved, extra)
  const base = { fontFace: FONT.latin, margin: 0, valign: 'top', paraSpaceBefore: 0, paraSpaceAfter: 0 }
  const S = pptx.ShapeType
  const axis = { fontFace: FONT.latin, size: 10 }

  deck.pages.forEach((page) => {
    const slide = pptx.addSlide()
    slide.background = { color: 'FFFFFF' }
    for (const el of page.els) {
      if (el.t === 'text') {
        slide.addText(
          el.runs.map((r) => ({ text: r.text, options: { ...runOpts(r), ...(r.size ? { fontSize: r.size } : {}), ...(r.link ? { hyperlink: { url: r.link } } : {}) } })),
          { ...base, x: el.x, y: el.y, w: el.w, h: el.h, fontSize: el.size, lineSpacing: el.size * 1.35, color: el.color ?? COLOR.ink, bold: Boolean(el.bold), align: el.align ?? 'left' },
        )
      } else if (el.t === 'rect') {
        slide.addShape(el.radius ? S.roundRect : S.rect, {
          x: el.x,
          y: el.y,
          w: el.w,
          h: el.h,
          ...(el.radius ? { rectRadius: Math.min(0.5, el.radius / Math.min(el.w, el.h)) } : {}),
          fill: el.fill ? { color: el.fill } : { type: 'none' },
          line: el.line ? { color: el.line, width: 1.25 } : { type: 'none' },
        })
      } else if (el.t === 'tri') {
        slide.addShape(S.rtTriangle, { x: el.x, y: el.y, w: el.w, h: el.h, fill: { color: el.fill }, line: { type: 'none' }, flipH: true })
      } else if (el.t === 'check') {
        slide.addText('✓', { ...base, shape: S.ellipse, x: el.x, y: el.y, w: el.d, h: el.d, fill: { color: COLOR.accent }, color: 'FFFFFF', fontSize: 10, bold: true, align: 'center', valign: 'middle' })
      } else if (el.t === 'line') {
        slide.addShape(S.line, { x: el.x, y: el.y, w: el.w, h: 0, line: { color: el.color ?? COLOR.line, width: 0.75 } })
      } else if (el.t === 'pageno') {
        slide.addText(`${el.no} / ${deck.pages.length}`, { ...base, x: PAGE.w - PAGE.m - 1, y: PAGE.h - 0.42, w: 1, h: LH(10), fontSize: 10, lineSpacing: 13.5, color: COLOR.ink, bold: true, align: 'right' })
      } else if (el.t === 'table') {
        const cell = (text, opts = {}) => ({ text, options: { fontFace: FONT.latin, fontSize: el.size, color: COLOR.ink, valign: 'middle', ...opts } })
        slide.addTable(
          el.rows.map((r) => r.cells.map((c, i) => (i === 0 && el.headCol ? cell(c, { bold: true, fill: { color: COLOR.gray } }) : cell(c)))),
          { x: el.x, y: el.y, w: el.w, colW: el.cols, rowH: el.rows.map((r) => r.h), border: { type: 'solid', pt: 0.75, color: COLOR.line }, margin: 0.05, fontFace: FONT.latin, fontSize: el.size, autoPage: false },
        )
      } else if (el.t === 'chart') {
        if (!el.values.length || el.values.every((v) => !v)) {
          slide.addText(el.empty, { ...base, x: el.x, y: el.y + el.h / 2 - 0.2, w: el.w, h: 0.3, fontSize: 10, color: COLOR.sub, align: 'center' })
          continue
        }
        const box = { x: el.x, y: el.y, w: el.w, h: el.h, showTitle: false }
        if (el.kind === 'pie' || el.kind === 'donut') {
          slide.addChart(el.kind === 'donut' ? pptx.ChartType.doughnut : pptx.ChartType.pie, [{ name: el.title ?? el.yTitle, labels: el.labels.map((l, i) => `${l} (${el.values[i]}${el.unit})`), values: el.values }], {
            ...box,
            chartColors: PIE_COLORS.slice(0, el.values.length),
            showPercent: true,
            showValue: false,
            showLegend: !el.legendOutside, // 범례는 reportSlides.js가 글 상자로 따로 놓음 (화면과 같은 자리)
            legendPos: 'r',
            legendFontSize: 10,
            legendFontFace: FONT.latin,
            dataLabelColor: 'FFFFFF',
            dataLabelFontSize: 10,
            dataLabelFontFace: FONT.latin,
            dataLabelFontBold: true,
            ...(el.kind === 'donut' ? { holeSize: 55 } : {}),
          })
          continue
        }
        const max = Math.max(1, ...el.values)
        const common = {
          ...box,
          chartColors: [COLOR.accent],
          showLegend: false,
          catAxisLabelFontSize: axis.size,
          catAxisLabelFontFace: axis.fontFace,
          valAxisLabelFontSize: axis.size,
          valAxisLabelFontFace: axis.fontFace,
          valAxisMinVal: 0,
          valAxisMajorUnit: max <= 5 ? 1 : undefined,
          valGridLine: { color: 'E5E5E5', size: 0.5 },
          showValAxisTitle: true,
          valAxisTitle: el.yTitle,
          valAxisTitleFontSize: axis.size,
          valAxisTitleFontFace: axis.fontFace,
          showCatAxisTitle: el.kind !== 'hbar',
          catAxisTitle: el.xTitle,
          catAxisTitleFontSize: axis.size,
          catAxisTitleFontFace: axis.fontFace,
        }
        if (el.kind === 'line') {
          // 가로축 라벨: 고른 것(최대 7개 · 첫/마지막)만 남기고 나머지는 빈칸, 겹치면 45도 (reportSlides.js axisLayout)
          const shown = new Set(el.ticks ?? el.labels.map((_, i) => i))
          const labels = el.labels.map((l, i) => (shown.has(i) ? l : ''))
          slide.addChart(pptx.ChartType.line, [{ name: el.yTitle, labels, values: el.values }], {
            ...common,
            lineSize: 2,
            lineDataSymbol: 'circle',
            lineDataSymbolSize: 5,
            catAxisLabelRotate: el.rotate ? -45 : 0,
            catAxisLabelFrequency: 1,
          })
        } else {
          const hbar = el.kind === 'hbar'
          // 가로막대는 PPT가 아래부터 그리므로 순서를 뒤집어 1위가 위에 오게
          const labels = hbar ? [...el.labels].reverse() : el.labels
          const values = hbar ? [...el.values].reverse() : el.values
          slide.addChart(pptx.ChartType.bar, [{ name: el.yTitle, labels, values }], {
            ...common,
            barDir: hbar ? 'bar' : 'col',
            showValue: true,
            dataLabelFontSize: 10,
            dataLabelFontFace: FONT.latin,
            dataLabelColor: COLOR.ink,
            catAxisLabelRotate: !hbar && el.labels.length > 6 ? -35 : 0,
          })
        }
      }
    }
  })

  const raw = await pptx.write({ outputType: 'arraybuffer' })
  const zip = await JSZip.loadAsync(raw)
  await Promise.all(
    Object.keys(zip.files)
      .filter((n) => /^ppt\/(slides|charts|theme|slideMasters|slideLayouts)\/[^/]+\.xml$/.test(n))
      .map(async (n) => {
        let xml = await zip.file(n).async('string')
        // 도넛: pptxgenjs가 showLegend: false여도 범례를 넣어 원을 가린다 → 범례는 reportSlides.js가 글 상자로 따로 놓으므로 지운다
        if (n.includes('/charts/') && xml.includes('<c:doughnutChart>')) xml = xml.replace(/<c:legend>[\s\S]*?<\/c:legend>/, '')
        zip.file(n, n.includes('/theme/') ? fixTheme(fixFonts(xml)) : fixFonts(xml))
      }),
  )
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}

// 어디서 내려받든(보고서 화면 · 편집 탭) 미리보기와 같은 그래프가 되게, 추가 데이터를 안 받았으면 여기서 불러온다
export async function loadReportExtra(saved) {
  const { fetchReportAnalysis, fetchTopicTrend, fetchTrends } = await import('./api.js')
  const [trends, topic, fresh] = await Promise.all([
    fetchTrends().catch(() => null),
    saved ? fetchTopicTrend(saved).catch(() => null) : null,
    saved ? fetchReportAnalysis(saved).catch(() => null) : null,
  ])
  return { trends, topic, analysis: fresh?.bundles ?? null }
}

export async function exportPptx(saved, extra) {
  extra ??= await loadReportExtra(saved)
  const data = await buildPptx(saved, { extra })
  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName(saved, 'pptx')
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
}

// PDF는 ReportSlide.jsx의 printSlides (같은 4:3 쪽을 인쇄 → PDF로 저장)
export { printSlides as printReport } from './ReportSlide.jsx'
