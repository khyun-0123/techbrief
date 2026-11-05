// 요약 API. 보통은 npm run dev 하나로 화면과 같은 포트(PORT)에서 열린다 (vite.config.js).
// API만 따로 시험할 때: npm run server. 키는 .env.local에서 읽고 브라우저로 보내지 않는다
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { collect, getSources, listArticles, saveSources, searchArticles } from './collector/index.js'
import { feedList } from './collector/feeds.js'
import { similarity } from './collector/dedupe.js'
import { fetchBodies } from './collector/fulltext.js'
import { getLists, saveLists } from './collector/lists.js'
import { getSetting, setSetting } from './db/store.js'
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
import { chatJson, llmProviders, modelName, pingModel, providerLabel, selectProvider } from './llm/client.js'
import { evidenceOf, hasHan, isProposal, isSupported, STRONG_OVERLAP, stripInlineRefs } from './llm/evidence.js'
import {
  buildReportMessages,
  buildSectionMessages,
  REPORT_SCHEMA,
  SECTION_KEYS,
  SECTION_SCHEMA,
} from './llm/reportPrompts.js'
import { adminConfigured, adminOf, changeLog, diffWords, login, logChange, logout, requireAdmin } from './admin.js'
import { refreshStatus, saveRefreshSettings, startRefresh, startScheduler as startRefreshScheduler } from './refresh.js'
import { featureList, FEATURES, getFeatures, saveFeatures } from './features.js'
import { summarizeArticle, summarizeOnly } from './summarize.js'
import { pruneUsage, recordClientEvent, usageStats } from './usage.js'
import { checkOps, getOps, OPS_LABEL, publicOps, saveOps } from './ops.js'

// 서버가 켜진 시각: 관리 페이지가 「다시 켜기」 뒤 새로 켜졌는지 알아보는 데 쓴다
const STARTED_AT = new Date().toISOString()
// npm run serve(scripts/serve.mjs)로 켰을 때만 「다시 켜기」를 할 수 있다. 이 종료 코드면 serve가 다시 켠다
const SUPERVISED = process.env.TECHBRIEF_SUPERVISED === '1'
const RESTART_EXIT_CODE = 75

const REPORT_TIMEOUT_MS = 240_000 // 보고서는 출력이 길어 요약보다 오래 걸린다
const MAX_REPORT_ARTICLES = 10

const MAX_BODY = 1_000_000 // 보고서 요청·보고서함 옮기기에는 기사 요약 여러 건이 들어간다

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
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
// kind: 기사에서 확인된 사실(fact)과 AI 해설·제안(ai)을 나눈다 (15 문서 F15).
// 모델의 분류만 믿지 않고 규칙과 함께 정한다. 실측: 모델은 업계 동향의 기사 사실도 ai·근거 없음으로 자주 표시하고,
// 글자 겹침만으로는 원문 단어를 많이 쓴 제안 문장(~할 수 있음)과 사실을 가르지 못함
// - 제안·전망 끝맺음(~할 수 있음, 기대됨, 필요함 …) → ai
// - 모델이 fact라고 한 문장: 원문과 맞는 근거(겹침 0.35 이상)가 있으면 fact
// - 모델이 ai라고 한 문장: 원문과 아주 많이 겹치면(0.6 이상) 사실로 보고 fact
// - 그 밖은 ai (원리 설명·일반 지식·제안)
function cleanBullets(bullets, articles) {
  const kept = []
  for (const b of bullets ?? []) {
    if (!b?.text?.trim()) continue
    const text = stripInlineRefs(b.text)
    const claimed = [...new Set((b.refs ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= articles.length))]
    const all = articles.map((_, i) => i + 1)
    const min = b.kind === 'ai' ? STRONG_OVERLAP : undefined
    let verified = b.kind === 'ai' ? [] : claimed.filter((n) => isSupported(text, evidenceOf(articles[n - 1])))
    if (verified.length === 0) verified = all.filter((n) => isSupported(text, evidenceOf(articles[n - 1]), min))
    if (isProposal(text)) verified = []
    verified.sort((x, y) => x - y)
    const kind = verified.length ? 'fact' : 'ai'
    const refs = kind === 'fact' ? verified : []
    const dup = kept.find((k) => k.kind === kind && similarity(k.text, text) >= SAME_BULLET)
    if (dup) {
      // 비슷한 글머리는 합치고 근거 번호만 모은다
      dup.refs = [...new Set([...dup.refs, ...refs])].sort((x, y) => x - y)
      continue
    }
    kept.push({ text, refs, kind, removedRefs: claimed.filter((n) => !refs.includes(n)), han: hasHan(text) })
  }
  return kept
}

