// 「내 보고서 · 선별 정리본」 (11/09 조장): 내가 만든 보고서 전문 + 선별 목록(폴더별, 한 줄 요약)을 HTML 파일 하나로
// 브라우저로 열어 읽고, 인쇄하면 PDF로 남길 수 있다. 바깥 파일 · 글꼴 없이 혼자 열린다
import { SECTIONS, formatDate } from './reportStore.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const kindOf = (b) => b.kind ?? (b.refs?.length ? 'fact' : 'ai')
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('ko-KR') : '')

function reportHtml(saved, n) {
  const { report, articles, createdAt } = saved
  const base = articles.filter((a) => !a.supplement).length
  const parts = [`<section class="report"><h2>${n}. ${esc(report.title)}</h2><p class="meta">${esc(formatDate(createdAt, true))} · 기사 ${base}건 기준</p>`]
  if (report.direction) parts.push(`<p class="dir">방향: ${esc(report.direction)}</p>`)
  for (const [key, label] of SECTIONS) {
    const bullets = (report.sections?.[key]?.bullets ?? []).filter((b) => !b.excluded)
    if (!bullets.length) continue
    const facts = bullets.filter((b) => kindOf(b) === 'fact')
    const ai = bullets.filter((b) => kindOf(b) === 'ai')
    parts.push(`<h3>${esc(label)}</h3><ul>${facts.map((b) => `<li>${esc(b.text)} <sup>[${(b.refs ?? []).join('][')}]</sup></li>`).join('')}</ul>`)
    if (ai.length) parts.push(`<div class="ai"><p>AI 해설·제안 — 기사에서 확인된 내용이 아니에요</p><ul>${ai.map((b) => `<li>${esc(b.text)}</li>`).join('')}</ul></div>`)
  }
  parts.push(
    `<h3>근거 기사</h3><ol class="refs">${articles
      .map((a) => `<li>${a.supplement ? '(보충) ' : ''}${a.url ? `<a href="${esc(a.url)}">${esc(a.title)}</a>` : esc(a.title)} — ${esc(a.source)}${a.publishedAt ? `, ${esc(day(a.publishedAt))}` : ''}</li>`)
      .join('')}</ol></section>`,
  )
  return parts.join('')
}

// folders: [{ name, articles: [{ title, source, publishedAt, url, headline, included }] }]
export function buildBundleHtml({ reports, folders }) {
  const now = new Date()
  const selCount = folders.reduce((n, f) => n + f.articles.length, 0)
  const selection = folders
    .filter((f) => f.articles.length)
    .map(
      (f) =>
        `<h3>${esc(f.name)} <small>${f.articles.length}건</small></h3><table><thead><tr><th>제목</th><th>출처 · 발행</th><th>한 줄 요약</th></tr></thead><tbody>${f.articles
          .map(
            (a) =>
              `<tr><td>${a.included ? '✓ ' : ''}${a.url ? `<a href="${esc(a.url)}">${esc(a.title)}</a>` : esc(a.title)}</td><td class="nowrap">${esc(a.source)}${a.publishedAt ? `<br>${esc(day(a.publishedAt))}` : ''}</td><td>${a.headline ? esc(a.headline) : '<span class="muted">요약 전</span>'}</td></tr>`,
          )
          .join('')}</tbody></table>`,
    )
    .join('')
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>테크브리프 정리본 ${esc(now.toLocaleDateString('ko-KR'))}</title>
<style>
body{max-width:880px;margin:32px auto;padding:0 20px;font-family:"Pretendard","Malgun Gothic",sans-serif;color:#111;line-height:1.6}
h1{margin:0 0 4px;font-size:26px}h2{margin:32px 0 4px;padding-top:16px;border-top:2px solid #111;font-size:20px}
h3{margin:18px 0 6px;padding-left:8px;border-left:3px solid #111;font-size:16px}h3 small{color:#777;font-weight:400}
.meta,.lead{color:#666;font-size:13px}.dir{padding:8px 12px;background:#f5f3ef;font-size:14px}
.ai{margin:6px 0;padding-left:12px;border-left:2px dashed #c25e00;color:#555}.ai p{margin:0;color:#c25e00;font-size:12px;font-weight:700}
ul,ol{margin:4px 0;padding-left:22px}sup{color:#666}.refs{font-size:13px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
th{background:#f5f3ef;font-weight:600}.nowrap{white-space:nowrap}.muted{color:#999}a{color:#111}
@media print{body{margin:0}h2{break-before:page}h2:first-of-type{break-before:auto}}
</style></head><body>
<h1>테크브리프 정리본</h1>
<p class="lead">${esc(now.toLocaleString('ko-KR'))} 받음 · 내 보고서 ${reports.length}개 · 선별 ${selCount}건. AI가 만든 초안이 들어 있어요. 근거 기사를 확인하고 쓰세요.</p>
${reports.length ? reports.map((r, i) => reportHtml(r, i + 1)).join('') : '<h2>내 보고서</h2><p class="muted">내가 만든 보고서가 없어요.</p>'}
<h2>선별 목록</h2>
${selection || '<p class="muted">선별한 기사가 없어요.</p>'}
</body></html>`
}
