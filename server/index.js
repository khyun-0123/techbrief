// 요약 API 서버. 실행: npm run server (키는 .env.local에서 읽고 브라우저로 보내지 않는다)
import { createServer } from 'node:http'
import { chatJson, modelName } from './llm/client.js'
import { buildSummaryMessages, SUMMARY_SCHEMA } from './llm/prompts.js'

const PORT = Number(process.env.API_PORT ?? 3001)
const MAX_BODY = 100_000

// 같은 기사는 다시 부르지 않는다 (서버를 끄면 비워짐. 화면 쪽은 localStorage에 따로 저장)
const cache = new Map()

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

async function readJson(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > MAX_BODY) throw Object.assign(new Error('요청이 너무 커요.'), { status: 413 })
  }
  try {
    return JSON.parse(raw || '{}')
  } catch {
    throw Object.assign(new Error('JSON 형식이 아니에요.'), { status: 400 })
  }
}

// 요약문 없이 제목만 넣었으면 컨셉 말고는 기사로 뒷받침할 수 없다.
// 모델이 "기사 근거"라고 해도 "AI 보충"으로 바꿔 근거 표시를 정직하게 유지한다
function checkBasis(summary, articles) {
  const hasBody = articles.some((a) => a.description)
  if (hasBody || !summary?.items) return summary
  let changed = false
  for (const [key, item] of Object.entries(summary.items)) {
    if (key !== 'concept' && item.basis === 'article') {
      item.basis = 'ai_background'
      item.refs = []
      changed = true
    }
  }
  if (changed) summary.warnings = [...(summary.warnings ?? []), '기사 제목만 있어 컨셉 외 항목은 AI 보충으로 표시함']
  return summary
}

async function handleSummary(req, res) {
  const { article, related = [], refresh = false } = await readJson(req)
  if (!article?.title) return send(res, 400, { error: 'article.title이 필요해요.' })

  const key = `${article.id ?? ''}:${article.title}`
  if (!refresh && cache.has(key)) return send(res, 200, { ...cache.get(key), cached: true })

  const articles = [article, ...related]
  const { data, model } = await chatJson({
    messages: buildSummaryMessages(articles),
    schema: SUMMARY_SCHEMA,
    schemaName: 'article_summary',
  })
  const result = { summary: checkBasis(data, articles), model, createdAt: new Date().toISOString() }
  cache.set(key, result)
  send(res, 200, result)
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      return send(res, 200, { ok: true, model: modelName() })
    }
    if (req.method === 'POST' && req.url === '/api/summaries') {
      return await handleSummary(req, res)
    }
    send(res, 404, { error: '없는 주소예요.' })
  } catch (err) {
    const status = err.status ?? (err.name === 'TimeoutError' ? 504 : 502)
    console.error(`[api] ${req.method} ${req.url} → ${status}: ${err.message}`)
    send(res, status, { error: err.message })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`요약 API 서버: http://127.0.0.1:${PORT} (모델 ${modelName() || '설정 없음'})`)
})
