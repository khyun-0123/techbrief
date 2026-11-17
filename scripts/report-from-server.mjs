// 서버의 보고서를 보고서팀 PPT 양식 JSON으로 (11/17) — scripts/report-template.mjs --from 이 가져다 쓴다
//   node scripts/report-template.mjs --from http://localhost:3038 [--index 0] out.pptx
//   node scripts/report-template.mjs --from reports.json [--index 0] out.pptx
// 옮기는 규칙은 server/reportToTemplate.js 한 곳 (앱의 「담당자 양식 PPT」 내려받기와 같음)
import { readFileSync } from 'node:fs'
import { reportToTemplate } from '../server/reportToTemplate.js'

export { reportToTemplate }

// from: 서버 주소(http…) 또는 /api/reports 응답을 저장한 파일. index 0 = 가장 최근 보고서
export async function loadFromServer(from, index = 0) {
  const body = /^https?:\/\//.test(from) ? await (await fetch(`${from.replace(/\/$/, '')}/api/reports`)).json() : JSON.parse(readFileSync(from, 'utf8'))
  const list = (Array.isArray(body) ? body : body.reports ?? []).filter((e) => !e.deletedAt)
  if (!list.length) throw new Error('보고서가 없어요')
  const entry = list[Math.min(Math.max(0, index), list.length - 1)]
  return { entry, trends: null, total: list.length }
}
