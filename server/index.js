// 요약 API. 보통은 npm run dev 하나로 화면과 같은 포트(PORT)에서 열린다 (vite.config.js).
// API만 따로 시험할 때: npm run server. 키는 .env.local에서 읽고 브라우저로 보내지 않는다
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { collect, getSources, listArticles, saveSources, searchArticles } from './collector/index.js'
import { feedList } from './collector/feeds.js'
import { getTrends } from './trends.js'
import { paperProviderStatus } from './papers/index.js'
import { popularPapers } from './papers/journals.js'
import { getTechTrends, startTechTrends } from './techtrends.js'
import { similarity } from './collector/dedupe.js'
import { fetchBodies } from './collector/fulltext.js'
import { getLists, saveLists } from './collector/lists.js'
import { getArticleText, getSelection, getSetting, pruneArticleTexts, saveSelection, setSetting } from './db/store.js'
import { addMaterial, deleteMaterial, listMaterials, materialBlocksAi } from './materials.js'
import { lookupWiki } from './wiki.js'
import { dbEnabled, dbStatus } from './db/index.js'
import {
  deleteReport,
  getSummaries,
  getKeywords,
  listReports,
  saveReport,
  setKeywords,
  reportOwnerIp,
  deleteReportsOlderThan,
  updateReport,
  updateReportSection,
} from './db/store.js'
import { reinforceBullet } from './reinforce.js'
import { searchPaperArticles } from './searchPapers.js'
import { addJob, answerJob, cancelJob, listJobs, setDraftBuilder } from './reportJobs.js'
import { chatJson, llmProviders, modelName, pingModel, providerLabel, selectProvider } from './llm/client.js'
import { evidenceOf, hasHan, isProposal, isSupported, STRONG_OVERLAP, stripInlineRefs } from './llm/evidence.js'
import {
  buildMergeMessages,
  buildReportMessages,
  buildSectionMessages,
  REPORT_SCHEMA,
  SECTION_KEYS,
  SECTION_SCHEMA,
} from './llm/reportPrompts.js'
import { adminConfigured, adminHere, adminOf, changeLog, clientIp, diffWords, login, logChange, logout, requireAdmin } from './admin.js'
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

// 보고서 자동 삭제 주기 (관리 페이지에서 고름, 0 = 끄기). 기본 꺼짐 (11/08)
const REPORT_RETENTION_SETTING = 'report_retention_days'
const REPORT_RETENTION_CHOICES = [0, 30, 90, 180, 365]
const REPORT_TIMEOUT_MS = 240_000 // 보고서는 출력이 길어 요약보다 오래 걸린다
// 보고서 한 번에 넣는 기사 수 (맥미니 문맥 크기 기준). 넘으면 화면이 고르게 한다 (21 문서 6-3)
// - 중요도 높은 10건만 (빠름) / 전부 (REPORT_CHUNK건씩 나눠 쓰고 합침, 오래 걸림, 최대 MAX_REPORT_ALL건)
const MAX_REPORT_ARTICLES = 10
const MAX_REPORT_ALL = 40
const REPORT_CHUNK = 8

const MAX_BODY = 1_000_000 // 보고서 요청·보고서함 옮기기에는 기사 요약 여러 건이 들어간다

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
  res.end(JSON.stringify(data))
}

async function readJson(req, max = MAX_BODY) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > max) throw Object.assign(new Error('요청이 너무 커요.'), { status: 413 })
  }
  try {
    return JSON.parse(raw || '{}')
  } catch {
    throw Object.assign(new Error('JSON 형식이 아니에요.'), { status: 400 })
  }
}

