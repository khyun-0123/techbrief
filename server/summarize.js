// 기사 한 건(+ 같은 이슈 기사)의 6항목 요약을 만든다. 화면 요청(/api/summaries)과 자동 최신화가 같이 쓴다
import { articleId } from './collector/normalize.js'
import { fetchBody } from './collector/fulltext.js'
import { articleUrlOf, getArticleText, getSummary, saveArticleText, saveSummary } from './db/store.js'
import { chatJson, PRIORITY } from './llm/client.js'
import { isSupported, stripInlineRefs } from './llm/evidence.js'
import { buildSummaryMessages, SUMMARY_SCHEMA } from './llm/prompts.js'

// 요약 항목의 '기사 근거' 표시를 원래 기사 텍스트로 다시 확인한다 (llm/evidence.js)
// 기사에 거의 없는 내용이면 'AI 보충'으로 바꾸고 근거 번호를 지운다
function checkBasis(summary, articles) {
  if (!summary?.items) return summary
  const evidence = articles.map((a) => [a.title, a.description, a.body].filter(Boolean).join(' ')).join(' ')
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
// 원문 기반 (11/07 결정): 대표 기사의 원문 본문을 가져와 함께 보낸다. 못 가져오면 지금처럼 발췌문으로 (「발췌문 기준」 표시)
// select: 「선별 추가」로 들어온 요청 → 원문을 DB에 저장(선별한 기사만, 90일). 예전 발췌문 요약이면 원문으로 다시 요약
const BODY_MAX = 4_000 // 요약에 넣는 본문 길이(글자). 같은 이슈 기사 요약문과 함께 문맥 안에 들어가게
export async function summarizeArticle(article, related = [], { refresh = false, priority = PRIORITY.USER, select = false } = {}) {
  const id = idOf(article)
  const saved = refresh ? null : await getSummary(id)
  if (saved && !(select && saved.summary?.basisSource !== 'fulltext')) return { ...saved, cached: true }
  const url = article.url || (await articleUrlOf(id))
  const stored = await getArticleText(id)
  const body = stored ?? (await fetchBody(url))
  if (select && body && !stored) await saveArticleText(id, url, body)
  // 선별했지만 원문을 못 가져왔고 예전 요약이 있으면 그대로 쓴다 (다시 해도 같은 발췌문 요약)
  if (saved && !body) return { ...saved, cached: true }
  const articles = [{ ...article, body: body ? body.slice(0, BODY_MAX) : null }, ...related]
  const { data, model } = await chatJson({
    messages: buildSummaryMessages(articles),
    schema: SUMMARY_SCHEMA,
    schemaName: 'article_summary',
    priority,
  })
  const summary = checkBasis(data, articles)
  summary.basisSource = body ? 'fulltext' : 'excerpt'
  const result = { summary, model, createdAt: new Date().toISOString() }
  await saveSummary(id, result, related.map((r) => (r.id || r.url ? idOf(r) : null)))
  return result
}

// 관리자 테스트 페이지(/admin/test)의 「요약 시험」: 저장하지 않고 지정한 AI 서버로 한 번 요약해 걸린 시간과 함께 돌려준다
// 공용 DB의 요약에는 영향이 없다. 사람이 누른 요약과 같은 순서로 대기열에 들어간다
export async function summarizeOnly(article, related = [], { provider } = {}) {
  const articles = [article, ...related]
  const started = Date.now()
  const { data, model, usage } = await chatJson({
    messages: buildSummaryMessages(articles),
    schema: SUMMARY_SCHEMA,
    schemaName: 'article_summary',
    priority: PRIORITY.USER,
    provider,
  })
  return { summary: checkBasis(data, articles), model, usage: usage ?? null, ms: Date.now() - started }
}
