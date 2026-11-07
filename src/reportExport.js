// 보고서 내보내기: PPT(.pptx)와 PDF(브라우저 인쇄 → PDF로 저장). 여러 쪽 가능, 인터랙션 없음
// 사내 규칙(1차 인터뷰): 제목 18pt · 소주제 14pt · 본문 11pt · 유첨·주석 10pt, 개조식
// 한글 'LG 스마트체'는 PC마다 설치 여부가 달라 기본은 맑은 고딕. 회사 PC에서는 PPT 글꼴만 바꾸면 된다
import { formatDate, kindOf } from './reportStore.js'

const FONT_KO = '맑은 고딕'
const INK = '1C2533'
const MUTED = '5B6677'
const ACCENT = '1B6A96'
const WARN = 'B45309'

function bulletRuns(b) {
  return [
    { text: b.text, options: { color: INK } },
    { text: ` [${b.refs.join('][')}]`, options: { color: ACCENT, fontSize: 10 } },
  ]
}

function fileName(saved, ext) {
  const date = (saved.createdAt ?? new Date().toISOString()).slice(0, 10)
  const title = (saved.report.title || '보고서').replace(/[\\/:*?"<>|]/g, '').slice(0, 40)
  return `${title}_${date}.${ext}`
}

// 16:9 슬라이드 2장: ① 보고서 본문 (핵심 요약 + 기술 개요·업계 동향·시사점 3단) ② 근거 기사
// 내용이 넘치면 PowerPoint가 글자를 줄여 상자에 맞춘다 (fit: shrink)
export async function exportPptx(saved) {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE' // 13.33 × 7.5 in
  pptx.title = saved.report.title
  const W = 13.33
  const M = 0.5
  const meta = `${formatDate(saved.createdAt)} · ${saved.periodLabel ?? ''} · 기사 ${saved.articles.length}건 기준`
  const sections = saved.report.sections

  // 기사에서 확인된 내용 → (줄 바꿔) AI 해설·제안 순서. 둘을 섞지 않는다 (15 문서 F15)
  function runs(list) {
    const facts = (list ?? []).filter((b) => kindOf(b) === 'fact')
    const ai = (list ?? []).filter((b) => kindOf(b) === 'ai')
    const out = []
    const push = (text, options = {}) => out.push({ text, options })
    facts.forEach((b, i) => {
      const parts = bulletRuns(b)
      push(`• ${parts[0].text}`, parts[0].options)
      push(parts[1].text, { ...parts[1].options, breakLine: i < facts.length - 1 || ai.length > 0 })
    })
    if (ai.length) {
      push('AI 해설·제안 (기사에서 확인된 내용 아님, 확인 필요)', { color: WARN, fontSize: 10, bold: true, breakLine: true })
      ai.forEach((b, i) => push(`· ${b.text}`, { color: MUTED, breakLine: i < ai.length - 1 }))
    }
    if (out.length === 0) push('내용 없음', { color: MUTED })
    return out
  }
  function box(slide, label, list, x, y, w, h) {
    slide.addText(`■ ${label}`, { x, y, w, h: 0.4, fontFace: FONT_KO, fontSize: 14, bold: true, color: INK })
    slide.addText(runs(list), {
      x, y: y + 0.42, w, h: h - 0.42,
      fontFace: FONT_KO, fontSize: 11, color: INK, valign: 'top', paraSpaceAfter: 6, lineSpacingMultiple: 1.15, fit: 'shrink',
    })
  }
  function header(slide, title, sub) {
    slide.background = { color: 'FFFFFF' }
    slide.addText(title, { x: M, y: 0.3, w: W - 2 * M - 4, h: 0.55, fontFace: FONT_KO, fontSize: 18, bold: true, color: INK })
    slide.addText(sub, { x: W - M - 4, y: 0.38, w: 4, h: 0.4, fontFace: FONT_KO, fontSize: 10, color: MUTED, align: 'right' })
    slide.addShape(pptx.ShapeType.line, { x: M, y: 0.9, w: W - 2 * M, h: 0, line: { color: INK, width: 1.5 } })
  }
  function footer(slide, text) {
    slide.addText(text, { x: M, y: 7.05, w: W - 2 * M, h: 0.3, fontFace: FONT_KO, fontSize: 10, color: MUTED })
  }

  const page = pptx.addSlide()
  header(page, saved.report.title, meta)
  page.addShape(pptx.ShapeType.rect, { x: M, y: 1.05, w: W - 2 * M, h: 1.9, fill: { color: 'F3F6FA' }, line: { color: 'F3F6FA' } })
  box(page, '핵심 요약', sections.summary?.bullets, M + 0.15, 1.12, W - 2 * M - 0.3, 1.8)
  const colW = (W - 2 * M - 0.5) / 3
  ;[['tech', '기술 개요'], ['industry', '업계 동향'], ['implications', '시사점']].forEach(([key, label], i) => {
    box(page, label, sections[key]?.bullets, M + i * (colW + 0.25), 3.15, colW, 3.8)
  })
  footer(page, `[n]은 근거 기사 번호 (다음 장) · AI가 만든 초안이에요. 근거 기사를 확인하고 고쳐 쓰세요 · 모델 ${saved.model ?? ''}`)

  const refs = pptx.addSlide()
  header(refs, '근거 기사', saved.report.title)
  refs.addText(
    saved.articles.map((a, i) => ({
      text: `[${i + 1}] ${a.title} — ${a.source}${a.publishedAt ? `, ${formatDate(a.publishedAt)}` : ''}${a.fulltext === false ? ' (발췌문으로 작성)' : ''}`,
      options: { breakLine: i < saved.articles.length - 1, hyperlink: a.url ? { url: a.url } : undefined },
    })),
    { x: M, y: 1.1, w: W - 2 * M, h: 5.8, fontFace: FONT_KO, fontSize: 10, color: INK, valign: 'top', paraSpaceAfter: 8, fit: 'shrink' },
  )
  footer(refs, '원문 링크는 제목을 누르면 열려요')

  await pptx.writeFile({ fileName: fileName(saved, 'pptx') })
}

// PDF: 인쇄용 화면(보고서만, A4)으로 브라우저 인쇄 창을 연다 → 'PDF로 저장'
export function printReport() {
  document.body.classList.add('printing-report')
  const done = () => {
    document.body.classList.remove('printing-report')
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  window.print()
}