async function handleSummary(req, res) {
  const { article, related = [], refresh = false, select = false } = await readJson(req)
  if (!article?.title) return send(res, 400, { error: 'article.title이 필요해요.' })
  if (await materialBlocksAi(String(article.id ?? ''))) return send(res, 403, { error: 'AI 요약을 허용하지 않은 자료예요. 원문을 직접 읽어 주세요.' })
  send(res, 200, await summarizeArticle(article, related, { refresh, select: Boolean(select) }))
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
  // 선별할 때 저장해 둔 원문이 있으면 그것을 쓰고, 없는 것만 가져온다
  const stored = await Promise.all(articles.map((a) => getArticleText(a.id).catch(() => null)))
  const fetched = await fetchBodies(articles.map((a, i) => (stored[i] ? null : a.url)))
  const bodies = stored.map((t, i) => t ?? fetched[i])
  articles.forEach((a, i) => {
    a.body = bodies[i] ? bodies[i].slice(0, per) : null
  })
  return articles
}

function readReportArticles(body, max = MAX_REPORT_ARTICLES) {
  const all = body.articles ?? []
  if (all.length > max) {
    throw Object.assign(new Error(`기사가 너무 많아요 (${all.length}건). ${max}건 이하로 골라 주세요.`), { status: 400 })
  }
  const articles = all.map((a, i) => ({ ...a, n: i + 1 }))
  if (articles.length === 0) throw Object.assign(new Error('보고서에 넣을 기사가 없어요.'), { status: 400 })
  const missing = articles.filter((a) => !a.summary?.items)
  if (missing.length) {
    throw Object.assign(new Error(`AI 요약이 없는 기사가 ${missing.length}건 있어요. 먼저 요약해 주세요.`), { status: 400 })
  }
  return articles
}

// 보고서 초안 한 번 (기사 10건 이하)
function draftReport(articles, opts) {
  return chatJson({
    messages: buildReportMessages(articles, opts),
    schema: REPORT_SCHEMA,
    schemaName: 'report_draft',
    report: true,
    timeoutMs: REPORT_TIMEOUT_MS,
  })
}

// 기사가 많을 때: REPORT_CHUNK건씩 나눠 초안 조각을 쓰고(원문 본문은 묶음마다 나눠 붙임), 조각을 한 보고서로 합친다
// 번호(n)는 처음부터 전체 기사 번호라 조각을 합쳐도 근거 번호가 그대로 맞는다
async function draftLongReport(articles, opts) {
  const parts = []
  for (let i = 0; i < articles.length; i += REPORT_CHUNK) {
    const chunk = await attachBodies(articles.slice(i, i + REPORT_CHUNK))
    const { data } = await draftReport(chunk, opts)
    parts.push(data)
  }
  const merged = await chatJson({
    messages: buildMergeMessages(articles, parts, opts),
    schema: REPORT_SCHEMA,
    schemaName: 'report_draft',
    report: true,
    timeoutMs: REPORT_TIMEOUT_MS,
  })
  const notes = parts.flatMap((p) => p.warnings ?? [])
  return { ...merged, data: { ...merged.data, warnings: [...new Set([...(merged.data.warnings ?? []), ...notes])] } }
}

// 보고서 한 건 만들기 (아직 저장 전). 대기열(reportJobs)과 예전 바로 만들기(/api/reports)가 같이 쓴다
async function buildReportEntry(body) {
  const all = body.mode === 'all'
  const picked = readReportArticles(body, all ? MAX_REPORT_ALL : MAX_REPORT_ARTICLES)
  for (const a of picked) if (await materialBlocksAi(String(a.id ?? ''))) throw Object.assign(new Error(`AI 입력을 허용하지 않은 자료가 있어요: ${a.title}`), { status: 403 })
  const title = body.title?.trim() || '테크 동향 브리핑'
  const direction = String(body.direction ?? '').trim().slice(0, 300)
  const opts = { title, periodLabel: body.periodLabel ?? '오늘', direction }
  const long = picked.length > MAX_REPORT_ARTICLES
  const articles = long ? picked : await attachBodies(picked)
  const { data, model } = long ? await draftLongReport(articles, opts) : await draftReport(articles, opts)
  const sections = Object.fromEntries(
    SECTION_KEYS.map((k) => [k, { bullets: cleanBullets(data.sections?.[k]?.bullets, articles) }]),
  )
  const createdAt = new Date().toISOString()
  // 보고서함에 넣을 한 건. DB가 있으면 서버에 저장하고, 없으면 화면이 브라우저에 저장한다
  const entry = {
    id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    articleKey: articles.map((a) => String(a.id ?? '')).sort().join('|'),
    report: { title, direction, sections, warnings: [...reportWarnings(sections), ...(data.warnings ?? [])] },
    model,
    createdAt,
    periodLabel: body.periodLabel ?? '오늘',
    ...(long ? { chunks: Math.ceil(articles.length / REPORT_CHUNK) } : {}),
    // fulltext: 원문 본문을 반영했는지 (화면 근거 기사 목록에 표시). 본문 자체는 저장하지 않는다
    articles: articles.map(({ title: t, source, url, publishedAt, body: b }) => ({ title: t, source, url, publishedAt, fulltext: Boolean(b) })),
    inputs: articles.map(({ n: _n, body: _b, ...rest }) => rest),
  }
  return entry
}
setDraftBuilder(buildReportEntry)

