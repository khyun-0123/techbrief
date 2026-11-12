// 보고서 내보내기: PPT(.pptx)와 PDF(브라우저 인쇄 → PDF로 저장). 여러 쪽 가능, 인터랙션 없음
// 사내 규칙(1차 인터뷰): 제목 18pt · 소주제 14pt · 본문 11pt · 유첨·주석 10pt, 개조식
// 한글 'LG 스마트체'는 PC마다 설치 여부가 달라 기본은 맑은 고딕. 회사 PC에서는 PPT 글꼴만 바꾸면 된다
import { formatDate, kindOf, sourcesLine } from './reportStore.js'

const FONT_KO = '맑은 고딕'
const INK = '1C2533'
const MUTED = '5B6677'
const ACCENT = '1B6A96'
const WARN = 'B45309'

function bulletRuns(b) {
  return [
    { text: `${b.tag ? `(${b.tag}) ` : ''}${b.text}`, options: { color: b.tag === '위협' ? WARN : INK } },
    { text: ` [${b.refs.join('][')}]`, options: { color: ACCENT, fontSize: 10 } },
  ]
}

function fileName(saved, ext) {
  const date = (saved.createdAt ?? new Date().toISOString()).slice(0, 10)
  const title = (saved.report.title || '보고서').replace(/[\\/:*?"<>|]/g, '').slice(0, 40)
  return `${title}_${date}.${ext}`
}

// 11/12 담당자 회신(35 문서): 4:3 가로, 1페이지 + 유첨
// ① 1페이지: 헤드라인 · 핵심 사실 근거(왼쪽) · 시사점 및 제언(오른쪽, 기회 · 위협 · 할 일) · 출처(수집 기간 · 기사 수)
// ② 유첨: 기술 개요 · 업계 동향 · 경쟁사 ③ 유첨: 분석 자료(경쟁사 특허 비교, 있을 때) ④ 근거 기사
// 내용이 넘치면 PowerPoint가 글자를 줄여 상자에 맞춘다 (fit: shrink)
export async function exportPptx(saved) {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'TB_4X3', width: 10, height: 7.5 }) // 4:3 (담당자 회신 11/10)
  pptx.layout = 'TB_4X3'
  pptx.title = saved.report.title
  const W = 10
  const M = 0.5
  const meta = `${formatDate(saved.createdAt)} · ${saved.periodLabel ?? ''} · 기사 ${saved.articles.length}건 기준`
  const sections = saved.report.sections

  // 기사에서 확인된 내용 → (줄 바꿔) AI 해설·제안 순서. 둘을 섞지 않는다 (15 문서 F15)
  function runs(list) {
    const facts = (list ?? []).filter((b) => !b.excluded && kindOf(b) === 'fact')
    const ai = (list ?? []).filter((b) => !b.excluded && kindOf(b) === 'ai')
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
    slide.addText(title, { x: M, y: 0.3, w: W - 2 * M - 3.2, h: 0.55, fontFace: FONT_KO, fontSize: 18, bold: true, color: INK, fit: 'shrink' })
    slide.addText(sub, { x: W - M - 3.2, y: 0.38, w: 3.2, h: 0.4, fontFace: FONT_KO, fontSize: 10, color: MUTED, align: 'right' })
    slide.addShape(pptx.ShapeType.line, { x: M, y: 0.9, w: W - 2 * M, h: 0, line: { color: INK, width: 1.5 } })
  }
  function footer(slide, text) {
    slide.addText(text, { x: M, y: 7.05, w: W - 2 * M, h: 0.3, fontFace: FONT_KO, fontSize: 10, color: MUTED })
  }

  const page = pptx.addSlide()
  header(page, saved.report.title, meta)
  const h = saved.report.headline
  page.addShape(pptx.ShapeType.rect, { x: M, y: 1.02, w: W - 2 * M, h: 1.05, fill: { color: 'F3F6FA' }, line: { color: 'F3F6FA' } })
  page.addText(
    h?.text ? [{ text: h.text, options: { color: INK, bold: true } }, ...(h.refs?.length ? [{ text: ` [${h.refs.join('][')}]`, options: { color: ACCENT, fontSize: 11, bold: false } }] : [])] : [{ text: '헤드라인 없음 (예전 형식 보고서)', options: { color: MUTED } }],
    { x: M + 0.15, y: 1.05, w: W - 2 * M - 0.3, h: 1.0, fontFace: FONT_KO, fontSize: 16, valign: 'middle', fit: 'shrink' },
  )
  const colW = (W - 2 * M - 0.3) / 2
  box(page, '핵심 사실 근거', sections.summary?.bullets, M, 2.25, colW, 4.55)
  box(page, '시사점 및 제언', sections.implications?.bullets, M + colW + 0.3, 2.25, colW, 4.55)
  footer(page, `출처: ${sourcesLine(saved)} · [n]은 근거 번호(유첨) · AI 초안, 확인 후 사용`)

  const apx = pptx.addSlide()
  header(apx, '유첨 1 · 상세 분석', saved.report.title)
  box(apx, '기술 개요', sections.tech?.bullets, M, 1.1, W - 2 * M, 2.8)
  box(apx, '업계 동향 · 경쟁사', sections.industry?.bullets, M, 4.0, W - 2 * M, 2.9)
  footer(apx, `모델 ${saved.model ?? ''} · AI 해설 · 제안은 기사에서 확인된 내용이 아님`)

  const analysis = (saved.report.analysis ?? []).filter((a) => a.competitors)
  if (analysis.length) {
    const sl = pptx.addSlide()
    header(sl, '유첨 2 · 분석 자료 (규칙 계산)', saved.report.title)
    let y = 1.1
    for (const a of analysis.slice(0, 2)) {
      const c = a.competitors
      sl.addText(`${a.keyword}${a.stage ? ` · 단계 ${a.stage.stage}` : ''} · 「${c.name}」 특허 (같은 발명 한 번, ${c.years})${c.verdict ? ` · 자사에 ${c.verdict}` : ''}`, {
        x: M, y, w: W - 2 * M, h: 0.4, fontFace: FONT_KO, fontSize: 12, bold: true, color: INK,
      })
      const rows = [['회사', '앞 3년', '최근 3년', '변화'], ...[...c.companies.filter((x) => !x.unsure), { name: '분야 전체', ...c.field }].map((x) => [x.name, String(x.before ?? ''), String(x.now ?? ''), x.ratio != null ? `${x.ratio}배` : '-'])]
      sl.addTable(rows.map((r, i) => r.map((t) => ({ text: t, options: { fontFace: FONT_KO, fontSize: 10, bold: i === 0, color: i === 0 ? MUTED : INK } }))), { x: M, y: y + 0.45, w: W - 2 * M, colW: [3.4, 1.7, 1.7, 2.2], border: { type: 'solid', color: 'DDE2EA', pt: 0.5 } })
      y += 0.45 + 0.3 * rows.length + 0.4
    }
    footer(sl, '출처: 디스플레이 특허 DB (Google Patents Public Data, IFI CLAIMS · Google, CC BY 4.0) · 출원인 이름 기준')
  }

  const refs = pptx.addSlide()
  header(refs, '근거 기사', saved.report.title)
  refs.addText(
    saved.articles.map((a, i) => ({
      text: `[${i + 1}] ${a.title} — ${a.source}${a.publishedAt ? `, ${formatDate(a.publishedAt)}` : ''}${a.fulltext === false ? ' (발췌문으로 작성)' : ''}`,
      options: { breakLine: i < saved.articles.length - 1, hyperlink: a.url ? { url: a.url } : undefined },
    })),
    { x: M, y: 1.1, w: W - 2 * M, h: 5.8, fontFace: FONT_KO, fontSize: 10, color: INK, valign: 'top', paraSpaceAfter: 6, fit: 'shrink' },
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

