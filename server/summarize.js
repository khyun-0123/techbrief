// 기사 한 건(+ 같은 이슈 기사)의 6항목 요약을 만든다. 화면 요청(/api/summaries)과 자동 최신화가 같이 쓴다
import { articleId } from './collector/normalize.js'
import { getSummary, saveSummary } from './db/store.js'
import { chatJson, PRIORITY } from './llm/client.js'
import { isSupported, stripInlineRefs } from './llm/evidence.js'
import { buildSummaryMessages, SUMMARY_SCHEMA } from './llm/prompts.js'

// 요약 항목의 '기사 근거' 표시를 원래 기사 텍스트로 다시 확인한다 (llm/evidence.js)
// 기사에 거의 없는 내용이면 'AI 보충'으로 바꾸고 근거 번호를 지운다
function checkBasis(summary, articles) {
  if (!summary?.items) return summary
  const evidence = articles.map((a) => [a.title, a.description].filter(Boolean).join(' ')).join(' ')
  let changed = 0
  for (const item of Object.values(summary.items)) {
    item.text = stripInlineRefs(item.text ?? '')
    if (item.basis !== 'article') {
      item.refs = []
    } else if (!isSupported(item.text, evidence)) {
      item.basis = 'ai_background'
      item.refs = []
      changed += 1
    } else {
      const refs = (item.refs ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= articles.length)
      item.refs = refs.length ? [...new Set(refs)] : [1]
    }
  }
  if (changed) summary.warnings = [...(summary.warnings ?? []), `기사 내용과 맞지 않아 ${changed}개 항목을 'AI 보충'으로 바꿈`]
  return summary
}

export function idOf(article) {
  return String(article.id ?? (article.url ? articleId(article.url) : article.title))
}

// 저장된 요약이 있으면 그대로 (cached: true), 없으면 AI로 만들어 저장한다
// 같은 이슈 기사들(related)도 이 요약을 함께 쓰게 해 둔다 → 다시 요약하지 않음
// priority: 사람이 누른 요약은 PRIORITY.USER(기본), 자동 최신화는 PRIORITY.BACKGROUND
export async function summarizeArticle(article, related = [], { refresh = false, priority = PRIORITY.USER } = {}) {
  const id = idOf(article)
  if (!refresh) {
    const saved = await getSummary(id)
    if (saved) return { ...saved, cached: true }
  }
  const articles = [article, ...related]
  const { data, model } = await chatJson({
    messages: buildSummaryMessages(articles),
    schema: SUMMARY_SCHEMA,
    schemaName: 'article_summary',
    priority,
  })
  const result = { summary: checkBasis(data, articles), model, createdAt: new Date().toISOString() }
  await saveSummary(id, result, related.map((r) => (r.id || r.url ? idOf(r) : null)))
  return result
}