function reportWarnings(sections) {
  const all = Object.values(sections).flatMap((s) => s.bullets)
  const warnings = []
  const ai = all.filter((b) => b.kind === 'ai').length
  if (ai) warnings.push(`AI 해설·제안 ${ai}개는 기사에서 확인된 내용이 아니에요 — 확인 후 쓰세요`)
  if (all.some((b) => b.han)) warnings.push('한자·중국어가 섞인 문장이 있어요 — 한글로 고치세요')
  return warnings
}

// 원문 본문을 붙인다 (13 문서 9절). 기사마다 길이를 나눠 전체 입력이 문맥 크기를 넘지 않게 한다
const BODY_BUDGET = 12_000 // 모든 기사 본문 합계(글자). LLM_NUM_CTX=16384 기준 여유 있게
async function attachBodies(articles) {
  const per = Math.min(2_500, Math.floor(BODY_BUDGET / articles.length))
  const bodies = await fetchBodies(articles.map((a) => a.url))
  articles.forEach((a, i) => {
    a.body = bodies[i] ? bodies[i].slice(0, per) : null
  })
  return articles
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
  const articles = await attachBodies(readReportArticles(body))
  const title = body.title?.trim() || '테크 동향 브리핑'
  const { data, model } = await chatJson({
    messages: buildReportMessages(articles, { title, periodLabel: body.periodLabel ?? '오늘' }),
    schema: REPORT_SCHEMA,
    schemaName: 'report_draft',
    report: true,
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
    // fulltext: 원문 본문을 반영했는지 (화면 근거 기사 목록에 표시). 본문 자체는 저장하지 않는다
    articles: articles.map(({ title: t, source, url, publishedAt, body: b }) => ({ title: t, source, url, publishedAt, fulltext: Boolean(b) })),
    inputs: articles.map(({ n: _n, body: _b, ...rest }) => rest),
  }
  if (dbEnabled()) await saveReport(entry)
  send(res, 200, { entry, stored: dbEnabled() })
}

async function handleReportSection(req, res) {
  const body = await readJson(req)
  const articles = await attachBodies(readReportArticles(body))
  if (!SECTION_KEYS.includes(body.key)) return send(res, 400, { error: '없는 섹션이에요.' })
  const { data, model } = await chatJson({
    messages: buildSectionMessages(articles, { key: body.key, report: body.report }),
    schema: SECTION_SCHEMA,
    schemaName: 'report_section',
    report: true,
    timeoutMs: REPORT_TIMEOUT_MS,
  })
  const bullets = cleanBullets(data.bullets, articles)
  if (body.reportId && dbEnabled()) await updateReportSection(body.reportId, body.key, bullets)
  send(res, 200, { key: body.key, bullets, model })
}

// 서버가 켜질 때: 관리자가 고른 AI 서버를 되살리고(17 문서 3-3) 자동 최신화 예약을 시작한다
const LLM_SETTING = 'llm_provider'
export function startScheduler() {
  getSetting(LLM_SETTING, null)
    .then((id) => id && selectProvider(id))
    .catch((err) => console.warn(`[llm] 저장된 AI 서버를 쓸 수 없어 기본값으로: ${err.message}`))
  startRefreshScheduler()
  // 사용 현황 원본은 90일만 둔다: 켜질 때 한 번, 그 뒤 하루 한 번
  const prune = () => pruneUsage().catch((err) => console.warn(`[usage] 오래된 기록 정리 실패: ${err.message}`))
  prune()
  setInterval(prune, 86_400_000).unref()
}

// 일반 사용자의 「지금 최신화」는 10분에 한 번 (17 문서 3-2). 관리자는 제한 없음
const RUN_COOLDOWN_MS = 10 * 60_000
async function checkRunCooldown(req) {
  if (adminOf(req)) return
  const { lastRunAt, running } = await refreshStatus()
  if (running) return // 이미 돌고 있으면 startRefresh가 알아서 합친다
  const wait = lastRunAt ? Date.parse(lastRunAt) + RUN_COOLDOWN_MS - Date.now() : 0
  if (wait > 0) {
    throw Object.assign(new Error(`방금 최신화했어요. ${Math.ceil(wait / 60_000)}분 뒤 다시 누를 수 있어요.`), { status: 429 })
  }
}

// /api 요청을 처리한다. Vite 개발 서버와 단독 서버가 같이 쓴다
export async function handleApi(req, res) {
  try {
    // 운영 상태(점검 중 · AI 정지)면 일반 사용자의 요청을 막는다. 관리자는 그대로 (19 문서 6장)
    if (!adminOf(req)) await checkOps(req)
    if (req.method === 'GET' && req.url === '/api/health') {
      const [modelReachable, db] = await Promise.all([pingModel(), dbStatus()])
      return send(res, 200, {
        ok: true,
        model: modelName(),
        modelReachable,
        db,
        llm: llmProviders(),
        server: { startedAt: STARTED_AT, supervised: SUPERVISED },
      })
    }
    if (req.method === 'GET' && req.url === '/api/ops') {
      return send(res, 200, publicOps(await getOps()))
    }
    if (req.method === 'PUT' && req.url === '/api/admin/ops') {
      const admin = requireAdmin(req)
      const saved = await saveOps(await readJson(req), admin.name)
      const extra = [saved.message && `「${saved.message}」`, saved.until && `${saved.until} 재개 예정`].filter(Boolean).join(' · ')
      await logChange(admin, '운영 상태', `${OPS_LABEL[saved.mode]}${extra ? ` · ${extra}` : ''}`)
      return send(res, 200, publicOps(saved))
    }
    if (req.method === 'POST' && req.url === '/api/admin/restart') {
      // 서버 다시 켜기: 이 프로세스를 끝내면 npm run serve가 다시 켠다 (npm run dev로 켰으면 꺼진 채 남으므로 막음)
      const admin = requireAdmin(req)
      if (!SUPERVISED) {
        return send(res, 409, { error: '이 서버는 npm run dev로 켜져 있어 여기서 다시 켤 수 없어요. 서버 PC에서 npm run serve로 켜 주세요.' })
      }
      await logChange(admin, '서버', '다시 켜기')
      send(res, 202, { ok: true, startedAt: STARTED_AT })
      console.log(`[server] ${admin.name}이(가) 관리 페이지에서 다시 켜기를 눌렀어요`)
      setTimeout(() => process.exit(RESTART_EXIT_CODE), 300)
      return
    }
    // ── 관리자 (17 문서) ──
    if (req.method === 'GET' && req.url === '/api/admin/me') {
      return send(res, 200, { configured: adminConfigured(), admin: adminOf(req) })
    }
    if (req.method === 'POST' && req.url === '/api/admin/login') {
      const result = login(await readJson(req))
      if (result.reset) return send(res, 200, { reset: true }) // 잠금 리셋: 로그인은 하지 않음
      return send(res, 200, { admin: { name: result.name } }, { 'Set-Cookie': result.cookie })
    }
    if (req.method === 'POST' && req.url === '/api/admin/logout') {
      return send(res, 200, { ok: true }, { 'Set-Cookie': logout(req) })
    }
    // 실험 기능: 누구나 읽고(화면이 무엇을 보일지 정함), 관리자만 바꾼다
    if (req.method === 'GET' && req.url === '/api/features') {
      return send(res, 200, { features: await getFeatures(), list: featureList() })
    }
    if (req.method === 'PUT' && req.url === '/api/features') {
      const admin = requireAdmin(req)
      const before = await getFeatures()
      const after = await saveFeatures(await readJson(req))
      const STATE = { off: '꺼짐', test: '테스트에서만', all: '모두에게' }
      for (const f of FEATURES) {
        if (before[f.key] !== after[f.key]) await logChange(admin, '실험 기능', `${f.label}: ${STATE[before[f.key]]} → ${STATE[after[f.key]]}`)
      }
      return send(res, 200, { features: after, list: featureList() })
    }
    // 수집 출처 (14 문서 4-B): 네이버 밖 출처 목록 · 켜기/끄기 · 지난 수집 결과. 관리자만
    if (req.method === 'GET' && req.url === '/api/admin/sources') {
      requireAdmin(req)
      return send(res, 200, { list: feedList(), ...(await getSources()) })
    }
    if (req.method === 'PUT' && req.url === '/api/admin/sources') {
      const admin = requireAdmin(req)
      const before = (await getSources()).disabled
      const after = await saveSources(await readJson(req))
      const names = Object.fromEntries(feedList().map((f) => [f.id, f.name]))
      for (const f of feedList()) {
        const was = !before.includes(f.id)
        const now = !after.disabled.includes(f.id)
        if (was !== now) await logChange(admin, '수집 출처', `${names[f.id]}: ${was ? '켜짐' : '꺼짐'} → ${now ? '켜짐' : '꺼짐'}`)
      }
      return send(res, 200, { list: feedList(), ...after })
    }
    // 테스트 페이지 「요약 시험」: 저장하지 않고 고른 AI 서버로 요약 (관리자만, AI 비용이 들어서)
    if (req.method === 'POST' && req.url === '/api/admin/test/summary') {
      requireAdmin(req)
      const { article, related = [], provider } = await readJson(req)
      if (!article?.title) return send(res, 400, { error: 'article.title이 필요해요.' })
      return send(res, 200, await summarizeOnly(article, related.slice(0, 5), { provider }))
    }
    // 사용 현황 (17 문서 4장): 기록은 누구나 보내고(개인 정보 없음), 보기는 관리자만
    if (req.method === 'POST' && req.url === '/api/usage') {
      await recordClientEvent(await readJson(req))
      return send(res, 200, { ok: true })
    }
    if (req.method === 'GET' && req.url.startsWith('/api/admin/usage')) {
      requireAdmin(req)
      const days = Number(new URL(req.url, 'http://x').searchParams.get('days'))
      const keywords = dbEnabled() ? await getKeywords() : []
      return send(res, 200, await usageStats(days, keywords))
    }
    if (req.method === 'GET' && req.url === '/api/admin/log') {
      requireAdmin(req)
      return send(res, 200, { log: await changeLog() })
    }
    if (req.method === 'PUT' && req.url === '/api/llm') {
      // AI 서버 (맥미니 / OpenRouter). 모두에게 적용되므로 관리자만, DB에 저장해 다시 켜도 유지
      const admin = requireAdmin(req)
      const { provider } = await readJson(req)
      const result = selectProvider(provider)
      await setSetting(LLM_SETTING, provider)
      await logChange(admin, 'AI 모델', providerLabel())
      return send(res, 200, result)
    }
    if (req.method === 'POST' && req.url === '/api/summaries') {
      return await handleSummary(req, res)
    }
    if (req.method === 'POST' && req.url === '/api/summaries/lookup') {
      const { ids = [] } = await readJson(req)
      return send(res, 200, { summaries: await getSummaries(ids.slice(0, 200).map(String)) })
    }
    if (req.method === 'POST' && req.url === '/api/collect') {
      // 화면에서는 쓰지 않는 예전 API. 아무 키워드나 DB에 쌓을 수 있어 관리자만
      requireAdmin(req)
      const { keywords = [] } = await readJson(req)
      return send(res, 200, await collect(keywords))
    }
    if (req.method === 'GET' && req.url === '/api/refresh') {
      return send(res, 200, await refreshStatus())
    }
    if (req.method === 'PUT' && req.url === '/api/refresh/settings') {
      // 자동 최신화 주기·자동 요약: 관리자만 (예전 비밀번호 잠금을 대신함)
      const admin = requireAdmin(req)
      const status = await saveRefreshSettings(await readJson(req))
      const s = status.settings
      const mode = s.mode === 'daily' ? `매일 ${s.time}` : s.mode === 'interval' ? `${s.hours}시간마다` : '꺼짐'
      await logChange(admin, '자동 최신화', `${mode} · 자동 요약 ${s.autoSummary === 'off' ? '꺼짐' : '켜짐'}`)
      return send(res, 200, status)
    }
    if (req.method === 'POST' && req.url === '/api/refresh/run') {
      await checkRunCooldown(req)
      const { keywords = [] } = await readJson(req)
      await startRefresh(keywords.map(String).slice(0, 20))
      return send(res, 202, await refreshStatus())
    }
    if (req.method === 'POST' && req.url === '/api/search') {
      const { query, period } = await readJson(req)
      return send(res, 200, await searchArticles(query, { period }))
    }
    if (req.method === 'GET' && req.url === '/api/favorites') {
      return send(res, 200, { favorites: await getSetting('favorite_queries', []) })
    }
    if (req.method === 'PUT' && req.url === '/api/favorites') {
      // 즐겨찾는 검색어 (13 문서 F3). 자동 수집 키워드와 별개, 팀 공용, 최대 30개
      const { favorites = [] } = await readJson(req)
      const list = [...new Set(favorites.map((q) => String(q).trim().slice(0, 50)).filter(Boolean))].slice(0, 30)
      await setSetting('favorite_queries', list)
      return send(res, 200, { favorites: list })
    }
    if (req.method === 'GET' && req.url === '/api/lists') {
      return send(res, 200, await getLists())
    }
    if (req.method === 'PUT' && req.url === '/api/lists') {
      // 자사·경쟁사·관심 기술: 중요도 점수에 쓰여 모두에게 영향 → 관리자만
      const admin = requireAdmin(req)
      const before = await getLists()
      const saved = await saveLists(await readJson(req))
      const names = { own: '자사·자회사', competitors: '경쟁사', interests: '관심 기술' }
      for (const [key, label] of Object.entries(names)) {
        const d = diffWords(before[key], saved[key])
        if (d !== '변경 없음') await logChange(admin, label, d)
      }
      return send(res, 200, saved)
    }
    if (req.method === 'GET' && req.url === '/api/articles') {
      return send(res, 200, await listArticles())
    }
    if (req.method === 'GET' && req.url === '/api/keywords') {
      return send(res, 200, { stored: dbEnabled(), keywords: dbEnabled() ? await getKeywords() : [] })
    }
    if (req.method === 'PUT' && req.url === '/api/keywords') {
      // 자동 수집 키워드: 관리자만
      const admin = requireAdmin(req)
      if (!dbEnabled()) return send(res, 400, { error: 'DB가 설정되지 않았어요.' })
      const before = await getKeywords()
      const { keywords = [] } = await readJson(req)
      const saved = await setKeywords(keywords)
      await logChange(admin, '자동 수집 키워드', diffWords(before, saved))
      return send(res, 200, { keywords: saved })
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
      // 공용 보고서함에서 지우면 되돌릴 수 없어 관리자만 (17 문서 3-3)
      const admin = requireAdmin(req)
      const id = decodeURIComponent(req.url.slice('/api/reports/'.length))
      await deleteReport(id)
      await logChange(admin, '보고서 삭제', id)
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
    send(res, status, { error: err.message, ...(err.locked && { locked: true }), ...(err.ops && { ops: true }) })
  }
}

// node server/index.js로 직접 실행했을 때만 단독 서버를 연다
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 3001)
  startScheduler()
  createServer(handleApi).listen(port, '127.0.0.1', () => {
    console.log(`요약 API 서버: http://127.0.0.1:${port} (${providerLabel()} 모델 ${modelName() || '설정 없음'})`)
  })
}
