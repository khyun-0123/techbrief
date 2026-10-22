// 만든 보고서 보관함 (localStorage). 새 보고서가 앞에 온다
import { load } from './utils.js'

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
  localStorage.removeItem(OLD_REPORT_KEY)
  return migrated
}

export function saveReports(list) {
  localStorage.setItem(REPORTS_KEY, JSON.stringify(list.slice(0, MAX_REPORTS)))
}

// 보고서가 어떤 기사들로 만들어졌는지 비교할 때 쓰는 열쇠
export function articleKey(ids) {
  return [...ids].sort().join('|')
}

export const SECTIONS = [
  ['summary', '핵심 요약'],
  ['tech', '기술 개요'],
  ['industry', '업계 동향'],
  ['implications', '시사점'],
]

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
  const lines = [`${report.title} (${formatDate(createdAt)} · 기사 ${articles.length}건 기준)`, '']
  for (const [key, label] of SECTIONS) {
    lines.push(`■ ${label}`)
    for (const b of report.sections[key]?.bullets ?? []) {
      lines.push(` - ${b.text}${b.refs.length ? ` [${b.refs.join('][')}]` : ' (근거 확인 필요)'}`)
    }
    lines.push('')
  }
  lines.push('[근거 기사]')
  articles.forEach((a, i) =>
    lines.push(`[${i + 1}] ${a.title} — ${a.source}${a.publishedAt ? `, ${formatDate(a.publishedAt)}` : ''}${a.url ? ` ${a.url}` : ''}`),
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
