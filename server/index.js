// 요약 API. 보통은 npm run dev 하나로 화면과 같은 포트(PORT)에서 열린다 (vite.config.js).
// API만 따로 시험할 때: npm run server. 키는 .env.local에서 읽고 브라우저로 보내지 않는다
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { addCustomFeed, checkAllFeeds, collect, deleteCustomFeed, getSources, listArticles, markFeedTested, markListStale, saveSources, searchArticles, searchCollected, testFeed } from './collector/index.js'
import { englishTerms, frequentSearches, listQueryTerms, pruneSearchCounts, recordSearch, setQueryTerms } from './queryTerms.js'
import { feedList } from './collector/feeds.js'
import { getTrends } from './trends.js'
import { paperProviderStatus } from './papers/index.js'
import { corpusStatus, startCorpus } from './papers/corpus.js'
import { kciOaiStatus } from './papers/kciOai.js'
import { buildTimeline, timelineStory } from './timeline.js'
import { readyTimelines, runPrecompute, startPrecompute } from './timelineJobs.js'
import { relatedWords, wordArticles } from './related.js'
import { checkRule, DEFAULT_RULE, describeRule, loadImportanceRule, PARTS as IMPORTANCE_PARTS, previewRule, ruleHistory, saveImportanceRule } from './importanceRule.js'
import { kiwiStatus } from './kiwi.js'
import { fillMap, mapMaterials } from './mapMaterials.js'
import { allCategoryCompetitors, bundleFacts, categoryTrends, headlineSeeds, ownerOf, prepareBundle, termVerdict } from './keywordBundle.js'
import { DEFAULT_STYLE, describeStyle, getReportStyle, LAYOUT_FIELDS, reportStyleHistory, saveReportStyle, SIZE_FIELDS } from './reportStyle.js'
import { describeTunables, GROUPS as TUNE_GROUPS, loadTunables, saveTunables, tune, tunablesHistory, tunablesView } from './tunables.js'
import { checkOwnerPatterns, DEFAULT_JUDGE, describeJudge, judgeHistory, judgeRule, loadJudgeSettings, RULE_FIELDS, saveJudgeRule, saveOwner } from './judgeSettings.js'
import { scopeSearch } from './scopeSearch.js'
import { popularPapers } from './papers/journals.js'
import { getTechTrends, startTechTrends } from './techtrends.js'
import { similarity } from './collector/dedupe.js'
import { fetchBodies } from './collector/fulltext.js'
import { getLists, saveLists } from './collector/lists.js'
import { getArticleText, getSelection, getSetting, pruneArticleTexts, saveSelection, setSetting } from './db/store.js'
import { addMaterial, deleteMaterial, listMaterials, materialBlocksAi } from './materials.js'
import { lookupWiki } from './wiki.js'
import { dbEnabled, dbStatus, query } from './db/index.js'
import {
  deleteReport,
  getSummaries,
  getKeywords,
  listReports,
  saveReport,
  setKeywords,
  reportOwnerIp,
  purgeTrash,
  reportTrashedAt,
  restoreReport,
  setReportStar,
  trashReport,
  trashReportsOlderThan,
  updateReport,
  updateReportSection,
} from './db/store.js'
import { reinforceBullet } from './reinforce.js'
import { listErrors, logError } from './errorLog.js'
import { searchPaperArticles } from './searchPapers.js'
import { activeJobs, addJob, answerJob, cancelJob, listJobs, resumableCount, setDraftBuilder } from './reportJobs.js'
import { sourceStatus } from './sourceGuard.js'
import { fetchTitlesIfMissing, patentDbStatus } from './patentDb.js'
import { abstractsStatus, fetchAbstractsIfWanted } from './patentAbstracts.js'
import { chatJson, currentProviderId, kickQueue, llmProviders, moveJob, PRIORITY, modelName, pingModel, providerLabel, queueList, selectProvider, setModelOverrides, testConnection, withQueueContext } from './llm/client.js'
import { SERVICES as API_KEY_SERVICES, apiKeyServiceLabel, loadApiKeys, publicApiKeys, resetApiKeys, revertApiKeys, updateApiKeys } from './apiKeys.js'
import { addCustom, deleteCustom, loadConnections, publicConnections, revertConnection, setConnectionDisabled, setConnectionParallel, updateBuiltin, updateCustom, BUILTIN_IDS } from './llm/connections.js'
import { evidenceOf, hasHan, isProposal, isSupported, STRONG_OVERLAP, stripInlineRefs } from './llm/evidence.js'
import {
  buildMergeMessages,
  buildReportMessages,
  buildSectionMessages,
  REPORT_SCHEMA,
  TAGS,
  SECTION_KEYS,
  SECTION_SCHEMA,
} from './llm/reportPrompts.js'
import { adminConfigured, adminHere, adminOf, changeLog, clientIp, confirmAdmin, diffWords, envPasswordSet, logChange, login, logout, passwordMatches, readCookie, requireAdmin, requireConfirmed, secureCookie } from './admin.js'
import { ACCESS_COOKIE, ACCESS_MAX_AGE, envAccessCodeSet, tokenOf as accessTokenOf } from './accessGate.js'
import { checkNewCode, clearAdminPassword, loadCredentials, saveAccessToken, saveAdminPassword, storedAccessToken, storedPassword } from './credentials.js'
import { backgroundAllowed, backlogBrief, queueSearchSummaries, refreshStatus, saveRefreshSettings, startRefresh, startScheduler as startRefreshScheduler } from './refresh.js'
import { featureList, FEATURES, getFeatures, RULE_FLAGS, saveFeatures } from './features.js'
import { prefetchLater } from './papers/prefetch.js'
import { summarizeArticle, summarizeOnly } from './summarize.js'
import { pruneUsage, recordClientEvent, usageStats } from './usage.js'
import { checkOps, getOps, OPS_LABEL, publicOps, saveOps } from './ops.js'

// 서버가 켜진 시각: 관리 페이지가 「다시 켜기」 뒤 새로 켜졌는지 알아보는 데 쓴다
const STARTED_AT = new Date().toISOString()
// npm run serve(scripts/serve.mjs)로 켰을 때만 「다시 켜기」를 할 수 있다. 이 종료 코드면 serve가 다시 켠다
const SUPERVISED = process.env.TECHBRIEF_SUPERVISED === '1'
const RESTART_EXIT_CODE = 75

// 보고서 자동 삭제 주기 (관리 페이지에서 고름, 0 = 끄기). 기본 꺼짐 (11/08)
const REPORT_RETENTION_SETTING = 'report_retention_days' // 만든 지 N일 지나면 휴지통으로 (0 = 끄기, 기본)
const REPORT_RETENTION_CHOICES = [0, 30, 90, 180, 365]
// 휴지통 보관 기간 (11/13 조장: 관리자가 설정에서 정함): 휴지통에 N일 있으면 영구 삭제. 0 = 자동으로 지우지 않음
const REPORT_TRASH_SETTING = 'report_trash_days'
const REPORT_TRASH_DEFAULT = 30
const REPORT_TRASH_CHOICES = [0, 7, 30, 90]
const trashDays = async () => {
  const v = await getSetting(REPORT_TRASH_SETTING, REPORT_TRASH_DEFAULT)
  return Number.isFinite(Number(v)) ? Number(v) : REPORT_TRASH_DEFAULT
}
const REPORT_TIMEOUT_MS = 240_000 // 보고서는 출력이 길어 요약보다 오래 걸린다
// 보고서 한 번에 넣는 기사 수 (맥미니 문맥 크기 기준). 넘으면 화면이 고르게 한다 (21 문서 6-3)
// - 중요도 높은 10건만 (빠름) / 전부 (REPORT_CHUNK건씩 나눠 쓰고 합침, 오래 걸림, 최대 MAX_REPORT_ALL건)
// 11/26: 한 번에 넣는 수는 관리 페이지 「세부 설정 › 보고서 한도」(server/tunables.js reportArticles, 기본 10). 나눠 쓰는 묶음은 그보다 크지 않게
const MAX_REPORT_ARTICLES = () => tune('reportArticles')
const MAX_REPORT_ALL = 40
const REPORT_CHUNK = () => Math.min(8, MAX_REPORT_ARTICLES())

const MAX_BODY = 1_000_000 // 보고서 요청·보고서함 옮기기에는 기사 요약 여러 건이 들어간다

// 큰 응답은 gzip으로 (11/17: 압축 없이 보내 첫 화면 자료 목록이 5.1MB → gzip 1.3MB). 브라우저가 gzip을 받는다고 할 때만
const GZIP_MIN = 32 * 1024
const acceptsGzip = (res) => /\bgzip\b/.test(String(res.req?.headers?.['accept-encoding'] ?? ''))
function sendBody(res, status, body, headers = {}, gz = null) {
  const base = { 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding', ...headers }
  if (acceptsGzip(res) && Buffer.byteLength(body) >= GZIP_MIN) {
    res.writeHead(status, { ...base, 'Content-Encoding': 'gzip' })
    return res.end(gz ?? gzipSync(body, { level: 6 }))
  }
  res.writeHead(status, base)
  return res.end(body)
}
function send(res, status, data, headers = {}) {
  return sendBody(res, status, JSON.stringify(data), headers)
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
const ROLES = ['배경', '쟁점', '전망'] // 유첨 글머리 칸 (11/25, reportPrompts SECTION_GUIDE)
function cleanBullets(bullets, articles) {
  const kept = []
  for (let b of bullets ?? []) {
    if (!b?.text?.trim()) continue
    let text = stripInlineRefs(b.text).replace(/\s*\[AI (?:보충|제안)\]/g, '').trim()
    // 「기회: …」처럼 표시를 글 앞에 쓴 경우 표시로 옮긴다 (11/12 실측)
    const lead = text.match(/^(기회|위협|할 일)\s*[:：·-]\s*/)
    if (lead) {
      b = { ...b, tag: b.tag || lead[1] }
      text = text.slice(lead[0].length)
    }
    // 「배경: …」처럼 칸 이름을 글 앞에 쓴 경우 role로 옮긴다 (11/25 시험: 4건 중 3건이 role 칸 대신 글 앞에 씀)
    const roleLead = text.match(/^(배경|쟁점|전망)\s*[:：·-]\s*/)
    if (roleLead) {
      b = { ...b, role: b.role || roleLead[1] }
      text = text.slice(roleLead[0].length)
    }
    // 표시 낱말만 쓴 줄(「기회」 · 「위협」)은 내용이 없어 뺀다 (11/17 지시문 시험에서 실제로 나옴)
    if (/^(기회|위협|할 일|기회·위협 공존|검토 필요)[.。]?$/.test(text)) continue
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
    kept.push({ text, refs, kind, ...(TAGS.includes(b.tag) ? { tag: b.tag } : {}), ...(ROLES.includes(b.role) ? { role: b.role } : {}), removedRefs: claimed.filter((n) => !refs.includes(n)), han: hasHan(text) })
  }
  return kept
}

// 시사점 글머리 표시 (AI가 tag를 비웠을 때만, 규칙)
function inferTag(text) {
  if (/위협|격차|뒤처|추격|잠식|열세|밀리/.test(text)) return '위협'
  if (/기회|우위|선점|앞서|가장 빠르/.test(text)) return '기회'
  return '할 일'
}
// 글머리 숫자 중 근거 글(기사 · [분석])에 그대로 없는 것 (연도 · 1~2자리 정수는 흔해서 소수 · 배수 · 큰 수만 본다)
function numbersNotIn(b, articles) {
  if (b.kind !== 'fact' || !b.refs?.length) return []
  const ev = b.refs.map((n) => evidenceOf(articles[n - 1] ?? {})).join(' ')
  const nums = [...b.text.matchAll(/\d+(?:[.,]\d+)*(?=\s*(?:배|건|%|편|곳|억|조|만|인치|Hz))/g)].map((m) => m[0])
  return [...new Set(nums)].filter((x) => !ev.includes(x))
}

function reportWarnings(sections) {
  const all = Object.values(sections).flatMap((s) => s.bullets)
  const warnings = []
  const ai = all.filter((b) => b.kind === 'ai').length
  if (ai) warnings.push(`AI 해설·제안 ${ai}개는 기사에서 확인된 내용이 아니에요 — 확인 후 쓰세요`)
  if (all.some((b) => b.han)) warnings.push('한자·중국어가 섞인 문장이 있어요 — 한글로 고치세요')
  const nums = all.filter((b) => b.numCheck?.length)
  if (nums.length) warnings.push(`근거와 다른 숫자가 있어요 (${nums.flatMap((b) => b.numCheck).join(', ')}) — 근거를 열어 확인하세요`)
  return warnings
}

// 원문 본문을 붙인다 (13 문서 9절). 기사마다 길이를 나눠 전체 입력이 문맥 크기를 넘지 않게 한다
const BODY_BUDGET = 12_000 // 모든 기사 본문 합계(글자). LLM_NUM_CTX=16384 기준 여유 있게
// 유료 논문 (11/14, 보고서팀 작업 이식): access가 paid인 논문은 원문을 가져오지 않는다 (초록까지만)
const isPaidPaper = (a) => Boolean(a.paper && a.access === 'paid')
// 보고서에 남길 유료 여부: 원문을 실제로 받았으면 open, 서버가 알면 그 값, 모르면 unknown (초록만 있다고 유료로 단정하지 않음)
function paperAccessOf(a) {
  if (a.access === 'paid' || a.access === 'open') return a.access
  return a.body ? 'open' : 'unknown'
}
async function attachBodies(articles) {
  const per = Math.min(2_500, Math.floor(BODY_BUDGET / articles.length))
  // 선별할 때 저장해 둔 원문이 있으면 그것을 쓰고, 없는 것만 가져온다
  const skip = (a) => a.analysis || isPaidPaper(a)
  const stored = await Promise.all(articles.map((a) => (skip(a) ? null : getArticleText(a.id).catch(() => null))))
  const fetched = await fetchBodies(articles.map((a, i) => (stored[i] || skip(a) ? null : a.url)))
  const bodies = stored.map((t, i) => t ?? fetched[i])
  articles.forEach((a, i) => {
    a.body = a.analysis ? null : bodies[i] ? bodies[i].slice(0, per) : null
  })
  return articles
}

function readReportArticles(body, max = MAX_REPORT_ARTICLES()) {
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
    priority: PRIORITY.REPORT,
  })
}