async function handleReport(req, res) {
  const entry = await buildReportEntry(await readJson(req))
  if (dbEnabled()) await saveReport(entry, clientIp(req))
  send(res, 200, { entry: { ...entry, mine: true }, stored: dbEnabled() })
}

async function handleReportSection(req, res) {
  const body = await readJson(req)
  // 기사가 많은 보고서(전부 넣기)는 원문 본문 없이 이 섹션의 요약 항목만으로 다시 쓴다 (문맥 크기)
  const picked = readReportArticles(body, MAX_REPORT_ALL)
  const articles = picked.length > MAX_REPORT_ARTICLES ? picked : await attachBodies(picked)
  if (!SECTION_KEYS.includes(body.key)) return send(res, 400, { error: '없는 섹션이에요.' })
  const { data, model } = await chatJson({
    messages: buildSectionMessages(articles, { key: body.key, report: body.report, direction: body.report?.direction }),
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
  startTechTrends() // 기술 트렌드: 켜진 뒤 1분, 그 뒤 하루마다 (TECH_TRENDS=off면 안 함)
  // 사용 현황 원본은 90일만 둔다: 켜질 때 한 번, 그 뒤 하루 한 번
  const prune = () => {
    pruneUsage().catch((err) => console.warn(`[usage] 오래된 기록 정리 실패: ${err.message}`))
    pruneArticleTexts().catch((err) => console.warn(`[texts] 오래된 원문 정리 실패: ${err.message}`)) // 원문은 90일만
    // 보고서 자동 삭제: 관리자가 정한 기간(기본 꺼짐)이 지난 보고서
    getSetting(REPORT_RETENTION_SETTING, 0)
      .then((days) => deleteReportsOlderThan(Number(days) || 0))
      .then((n) => n && console.log(`[reports] 자동 삭제 ${n}개`))
      .catch((err) => console.warn(`[reports] 자동 삭제 실패: ${err.message}`))
  }
  prune()
  setInterval(prune, 86_400_000).unref()
}

// 일반 사용자의 「지금 최신화」는 10분에 한 번 (17 문서 3-2). 관리 페이지에서 누른 관리자만 제한 없음 (11/08 원칙)
const RUN_COOLDOWN_MS = 10 * 60_000
async function checkRunCooldown(req) {
  if (adminHere(req)) return
  const { lastRunAt, running } = await refreshStatus()
  if (running) return // 이미 돌고 있으면 startRefresh가 알아서 합친다
  const wait = lastRunAt ? Date.parse(lastRunAt) + RUN_COOLDOWN_MS - Date.now() : 0
  if (wait > 0) {
    throw Object.assign(new Error(`방금 최신화했어요. ${Math.ceil(wait / 60_000)}분 뒤 다시 누를 수 있어요.`), { status: 429 })
  }
}

// 다른 출처에서 브라우저가 대신 보낸 변경 요청 막기 (11/08, 요즘 표준 방식 — Go 1.25 CrossOriginProtection과 같음)
// 쿠키와 SameSite는 포트를 구분하지 않아, 같은 서버의 다른 포트 앱(예: :3040)이 관리자 브라우저로 3038에 요청을 보낼 수 있다.
// 1) Sec-Fetch-Site가 있으면 same-origin(이 화면) · none(사용자가 직접 연 것)만 받는다 (포트까지 구분)
// 2) 없으면(오래된 브라우저) Origin의 주소:포트가 Host와 같아야 한다
// 3) 둘 다 없으면 브라우저가 아닌 요청(curl · 스크립트)이라 통과 — 쿠키를 대신 실어 보내는 공격이 아님
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
function crossOrigin(req) {
  if (!UNSAFE_METHODS.has(req.method)) return false
  const site = req.headers['sec-fetch-site']
  if (site) return site !== 'same-origin' && site !== 'none'
  const origin = req.headers.origin
  if (!origin) return false
  try {
    return new URL(origin).host !== req.headers.host
  } catch {
    return true
  }
}

// /api 요청을 처리한다. Vite 개발 서버와 단독 서버가 같이 쓴다
export async function handleApi(req, res) {
  try {
    if (crossOrigin(req)) return send(res, 403, { error: '다른 사이트에서 보낸 요청은 받지 않아요.' })
    // 운영 상태(점검 중 · AI 정지)면 일반 사용자의 요청을 막는다. 관리 페이지에서 보낸 관리자 요청만 그대로 (19 문서 6장, 11/08 원칙)
    if (!adminHere(req)) await checkOps(req)
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
    // 키워드 추이 (22 문서 6-4): 뉴스 기사량 · 네이버 검색량 · Wikipedia 관심도 · GDELT 해외 보도량. 누구나 읽음
    // 기술 트렌드 (25 문서): 기간별 출처마다 순위 + 종합 순위. 누구나 읽음
    if (req.method === 'GET' && req.url.startsWith('/api/tech-trends')) {
      const q = new URL(req.url, 'http://x').searchParams
      return send(res, 200, await getTechTrends({ period: q.get('period'), from: q.get('from'), to: q.get('to') }))
    }
    // 최근 12개월 디스플레이 주제 논문 중 「달마다 인용이 많이 붙는」 순 (일주일 캐시, server/papers/journals.js). 화면은 아직 없음
    if (req.method === 'GET' && req.url === '/api/papers/popular') {
      try {
        return send(res, 200, await popularPapers())
      } catch (err) {
        return send(res, 503, { error: `논문 출처가 모두 막혀 있어요: ${err.message}` })
      }
    }
    if (req.method === 'GET' && req.url === '/api/trends') {
      return send(res, 200, await getTrends())
    }
    // 수집 출처 (14 문서 4-B): 네이버 밖 출처 목록 · 켜기/끄기 · 지난 수집 결과. 관리자만
    if (req.method === 'GET' && req.url === '/api/admin/sources') {
      requireAdmin(req)
      return send(res, 200, { list: feedList(), ...(await getSources()), papers: await paperProviderStatus() })
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
      await logChange(admin, '자동 최신화', `${mode} · 자동 요약 ${s.autoSummary === 'off' ? '꺼짐' : `켜짐(기사 최근 ${s.summaryDays}일)`}`)
      return send(res, 200, status)
    }
    if (req.method === 'POST' && req.url === '/api/refresh/run') {
      await checkRunCooldown(req)
      const { keywords = [] } = await readJson(req)
      await startRefresh(keywords.map(String).slice(0, 20))
      return send(res, 202, await refreshStatus())
    }
    if (req.method === 'POST' && req.url === '/api/search') {
      // 뉴스(네이버) + 논문을 같이 찾는다 (11/08). 논문이 막혀도 뉴스 결과는 그대로
      const { query, period } = await readJson(req)
      const [news, papers] = await Promise.all([
        searchArticles(query, { period }),
        searchPaperArticles(query, period).catch((err) => ({ articles: [], note: `논문을 찾지 못했어요 (${err.message})` })),
      ])
      return send(res, 200, { ...news, articles: [...news.articles, ...papers.articles], newsCount: news.articles.length, paperCount: papers.articles.length, paperNote: papers.note })
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
    // 직접 추가한 자료 (27 문서 3장). 파일은 base64로 받아 크기 제한을 따로 둔다
    if (req.method === 'GET' && req.url === '/api/materials') {
      return send(res, 200, { materials: await listMaterials() })
    }
    if (req.method === 'POST' && req.url === '/api/materials') {
      const input = await readJson(req, 15_000_000)
      return send(res, 200, { material: await addMaterial(input, input.clientId) })
    }
    if (req.method === 'DELETE' && req.url.startsWith('/api/materials/')) {
      const [path, qs = ''] = req.url.split('?')
      const id = decodeURIComponent(path.slice('/api/materials/'.length))
      await deleteMaterial(id, { clientId: new URLSearchParams(qs).get('client'), admin: Boolean(adminHere(req)) })
      return send(res, 200, { ok: true })
    }
    // 선별 폴더 (11/07 결정: 선별 정보 서버 기록). 11/08부터 IP별로 담는다: 같은 IP면 어느 브라우저에서나 같은 선별
    // (예전 브라우저 무작위 번호 기록과 섞이지 않게 'ip:' 앞머리. 보내 온 clientId는 쓰지 않음)
    if (req.method === 'GET' && req.url.startsWith('/api/selections')) {
      const ip = clientIp(req)
      return send(res, 200, { selection: ip ? await getSelection(`ip:${ip}`) : null })
    }
    if (req.method === 'PUT' && req.url === '/api/selections') {
      const { folders = [], folderOf = {}, selectedIds = [] } = await readJson(req)
      const ip = clientIp(req)
      if (!ip) return send(res, 400, { error: '접속 주소를 알 수 없어요.' })
      const data = {
        folders: folders.slice(0, 50).map((f) => ({ id: String(f.id).slice(0, 40), name: String(f.name ?? '').slice(0, 40) })),
        folderOf: Object.fromEntries(Object.entries(folderOf).slice(0, 2000).map(([k, v]) => [String(k).slice(0, 200), String(v).slice(0, 40)])),
        selectedIds: selectedIds.slice(0, 2000).map((x) => String(x).slice(0, 200)),
      }
      await saveSelection(`ip:${ip}`, data)
      return send(res, 200, { ok: true })
    }
    // 용어 백과 (위키백과 요약). 보고서 근거가 아니라 용어 이해용 (27 문서 4장)
    if (req.method === 'GET' && req.url.startsWith('/api/wiki')) {
      const term = new URLSearchParams(req.url.split('?')[1] ?? '').get('q')
      return send(res, 200, await lookupWiki(term))
    }
    if (req.method === 'GET' && req.url === '/api/reports') {
      return send(res, 200, { stored: dbEnabled(), reports: dbEnabled() ? await listReports(200, { ip: clientIp(req) }) : [] })
    }
    // 관리 페이지 보고서 관리 (11/08): 전체 목록(만든 IP 포함) · 자동 삭제 주기
    if (req.method === 'GET' && req.url === '/api/admin/reports') {
      requireAdmin(req)
      const retentionDays = Number(await getSetting(REPORT_RETENTION_SETTING, 0)) || 0
      return send(res, 200, { stored: dbEnabled(), retentionDays, reports: await listReports(1000, { withIp: true }) })
    }
    if (req.method === 'PUT' && req.url === '/api/admin/reports/retention') {
      const admin = requireAdmin(req)
      const days = Number((await readJson(req)).days)
      if (!REPORT_RETENTION_CHOICES.includes(days)) return send(res, 400, { error: '고를 수 있는 기간이 아니에요.' })
      await setSetting(REPORT_RETENTION_SETTING, days)
      const deleted = await deleteReportsOlderThan(days)
      await logChange(admin, '보고서 자동 삭제', days ? `만든 지 ${days}일 지난 보고서 (지금 ${deleted}개 지움)` : '꺼짐')
      return send(res, 200, { retentionDays: days, deleted })
    }
    if (req.method === 'POST' && req.url === '/api/reports/import') {
      // 브라우저(localStorage)에 있던 보고서함을 DB로 옮긴다. 이미 있는 건 건너뜀
      if (!dbEnabled()) return send(res, 400, { error: 'DB가 설정되지 않았어요.' })
      const { reports = [] } = await readJson(req)
      const ip = clientIp(req)
      for (const r of reports.slice(0, 30)) if (r?.id && r.report) await saveReport(r, ip)
      return send(res, 200, { reports: await listReports(30, { ip }) })
    }
    if (req.method === 'DELETE' && req.url.startsWith('/api/reports/')) {
      // 공용 보고서함에서 지우면 되돌릴 수 없다 (11/08): 일반 화면에서는 그 보고서를 만든 IP만,
      // 관리자는 관리 페이지에서만 모든 보고서를 지운다 (일반 화면에서는 관리자도 일반 사용자와 같음)
      const [path] = req.url.split('?')
      const id = decodeURIComponent(path.slice('/api/reports/'.length))
      const admin = adminHere(req)
      if (!admin) {
        const ip = clientIp(req)
        const owner = await reportOwnerIp(id)
        if (!ip || !owner || owner !== ip) {
          throw Object.assign(new Error('보고서는 만든 사람(같은 IP)만 지울 수 있어요. 다른 보고서는 관리 페이지에서 관리자가 지워요.'), { status: 403 })
        }
      }
      await deleteReport(id)
      if (admin) await logChange(admin, '보고서 삭제', id)
      return send(res, 200, { ok: true })
    }
    if (req.method === 'POST' && req.url === '/api/reports') {
      return await handleReport(req, res)
    }
    // 보고서 고치기: 줄 빼기 · 되살리기, AI 보충 근거 반영 (11/08). 보고서함은 팀 공용이라 누구나 고칠 수 있다
    // 단 만든 브라우저 번호(createdBy)는 서버가 원래 값으로 지킨다 (updateReport)
    if (req.method === 'PUT' && req.url.startsWith('/api/reports/')) {
      const id = decodeURIComponent(req.url.slice('/api/reports/'.length))
      const { report, articles } = await readJson(req)
      if (!report?.sections || !Array.isArray(articles)) return send(res, 400, { error: '보고서 형식이 아니에요.' })
      if (dbEnabled()) await updateReport(id, report, articles)
      return send(res, 200, { ok: true })
    }
    // 보고서 작업 대기열 (11/08): 만들기 → 대기열 → (필요하면 사용자에게 물음) → 보고서함
    if (req.method === 'POST' && req.url === '/api/report-jobs') {
      const body = await readJson(req)
      if (!(body.articles ?? []).length) return send(res, 400, { error: '보고서에 넣을 기사가 없어요.' })
      return send(res, 202, { job: addJob(body, body.clientId, clientIp(req)) })
    }
    if (req.method === 'GET' && req.url.startsWith('/api/report-jobs')) {
      const client = new URLSearchParams(req.url.split('?')[1] ?? '').get('client')
      return send(res, 200, { jobs: listJobs(client) })
    }
    if (req.method === 'POST' && /^\/api\/report-jobs\/[\w-]+\/(answer|cancel)$/.test(req.url)) {
      const [, , , id, action] = req.url.split('/')
      if (action === 'answer') {
        const { use } = await readJson(req)
        return send(res, 200, { job: answerJob(id, use) })
      }
      return send(res, 200, { job: cancelJob(id) })
    }
    // AI 해설 한 줄의 근거를 우리 자료 · 위키백과에서 찾아 고쳐 쓴다
    if (req.method === 'POST' && req.url === '/api/reports/reinforce') {
      const { text, inputs = [], existing = [] } = await readJson(req)
      return send(res, 200, await reinforceBullet({ text, inputs: inputs.slice(0, 40), existing: existing.slice(0, 80) }))
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
