// 요약 API. 보통은 npm run dev 하나로 화면과 같은 포트(PORT)에서 열린다 (vite.config.js).
// API만 따로 시험할 때: npm run server. 키는 .env.local에서 읽고 브라우저로 보내지 않는다
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { collect, listArticles, searchArticles } from './collector/index.js'
import { similarity } from './collector/dedupe.js'
import { dbEnabled, dbStatus } from './db/index.js'
import {
  deleteReport,
  getSummaries,
  getKeywords,
  listReports,
  saveReport,
  setKeywords,
  updateReportSection,
} from './db/store.js'
import { chatJson, modelName, pingModel, reportModelName } from './llm/client.js'
import { evidenceOf, hasHan, isSupported, stripInlineRefs } from './llm/evidence.js'
import {
  buildReportMessages,
  buildSectionMessages,
  REPORT_SCHEMA,
  SECTION_KEYS,
  SECTION_SCHEMA,
} from './llm/reportPrompts.js'
import { refreshStatus, saveRefreshSettings, startRefresh, startScheduler } from './refresh.js'
import { summarizeArticle } from './summarize.js'

const REPORT_TIMEOUT_MS = 240_000 // 보고서는 출력이 길어 요약보다 오래 걸린다
const MAX_REPORT_ARTICLES = 10

const MAX_BODY = 1_000_000 // 보고서 요청·보고서함 옮기기에는 기사 요약 여러 건이 들어간다

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

async function handleSummary(req, res) {
  const { article, related = [], refresh = false } = await readJson(req)
  if (!article?.title) return send(res, 400, { error: 'article.title이 필요해요.' })
  send(res, 200, await summarizeArticle(article, related, { refresh }))
}

// 같은 섹션에서 이 이상 비슷한 글머리는 하나로 합친다 (기사마다 같은 원리 설명이 반복되는 문제)
// 실측: 같은 원리 설명끼리 0.28~0.60, 서로 다른 내용끼리 0.05~0.06
const SAME_BULLET = 0.3

// 글머리의 근거 번호를 정리한다: 범위 밖 번호를 지우고, 그 기사 원문과 맞지 않는 번호도 지운다
function cleanBullets(bullets, articles) {
  const kept = []
  for (const b of bullets ?? []) {
    if (!b?.text?.trim()) continue
    const text = stripInlineRefs(b.text)
    const claimed = [...new Set((b.refs ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= articles.length))]
    const refs = claimed.filter((n) => isSupported(text, evidenceOf(articles[n - 1]))).sort((x, y) => x - y)
    const dup = kept.find((k) => similarity(k.text, text) >= SAME_BULLET)
    if (dup) {
      // 비슷한 글머리는 합치고 근거 번호만 모은다
      dup.refs = [...new Set([...dup.refs, ...refs])].sort((x, y) => x - y)
      continue
    }
    kept.push({ text, refs, removedRefs: claimed.filter((n) => !refs.includes(n)), han: hasHan(text) })
  }
  return kept
}

function reportWarnings(sections) {
  const all = Object.values(sections).flatMap((s) => s.bullets)
  const warnings = []
  const unsupported = all.filter((b) => b.refs.length === 0).length
  if (unsupported) warnings.push(`근거 기사가 확인되지 않은 문장 ${unsupported}개 — 확인 후 고치거나 지우세요`)
  if (all.some((b) => b.han)) warnings.push('한자·중국어가 섞인 문장이 있어요 — 한글로 고치세요')
  return warnings
}

function readReportArticles(body) {
  const articles = (body.articles ?? []).slice(0, MAX_REPORT_ARTICLES).map((a, i) => ({ ...a, n: i + 1 }))
  if (articles.length === 0) throw Object.assign(new Error('보고서에 넣을 기사가 없어요.'), { status: 400 })
  const missing = articles.filter((a) => !a.summary?.items)
  if (missing.length) {
    throw Object.assign(new Error(`AI 요약이 없는 기사가 ${missing.length}건 있어요. 먼저 요약해 주세요.`), { status: 400 })
  }
  return articles
}

async function handleReport(req, res) {
  const body = await readJson(req)
  const articles = readReportArticles(body)
  const title = body.title?.trim() || '테크 동향 브리핑'
  const { data, model } = await chatJson({
    messages: buildReportMessages(articles, { title, periodLabel: body.periodLabel ?? '오늘' }),
    schema: REPORT_SCHEMA,
    schemaName: 'report_draft',
    model: reportModelName(),
    timeoutMs: REPORT_TIMEOUT_MS,
  })
  const sections = Object.fromEntries(
    SECTION_KEYS.map((k) => [k, { bullets: cleanBullets(data.sections?.[k]?.bullets, articles) }]),
  )
  const createdAt = new Date().toISOString()
  // 보고서함에 넣을 한 건. DB가 있으면 서버에 저장하고, 없으면 화면이 브라우저에 저장한다
  const entry = {
    id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    articleKey: articles.map((a) => String(a.id ?? '')).sort().join('|'),
    report: { title, sections, warnings: [...reportWarnings(sections), ...(data.warnings ?? [])] },
    model,
    createdAt,
    periodLabel: body.periodLabel ?? '오늘',
    articles: articles.map(({ title: t, source, url, publishedAt }) => ({ title: t, source, url, publishedAt })),
    inputs: articles.map(({ n: _n, ...rest }) => rest),
  }
  if (dbEnabled()) await saveReport(entry)
  send(res, 200, { entry, stored: dbEnabled() })
}