// 기사가 많을 때: REPORT_CHUNK건씩 나눠 초안 조각을 쓰고(원문 본문은 묶음마다 나눠 붙임), 조각을 한 보고서로 합친다
// 번호(n)는 처음부터 전체 기사 번호라 조각을 합쳐도 근거 번호가 그대로 맞는다
async function draftLongReport(articles, opts) {
  const size = REPORT_CHUNK()
  const chunks = []
  for (let i = 0; i < articles.length; i += size) chunks.push(articles.slice(i, i + size))
  // 11/26: 조각을 한꺼번에 대기열에 넣는다 — 동시 요청 수가 1이면 예전처럼 차례로, 늘리면 함께 (순서는 조각 순서 그대로 합침)
  const parts = await Promise.all(chunks.map(async (c) => (await draftReport(await attachBodies(c), opts)).data))
  const merged = await chatJson({
    messages: buildMergeMessages(articles, parts, opts),
    schema: REPORT_SCHEMA,
    schemaName: 'report_draft',
    report: true,
    timeoutMs: REPORT_TIMEOUT_MS,
    priority: PRIORITY.REPORT,
  })
  const notes = parts.flatMap((p) => p.warnings ?? [])
  return { ...merged, data: { ...merged.data, warnings: [...new Set([...(merged.data.warnings ?? []), ...notes])] } }
}

// 일반 화면에서 보고서를 휴지통에 넣거나 · 되살리거나 · 영구 삭제하는 것은 만든 사람(같은 IP)만 (11/08 원칙, 17 문서)
async function requireReportOwner(req, id) {
  const ip = clientIp(req)
  const owner = await reportOwnerIp(id)
  if (!ip || !owner || owner !== ip) {
    throw Object.assign(new Error('보고서는 만든 사람(같은 IP)만 지우거나 되살릴 수 있어요. 다른 보고서는 관리 페이지에서 관리자가 지워요.'), { status: 403 })
  }
}

// 보고서 한 건 만들기 (아직 저장 전). 대기열(reportJobs)과 예전 바로 만들기(/api/reports)가 같이 쓴다
export async function buildReportEntry(body) {
  const all = body.mode === 'all'
  const picked = readReportArticles(body, all ? MAX_REPORT_ALL : MAX_REPORT_ARTICLES())
  for (const a of picked) if (await materialBlocksAi(String(a.id ?? ''))) throw Object.assign(new Error(`AI 입력을 허용하지 않은 자료가 있어요: ${a.title}`), { status: 403 })
  // 11/14: 주제 키워드를 제목에. 11/17 조장: 제목 앞에 날짜(MM.DD), 같은 날 같은 제목이면 저장할 때 끝에 번호 2 · 3 …(saveReport unique)
  const baseTitle = (body.title?.trim() || `${String(body.topics?.[0] ?? '').trim() || '테크'} 동향 브리핑`).replace(/^\d{1,2}\.\d{1,2}\s+/, '')
  const kst = new Date(Date.now() + 9 * 3600_000)
  const title = `${String(kst.getUTCMonth() + 1).padStart(2, '0')}.${String(kst.getUTCDate()).padStart(2, '0')} ${baseTitle}`.slice(0, 80)
  const direction = String(body.direction ?? '').trim().slice(0, 300)
  // 11/12 조장: 대시보드에서 분석한 키워드는 보고서에 「당연히」 들어간다 — 주제 키워드의 분석 묶음(keywordBundle.js)을 [분석] 근거로 자동으로 붙인다
  // 주제 키워드: 화면이 보낸 topics(대시보드에서 고른 범위의 중심 키워드). 묶음이 없으면 20초까지 만들어 보고, 못 만들면 없이 쓴다
  const topics = [...new Set((body.topics ?? []).map((t) => String(t).trim()).filter(Boolean))].slice(0, 3)
  const bundles = (
    await Promise.all(topics.map((t) => Promise.race([prepareBundle(t), new Promise((res) => setTimeout(() => res(null), 20_000))]).catch(() => null)))
  ).filter(Boolean)
  const facts = bundles.flatMap(bundleFacts).map((f, i) => ({ ...f, n: picked.length + i + 1 }))
  const opts = { title, periodLabel: body.periodLabel ?? '오늘', direction, topics, seeds: bundles.flatMap(headlineSeeds).slice(0, 4) }
  const long = picked.length > MAX_REPORT_ARTICLES()
  const articles = [...(long ? picked : await attachBodies(picked)), ...facts]
  const { data, model } = long ? await draftLongReport(articles, opts) : await draftReport(articles, opts)
  const sections = Object.fromEntries(
    SECTION_KEYS.map((k) => [k, { bullets: cleanBullets(data.sections?.[k]?.bullets, articles) }]),
  )
  // ① 헤드라인: 근거 정리는 글머리와 같은 규칙. 「~할 수 있음」 같은 제안이면 ai로 남는다
  const headline = data.headline?.text?.trim() ? cleanBullets([data.headline], articles)[0] ?? null : null
  // ③ 시사점 표시를 AI가 빠뜨리면 규칙으로 채운다 (기회 · 위협 · 할 일)
  for (const b of sections.implications.bullets) b.tag ??= inferTag(b.text)
  // 숫자 확인 (작업 원칙 2): 사실 글머리의 숫자가 근거 글에 없으면 표시 (11/12 실측: 2.04배 → 「2.1배」로 반올림)
  for (const b of [headline, ...Object.values(sections).flatMap((x) => x.bullets)].filter(Boolean)) {
    const bad = numbersNotIn(b, articles)
    if (bad.length) b.numCheck = bad
  }
  // ④ 출처: AI가 아니라 서버가 센다 (담당자 회신: 수집 기간과 기사 수)
  // 수집 기간은 기사 날짜만, 논문은 연도 범위를 따로 (11/17, 40 문서 R8)
  const dates = picked.filter((a) => !a.paper).map((a) => Date.parse(a.publishedAt)).filter(Number.isFinite).sort((a, b) => a - b)
  const paperYears = picked.filter((a) => a.paper).map((a) => new Date(a.publishedAt).getFullYear()).filter(Number.isFinite).sort((a, b) => a - b)
  const day = (t) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10)
  const sources = {
    period: dates.length ? `${day(dates[0])} ~ ${day(dates[dates.length - 1])}` : null,
    ...(paperYears.length ? { papers: paperYears[0] === paperYears.at(-1) ? `${paperYears[0]}` : `${paperYears[0]}~${paperYears.at(-1)}` } : {}),
    articles: picked.length,
    analysis: facts.length ? [...new Set(facts.map((f) => f.source))] : [],
    topics,
  }
  const createdAt = new Date().toISOString()
  // 보고서함에 넣을 한 건. DB가 있으면 서버에 저장하고, 없으면 화면이 브라우저에 저장한다
  const entry = {
    id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
    articleKey: articles.map((a) => String(a.id ?? '')).sort().join('|'),
    // analysis: 유첨 그래프용 분석 묶음 (규칙 숫자, 화면 전용 — report와 함께 저장돼 다시 열어도 보인다)
    report: { title, direction, headline, ...(typeof data.oneLine === 'string' && data.oneLine.trim() ? { oneLine: data.oneLine.trim().slice(0, 80) } : {}), sections, sources, analysis: bundles.map((b) => ({ keyword: b.keyword, at: b.at, stage: b.stage, patentYears: b.patentYears, competitors: b.competitors, owners: b.owners, quotes: b.quotes, papers: b.papers, rising: b.rising, makers: b.makers, breadth: b.breadth, attention: b.attention, surges: b.surges, signal: b.signal })), warnings: [...reportWarnings(sections), ...(headline?.numCheck?.length ? [`헤드라인 숫자가 근거와 달라요 (${headline.numCheck.join(', ')}) — 확인하세요`] : []), ...(headline && !headline.refs.length ? ['헤드라인에 근거 번호가 없어요 — AI 해설로 보고 확인하세요'] : []), ...(data.warnings ?? [])] },
    model,
    createdAt,
    periodLabel: body.periodLabel ?? '오늘',
    ...(long ? { chunks: Math.ceil(articles.length / REPORT_CHUNK()) } : {}),
    // fulltext: 원문 본문을 반영했는지 (화면 근거 기사 목록에 표시). 본문 자체는 저장하지 않는다
    articles: articles.map((a) => {
      const { title: t, source, url, publishedAt, body: b, analysis, description, paper, patent, authors } = a
      return {
        title: t,
        source,
        url,
        publishedAt,
        // [분석] 줄은 우리 규칙 계산이라 원문 · 발췌문 표시가 없다 (11/17: 「발췌문으로 작성」으로 보였음). 어느 키워드 분석인지 남겨 앱 분석으로 잇는다
        ...(analysis ? { analysis: true, description, ...(a.keyword ? { keyword: a.keyword } : {}) } : { fulltext: Boolean(b) }),
        ...(paper ? { paper: true, access: paperAccessOf(a), ...(authors?.length ? { authors: authors.slice(0, 6) } : {}) } : {}),
        ...(patent ? { patent: true, ...(a.patentNo ? { patentNo: a.patentNo } : {}) } : {}),
      }
    }),
    inputs: picked.map(({ n: _n, body: _b, ...rest }) => rest),
  }
  return entry
}
setDraftBuilder(buildReportEntry)

