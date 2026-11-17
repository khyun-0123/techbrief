// 만든 보고서 보관함 (localStorage). 새 보고서가 앞에 온다
import { load, save } from './utils.js'

const REPORTS_KEY = 'techbrief-reports'
const OLD_REPORT_KEY = 'techbrief-report' // 데모 1차의 '마지막 초안' 하나
const MAX_REPORTS = 30

export function loadReports() {
  const list = load(REPORTS_KEY, null)
  if (list) return list
  // 예전 형식(마지막 초안 하나)이 있으면 보관함으로 옮긴다
  const old = load(OLD_REPORT_KEY, null)
  const migrated = old?.report ? [{ ...old, id: old.createdAt }] : []
  saveReports(migrated)
  try {
    localStorage.removeItem(OLD_REPORT_KEY)
  } catch {
    // 저장소를 못 쓰면 그대로
  }
  return migrated
}

export function saveReports(list) {
  save(REPORTS_KEY, list.slice(0, MAX_REPORTS)) // DB가 없을 때만 쓰임. 저장 못 해도 화면은 계속 (11/17)
}

// 보고서가 어떤 기사들로 만들어졌는지 비교할 때 쓰는 열쇠
export function articleKey(ids) {
  return [...ids].sort().join('|')
}

// 기사에서 확인된 사실(fact)인지 AI 해설·제안(ai)인지 (15 문서 F15). 예전 보고서는 근거 번호로 판단
export function kindOf(b) {
  return b.kind ?? (b.refs?.length ? 'fact' : 'ai')
}

// 11/12: 담당자 회신(11/10, 35 문서) — 1페이지 = 헤드라인 · 핵심 사실 근거 · 시사점 및 제언 · 출처, 상세(기술 개요 · 업계 동향)는 유첨
// 섹션 키는 그대로 (예전 보고서도 같은 자리에 보인다)
export const SECTIONS = [
  ['summary', '핵심 사실 근거'],
  ['implications', '시사점 및 제언'],
  ['tech', '기술 개요'],
  ['industry', '업계 동향 · 경쟁사'],
]
export const APPENDIX = new Set(['tech', 'industry'])

// ④ 출처 한 줄 (서버가 센 값. 예전 보고서는 기사 수만)
export function sourcesLine(saved) {
  const s = saved.report.sources
  const n = s?.articles ?? saved.articles.filter((a) => !a.supplement && !a.analysis).length
  return [s?.period && `수집 기간 ${s.period}`, `기사 ${n}건`, ...(s?.analysis ?? []).map((x) => `분석: ${x}`)].filter(Boolean).join(' · ')
}

export function formatDate(iso, withTime = false) {
  if (!iso) return ''
  const opts = withTime
    ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { month: 'numeric', day: 'numeric' }
  return new Date(iso).toLocaleString('ko-KR', opts)
}

// 업무망 문서에 붙여 넣기 좋은 개조식 텍스트
export function toPlainText(saved) {
  const { report, articles, createdAt } = saved
  const lines = [`${report.title} (${formatDate(createdAt)} · 기사 ${articles.filter((a) => !a.supplement).length}건 기준)`, '']
  if (report.direction) lines.push(`방향: ${report.direction}`, '')
  if (report.headline?.text) lines.push(`▶ ${report.headline.text}${report.headline.refs?.length ? ` [${report.headline.refs.join('][')}]` : ''}`, '')
  let appendix = false
  for (const [key, label] of SECTIONS) {
    if (APPENDIX.has(key) && !appendix) {
      lines.push(`■ 출처: ${sourcesLine(saved)}`, '', '──── 유첨 ────', '')
      appendix = true
    }
    lines.push(`■ ${label}`)
    const bullets = (report.sections[key]?.bullets ?? []).filter((b) => !b.excluded) // 뺀 줄은 넣지 않는다
    const facts = bullets.filter((b) => kindOf(b) === 'fact')
    const ai = bullets.filter((b) => kindOf(b) === 'ai')
    for (const b of facts) lines.push(` - ${b.tag ? `(${b.tag}) ` : ''}${b.text} [${b.refs.join('][')}]`)
    if (ai.length) {
      lines.push('  (AI 해설·제안 — 기사에서 확인된 내용 아님, 확인 필요)')
      for (const b of ai) lines.push(`  · ${b.tag ? `(${b.tag}) ` : ''}${b.text}`)
    }
    lines.push('')
  }
  lines.push('[근거 기사]')
  articles.forEach((a, i) =>
    lines.push(`[${i + 1}] ${a.supplement ? '(보충) ' : ''}${a.title} — ${a.source}${a.publishedAt ? `, ${formatDate(a.publishedAt)}` : ''}${a.url ? ` ${a.url}` : ''}`),
  )
  return lines.join('\n')
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}