async function handleReportSection(req, res) {
  const body = await readJson(req)
  const articles = readReportArticles(body)
  if (!SECTION_KEYS.includes(body.key)) return send(res, 400, { error: '없는 섹션이에요.' })
  const { data, model } = await chatJson({
    messages: buildSectionMessages(articles, { key: body.key, report: body.report }),
    schema: SECTION_SCHEMA,
    schemaName: 'report_section',
    model: reportModelName(),
    timeoutMs: REPORT_TIMEOUT_MS,
  })
  const bullets = cleanBullets(data.bullets, articles)
  if (body.reportId && dbEnabled()) await updateReportSection(body.reportId, body.key, bullets)
  send(res, 200, { key: body.key, bullets, model })
}

export { startScheduler }

// /api 요청을 처리한다. Vite 개발 서버와 단독 서버가 같이 쓴다
export async function handleApi(req, res) {
  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      const [modelReachable, db] = await Promise.all([pingModel(), dbStatus()])
      return send(res, 200, { ok: true, model: modelName(), modelReachable, db })
    }
    if (req.method === 'POST' && req.url === '/api/summaries') {
      return await handleSummary(req, res)
    }
    if (req.method === 'POST' && req.url === '/api/summaries/lookup') {
      const { ids = [] } = await readJson(req)
      return send(res, 200, { summaries: await getSummaries(ids.slice(0, 200).map(String)) })
    }
    if (req.method === 'POST' && req.url === '/api/collect') {
      const { keywords = [] } = await readJson(req)
      return send(res, 200, await collect(keywords))
    }
    if (req.method === 'GET' && req.url === '/api/refresh') {
      return send(res, 200, await refreshStatus())
    }
    if (req.method === 'PUT' && req.url === '/api/refresh/settings') {
      return send(res, 200, await saveRefreshSettings(await readJson(req)))
    }
    if (req.method === 'POST' && req.url === '/api/refresh/run') {
      const { keywords = [] } = await readJson(req)
      await startRefresh(keywords.map(String).slice(0, 20))
      return send(res, 202, await refreshStatus())
    }
    if (req.method === 'POST' && req.url === '/api/search') {
      const { query } = await readJson(req)
      return send(res, 200, await searchArticles(query))
    }
    if (req.method === 'GET' && req.url === '/api/articles') {
      return send(res, 200, await listArticles())
    }
    if (req.method === 'GET' && req.url === '/api/keywords') {
      return send(res, 200, { stored: dbEnabled(), keywords: dbEnabled() ? await getKeywords() : [] })
    }
    if (req.method === 'PUT' && req.url === '/api/keywords') {
      if (!dbEnabled()) return send(res, 400, { error: 'DB가 설정되지 않았어요.' })
      const { keywords = [] } = await readJson(req)
      return send(res, 200, { keywords: await setKeywords(keywords) })
    }
    if (req.method === 'GET' && req.url === '/api/reports') {
      return send(res, 200, { stored: dbEnabled(), reports: dbEnabled() ? await listReports() : [] })
    }
    if (req.method === 'POST' && req.url === '/api/reports/import') {
      // 브라우저(localStorage)에 있던 보고서함을 DB로 옮긴다. 이미 있는 건 건너뜀
      if (!dbEnabled()) return send(res, 400, { error: 'DB가 설정되지 않았어요.' })
      const { reports = [] } = await readJson(req)
      for (const r of reports.slice(0, 30)) if (r?.id && r.report) await saveReport(r)
      return send(res, 200, { reports: await listReports() })
    }
    if (req.method === 'DELETE' && req.url.startsWith('/api/reports/')) {
      await deleteReport(decodeURIComponent(req.url.slice('/api/reports/'.length)))
      return send(res, 200, { ok: true })
    }
    if (req.method === 'POST' && req.url === '/api/reports') {
      return await handleReport(req, res)
    }
    if (req.method === 'POST' && req.url === '/api/reports/section') {
      return await handleReportSection(req, res)
    }
    send(res, 404, { error: '없는 주소예요.' })
  } catch (err) {
    const status = err.status ?? (err.name === 'TimeoutError' ? 504 : 502)
    console.error(`[api] ${req.method} ${req.url} → ${status}: ${err.message}`)
    send(res, status, { error: err.message })
  }
}

// node server/index.js로 직접 실행했을 때만 단독 서버를 연다
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 3001)
  startScheduler()
  createServer(handleApi).listen(port, '127.0.0.1', () => {
    console.log(`요약 API 서버: http://127.0.0.1:${port} (모델 ${modelName() || '설정 없음'})`)
  })
}