async function handleReport(req, res) {
  const entry = await buildReportEntry(await readJson(req))
  if (dbEnabled()) await saveReport(entry, clientIp(req), { unique: true })
  send(res, 200, { entry: { ...entry, mine: true }, stored: dbEnabled() })
}

async function handleReportSection(req, res) {
  const body = await readJson(req)
  // 기사가 많은 보고서(전부 넣기)는 원문 본문 없이 이 섹션의 요약 항목만으로 다시 쓴다 (문맥 크기)
  const picked = readReportArticles(body, MAX_REPORT_ALL)
  const articles = picked.length > MAX_REPORT_ARTICLES() ? picked : await attachBodies(picked)
  if (!SECTION_KEYS.includes(body.key)) return send(res, 400, { error: '없는 섹션이에요.' })
  const { data, model } = await chatJson({
    messages: buildSectionMessages(articles, { key: body.key, report: body.report, direction: body.report?.direction }),
    schema: SECTION_SCHEMA,
    schemaName: 'report_section',
    kind: 'section',
    report: true,
    timeoutMs: REPORT_TIMEOUT_MS,
    priority: PRIORITY.WAIT, // 보고서 화면에서 섹션 하나를 다시 쓰는 동안 사람이 기다림
  })
  const bullets = cleanBullets(data.bullets, articles)
  if (body.reportId && dbEnabled()) await updateReportSection(body.reportId, body.key, bullets)
  send(res, 200, { key: body.key, bullets, model })
}

