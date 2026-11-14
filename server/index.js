// 요약 API. 보통은 npm run dev 하나로 화면과 같은 포트(PORT)에서 열린다 (vite.config.js).
// API만 따로 시험할 때: npm run server. 키는 .env.local에서 읽고 브라우저로 보내지 않는다
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { collect, getSources, listArticles, saveSources, searchArticles, searchCollected } from './collector/index.js'
import { englishTerms, frequentSearches, listQueryTerms, pruneSearchCounts, recordSearch, setQueryTerms } from './queryTerms.js'
import { feedList } from './collector/feeds.js'
import { getTrends } from './trends.js'
import { paperProviderStatus } from './papers/index.js'
import { corpusStatus, startCorpus } from './papers/corpus.js'
import { buildTimeline, timelineStory } from './timeline.js'
import { readyTimelines, runPrecompute, startPrecompute } from './timelineJobs.js'
import { relatedWords } from './related.js'
import { kiwiStatus } from './kiwi.js'
import { fillMap, mapMaterials } from './mapMaterials.js'
import { allCategoryCompetitors, bundleFacts, categoryCompetitors, headlineSeeds, prepareBundle, THREAT_FACTOR } from './keywordBundle.js'
import { scopeSearch } from './scopeSearch.js'
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
import { searchPaperArticles } from './searchPapers.js'
import { addJob, answerJob, cancelJob, listJobs, setDraftBuilder } from './reportJobs.js'
import { sourceStatus } from './sourceGuard.js'
import { patentDbStatus } from './patentDb.js'
import { chatJson, llmProviders, modelName, pingModel, providerLabel, selectProvider } from './llm/client.js'
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
import { adminConfigured, adminHere, adminOf, changeLog, clientIp, diffWords, login, logChange, logout, requireAdmin } from './admin.js'
import { queueSearchSummaries, refreshStatus, saveRefreshSettings, startRefresh, startScheduler as startRefreshScheduler } from './refresh.js'
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
  for (let b of bullets ?? []) {
    if (!b?.text?.trim()) continue
    let text = stripInlineRefs(b.text).replace(/\s*\[AI (?:보충|제안)\]/g, '').trim()
    // 「기회: …」처럼 표시를 글 앞에 쓴 경우 표시로 옮긴다 (11/12 실측)
    const lead = text.match(/^(기회|위협|할 일)\s*[:：·-]\s*/)
    if (lead) {
      b = { ...b, tag: b.tag || lead[1] }
      text = text.slice(lead[0].length)
    }
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
    kept.push({ text, refs, kind, ...(TAGS.includes(b.tag) ? { tag: b.tag } : {}), removedRefs: claimed.filter((n) => !refs.includes(n)), han: hasHan(text) })
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

// 일반 화면에서 보고서를 휴지통에 넣거나 · 되살리거나 · 영구 삭제하는 것은 만든 사람(같은 IP)만 (11/08 원칙, 17 문서)
async function requireReportOwner(req, id) {
  const ip = clientIp(req)
  const owner = await reportOwnerIp(id)
  if (!ip || !owner || owner !== ip) {
    throw Object.assign(new Error('보고서는 만든 사람(같은 IP)만 지우거나 되살릴 수 있어요. 다른 보고서는 관리 페이지에서 관리자가 지워요.'), { status: 403 })
  }
}

// 보고서 한 건 만들기 (아직 저장 전). 대기열(reportJobs)과 예전 바로 만들기(/api/reports)가 같이 쓴다
async function buildReportEntry(body) {
  const all = body.mode === 'all'
  const picked = readReportArticles(body, all ? MAX_REPORT_ALL : MAX_REPORT_ARTICLES)
  for (const a of picked) if (await materialBlocksAi(String(a.id ?? ''))) throw Object.assign(new Error(`AI 입력을 허용하지 않은 자료가 있어요: ${a.title}`), { status: 403 })
  const title = body.title?.trim() || `${String(body.topics?.[0] ?? '').trim() || '테크'} 동향 브리핑` // 11/14: 주제 키워드를 제목에
  const direction = String(body.direction ?? '').trim().slice(0, 300)
  // 11/12 조장: 대시보드에서 분석한 키워드는 보고서에 「당연히」 들어간다 — 주제 키워드의 분석 묶음(keywordBundle.js)을 [분석] 근거로 자동으로 붙인다
  // 주제 키워드: 화면이 보낸 topics(대시보드에서 고른 범위의 중심 키워드). 묶음이 없으면 20초까지 만들어 보고, 못 만들면 없이 쓴다
  const topics = [...new Set((body.topics ?? []).map((t) => String(t).trim()).filter(Boolean))].slice(0, 3)
  const bundles = (
    await Promise.all(topics.map((t) => Promise.race([prepareBundle(t), new Promise((res) => setTimeout(() => res(null), 20_000))]).catch(() => null)))
  ).filter(Boolean)
  const facts = bundles.flatMap(bundleFacts).map((f, i) => ({ ...f, n: picked.length + i + 1 }))
  const opts = { title, periodLabel: body.periodLabel ?? '오늘', direction, topics, seeds: bundles.flatMap(headlineSeeds).slice(0, 4) }
  const long = picked.length > MAX_REPORT_ARTICLES
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
  const dates = picked.map((a) => Date.parse(a.publishedAt)).filter(Number.isFinite).sort((a, b) => a - b)
  const day = (t) => new Date(t + 9 * 3600_000).toISOString().slice(0, 10)
  const sources = {
    period: dates.length ? `${day(dates[0])} ~ ${day(dates[dates.length - 1])}` : null,
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
    report: { title, direction, headline, sections, sources, analysis: bundles.map((b) => ({ keyword: b.keyword, stage: b.stage, patentYears: b.patentYears, competitors: b.competitors, owners: b.owners, quotes: b.quotes })), warnings: [...reportWarnings(sections), ...(headline?.numCheck?.length ? [`헤드라인 숫자가 근거와 달라요 (${headline.numCheck.join(', ')}) — 확인하세요`] : []), ...(headline && !headline.refs.length ? ['헤드라인에 근거 번호가 없어요 — AI 해설로 보고 확인하세요'] : []), ...(data.warnings ?? [])] },
    model,
    createdAt,
    periodLabel: body.periodLabel ?? '오늘',
    ...(long ? { chunks: Math.ceil(articles.length / REPORT_CHUNK) } : {}),
    // fulltext: 원문 본문을 반영했는지 (화면 근거 기사 목록에 표시). 본문 자체는 저장하지 않는다
    articles: articles.map((a) => {
      const { title: t, source, url, publishedAt, body: b, analysis, description, paper, authors } = a
      return {
        title: t,
        source,
        url,
        publishedAt,
        fulltext: Boolean(b),
        ...(analysis ? { analysis: true, description } : {}),
        ...(paper ? { paper: true, access: paperAccessOf(a), ...(authors?.length ? { authors: authors.slice(0, 6) } : {}) } : {}),
      }
    }),
    inputs: picked.map(({ n: _n, body: _b, ...rest }) => rest),
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
    kind: 'section',
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
  startCorpus() // 디스플레이 논문 DB: 켜진 뒤 3분, 그 뒤 6시간마다 (PAPER_CORPUS=off면 안 함, papers/corpus.js)
  startPrecompute() // 기술 시계열 미리 분석: 켜진 뒤 10분, 그 뒤 6시간마다 (TIMELINE_PRECOMPUTE=off면 안 함, timelineJobs.js)
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
const RECOMMENDED_SETTING = 'recommended_queries'
async function recommendedQueries() {
  const saved = await getSetting(RECOMMENDED_SETTING, null)
  return saved ?? (await getSetting('favorite_queries', [])) // 처음엔 예전 공용 즐겨찾기
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
export async function handleApi(req, res) {
  try {
    if (crossOrigin(req)) return send(res, 403, { error: '다른 사이트에서 보낸 요청은 받지 않아요.' })
    // 운영 상태(점검 중 · AI 정지)면 일반 사용자의 요청을 막는다. 관리 페이지에서 보낸 관리자 요청만 그대로 (19 문서 6장, 11/08 원칙)
    if (!adminHere(req)) await checkOps(req)
    if (req.method === 'GET' && req.url === '/api/health') {
      const [modelReachable, db, sources, patentDb] = await Promise.all([pingModel(), dbStatus(), sourceStatus(), patentDbStatus().catch(() => ({ ready: false }))])
      return send(res, 200, {
        ok: true,
        model: modelName(),
        modelReachable,
        db,
        llm: llmProviders(),
        server: { startedAt: STARTED_AT, supervised: SUPERVISED },
        sources, // 외부 출처 오늘 호출 수 · 한도 · 쉬는 중 (sourceGuard.js, 키는 없음)
        patentDb, // 디스플레이 특허 DB 건수 · 받은 날 (patentDb.js)
        kiwi: kiwiStatus().status, // 형태소 분석기 (kiwi.js): ready · loading · missing(모델 없음 → 예전 규칙) · idle(아직 안 씀)
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
      const result = login(await readJson(req), clientIp(req))
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
      return send(res, 200, { list: feedList(), ...(await getSources()), papers: await paperProviderStatus(), corpus: await corpusStatus().catch(() => null) })
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
      const { query, refresh = false } = await readJson(req)
      const tl = await buildTimeline(query, { refresh: Boolean(refresh) })
      // 11/12: 분석한 키워드는 보고서에 쓸 묶음을 뒤에서 미리 만들어 둔다 (keywordBundle.js, 3일 기억)
      prepareBundle(query, { refresh: Boolean(refresh) }).catch((err) => console.warn(`[bundle] ${query}: ${err.message}`))
      return send(res, 200, tl)
    }
    if (req.method === 'GET' && req.url === '/api/timeline/ready') {
      return send(res, 200, await readyTimelines())
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
    // 키워드 분석 묶음 (11/12, keywordBundle.js): 대시보드 키워드 분석 · 보고서가 같은 것을 본다. 화면용이라 네이버 문장도 aiOk: false로 함께
    if (req.method === 'GET' && req.url.startsWith('/api/bundle?')) {
      const q = new URL(req.url, 'http://x').searchParams.get('q')
      return send(res, 200, (await prepareBundle(q)) ?? {})
    }
    // 세부 카테고리 × 경쟁사 특허 (11/12, 대시보드 「이번 주 한눈에」 · keywordBundle.js). 7일 기억, 특허 DB를 다시 받으면 다시 셈
    // 요즘 뜨는 기술 옆 자사 위협 · 기회 (11/14 조장): 기술 용어 → 그 말이 든 특허가 가장 많은 세부 기술(CPC) → 경쟁사 특허 판정
    // 특허 10건 미만이면 연결이 약해 판정하지 않음. 값은 mapMaterials(24시간) · categoryCompetitors(7일) 기억을 그대로 씀
    if (req.method === 'GET' && req.url.startsWith('/api/trend-verdicts?')) {
      const terms = (new URL(req.url, 'http://x').searchParams.get('terms') ?? '').split('|').map((t) => t.trim()).filter(Boolean).slice(0, 20)
      const one = async (term) => {
        const m = await Promise.race([mapMaterials(term), new Promise((res) => setTimeout(() => res(null), 8_000))]).catch(() => null)
        const cat = m?.categories?.[0]
        if (!cat || cat.count < 10) return [term, null]
        const comp = await categoryCompetitors(cat.id).catch(() => null)
        return [term, comp ? { category: { id: cat.id, name: cat.name, patents: cat.count }, verdict: comp.verdict, competitors: comp } : null]
      }
      return send(res, 200, { verdicts: Object.fromEntries(await Promise.all(terms.map(one))), threatFactor: THREAT_FACTOR })
    }
    if (req.method === 'GET' && req.url === '/api/category-competitors') {
      return send(res, 200, { categories: await allCategoryCompetitors(), rule: `위협: 경쟁사 중 하나가 분야 증가의 ${THREAT_FACTOR}배 이상 · 자사는 분야보다 느림 / 기회: 자사가 경쟁사 모두보다 빠르고 분야 이상` })
    }
    // 연관 키워드 (11/10, 대시보드 맵 재료 · related.js)
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
    // 검색어 (11/09 조장 결정): 「추천 검색어」는 관리자가 관리 페이지에서 고르는 공용 목록,
    // 즐겨찾기 ☆ · 최근 검색어는 IP별 (선별 폴더와 같은 방식). 예전 공용 즐겨찾기(favorite_queries)는 추천 검색어의 처음 값으로 쓴다
    if (req.method === 'GET' && req.url === '/api/favorites') {
      const ip = clientIp(req)
      return send(res, 200, {
        recommended: await recommendedQueries(),
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
    if (req.method === 'GET' && req.url.startsWith('/api/admin/search-terms')) {
      requireAdmin(req)
      const days = Math.min(90, Math.max(1, Number(new URL(req.url, 'http://x').searchParams.get('days')) || 14))
      const exclude = [...(await getKeywords().catch(() => [])), ...(await recommendedQueries())]
      return send(res, 200, { days, frequent: await frequentSearches({ days, exclude }), translations: await listQueryTerms() })
    }
    if (req.method === 'PUT' && req.url === '/api/admin/query-terms') {
      const admin = requireAdmin(req)
      const { query, terms = [] } = await readJson(req)
      const saved = await setQueryTerms(query, terms)
      await logChange(admin, '검색어 영문 표기', saved.terms.length ? `${saved.query} → ${saved.terms.join(' · ')}` : `${saved.query} 지움 (다음 찾기 때 AI가 다시 만듦)`)
      return send(res, 200, saved)
    }
    if (req.method === 'GET' && req.url === '/api/admin/recommended-queries') {
      requireAdmin(req)
      return send(res, 200, { recommended: await recommendedQueries() })
    }
    if (req.method === 'PUT' && req.url === '/api/admin/recommended-queries') {
      const admin = requireAdmin(req)
      const before = await recommendedQueries()
      const { recommended = [] } = await readJson(req)
      const list = cleanQueries(recommended, 20)
      await setSetting(RECOMMENDED_SETTING, list)
      await logChange(admin, '추천 검색어', diffWords(before, list))
      return send(res, 200, { recommended: list })
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