// 서버가 켜질 때: 관리자가 고른 AI 서버를 되살리고(17 문서 3-3) 자동 최신화 예약을 시작한다
const LLM_SETTING = 'llm_provider'
const LLM_MODELS = 'llm_models'
export function startScheduler() {
  loadConnections() // 11/25: 관리 페이지에서 넣은 AI 주소 · 키 · 새 연결 (모델 · 고른 서버보다 먼저 — 새 연결을 고를 수 있게)
    .catch((err) => console.warn(`[llm] 저장된 AI 연결을 읽지 못해 설정 파일 값으로: ${err.message}`))
    .then(() => loadApiKeys()) // 11/26: 관리 페이지에서 넣은 수집 API 키 → process.env (같은 암호 열쇠라 AI 연결 뒤에)
    .catch((err) => console.warn(`[api-keys] 저장된 수집 API 키를 읽지 못해 서버 설정 값으로: ${err.message}`))
    .then(() => getSetting(LLM_MODELS, null)) // 11/20: 관리 페이지에서 바꾼 모델 이름 · 예비 AI (서버를 다시 켜도 유지)
    .then((v) => v && setModelOverrides(v))
    .catch((err) => console.warn(`[llm] 저장된 모델 설정을 쓸 수 없어 설정 파일 값으로: ${err.message}`))
    .then(() => getSetting(LLM_SETTING, null))
    .then((id) => id && selectProvider(id))
    .catch((err) => console.warn(`[llm] 저장된 AI 서버를 쓸 수 없어 기본값으로: ${err.message}`))
  getSources().catch(() => {}) // 11/25: 관리 페이지에서 더한 출처를 미리 읽어 둔다 (출처 단계 tierOf가 켜질 때부터 알게)
  startRefreshScheduler()
  // 11/26: 관리 페이지 「세부 설정」(낱말 목록 · 같은 소식 묶기)을 먼저 읽고 목록을 계산 (읽기 전에 계산하면 기본값으로 한 번 계산됨)
  loadTunables()
    .catch(() => {})
    .then(() => listArticles())
    .catch(() => {}) // 11/17: 자료 현황 목록을 켜질 때 미리 계산해 둔다 (첫 화면이 계산을 기다리지 않게)
  startTechTrends({ allowed: backgroundAllowed }) // 기술 트렌드: 켜진 뒤 1분, 그 뒤 하루마다 (TECH_TRENDS=off면 안 함)
  startCorpus({ allowed: backgroundAllowed }) // 디스플레이 논문 DB: 켜진 뒤 3분, 그 뒤 6시간마다 (PAPER_CORPUS=off면 안 함, papers/corpus.js)
  startPrecompute({ allowed: backgroundAllowed }) // 기술 시계열 미리 분석: 켜진 뒤 10분, 그 뒤 6시간마다 (TIMELINE_PRECOMPUTE=off면 안 함, timelineJobs.js)
  // 11/21 Railway: 특허 제목 파일이 없고 PATENT_TITLES_URL이 있으면 켜진 뒤 30초에 한 번 받아 온다 (patentDb.js)
  // 11/21: PATENT_ABSTRACTS=fetch 이고 아직 안 받았으면 켜진 뒤 2분에 디스플레이 특허 초록을 한 번 받는다 (patentAbstracts.js, BigQuery 약 260GB — 하루 할당량을 그날만 올려야 함)
  // 11/22: PATENT_PUBS=fetch 면 원문 링크용 공보 번호도(약 37GB, 하루 한도 안). 초록이 있으면 전문 검색 색인도 없을 때 한 번 만든다
  if (dbEnabled()) setTimeout(() => fetchAbstractsIfWanted().catch((err) => console.warn(`[abstracts] ${err.message}`)), 120_000)
  if (process.env.PATENT_TITLES_URL) setTimeout(() => fetchTitlesIfMissing().catch((err) => console.warn(`[patent-db] ${err.message}`)), 30_000)
  // 사용 현황 원본은 90일만 둔다: 켜질 때 한 번, 그 뒤 하루 한 번
  const prune = () => {
    pruneUsage().catch((err) => console.warn(`[usage] 오래된 기록 정리 실패: ${err.message}`))
    pruneArticleTexts().catch((err) => console.warn(`[texts] 오래된 원문 정리 실패: ${err.message}`)) // 원문은 90일만
    pruneSearchCounts().catch((err) => console.warn(`[search] 오래된 검색어 횟수 정리 실패: ${err.message}`)) // 검색어 횟수는 90일만
    // 보고서 자동 정리 (11/13): 관리자가 정한 기간(기본 꺼짐)이 지난 보고서는 휴지통으로, 휴지통 보관 기간(기본 30일)이 지나면 영구 삭제
    getSetting(REPORT_RETENTION_SETTING, 0)
      .then((days) => trashReportsOlderThan(Number(days) || 0))
      .then((n) => n && console.log(`[reports] 휴지통으로 ${n}개`))
      .then(async () => purgeTrash(await trashDays()))
      .then((n) => n && console.log(`[reports] 휴지통 영구 삭제 ${n}개`))
      .catch((err) => console.warn(`[reports] 자동 정리 실패: ${err.message}`))
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
// 자료 현황 목록을 화면용으로 가볍게 (11/17, 39 문서 B: 4MB 넘게 받아 브라우저가 무거웠음)
// - 중요도 세부(scoreParts)에서 서버만 쓰는 원점수(raw)를 빼고, 모든 자료에 같은 배점(max) · 기준(high)은 한 번만(rule)
// - 비어 있거나 기본값인 칸(false · null · 빈 목록 · 배수 1)은 뺀다 → 화면(App.jsx)이 rule을 다시 붙인다
const lightCache = new WeakMap()
function lightParts(p) {
  if (!p) return p
  const out = {}
  for (const [k, v] of Object.entries(p)) {
    if (k === 'raw' || k === 'max' || k === 'high') continue
    if (v === null || v === false || v === undefined || (Array.isArray(v) && !v.length)) continue
    if ((k === 'weight' || k === 'noise') && v === 1) continue
    out[k] = v
  }
  return out
}
// 가벼운 목록 객체 (미리 계산한 목록마다 한 번) — 한 쪽씩 보기가 같은 객체를 쓴다
const lightObjs = new WeakMap()
async function lightOf(list) {
  let o = lightObjs.get(list)
  if (!o) {
    o = lightList(list)
    lightObjs.set(list, o)
  }
  return o
}

function lightList(list) {
  const sample = list.articles.find((a) => a.scoreParts?.max)
  return {
    ...list,
    rule: sample ? { max: sample.scoreParts.max, high: sample.scoreParts.high } : null,
    articles: list.articles.map((a) => (a.scoreParts && !a.paper ? { ...a, scoreParts: lightParts(a.scoreParts) } : a)),
  }
}

function cleanQueries(list, max) {
  return [...new Set(list.map((q) => String(q).trim().slice(0, 50)).filter(Boolean))].slice(0, max)
}

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
// 브라우저 번호 (11/15 대기열 보기): 화면이 쿠키 tb_client로 보낸다 (src/usage.js). 「내 작업」 표시에만 쓰고 저장하지 않는다
const clientOf = (req) => String(readCookie(req, 'tb_client') ?? '').replace(/[^\w-]/g, '').slice(0, 64) || null

// 요청 하나를 처리하는 동안 AI 호출이 누구의 요청인지 알 수 있게 맥락을 넣는다 (llm/client.js withQueueContext)
// 보고서 → 보고서팀 양식 데이터 (PPT · 미리보기 공통, 11/25)
// 예전 보고서(11/17 전)는 분석 묶음에 논문 추이 · 연구 폭 등이 없음 → 지금 묶음(3일 기억)으로 채우고 「분석 기준일」을 그 묶음 날짜로 (40 문서 R6)
// withDeck: 앱 양식 1쪽을 함께 만들고, 1쪽에 못 들어가 옮긴 사실을 유첨 1 「본문에서 옮긴 사실」로
async function templateDataFor(entry, { withDeck = true } = {}) {
  const { reportToTemplate, topicTrendItems } = await import('./reportToTemplate.js')
  const r0 = entry.report ?? {}
  const kws = (r0.analysis?.length ? r0.analysis.map((a) => a.keyword) : (r0.sources?.topics ?? [])).filter(Boolean).slice(0, 2)
  const fresh = await Promise.all(kws.map((k) => Promise.race([prepareBundle(k).catch(() => null), new Promise((ok) => setTimeout(() => ok(null), 15_000))])))
  const analysis = kws
    .map((k, i) => {
      const old = r0.analysis?.find((a) => a.keyword === k)
      const b = fresh[i]
      if (old?.papers || !b) return old
      return { ...(old ?? {}), keyword: k, at: b.at, stage: old?.stage ?? b.stage, patentYears: old?.patentYears?.length ? old.patentYears : b.patentYears, competitors: old?.competitors ?? b.competitors, owners: old?.owners ?? b.owners, quotes: old?.quotes ?? b.quotes, papers: b.papers, rising: b.rising, makers: b.makers, breadth: b.breadth, attention: b.attention, surges: b.surges, signal: b.signal }
    })
    .filter(Boolean)
  const e = analysis.length ? { ...entry, report: { ...r0, analysis } } : entry
  // 추이 그래프: 보고서 주제어가 든 모은 기사 수 → 없으면 맞는 수집 키워드 (11/17)
  const [topicItems, trendItems] = await Promise.all([topicTrendItems(e, query).catch(() => []), getTrends().then((t) => t.items).catch(() => [])])
  const data = reportToTemplate(e, { topicItems, trendItems })
  let deck = null
  if (withDeck) {
    const { reportPages, applyReportStyle } = await import('../src/reportSlides.js')
    applyReportStyle(await getReportStyle())
    deck = reportPages(e, { topic: { items: topicItems }, trends: { items: trendItems } })
    const moved = (deck.moved ?? []).map((f) => ({ text: f.text, refs: f.refs ?? [] }))
    if (moved.length) data.appendix = { ...data.appendix, single_facts: [...moved, ...(data.appendix?.single_facts ?? []).filter((x) => !moved.some((m) => m.text === x.text))] }
  }
  return { data, deck }
}

export function handleApi(req, res) {
  return withQueueContext({ client: clientOf(req), label: null }, () => handleApiInner(req, res))
}

async function handleApiInner(req, res) {
  try {
    if (crossOrigin(req)) return send(res, 403, { error: '다른 사이트에서 보낸 요청은 받지 않아요.' })
    // 운영 상태(점검 중 · AI 정지)면 일반 사용자의 요청을 막는다. 관리 페이지에서 보낸 관리자 요청만 그대로 (19 문서 6장, 11/08 원칙)
    if (!adminHere(req)) await checkOps(req)
    if (req.method === 'GET' && req.url === '/api/health') {
      const [modelReachable, db, sources, patentDb, patentAbstracts] = await Promise.all([pingModel(), dbStatus(), sourceStatus(), patentDbStatus().catch(() => ({ ready: false })), abstractsStatus().catch(() => ({ ready: false }))])
      return send(res, 200, {
        ok: true,
        model: modelName(),
        modelReachable,
        db,
        llm: llmProviders(),
        server: { startedAt: STARTED_AT, supervised: SUPERVISED, resumable: resumableCount() }, // resumable: 다시 켜진 뒤 이어서 할 보고서 작업 수 (11/20)
        sources, // 외부 출처 오늘 호출 수 · 한도 · 쉬는 중 (sourceGuard.js, 키는 없음)
        patentDb, // 디스플레이 특허 DB 건수 · 받은 날 (patentDb.js)
        patentAbstracts, // 디스플레이 특허 초록 건수 · 받는 중인지 (patentAbstracts.js, 11/21)
        kiwi: kiwiStatus().status, // 형태소 분석기 (kiwi.js): ready · loading · missing(모델 없음 → 예전 규칙) · idle(아직 안 씀)
      })
    }
    if (req.method === 'GET' && req.url === '/api/ops') {
      return send(res, 200, publicOps(await getOps()))
    }
    // 오류 기록 (11/26): 화면에서 난 오류를 모아 받음 (서버가 꺼져 있던 동안 것은 다시 연결된 뒤에) · 관리 페이지에서 보기
    if (req.method === 'POST' && req.url === '/api/client-errors') {
      const body = await readJson(req)
      const items = Array.isArray(body.items) ? body.items.slice(0, 30) : []
      for (const it of items) await logError({ side: 'client', kind: it.kind, path: it.path, status: it.status, message: it.message, clientId: body.clientId, at: it.at })
      return send(res, 200, { ok: true, saved: items.length })
    }
    if (req.method === 'GET' && req.url === '/api/admin/errors') {
      requireAdmin(req)
      return send(res, 200, { errors: await listErrors(200) })
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
      await loadCredentials()
      const result = login(await readJson(req), clientIp(req))
      if (result.reset) return send(res, 200, { reset: true }) // 잠금 리셋: 로그인은 하지 않음
      return send(res, 200, { admin: { name: result.name } }, { 'Set-Cookie': secureCookie(result.cookie, req) })
    }
    if (req.method === 'POST' && req.url === '/api/admin/logout') {
      return send(res, 200, { ok: true }, { 'Set-Cookie': secureCookie(logout(req), req) })
    }
    // 실험 기능: 누구나 읽고(화면이 무엇을 보일지 정함), 관리자만 바꾼다
    if (req.method === 'GET' && req.url === '/api/features') {
      return send(res, 200, { features: await getFeatures(), list: featureList(), limits: { reportArticles: tune('reportArticles') } }) // limits: 11/26 관리 페이지 「세부 설정」 (화면 보고서 한도)
    }
    if (req.method === 'PUT' && req.url === '/api/features') {
      const admin = requireAdmin(req)
      const before = await getFeatures()
      const after = await saveFeatures(await readJson(req))
      const STATE = { off: '꺼짐', test: '테스트에서만', all: '모두에게' }
      for (const f of FEATURES) {
        if (before[f.key] !== after[f.key]) await logChange(admin, '실험 기능', `${f.label}: ${STATE[before[f.key]]} → ${STATE[after[f.key]]}`)
      }
      // 판단 규칙 스위치(11/26)를 바꿨으면 점수 재료 기억을 비우고 목록 · 중요도를 새 규칙으로 다시 계산 (끝날 때까지는 기존 점수)
      if (RULE_FLAGS.some((k) => (before[k] === 'all') !== (after[k] === 'all'))) {
        globalThis.__scoreCtx = { at: 0, value: null }
        markListStale()
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
      return send(res, 200, { list: feedList(), ...(await getSources({ counts: true })), papers: await paperProviderStatus(), corpus: await corpusStatus().catch(() => null), kciOai: await kciOaiStatus().catch(() => null) })
    }
    if (req.method === 'PUT' && req.url === '/api/admin/sources') {
      const admin = requireAdmin(req)
      const prev = await getSources()
      const before = prev.disabled
      const after = await saveSources(await readJson(req))
      const names = Object.fromEntries(feedList().map((f) => [f.id, f.name]))
      const everyText = (h) => (h ? (h >= 168 ? '일주일마다' : `${h}시간마다`) : '최신화 때마다')
      for (const f of feedList()) {
        const was = !before.includes(f.id)
        const now = !after.disabled.includes(f.id)
        if (was !== now) await logChange(admin, '수집 출처', `${names[f.id]}: ${was ? '켜짐' : '꺼짐'} → ${now ? '켜짐' : '꺼짐'}`)
        const e0 = prev.every?.[f.id] ?? 0
        const e1 = after.every?.[f.id] ?? 0
        if (e0 !== e1) await logChange(admin, '수집 주기', `${names[f.id]}: ${everyText(e0)} → ${everyText(e1)}`)
      }
      return send(res, 200, { list: feedList(), ...after })
    }
    // 출처 시험 · 전체 점검 · 더하기 · 지우기 (11/25 조장). 시험은 저장하지 않는다
    if (req.method === 'POST' && req.url === '/api/admin/sources/test') {
      requireAdmin(req)
      const { id, url } = await readJson(req)
      const test = await testFeed(id ? { id: String(id) } : { url: String(url ?? '') })
      if (id) await markFeedTested(test).catch(() => {}) // 정상이면 지난 수집 오류를 지움
      return send(res, 200, test)
    }
    if (req.method === 'POST' && req.url === '/api/admin/sources/check') {
      requireAdmin(req)
      return send(res, 200, await checkAllFeeds())
    }
    if (req.method === 'POST' && req.url === '/api/admin/sources/custom') {
      const admin = requireAdmin(req)
      const { feed, test } = await addCustomFeed(await readJson(req))
      await logChange(admin, '수집 출처', `출처 더함: ${feed.name} (${feed.url})${test.recommend?.hours ? ` · 주기 ${test.recommend.hours}시간` : ''}`)
      return send(res, 200, { list: feedList(), ...(await getSources({ counts: true })), added: feed, test })
    }
    if (req.method === 'POST' && req.url.startsWith('/api/admin/sources/custom/') && req.url.endsWith('/delete')) {
      const admin = requireAdmin(req)
      const id = decodeURIComponent(req.url.slice('/api/admin/sources/custom/'.length, -'/delete'.length))
      if (!feedList().some((f) => f.id === id && f.custom)) return send(res, 403, { error: '기본 출처는 지울 수 없어요. 끄기만 할 수 있어요.' })
      requireConfirmed(req)
      const name = await deleteCustomFeed(id)
      await logChange(admin, '수집 출처', `출처 지움: ${name} (이미 모은 글은 그대로)`)
      return send(res, 200, { list: feedList(), ...(await getSources({ counts: true })) })
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
    // 화면 요약 대기열이 1분마다 묻는 동시 요청 수 (11/26) — /api/health는 AI 서버 · DB까지 확인해 무거움
    if (req.method === 'GET' && req.url === '/api/llm/parallel') {
      return send(res, 200, { parallel: llmProviders().parallel })
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
    // 민감한 작업 전 비밀번호 다시 확인 (11/25) → 10분 동안 유효
    if (req.method === 'POST' && req.url === '/api/admin/confirm') {
      requireAdmin(req)
      const { password } = await readJson(req)
      return send(res, 200, confirmAdmin(req, password))
    }
    // ── AI 연결 (11/25): 주소 · API 키 넣기(단방향) · 되돌리기 · 끄기 · 새 연결 더하기 · 지우기(새 연결만, 비밀번호 다시) · 시험 ──
    // 응답에는 키 글자가 없다 (publicConnections: 있음 · 없음 · 어디서 온 값). 변경 기록에도 키는 남기지 않는다
    if (req.url === '/api/admin/llm-connections' || req.url.startsWith('/api/admin/llm-connections/')) {
      const admin = requireAdmin(req)
      const [, , , , rawId, action] = req.url.split('?')[0].split('/')
      const sensitive = (req.method === 'POST' && !rawId) || (req.method === 'PUT' && rawId && !action) || ['revert', 'delete'].includes(action)
      if (sensitive) requireConfirmed(req) // 11/25: 키를 넣거나 바꾸거나 되돌리거나 지우는 일은 최근 10분 안에 비밀번호 확인
      const id = rawId ? decodeURIComponent(rawId) : ''
      const reply = () => send(res, 200, { connections: publicConnections(), llm: llmProviders() })
      const nameOf = (x) => llmProviders().providers.find((p) => p.id === x)?.label ?? x
      if (req.method === 'GET' && !id) return reply()
      if (req.method === 'POST' && !id) {
        const newId = await addCustom(await readJson(req))
        await logChange(admin, 'AI 연결', `새 연결 「${nameOf(newId)}」 더함`)
        return reply()
      }
      if (req.method === 'PUT' && id && !action) {
        const body = await readJson(req)
        const changed = BUILTIN_IDS.includes(id) ? await updateBuiltin(id, body) : await updateCustom(id, body)
        await logChange(admin, 'AI 연결', `「${nameOf(id)}」 ${changed.join(' · ')} 바꿈`)
        return reply()
      }
      if (req.method === 'POST' && action === 'revert') {
        const to = await revertConnection(id)
        await logChange(admin, 'AI 연결', `「${nameOf(id)}」 ${to}으로 되돌림`)
        return reply()
      }
      if (req.method === 'POST' && action === 'disable') {
        const { disabled } = await readJson(req)
        if (disabled && currentProviderId() === id) return send(res, 409, { error: '지금 쓰는 AI 연결은 끌 수 없어요. 먼저 다른 AI 서버를 고르세요.' })
        await setConnectionDisabled(id, Boolean(disabled))
        await logChange(admin, 'AI 연결', `「${nameOf(id)}」 ${disabled ? '끔' : '켬'}`)
        return reply()
      }
      // 11/26: 동시 요청 수 (키를 건드리지 않아 비밀번호 다시 확인은 묻지 않음)
      if (req.method === 'POST' && action === 'parallel') {
        const { parallel } = await readJson(req)
        const n = await setConnectionParallel(id, parallel)
        kickQueue()
        await logChange(admin, 'AI 연결', `「${nameOf(id)}」 동시 요청 수 ${n}`)
        return reply()
      }
      if (req.method === 'POST' && action === 'delete') {
        if (BUILTIN_IDS.includes(id)) return send(res, 403, { error: '기본 AI 연결은 지울 수 없어요. 바꾸거나 끌 수만 있어요.' })
        if (currentProviderId() === id) return send(res, 409, { error: '지금 쓰는 AI 연결은 지울 수 없어요. 먼저 다른 AI 서버를 고르세요.' })
        const label = await deleteCustom(id)
        // 예비 AI로 고른 연결이면 예비 AI 설정을 비운다
        const models = await getSetting(LLM_MODELS, null)
        if (models?.fallback === id) await setSetting(LLM_MODELS, setModelOverrides({ ...models, fallback: '' }))
        await logChange(admin, 'AI 연결', `새 연결 「${label}」 지움`)
        return reply()
      }
      if (req.method === 'POST' && action === 'test') {
        return send(res, 200, await testConnection(id))
      }
      return send(res, 404, { error: '없는 요청이에요.' })
    }
    // ── 수집 API 키 (11/26): 서비스마다 다른 칸(apiKeys.js SERVICES) · 넣기만 · 되돌리기 · 서버 설정 값으로. 응답 · 기록에 키 글자 없음 ──
    if (req.url === '/api/admin/api-keys' || req.url.startsWith('/api/admin/api-keys/')) {
      const admin = requireAdmin(req)
      const [, , , , rawId, action] = req.url.split('?')[0].split('/')
      const id = rawId ? decodeURIComponent(rawId) : ''
      if (req.method === 'GET' && !id) return send(res, 200, publicApiKeys())
      if (!id || !API_KEY_SERVICES.some((s) => s.id === id)) return send(res, 404, { error: '없는 서비스예요.' })
      requireConfirmed(req) // 키를 넣거나 되돌리는 일은 최근 10분 안에 비밀번호 확인 (AI 연결과 같음)
      const name = apiKeyServiceLabel(id)
      if (req.method === 'PUT' && !action) {
        const { values } = await readJson(req)
        const changed = await updateApiKeys(id, values)
        await logChange(admin, '수집 API 키', `「${name}」 ${changed.join(' · ')} 바꿈`)
        return send(res, 200, publicApiKeys())
      }
      if (req.method === 'POST' && action === 'revert') {
        await revertApiKeys(id)
        await logChange(admin, '수집 API 키', `「${name}」 바로 전 값으로 되돌림`)
        return send(res, 200, publicApiKeys())
      }
      if (req.method === 'POST' && action === 'reset') {
        await resetApiKeys(id)
        await logChange(admin, '수집 API 키', `「${name}」 서버 설정 값으로 되돌림`)
        return send(res, 200, publicApiKeys())
      }
      return send(res, 404, { error: '없는 요청이에요.' })
    }
    if (req.method === 'PUT' && req.url === '/api/admin/llm-models') {
      // 모델 이름 · 예비 AI (11/20). 빈 칸은 설정 파일 값. 열쇠 · 주소는 설정 파일에만
      const admin = requireAdmin(req)
      const saved = setModelOverrides(await readJson(req))
      await setSetting(LLM_MODELS, saved)
      const desc = Object.entries(saved.models).map(([id, m]) => `${id}: ${[m.model, m.reportModel && `보고서 ${m.reportModel}`].filter(Boolean).join(' · ')}`).join(' / ')
      await logChange(admin, 'AI 모델 이름', `${desc || '모두 설정 파일 값'} · 예비 AI ${saved.fallback ?? '설정 파일 값'}`)
      return send(res, 200, llmProviders())
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
    // AI 대기열 (11/15): 지금 처리 중 · 기다리는 AI 요청, 보고서 작업, 자동 요약 대기 — 오른쪽 아래 창과 관리 페이지 「운영」
    // 기다리는 AI 일 순서 바꾸기 (11/17): 일반 화면은 내 작업끼리, 관리 페이지에서 보낸 요청은 모든 일의 단계 (adminHere, 11/08 원칙)
    if (req.method === 'POST' && req.url === '/api/queue/move') {
      const { id, action } = await readJson(req)
      const viewer = clientOf(req)
      return send(res, 200, moveJob(id, String(action), { viewer, admin: Boolean(adminHere(req)) }))
    }
    if (req.method === 'GET' && req.url === '/api/queue') {
      const viewer = clientOf(req)
      return send(res, 200, { ...queueList(viewer), reports: activeJobs(viewer), backlog: backlogBrief(), at: new Date().toISOString() })
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
      await logChange(admin, '자동 최신화', `${mode} · 자동 요약 ${s.autoSummary === 'off' ? '꺼짐' : `켜짐(기사 최근 ${s.summaryDays}일)`} · 네이버 기사 ${s.naverKeepDays ? `${s.naverKeepDays}일 보관` : '지우지 않음'}`)
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
      // 11/10: 한글 검색어는 영문 검색어를 먼저 만든다(queryTerms.js). 네이버는 기다리지 않고 같이 찾는다
      //   논문(OpenAlex)과 이미 모은 1·2차 출처(DB)는 영문 검색어로도 찾는다
      const terms = englishTerms(query).catch((err) => ({ terms: [], source: null, error: err.message }))
      const [news, papers, collected] = await Promise.all([
        searchArticles(query, { period }),
        terms.then((t) => searchPaperArticles(query, period, t)).catch((err) => ({ articles: [], note: `논문을 찾지 못했어요 (${err.message})` })),
        terms.then((t) => searchCollected(query, t.terms, { period })).catch((err) => {
          console.warn(`[search] 1·2차 출처 찾기 실패: ${err.message}`)
          return { articles: [] }
        }),
      ])
      recordSearch(query, clientIp(req)).catch((err) => console.warn(`[search] 검색어 횟수 기록 실패: ${err.message}`))
      // 찾기 결과 중 「중요」 뉴스는 자동 요약 대기열에 (11/09 조장, refresh.js). 응답은 기다리지 않는다
      queueSearchSummaries(news.articles).catch((err) => console.warn(`[search] 자동 요약 넣기 실패: ${err.message}`))
      // 네이버 결과와 같은 글(주소)은 1·2차 쪽을 뺀다
      const seen = new Set(news.articles.map((a) => a.url))
      const feedHits = collected.articles.filter((a) => !seen.has(a.url))
      return send(res, 200, {
        ...news,
        articles: [...news.articles, ...feedHits, ...papers.articles],
        newsCount: news.articles.length,
        collectedCount: feedHits.length,
        paperCount: papers.articles.length,
        paperNote: papers.note,
        newsNote: news.newsError ? `네이버 뉴스가 잠시 막혀 이미 모은 자료 · 논문만 보여요 (${news.newsError})` : null,
        paperTerms: papers.terms ?? [],
        paperPending: Boolean(papers.pending),
        paperProvider: papers.provider ?? null,
      })
    }
    // 기술 시계열 (11/10): 숫자 · 단계는 규칙으로(buildTimeline), 글은 AI가 따로(timelineStory, 1분 안팎)
    if (req.method === 'POST' && req.url === '/api/timeline') {
      const { query, refresh = false, open = false } = await readJson(req)
      const tl = await buildTimeline(query, { refresh: Boolean(refresh) })
      // 키워드 분석을 연 기록 (11/17 P12): 화면이 open을 보낼 때만 (미리보기 · 다시 계산은 세지 않음)
      if (open && !refresh) recordSearch(query, clientIp(req), { open: true }).catch(() => {})
      // 11/12: 분석한 키워드는 보고서에 쓸 묶음을 뒤에서 미리 만들어 둔다 (keywordBundle.js, 3일 기억)
      prepareBundle(query, { refresh: Boolean(refresh) }).catch((err) => console.warn(`[bundle] ${query}: ${err.message}`))
      // 11/26 D2: 실험 기능 「논문 미리 모으기」가 켜져 있으면 처음 · 성장기 논문을 뒤에서 받아 둔다 (papers/prefetch.js, 한 말 30일에 한 번)
      if (open) prefetchLater(query)
      return send(res, 200, tl)
    }
    if (req.method === 'GET' && req.url === '/api/timeline/ready') {
      return send(res, 200, await readyTimelines())
    }
    // 기술 시계열 「최근 소식」 (11/17, 37 문서 P8): 모은 기사 중 최근 30일 그 말이 든 이슈, 자료 현황과 같은 점수 · 요약 한 줄
    if (req.method === 'GET' && req.url.startsWith('/api/timeline/news?')) {
      const q = new URL(req.url, 'http://x').searchParams.get('q')
      const { timelineNews } = await import('./timelineNews.js')
      return send(res, 200, await timelineNews(q))
    }
    // 관리 페이지에서 미리 분석을 바로 돌릴 때 (뒤에서 돌고 바로 돌려줌)
    if (req.method === 'POST' && req.url === '/api/admin/timeline/precompute') {
      requireAdmin(req)
      runPrecompute().catch((err) => console.warn(`[timeline-jobs] ${err.message}`))
      return send(res, 202, { started: true })
    }
    if (req.method === 'POST' && req.url === '/api/timeline/story') {
      const { query, refresh = false } = await readJson(req)
      return send(res, 200, await timelineStory(query, { refresh: Boolean(refresh) }))
    }
    // 대표 특허 (11/22, patentMaterials.js): 키워드 분석 「대표 특허」 3건 — 찾기 목록의 특허와 같은 순서(최근 · 여러 나라 · 비교 회사)
    if (req.method === 'GET' && req.url.startsWith('/api/patents?')) {
      const q = String(new URL(req.url, 'http://x').searchParams.get('q') ?? '').trim().slice(0, 60)
      if (!q) return send(res, 400, { error: '키워드가 없어요.' })
      const t = await englishTerms(q, { waitMs: 8_000 }).catch(() => ({ terms: [] }))
      const { searchPatentArticles } = await import('./patentMaterials.js')
      const { articles } = await searchPatentArticles(q, 'all', t.terms ?? [])
      return send(res, 200, { keyword: q, patents: articles.slice(0, 3).map(({ title, url, publishedAt, source, abstract, countries, patentNo, patentCompany }) => ({ title, url, year: publishedAt.slice(0, 4), owner: source.replace(/^특허 · /, ''), abstract, countries: countries.length, patentNo, company: patentCompany })) })
    }
    // 키워드 분석 묶음 (11/12, keywordBundle.js): 대시보드 키워드 분석 · 보고서가 같은 것을 본다. 화면용이라 네이버 문장도 aiOk: false로 함께
    if (req.method === 'GET' && req.url.startsWith('/api/bundle?')) {
      const q = new URL(req.url, 'http://x').searchParams.get('q')
      return send(res, 200, (await prepareBundle(q)) ?? {})
    }
    // 세부 카테고리 × 경쟁사 특허 (11/12, 대시보드 「이번 주 한눈에」 · keywordBundle.js). 7일 기억, 특허 DB를 다시 받으면 다시 셈
    // 요즘 뜨는 기술 옆 자사 위협 · 기회 (11/14 조장): 기술 용어 → 그 말이 든 특허가 가장 많은 세부 기술(CPC) → 경쟁사 특허 판정
    // 특허 10건 미만이면 연결이 약해 판정하지 않음. 값은 mapMaterials(24시간) · categoryCompetitors(7일) 기억을 그대로 씀
    // 세부 기술 카테고리 9개의 해마다 특허 수 · 앞 3년 대비 (11/17 R11, 7일 기억)
    if (req.method === 'GET' && req.url === '/api/category-trends') {
      return send(res, 200, (await categoryTrends()) ?? { items: [] })
    }
    if (req.method === 'GET' && req.url.startsWith('/api/trend-verdicts?')) {
      const terms = (new URL(req.url, 'http://x').searchParams.get('terms') ?? '').split('|').map((t) => t.trim()).filter(Boolean).slice(0, 20)
      const one = async (term) => [term, await termVerdict(term).catch(() => null)]
      return send(res, 200, { verdicts: Object.fromEntries(await Promise.all(terms.map(one))), threatFactor: judgeRule().threatFactor })
    }
    // 자료 목록의 「자사 위협 · 기회 기술」 표시 (11/17, server/techVerdicts.js)
    if (req.method === 'GET' && req.url === '/api/tech-verdicts') {
      const { techVerdicts } = await import('./techVerdicts.js')
      return send(res, 200, await techVerdicts())
    }
    if (req.method === 'GET' && req.url === '/api/category-competitors') {
      return send(res, 200, { categories: await allCategoryCompetitors(), rule: `위협: 경쟁사 중 하나가 분야 증가의 ${judgeRule().threatFactor}배 이상 · 자사는 분야보다 느림 / 기회: 자사가 경쟁사 모두보다 빠르고 분야 이상` })
    }
    // 연관 키워드 (11/10, 대시보드 맵 재료 · related.js)
    // 맵 점의 관련 기사 3건 (11/15, related.js wordArticles)
    if (req.method === 'GET' && req.url.startsWith('/api/related/articles?')) {
      const sp = new URL(req.url, 'http://x').searchParams
      return send(res, 200, await wordArticles(sp.get('q'), sp.get('w')))
    }
    if (req.method === 'GET' && req.url.startsWith('/api/related?')) {
      const q = new URL(req.url, 'http://x').searchParams.get('q')
      // 11/12: 뉴스에서 함께 나온 말 + 우리 DB 재료(특허 출원인 · 논문 핵심어 · 기업). 재료를 못 만들면 뉴스 맵만
      const [news, materials] = await Promise.all([relatedWords(q), mapMaterials(q).catch(() => null)])
      return send(res, 200, { ...news, nodes: fillMap(news.nodes, materials), materials })
    }
    // 범위 찾기 (11/10): 중심 키워드 + 고른 말 (scopeSearch.js)
    if (req.method === 'POST' && req.url === '/api/search/scope') {
      const { query, terms = [], period } = await readJson(req) // 11/14: mode(넓게/좁게) 없앰 — 늘 고른 말이 든 자료만
      const out = await scopeSearch({ query, terms: Array.isArray(terms) ? terms.map(String) : [], period })
      recordSearch(query, clientIp(req)).catch(() => {})
      queueSearchSummaries(out.newsArticles).catch((err) => console.warn(`[search] 자동 요약 넣기 실패: ${err.message}`))
      const { newsArticles, ...body } = out
      return send(res, 200, { ...body, newsCount: newsArticles.length })
    }
    // 영문 검색어가 늦게 만들어질 때 (paperPending) 화면이 뒤에서 다시 부른다: 논문 + 영문 표기로 찾은 1·2차 출처만 (11/10)
    if (req.method === 'POST' && req.url === '/api/search/papers') {
      const { query, period } = await readJson(req)
      const t = await englishTerms(query, { waitMs: 90_000 })
      const [papers, collected] = await Promise.all([
        searchPaperArticles(query, period, t).catch((err) => ({ articles: [], note: `논문을 찾지 못했어요 (${err.message})` })),
        searchCollected(query, t.terms, { period }).catch(() => ({ articles: [] })),
      ])
      return send(res, 200, { query, collected: collected.articles, papers: papers.articles, paperNote: papers.note, paperTerms: papers.terms ?? [], paperPending: Boolean(papers.pending) })
    }
    // 검색어: 즐겨찾기 ☆ · 최근 검색어는 IP별 (선별 폴더와 같은 방식)
    // 11/16 조장: 「추천 검색어」(관리자가 따로 고르던 공용 목록)를 자동 수집 키워드와 합쳤다 — 추천은 자동 수집되는 말만.
    // 화면은 추천 대신 /api/keywords의 자동 수집 키워드를 보여 준다 (예전 설정값 recommended_queries는 DB에 남아 있지만 읽지 않음)
    if (req.method === 'GET' && req.url === '/api/favorites') {
      const ip = clientIp(req)
      return send(res, 200, {
        favorites: await getSetting(`favorite_queries:ip:${ip}`, []),
        recent: await getSetting(`recent_queries:ip:${ip}`, null), // null = 아직 서버에 없음 (브라우저 것을 올림)
      })
    }
    if (req.method === 'PUT' && req.url === '/api/favorites') {
      const ip = clientIp(req)
      const body = await readJson(req)
      const out = {}
      if (Array.isArray(body.favorites)) {
        out.favorites = cleanQueries(body.favorites, 30)
        await setSetting(`favorite_queries:ip:${ip}`, out.favorites)
      }
      if (Array.isArray(body.recent)) {
        out.recent = cleanQueries(body.recent, 10)
        await setSetting(`recent_queries:ip:${ip}`, out.recent)
      }
      return send(res, 200, out)
    }
    // 자주 찾은 새 키워드 · 검색어 영문 표기 (11/10): 자동 수집 키워드는 회의를 거쳐 관리자가 넣는다 → 그 판단 자료
    // 중요도 기준 (11/15 팀 회의, importanceRule.js): 보기 · 미리보기 · 저장 — 관리자만
    if (req.method === 'GET' && req.url === '/api/admin/importance-rule') {
      requireAdmin(req)
      return send(res, 200, { rule: await loadImportanceRule({ fresh: true }), defaults: DEFAULT_RULE, parts: IMPORTANCE_PARTS, history: await ruleHistory() })
    }
    if (req.method === 'POST' && req.url === '/api/admin/importance-rule/preview') {
      requireAdmin(req)
      const rule = checkRule(await readJson(req))
      await loadImportanceRule({ fresh: true })
      return send(res, 200, previewRule((await listArticles()).articles, rule))
    }
    if (req.method === 'PUT' && req.url === '/api/admin/importance-rule') {
      const admin = requireAdmin(req)
      const before = await loadImportanceRule({ fresh: true })
      const rule = await saveImportanceRule(await readJson(req), admin?.name)
      markListStale() // 11/17: 목록 점수를 새 기준으로 다시 계산 (끝날 때까지는 기존 점수)
      await logChange(admin, '중요도 기준', `${describeRule(before)} → ${describeRule(rule)}`)
      return send(res, 200, { rule, history: await ruleHistory() })
    }
    // 관리 안내 (11/20, 관리자 인수인계): 웹으로 보기(HTML) · 내려받기(PDF). 기본은 저장소 docs/admin_guide 파일,
    // 관리자가 새 판으로 바꿀 수 있게 하되 배포를 마칠 때까지는 잠근다 (서버 설정 MANUAL_UPLOAD=on일 때만 열림)
    if (req.method === 'GET' && req.url === '/api/admin/manual') {
      requireAdmin(req)
      const info = async (kind) => {
        const up = await getSetting(`manual_${kind}`, null).catch(() => null)
        return up?.data ? { source: 'uploaded', at: up.at, size: up.size } : { source: 'bundled' }
      }
      return send(res, 200, { html: await info('html'), pdf: await info('pdf'), uploadOpen: process.env.MANUAL_UPLOAD === 'on' })
    }
    if (req.method === 'GET' && /^\/api\/admin\/manual\/(html|pdf)(\?|$)/.test(req.url)) {
      requireAdmin(req)
      const kind = req.url.includes('/pdf') ? 'pdf' : 'html'
      const up = await getSetting(`manual_${kind}`, null).catch(() => null)
      const body = up?.data ? Buffer.from(up.data, 'base64') : await readFile(new URL(`../docs/admin_guide/techbrief_admin_guide.${kind}`, import.meta.url))
      const headers =
        kind === 'pdf'
          ? { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('테크브리프_관리자_안내.pdf')}` }
          : { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': 'sandbox allow-popups allow-modals; default-src data: \'unsafe-inline\'' } // 올린 HTML이 스크립트를 돌리지 못하게
      res.writeHead(200, { ...headers, 'Cache-Control': 'no-store' })
      return res.end(body)
    }
    if (req.method === 'PUT' && /^\/api\/admin\/manual\/(html|pdf)$/.test(req.url)) {
      const admin = requireAdmin(req)
      if (process.env.MANUAL_UPLOAD !== 'on') throw Object.assign(new Error('관리 안내 파일 바꾸기는 배포를 마친 뒤 열려요.'), { status: 423 })
      const kind = req.url.endsWith('/pdf') ? 'pdf' : 'html'
      const { data } = await readJson(req, 12_000_000)
      const buf = Buffer.from(String(data ?? ''), 'base64')
      if (!buf.length || buf.length > 8_000_000) throw Object.assign(new Error('파일은 8MB까지 올릴 수 있어요.'), { status: 400 })
      const head = buf.subarray(0, 512).toString('utf8').toLowerCase()
      if (kind === 'pdf' ? !head.startsWith('%pdf') : !(head.includes('<!doctype html') || head.includes('<html'))) throw Object.assign(new Error(kind === 'pdf' ? 'PDF 파일이 아니에요.' : 'HTML 파일이 아니에요.'), { status: 400 })
      await setSetting(`manual_${kind}`, { data: buf.toString('base64'), size: buf.length, at: new Date().toISOString() })
      await logChange(admin, '관리 안내', `${kind.toUpperCase()} 파일을 새 판으로 바꿈 (${Math.round(buf.length / 1024)}KB)`)
      return send(res, 200, { ok: true })
    }
    // 접속 · 보안 (11/20, credentials.js): 접속 코드 · 관리자 비밀번호를 관리 페이지에서 — 값은 보내지도 기록하지도 않음
    if (req.method === 'GET' && req.url === '/api/admin/security') {
      requireAdmin(req)
      await loadCredentials({ fresh: true })
      return send(res, 200, {
        accessCode: storedAccessToken() ? 'admin' : envAccessCodeSet() ? 'env' : 'none',
        password: storedPassword() ? 'admin' : envPasswordSet() ? 'env' : 'none',
        passwordAt: storedPassword()?.at ?? null,
      })
    }
    if (req.method === 'PUT' && req.url === '/api/admin/security/access-code') {
      const admin = requireAdmin(req)
      const { code, current } = await readJson(req)
      if (!passwordMatches(current)) throw Object.assign(new Error('관리자 비밀번호가 맞지 않아요.'), { status: 403 })
      const token = accessTokenOf(checkNewCode(code))
      await saveAccessToken(token)
      await logChange(admin, '접속 코드', '관리 페이지에서 바꿈 (예전 코드로 들어온 브라우저는 새 코드를 넣어야 함)')
      // 바꾼 사람은 새 코드로 바로 통과 (자기 화면이 잠기지 않게)
      return send(res, 200, { accessCode: 'admin' }, { 'Set-Cookie': secureCookie(`${ACCESS_COOKIE}=${token}; Max-Age=${ACCESS_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax`, req) })
    }
    if (req.method === 'POST' && req.url === '/api/admin/security/access-code/reset') {
      const admin = requireAdmin(req)
      const { current } = await readJson(req)
      if (!passwordMatches(current)) throw Object.assign(new Error('관리자 비밀번호가 맞지 않아요.'), { status: 403 })
      if (!envAccessCodeSet()) throw Object.assign(new Error('설정 파일에 접속 코드가 없어 되돌리면 누구나 들어올 수 있게 돼요. 새 코드로 바꿔 주세요.'), { status: 400 })
      await saveAccessToken(null)
      await logChange(admin, '접속 코드', '설정 파일 값으로 되돌림')
      return send(res, 200, { accessCode: 'env' })
    }
    if (req.method === 'PUT' && req.url === '/api/admin/security/password') {
      const admin = requireAdmin(req)
      const { current, next } = await readJson(req)
      if (!passwordMatches(current)) throw Object.assign(new Error('지금 비밀번호가 맞지 않아요.'), { status: 403 })
      await saveAdminPassword(next)
      await logChange(admin, '관리자 비밀번호', '관리 페이지에서 바꿈')
      return send(res, 200, { password: 'admin' })
    }
    if (req.method === 'POST' && req.url === '/api/admin/security/password/reset') {
      const admin = requireAdmin(req)
      const { current } = await readJson(req)
      if (!passwordMatches(current)) throw Object.assign(new Error('지금 비밀번호가 맞지 않아요.'), { status: 403 })
      if (!envPasswordSet()) throw Object.assign(new Error('설정 파일에 비밀번호가 없어 되돌리면 관리자로 들어올 수 없게 돼요.'), { status: 400 })
      await clearAdminPassword()
      await logChange(admin, '관리자 비밀번호', '설정 파일 값으로 되돌림')
      return send(res, 200, { password: 'env' })
    }
    // 판정 기준 · 회사 특허 이름 (11/20, judgeSettings.js): 코드로 고치던 숫자를 관리 페이지에서 — 관리자만
    // 보고서 양식 (11/20): 글꼴 · 글자 크기 · 강조색 · 여백 · 줄 간격. 읽기는 누구나(화면이 보고서를 그릴 때), 바꾸기는 관리자만
    if (req.method === 'GET' && req.url === '/api/report-style') {
      return send(res, 200, { style: await getReportStyle() })
    }
    if (req.method === 'GET' && req.url === '/api/admin/report-style') {
      requireAdmin(req)
      return send(res, 200, { style: await getReportStyle(), defaults: DEFAULT_STYLE, sizeFields: SIZE_FIELDS, layoutFields: LAYOUT_FIELDS, history: await reportStyleHistory() })
    }
    if (req.method === 'PUT' && req.url === '/api/admin/report-style') {
      const admin = requireAdmin(req)
      const out = await saveReportStyle(await readJson(req), admin)
      await logChange(admin, '보고서 양식', describeStyle(out.style))
      return send(res, 200, out)
    }
    // 기술 ↔ CPC 연결표 (11/21, techCpc.js): 특허 제목에 드문 기술을 CPC로도 센다. 켜고 끄고 고치기 · 켜기 전 확인
    if (req.method === 'GET' && req.url === '/api/admin/tech-cpc') {
      requireAdmin(req)
      const { loadTechCpc, DEFAULT_TECHS, techCpcVersion } = await import('./techCpc.js')
      const list = await loadTechCpc({ fresh: true })
      return send(res, 200, { list, defaults: DEFAULT_TECHS, version: techCpcVersion() })
    }
    if (req.method === 'PUT' && req.url === '/api/admin/tech-cpc') {
      const admin = requireAdmin(req)
      const { loadTechCpc, saveTechCpc, resetTechCpc, techCpcVersion } = await import('./techCpc.js')
      const before = (await loadTechCpc({ fresh: true })).filter((t) => t.on).map((t) => t.name)
      const body = await readJson(req)
      const list = body?.reset ? await resetTechCpc(admin?.name) : await saveTechCpc(body?.list, admin?.name)
      const { staleTechVerdicts } = await import('./techVerdicts.js')
      staleTechVerdicts()
      markListStale() // 자료 목록의 「자사 위협 · 기회」 표시도 새 연결표로
      const after = list.filter((t) => t.on).map((t) => t.name)
      await logChange(admin, '기술 ↔ CPC 연결표', `켠 기술: ${before.join(', ') || '없음'} → ${after.join(', ') || '없음'}`)
      return send(res, 200, { list, version: techCpcVersion() })
    }
    if (req.method === 'POST' && req.url === '/api/admin/tech-cpc/preview') {
      requireAdmin(req)
      const { previewTech } = await import('./techCpc.js')
      return send(res, 200, await previewTech(await readJson(req)))
    }
    // 특허 「제목만 / 제목 + 초록」 비교 (11/22, abstractCompare.js): 읽기만, 판정은 안 바꿈
    if (req.method === 'GET' && req.url === '/api/admin/abstract-compare') {
      requireAdmin(req)
      const { COMPARE_SET } = await import('./abstractCompare.js')
      const { abstractsStatus } = await import('./patentAbstracts.js')
      return send(res, 200, { set: COMPARE_SET, abstracts: await abstractsStatus() })
    }
    if (req.method === 'POST' && req.url === '/api/admin/abstract-compare') {
      requireAdmin(req)
      const { compareAbstracts } = await import('./abstractCompare.js')
      return send(res, 200, await compareAbstracts(await readJson(req)))
    }
    // 세부 설정 (11/26, notes/admin-review-1120 S5 · S7~S12): 코드에만 있던 숫자 · 낱말 목록 · 세부 기술 분류. 묶음(카드)마다 저장 · 처음 값으로
    if (req.method === 'GET' && req.url === '/api/admin/tunables') {
      requireAdmin(req)
      await loadTunables({ fresh: true })
      return send(res, 200, { ...tunablesView(), history: (await tunablesHistory()).slice(0, 10).map(({ at, name, group }) => ({ at, name, group })) })
    }
    const tuneMatch = req.url.match(/^\/api\/admin\/tunables\/([a-z]+)(\/reset)?$/)
    if (tuneMatch && ((req.method === 'PUT' && !tuneMatch[2]) || (req.method === 'POST' && tuneMatch[2]))) {
      const admin = requireAdmin(req)
      const group = tuneMatch[1]
      const reset = Boolean(tuneMatch[2])
      const { before, after, changed } = await saveTunables(group, reset ? {} : (await readJson(req))?.values, admin?.name)
      if (changed.length) {
        if (['words', 'dedupe'].includes(group)) markListStale() // 점수 · 묶음을 새 값으로 다시 계산 (끝날 때까지는 기존 값)
        if (group === 'categories') {
          const { staleTechVerdicts } = await import('./techVerdicts.js')
          staleTechVerdicts()
          markListStale()
        }
        const title = TUNE_GROUPS.find((g) => g.id === group)?.title ?? group
        const pick = (o) => Object.fromEntries(changed.filter((k) => k in o).map((k) => [k, o[k]]))
        await logChange(admin, '세부 설정', `${title}${reset ? ' 처음 값으로' : ''}: ${describeTunables(pick(before))} → ${describeTunables(pick(after))}`)
      }
      return send(res, 200, { ...tunablesView(), updated: changed })
    }
    if (req.method === 'GET' && req.url === '/api/admin/judge') {
      requireAdmin(req)
      await loadJudgeSettings({ fresh: true })
      const lists = await getLists().catch(() => ({}))
      const row = (name, role) => {
        const o = ownerOf(name)
        return { name, role, source: o?.source ?? 'none', like: o?.like ?? [] }
      }
      const companies = [...(lists.own ?? []).map((n) => row(n, 'own')), ...(lists.competitors ?? []).map((n) => row(n, 'competitor'))]
      return send(res, 200, { rule: judgeRule(), defaults: DEFAULT_JUDGE, fields: RULE_FIELDS, history: await judgeHistory(), companies })
    }
    if (req.method === 'PUT' && req.url === '/api/admin/judge') {
      const admin = requireAdmin(req)
      await loadJudgeSettings({ fresh: true })
      const before = judgeRule()
      const rule = await saveJudgeRule(await readJson(req), admin?.name)
      const { staleTechVerdicts } = await import('./techVerdicts.js')
      staleTechVerdicts()
      markListStale() // 자료 목록의 「자사 위협 · 기회」 표시도 새 기준으로
      await logChange(admin, '판정 기준', `${describeJudge(before)} → ${describeJudge(rule)}`)
      return send(res, 200, { rule, history: await judgeHistory() })
    }
    // 출원인 이름으로 특허 DB에서 최근 6년 몇 건이 잡히나 (저장 전 확인)
    if (req.method === 'POST' && req.url === '/api/admin/judge/owner-check') {
      requireAdmin(req)
      const like = checkOwnerPatterns((await readJson(req)).like)
      if (!like.length || !dbEnabled()) return send(res, 200, { count: null, samples: [] })
      const since = (new Date().getFullYear() - 6) * 10000
      const { rows } = await query(
        `SELECT o AS name, count(*)::int AS n FROM display_patents, unnest(owners) o WHERE pub >= $1 AND o LIKE ANY($2::text[]) GROUP BY o ORDER BY n DESC LIMIT 6`,
        [since, like],
      )
      return send(res, 200, { count: rows.reduce((a, r) => a + r.n, 0), samples: rows })
    }
    if (req.method === 'PUT' && req.url === '/api/admin/judge/owner') {
      const admin = requireAdmin(req)
      const { name, like } = await readJson(req)
      const saved = await saveOwner(name, like)
      const { staleTechVerdicts } = await import('./techVerdicts.js')
      staleTechVerdicts()
      markListStale()
      await logChange(admin, '회사 특허 이름', saved.like.length ? `${saved.name}: ${saved.like.join(', ')}` : `${saved.name}: 직접 넣은 이름 지움 (기본 사전)`)
      return send(res, 200, saved)
    }
    if (req.method === 'GET' && req.url.startsWith('/api/admin/search-terms')) {
      requireAdmin(req)
      const days = Math.min(90, Math.max(1, Number(new URL(req.url, 'http://x').searchParams.get('days')) || 14))
      const exclude = await getKeywords().catch(() => []) // 11/16: 추천 검색어를 자동 수집 키워드와 합침
      return send(res, 200, { days, frequent: await frequentSearches({ days, exclude }), translations: await listQueryTerms() })
    }
    if (req.method === 'PUT' && req.url === '/api/admin/query-terms') {
      const admin = requireAdmin(req)
      const { query, terms = [] } = await readJson(req)
      const saved = await setQueryTerms(query, terms)
      await logChange(admin, '검색어 영문 표기', saved.terms.length ? `${saved.query} → ${saved.terms.join(' · ')}` : `${saved.query} 지움 (다음 찾기 때 AI가 다시 만듦)`)
      return send(res, 200, saved)
    }
    if (req.method === 'GET' && req.url === '/api/lists') {
      return send(res, 200, await getLists())
    }
    if (req.method === 'PUT' && req.url === '/api/lists') {
      // 자사·경쟁사·관심 기술: 중요도 점수에 쓰여 모두에게 영향 → 관리자만
      const admin = requireAdmin(req)
      const before = await getLists()
      const saved = await saveLists(await readJson(req))
      markListStale() // 경쟁사 · 관심 기술이 바뀌면 중요도도 바뀜
      const names = { own: '자사·자회사', competitors: '경쟁사', interests: '관심 기술' }
      for (const [key, label] of Object.entries(names)) {
        const d = diffWords(before[key], saved[key])
        if (d !== '변경 없음') await logChange(admin, label, d)
      }
      return send(res, 200, saved)
    }
    // 자료 현황 한 쪽씩 (11/17 B2, server/articlePages.js): 실험 기능 「articlesPaging」을 켠 화면만 쓴다. 같은 미리 계산 목록 · 가벼운 꼴
    if (req.method === 'GET' && (req.url === '/api/articles/home' || req.url.startsWith('/api/articles/page'))) {
      const light = await lightOf(await listArticles())
      const { articlesHome, articlesPage } = await import('./articlePages.js')
      if (req.url === '/api/articles/home') return send(res, 200, await articlesHome(light))
      return send(res, 200, await articlesPage(light, new URL(req.url, 'http://x').searchParams, clientOf(req)))
    }
    if (req.method === 'POST' && req.url === '/api/articles/by-ids') {
      const { ids = [] } = await readJson(req)
      const { articlesByIds } = await import('./articlePages.js')
      return send(res, 200, await articlesByIds(await lightOf(await listArticles()), ids))
    }
    if (req.method === 'GET' && req.url === '/api/articles') {
      // 11/17 (39 문서 B): 화면용으로 가볍게 — 미리 계산한 목록마다 한 번만 만들어 두고 그대로 보낸다
      const list = await listArticles()
      // 목록마다 한 번만 글로 만들고 · 압축해 둔다 (압축은 처음 받을 때 한 번, 약 0.1초)
      let cached = lightCache.get(list)
      if (!cached) {
        cached = { body: JSON.stringify(lightList(list)), gz: null }
        lightCache.set(list, cached)
      }
      if (acceptsGzip(res) && !cached.gz) cached.gz = gzipSync(cached.body, { level: 6 })
      return sendBody(res, 200, cached.body, {}, cached.gz)
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
      markListStale() // 11/17: 관심 기술 = 자동 수집 키워드라 중요도(사업 연관성)도 바뀜
      return send(res, 200, { keywords: saved })
    }
    // 직접 추가한 자료 (27 문서 3장). 파일은 base64로 받아 크기 제한을 따로 둔다
    if (req.method === 'GET' && (req.url === '/api/materials' || req.url.startsWith('/api/materials?'))) {
      const client = new URLSearchParams(req.url.split('?')[1] ?? '').get('client')
      return send(res, 200, { materials: await listMaterials(300, client) })
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
      const { folders = [], folderOf = {}, selectedIds = [], tagsOf = {} } = await readJson(req)
      const ip = clientIp(req)
      if (!ip) return send(res, 400, { error: '접속 주소를 알 수 없어요.' })
      const data = {
        folders: folders.slice(0, 50).map((f) => ({ id: String(f.id).slice(0, 40), name: String(f.name ?? '').slice(0, 40) })),
        folderOf: Object.fromEntries(Object.entries(folderOf).slice(0, 2000).map(([k, v]) => [String(k).slice(0, 200), String(v).slice(0, 40)])),
        selectedIds: selectedIds.slice(0, 2000).map((x) => String(x).slice(0, 200)),
        // 11/22: 폴더 → 키워드 태그 (기사마다 검색어 태그 최대 5개). folders · folderOf는 예전 기록용으로만 남음 (화면은 빈 값을 보냄)
        tagsOf: Object.fromEntries(
          Object.entries(tagsOf && typeof tagsOf === 'object' ? tagsOf : {})
            .slice(0, 2000)
            .map(([k, v]) => [String(k).slice(0, 200), (Array.isArray(v) ? v : []).slice(0, 5).map((t) => String(t).slice(0, 40))]),
        ),
      }
      await saveSelection(`ip:${ip}`, data)
      return send(res, 200, { ok: true })
    }
    // 용어 백과 (위키백과 요약). 보고서 근거가 아니라 용어 이해용 (27 문서 4장)
    if (req.method === 'GET' && req.url.startsWith('/api/wiki')) {
      const term = new URLSearchParams(req.url.split('?')[1] ?? '').get('q')
      return send(res, 200, await lookupWiki(term))
    }
    // 담당자(보고서팀) PPT 양식으로 내려받기 (11/17, 39 문서 E): 4:3 · 본문 1장 + 유첨 4장 (templates/report-template.pptx와 같은 칸)
    // 옮기는 규칙 server/reportToTemplate.js · 그리는 것 scripts/report-template.mjs(보고서팀). 못 채운 칸은 X-Report-Notes 머리글로 알림
    // 예전 보고서(11/17 전) 미리보기의 「기술 시계열」 장: 기억해 둔 분석 묶음을 키워드마다 (만들지 않음, 없으면 빈 값) — 41 문서 S3-3
    if (req.method === 'POST' && req.url === '/api/report-analysis') {
      const { keywords = [] } = await readJson(req)
      const list = (Array.isArray(keywords) ? keywords : []).map((k) => String(k ?? '').trim().slice(0, 50)).filter(Boolean).slice(0, 3)
      const { cachedBundle } = await import('./keywordBundle.js')
      const out = {}
      for (const k of list) {
        const b = await cachedBundle(k)
        if (b) out[k] = { at: b.at, papers: b.papers, rising: b.rising, makers: b.makers, breadth: b.breadth, attention: b.attention, surges: b.surges, signal: b.signal }
      }
      return send(res, 200, { bundles: out })
    }
    // 보고서 주제어가 든 모은 기사의 날짜별 수 (11/17): 앱 미리보기 「기사 수 추이」 — 담당자 양식 PPT와 같은 계산(reportToTemplate.js)
    if (req.method === 'POST' && req.url === '/api/topic-trend') {
      const { terms = [], createdAt } = await readJson(req)
      const topics = (Array.isArray(terms) ? terms : []).map((t) => String(t ?? '').trim().slice(0, 50)).filter(Boolean).slice(0, 3)
      if (!dbEnabled() || !topics.length) return send(res, 200, { items: [] })
      const { topicTrendItems } = await import('./reportToTemplate.js')
      const at = Number.isFinite(Date.parse(createdAt)) ? createdAt : new Date().toISOString()
      return send(res, 200, { items: await topicTrendItems({ createdAt: at, report: { sources: { topics } } }, query) })
    }
    // 보고서팀 양식 데이터 (11/25 팀 검수: 미리보기 · PDF도 PPT와 같은 「앱 1쪽 + 보고서팀 유첨」으로 — 화면이 이 값으로 유첨 쪽을 그림)
    if (req.method === 'GET' && (req.url.startsWith('/api/reports/pptx?') || req.url.startsWith('/api/reports/template?'))) {
      const sp = new URL(req.url, 'http://x').searchParams
      const id = sp.get('id')
      const list = dbEnabled() ? await listReports(1000, { ip: clientIp(req) }) : []
      const entry = list.find((e) => String(e.id) === String(id))
      if (!entry) return send(res, 404, { error: '보고서를 찾지 못했어요.' })
      const teamCover = sp.get('form') === 'team'
      const { data, deck } = await templateDataFor(entry, { withDeck: !teamCover })
      if (req.url.startsWith('/api/reports/template?')) return send(res, 200, { data })
      const { renderPptx, setTemplateStyle } = await import('../scripts/report-template.mjs')
      setTemplateStyle(await getReportStyle()) // 11/20: 관리 페이지 「보고서 양식」의 글꼴 · 강조색 (칸 자리 · 글자 크기는 양식 고정)
      // 11/25 PPT 하나로 (45 문서 7장): 1쪽 = 앱 양식 1쪽(화면 미리보기와 같은 핵심 요약), 유첨 = 보고서팀 양식. ?form=team 이면 예전 보고서팀 양식 1쪽 그대로
      let cover
      if (deck) {
        const { drawPage } = await import('../src/reportExport.js')
        cover = (pres, slide, total) => drawPage(pres, deck.pages[0], { slide, total })
      }
      const buf = await renderPptx(data, { cover })
      const name = encodeURIComponent(`${(entry.report?.title ?? '보고서').replace(/[\\/:*?"<>|]/g, '_')}${teamCover ? '_보고서팀양식' : ''}.pptx`)
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename*=UTF-8''${name}`,
        'X-Report-Notes': encodeURIComponent(JSON.stringify(data._notes ?? [])),
      })
      return res.end(buf)
    }
    if (req.method === 'GET' && req.url === '/api/reports') {
      return send(res, 200, { stored: dbEnabled(), trashDays: await trashDays(), reports: dbEnabled() ? await listReports(200, { ip: clientIp(req) }) : [] })
    }
    // 관리 페이지 보고서 관리 (11/08): 전체 목록(만든 IP 포함) · 자동 삭제 주기
    if (req.method === 'GET' && req.url === '/api/admin/reports') {
      requireAdmin(req)
      const retentionDays = Number(await getSetting(REPORT_RETENTION_SETTING, 0)) || 0
      return send(res, 200, { stored: dbEnabled(), retentionDays, trashDays: await trashDays(), reports: await listReports(1000, { withIp: true }) })
    }
    if (req.method === 'PUT' && req.url === '/api/admin/reports/retention') {
      const admin = requireAdmin(req)
      const days = Number((await readJson(req)).days)
      if (!REPORT_RETENTION_CHOICES.includes(days)) return send(res, 400, { error: '고를 수 있는 기간이 아니에요.' })
      await setSetting(REPORT_RETENTION_SETTING, days)
      const deleted = await trashReportsOlderThan(days)
      await logChange(admin, '보고서 자동 정리', days ? `만든 지 ${days}일 지난 보고서는 휴지통으로 (지금 ${deleted}개)` : '꺼짐')
      return send(res, 200, { retentionDays: days, deleted })
    }
    // 휴지통 보관 기간 (11/13): 관리자가 정함. 바꾸면 바로 한 번 정리
    if (req.method === 'PUT' && req.url === '/api/admin/reports/trash') {
      const admin = requireAdmin(req)
      const days = Number((await readJson(req)).days)
      if (!REPORT_TRASH_CHOICES.includes(days)) return send(res, 400, { error: '고를 수 있는 기간이 아니에요.' })
      await setSetting(REPORT_TRASH_SETTING, days)
      const purged = await purgeTrash(days)
      await logChange(admin, '휴지통 보관 기간', days ? `${days}일 지나면 영구 삭제 (지금 ${purged}개 지움)` : '자동으로 지우지 않음')
      return send(res, 200, { trashDays: days, purged })
    }
    // 휴지통에서 되살리기 · 중요 표시 (11/13). 되살리기는 만든 사람(같은 IP)만
    if (req.method === 'POST' && /^\/api\/reports\/[^/]+\/restore$/.test(req.url)) {
      const id = decodeURIComponent(req.url.split('/')[3])
      await requireReportOwner(req, id)
      await restoreReport(id)
      return send(res, 200, { ok: true })
    }
    if (req.method === 'PUT' && /^\/api\/reports\/[^/]+\/star$/.test(req.url)) {
      const id = decodeURIComponent(req.url.split('/')[3])
      const { on } = await readJson(req)
      await setReportStar(clientIp(req), id, Boolean(on))
      return send(res, 200, { ok: true, starred: Boolean(on) })
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
      // 11/13 휴지통: 일반 화면에서 지우면 휴지통으로 (만든 IP만, 11/08 원칙 그대로). 휴지통에 있는 것을 ?permanent=1로 지우면 영구 삭제 (만든 사람)
      // 관리자는 관리 페이지에서만 모든 보고서를 바로 영구 삭제한다 (일반 화면에서는 관리자도 일반 사용자와 같음)
      const [path, qs] = req.url.split('?')
      const id = decodeURIComponent(path.slice('/api/reports/'.length))
      const admin = adminHere(req)
      if (admin) {
        await deleteReport(id)
        await logChange(admin, '보고서 삭제', id)
        return send(res, 200, { ok: true, permanent: true })
      }
      await requireReportOwner(req, id)
      if (new URLSearchParams(qs ?? '').get('permanent') === '1') {
        if (!(await reportTrashedAt(id))) return send(res, 400, { error: '영구 삭제는 휴지통에서만 할 수 있어요.' })
        await deleteReport(id)
        return send(res, 200, { ok: true, permanent: true })
      }
      await trashReport(id)
      return send(res, 200, { ok: true, trashed: true })
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
      return send(res, 200, { jobs: client ? listJobs(client) : [] }) // 번호 없이 전체 목록은 주지 않음 (11/09)
    }
    if (req.method === 'POST' && /^\/api\/report-jobs\/[\w-]+\/(answer|cancel)$/.test(req.url)) {
      // 작업을 만든 브라우저(clientId)이면서 같은 IP일 때만 답하기 · 취소 (11/09)
      const [, , , id, action] = req.url.split('/')
      const { use, clientId } = await readJson(req)
      const who = { clientId, ip: clientIp(req) }
      if (action === 'answer') return send(res, 200, { job: answerJob(id, use, who) })
      return send(res, 200, { job: cancelJob(id, who) })
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
    if (status >= 500) logError({ side: 'server', kind: 'api', path: `${req.method} ${String(req.url).split('?')[0]}`, status, message: err.message }).catch(() => {})
    send(res, status, { error: err.message, ...(err.locked && { locked: true }), ...(err.ops && { ops: true }), ...(err.code && /^[A-Z_]+$/.test(err.code) && { code: err.code }) })
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
