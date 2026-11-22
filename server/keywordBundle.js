// 키워드 분석 묶음 (11/12 조장: 「키워드로 검색하면 그 키워드는 미리 준비해서 들고 있어야 한다. 분석에서 보고서 근거 보내기를 누르지 않아도
// 보고서를 만들러 가면 당연히 추가돼야 할 내용」)
// 대시보드에서 키워드를 분석하면(/api/timeline) 뒤에서 이 묶음을 만들어 3일 기억한다. 보고서를 만들 때 주제 키워드의 묶음을 근거로 자동으로 넣는다
// 묶음 = 규칙으로 계산한 숫자만: 기술 단계와 이유 · 특허 출원인 · 세부 카테고리 × 경쟁사 특허(위협 · 기회) · 상용화 시점 문장
// AI 입력 제한(23 문서): 네이버 검색 관심도와 네이버 기사 문장은 보고서 AI 입력(facts)에 넣지 않는다 — 화면용 값에는 남긴다
import { dbEnabled, query } from './db/index.js'
import { commercialQuotes } from './commercial.js'
import { DISPLAY_CATEGORIES } from './displayCategories.js'
import { mapMaterials } from './mapMaterials.js'
import { createHash } from 'node:crypto'
import { patentDbReady, toPg } from './patentDb.js'
import { patternFromTerms } from './patents.js'
import { techCpcVersion, techRuleFor, techWhere } from './techCpc.js'
import { cacheGet, cachePut } from './papers/index.js'
import { queryKey } from './queryTerms.js'
import { getTechTrends } from './techtrends.js'
import { getLists } from './collector/lists.js'
import { supplierPatents } from './suppliers.js'
import { buildTimeline, cachedTimeline, techStale } from './timeline.js'
import { surgeMonths } from './timesfm.js'
import { customOwners, judgeRule, judgeVersion, loadJudgeSettings, ownersVersion } from './judgeSettings.js'

const TTL = 3 * 86_400_000
const running = new Map()

// ── 세부 카테고리 × 경쟁사 특허 (디스플레이 특허 DB, 같은 발명 한 번, 최근 3년 대 앞 3년) ──
// ⚠ 11/12 받은 특허 DB는 CPC를 「/ 뒤 두 자리」까지만 저장해(G06F3/0412 → G06F3/04) 세부 코드로 정한 카테고리(터치 · TFT 일부 · 접는 기기)가 덜 세어진다
//   → 11/13 다시 받을 때 전체 코드로 저장 (33 문서 W28). 그 전까지 0건인 카테고리는 화면에서 숨긴다
export async function allCategoryCompetitors() {
  const out = []
  for (const c of DISPLAY_CATEGORIES) {
    const r = await categoryCompetitors(c.id).catch(() => null)
    if (r) out.push(r)
  }
  return out
}

// 회사는 출원인 이름 글자로 묶는다 (33 문서 W25: CSOT는 이름이 바뀌었을 수 있어 판단에서 뺀다)
// 11/17 (37 문서 P9): 비교 회사를 4곳 고정 → **관리 페이지 「회사」의 경쟁사 목록**으로. 이름 → 특허 출원인 글자 사전에 있는 회사만 센다
// (사전에 없는 회사는 `unmatched`로 알려 준다 — 사전에 한 줄 더하면 됨). id는 화면(CategoryGlance)이 쓰는 sdc · lgd · boe 그대로
// 출원인 글자는 11/17 특허 DB 실측(최근 6년 출원인 상위)으로 정함
const OWNER_DICT = [
  { id: 'lgd', names: ['LG디스플레이', 'LGD', '엘지디스플레이', 'LG Display'], like: ['LG DISPLAY%'] },
  { id: 'sdc', names: ['삼성디스플레이', 'SDC', 'Samsung Display'], like: ['SAMSUNG DISPLAY%'] },
  { id: 'boe', names: ['BOE', '비오이', 'BOE Technology'], like: ['BOE TECHNOLOGY%'] },
  { id: 'csot', names: ['CSOT', 'China Star', '차이나스타', 'TCL CSOT'], like: ['%CHINA STAR%'], unsure: true },
  { id: 'tianma', names: ['티엔마', '톈마', 'Tianma'], like: ['%TIANMA%'] },
  { id: 'sharp', names: ['샤프', 'Sharp'], like: ['SHARP%'] },
  { id: 'jdi', names: ['JDI', '재팬디스플레이', 'Japan Display'], like: ['JAPAN DISPLAY%'] },
  { id: 'visionox', names: ['비전옥스', 'Visionox'], like: ['%VISIONOX%'] },
  { id: 'auo', names: ['AUO', 'AU Optronics'], like: ['AU OPTRONICS%'] },
  { id: 'innolux', names: ['이노룩스', 'Innolux'], like: ['INNOLUX%'] },
  { id: 'everdisplay', names: ['에버디스플레이', 'EverDisplay', 'EDO'], like: ['%EVERDISPLAY%'] },
]
const flatName = (t) => String(t ?? '').toLowerCase().replace(/[\s·.()-]/g, '')
const dictOf = (name) => OWNER_DICT.find((d) => d.names.some((n) => flatName(n) === flatName(name)))
// 11/20: 관리 페이지 「판정 기준 › 회사 특허 이름」에 넣은 출원인 이름이 있으면 그것을 먼저 (코드 사전에 없는 회사도 비교 가능)
export function ownerOf(name) {
  const custom = Object.entries(customOwners()).find(([k]) => flatName(k) === flatName(name))
  if (custom?.[1]?.like?.length) return { id: `c-${flatName(custom[0])}`, names: [custom[0]], like: custom[1].like, source: 'custom' }
  const d = dictOf(name)
  return d ? { ...d, source: 'dict' } : null
}
// 자사 + 관리 페이지 경쟁사 목록. 목록을 못 읽으면 예전 4곳
// 11/20: 자사는 관리 페이지 「자사 · 자회사」 목록에서 출원인 이름을 찾을 수 있는 첫 회사 (예전: LG디스플레이로 고정). 못 찾으면 LG디스플레이
export async function compareCompanies() {
  await loadJudgeSettings()
  const lists = await getLists().catch(() => null)
  const wanted = lists?.competitors?.length ? lists.competitors : ['삼성디스플레이', 'BOE', 'CSOT']
  const ownName = (lists?.own ?? []).find((n) => ownerOf(n))
  const ownD = ownName ? ownerOf(ownName) : { ...OWNER_DICT[0], source: 'dict' }
  const out = [{ ...ownD, name: `${ownName ?? 'LG디스플레이'} (자사)`, own: true }]
  const unmatched = []
  for (const name of wanted) {
    const d = ownerOf(name)
    if (!d) unmatched.push(name)
    else if (!out.some((x) => x.id === d.id)) out.push({ ...d, name: d.id === 'csot' ? 'CSOT' : String(name).trim() })
  }
  return { companies: out, unmatched }
}
// 위협 · 기회 (규칙, [우리 판단] — 33 문서): 경쟁사 중 누군가 분야보다 1.5배 이상 빠르고 자사가 분야보다 느리면 위협,
// 자사가 확실한 경쟁사 모두보다 빠르고 분야 이상이면 기회
export const THREAT_FACTOR = 1.5 // 기본값. 계산은 관리 페이지 「판정 기준」 값 (judgeRule().threatFactor, 11/20)
// 작은 수 보정 (11/15 팀 회의: 「1건 → 5건을 500% 늘었다고 강조하면 안 됨 — 근원값을 보고 가중해서」):
// - 앞 · 뒤 기간 합이 RATIO_MIN건 미만이면 비율을 내지 않음(「건수 적음」, 판정에서 뺌) — Porter 외 2019 「최소 7건」과 같은 일회성 방지, 10은 timeline.js PAT_MIN과 맞춤
// - 비율은 양쪽에 RATIO_PRIOR건씩 더해 계산 (가법 보정 · 작은 표본일수록 1배 쪽으로 당겨짐): 1→5건 = 5배가 아니라 (5+5)/(1+5) = 1.67배, 100→500건은 4.9배로 거의 그대로
export const RATIO_MIN = 10 // 기본값 — 계산은 judgeRule().patMin (기술 단계의 특허 최소 건수와 같은 값)
export const RATIO_PRIOR = 5 // 기본값 — 계산은 judgeRule().ratioPrior
// 한 말의 자사 위협 · 기회 판정 (11/14 「요즘 뜨는 기술」 옆 표시 · 11/17 자료 목록 표시가 같이 씀)
// 그 말 특허가 가장 많은 세부 분류 → 경쟁사 특허 비교. 맵 재료는 8초까지만 기다림
// 판정하지 않는 경우 (연결이 약함):
// - 그 분류 특허 10건 미만
// - 11/17: 그 말 특허 중 그 분류 비율이 45% 미만 — 「LED」(26%, 조명 등 여러 분야) · 「키오스크」(15%)처럼 한 분류로 대표할 수 없는 말 [우리 판단, 33 문서 W32]
// - 11/17: 「디스플레이 특허 안에서만」 센 말 (디스플레이 논문이 적은 말 — 키오스크 · UTG)
export const VERDICT_SHARE_MIN = 0.45 // 기본값 — 계산은 judgeRule().shareMin
export async function termVerdict(term) {
  const m = await Promise.race([mapMaterials(term), new Promise((res) => setTimeout(() => res(null), 8_000))]).catch(() => null)
  // 11/21: 「기술 ↔ CPC 연결표」가 켜진 기술은 그 기술 특허 안에서 비교 (건수가 판정 최소에 못 미치면 예전처럼 넓은 분류로)
  const rule = await techRuleFor([term, ...(m?.terms ?? [])]).catch(() => null)
  if (rule) {
    const comp = await techCompetitors(rule, m?.terms ?? []).catch(() => null)
    if (comp?.field?.ratio != null) return { category: { id: comp.id, name: comp.name, patents: comp.field.before + comp.field.now, share: 1, tech: true }, verdict: comp.verdict, competitors: comp }
  }
  const cat = m?.categories?.[0]
  if (!cat || cat.count < 10) return null
  if (m.basis === '디스플레이 특허 안에서만') return null
  const share = m.patentTotal ? cat.count / m.patentTotal : 0
  await loadJudgeSettings()
  if (share < judgeRule().shareMin) return null
  const comp = await categoryCompetitors(cat.id).catch(() => null)
  return comp ? { category: { id: cat.id, name: cat.name, patents: cat.count, share: Math.round(share * 100) / 100 }, verdict: comp.verdict, competitors: comp } : null
}

export async function categoryCompetitors(catId) {
  const cat = DISPLAY_CATEGORIES.find((c) => c.id === catId)
  if (!cat || !dbEnabled()) return null
  return competitorsWhere({ id: cat.id, name: cat.name, cacheId: catId, where: (at) => ({ sql: `EXISTS (SELECT 1 FROM unnest(cpc) x WHERE x ~ $${at})`, params: [cat.cpc] }) })
}

// 11/21 (techCpc.js): 「기술 ↔ CPC 연결표」가 켜진 기술은 넓은 분류(OLED 소자 전체) 대신 그 기술 특허 안에서 회사별로 비교한다
// 그 기술 특허 = 제목(영문 검색어) OR 그 기술 CPC − 빼는 제목. 분야 = 그 기술 특허 전체 (누가 그 기술 안에서 빠른가)
export async function techCompetitors(rule, terms = []) {
  if (!rule || !dbEnabled()) return null
  const pattern = patternFromTerms(terms)
  const titlePg = pattern ? toPg(pattern.toLowerCase()) : null
  const cacheId = `tech:${rule.id}:${techCpcVersion()}:${createHash('sha1').update(titlePg ?? '').digest('hex').slice(0, 8)}`
  return competitorsWhere({
    id: `tech:${rule.id}`,
    name: rule.name,
    cacheId,
    tech: true,
    where: (at) => {
      if (!titlePg) return techWhere(rule, at)
      const w = techWhere(rule, at + 1, `lower(title) ~ $${at}`)
      return { sql: w.sql, params: [titlePg, ...w.params] }
    },
  })
}

// where(at): 비교할 특허를 고르는 SQL 조건 · 자리표시자는 at번부터
export async function competitorsWhere({ id, name, cacheId, where, tech = false }) {
  // 특허 DB를 다시 받으면(분기 · 11/13 CPC 전체 코드) 다시 센다
  const meta = await patentDbReady().catch(() => null)
  if (!meta) return null
  const { companies: COMPANIES, unmatched } = await compareCompanies()
  const key = `cat-competitors:v5:${cacheId}:${meta.at}:${COMPANIES.map((c) => c.id).join(',')}:${judgeVersion()}:${ownersVersion()}` // v2: 작은 수 보정 · v3: 2개국 이상 출원 비율 (11/15) · v4: 관리 페이지 경쟁사 목록 (11/17)
  const hit = await cacheGet(key).catch(() => null)
  if (hit) return hit
  const last = new Date().getFullYear() - 1
  const [a, b] = [(last - 5) * 10000, (last - 2) * 10000]
  const cols = COMPANIES.map(
    (c, i) =>
      `count(*) FILTER (WHERE pub >= $1 AND pub < $2 AND EXISTS (SELECT 1 FROM unnest(owners) o WHERE o LIKE ANY($${i + 4}::text[])))::int AS b${i},
       count(*) FILTER (WHERE pub >= $2 AND pub < $3 AND EXISTS (SELECT 1 FROM unnest(owners) o WHERE o LIKE ANY($${i + 4}::text[])))::int AS r${i},
       count(*) FILTER (WHERE pub >= $2 AND pub < $3 AND cardinality(countries) >= 2 AND EXISTS (SELECT 1 FROM unnest(owners) o WHERE o LIKE ANY($${i + 4}::text[])))::int AS i${i}`,
  ).join(', ')
  const w = where(4 + COMPANIES.length)
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE pub >= $1 AND pub < $2)::int AS fb, count(*) FILTER (WHERE pub >= $2 AND pub < $3)::int AS fr,
            count(*) FILTER (WHERE pub >= $2 AND pub < $3 AND cardinality(countries) >= 2)::int AS fi, ${cols}
       FROM display_patents WHERE pub >= $1 AND pub < $3 AND ${w.sql}`,
    [a, b, (last + 1) * 10000, ...COMPANIES.map((c) => c.like), ...w.params],
  )
  const r = rows[0]
  if (!r?.fb) return null
  const { patMin, ratioPrior } = judgeRule() // 11/20 관리 페이지 「판정 기준」
  const ratio = (before, now) => (before + now >= patMin ? Math.round(((now + ratioPrior) / (before + ratioPrior)) * 100) / 100 : null)
  const field = ratio(r.fb, r.fr)
  const companies = COMPANIES.map((c, i) => ({ id: c.id, name: c.name, own: Boolean(c.own), unsure: Boolean(c.unsure), before: r[`b${i}`], now: r[`r${i}`], ratio: ratio(r[`b${i}`], r[`r${i}`]), intl: r[`r${i}`] ? Math.round((r[`i${i}`] / r[`r${i}`]) * 100) / 100 : null }))
  const sure = companies.filter((c) => !c.unsure && !c.own && c.ratio != null)
  const own = companies.find((c) => c.own)
  const threat = own?.ratio != null && field != null && sure.some((c) => c.ratio >= judgeRule().threatFactor * field) && own.ratio < field
  const chance = own?.ratio != null && field != null && sure.every((c) => own.ratio > c.ratio) && own.ratio >= field
  const out = { id, name, ...(tech ? { tech: true } : {}), years: `${last - 5}~${last - 3} → ${last - 2}~${last}`, field: { before: r.fb, now: r.fr, ratio: field, intl: r.fr ? Math.round((r.fi / r.fr) * 100) / 100 : null }, companies, verdict: threat ? '위협' : chance ? '기회' : null, ...(unmatched.length ? { unmatched } : {}) }
  await cachePut(key, out, 7 * 86_400_000).catch(() => {})
  return out
}

// ── 세부 기술 카테고리 추이 (11/17, 35 문서 R11): 9개 카테고리 모두 해마다 특허 수 · 앞 3년 대비 (분야 = 그 카테고리 전체) ──
// 키워드가 아니라 카테고리 단위 — 「이 기술이 걸친 분야가 커지는 중인가」. 특허 DB를 다시 받으면 다시 셈 (7일 기억)
// 논문은 CPC 같은 분류가 없어 카테고리로 나누지 않는다 (한계, 41 문서 R11)
export async function categoryTrends() {
  if (!dbEnabled()) return null
  const meta = await patentDbReady().catch(() => null)
  if (!meta) return null
  await loadJudgeSettings()
  const key = `cat-trends:v2:${meta.at}:${judgeVersion()}`
  const hit = await cacheGet(key).catch(() => null)
  if (hit) return hit
  const last = new Date().getFullYear() - 1
  const from = last - 7
  const cols = DISPLAY_CATEGORIES.map((c, i) => `bool_or(x ~ $${i + 3}) AS c${i}`).join(', ')
  const { rows } = await query(
    `WITH m AS (SELECT p.pub / 10000 AS y, ${cols} FROM display_patents p, unnest(p.cpc) x WHERE p.pub >= $1 AND p.pub < $2 GROUP BY p.family, p.pub)
     SELECT y, ${DISPLAY_CATEGORIES.map((_, i) => `count(*) FILTER (WHERE c${i})::int AS n${i}`).join(', ')} FROM m GROUP BY y ORDER BY y`,
    [from * 10000, (last + 1) * 10000, ...DISPLAY_CATEGORIES.map((c) => c.cpc)],
  )
  const { patMin, ratioPrior } = judgeRule() // 11/20 관리 페이지 「판정 기준」
  const ratio = (before, now) => (before + now >= patMin ? Math.round(((now + ratioPrior) / (before + ratioPrior)) * 100) / 100 : null)
  const items = DISPLAY_CATEGORIES.map((c, i) => {
    const years = rows.map((r) => ({ y: Number(r.y), n: r[`n${i}`] }))
    const sum = (a, b) => years.filter((x) => x.y >= a && x.y <= b).reduce((s, x) => s + x.n, 0)
    const before = sum(last - 5, last - 3)
    const now = sum(last - 2, last)
    return { id: c.id, name: c.name, years, before, now, ratio: ratio(before, now) }
  })
  const out = { span: `${last - 5}~${last - 3} → ${last - 2}~${last}`, items, at: new Date().toISOString() }
  await cachePut(key, out, 7 * 86_400_000).catch(() => {})
  return out
}

// ── 묶음 만들기 ──
const bundleKey = (keyword) => `bundle:v8:${queryKey(keyword)}:t${techCpcVersion()}` // :t (11/21) 「기술 ↔ CPC 연결표」 버전 // v8 (11/17 R11): 세부 기술 분류 비중 · 분류 추이 · v7 (11/17 R10): 소부장 기업 특허 · v5 (11/17): 특허 비교 회사 = 관리 페이지 경쟁사 목록
// 기억해 둔 묶음만 (만들지 않음): 11/17 전 보고서 미리보기에 기술 시계열을 채울 때 (화면이 기다리지 않게)
export async function cachedBundle(raw) {
  const keyword = String(raw ?? '').trim().slice(0, 50)
  return keyword ? cacheGet(bundleKey(keyword)).catch(() => null) : null
}
export async function prepareBundle(raw, { refresh = false } = {}) {
  const keyword = String(raw ?? '').trim().slice(0, 50)
  if (!keyword) return null
  const key = bundleKey(keyword) // v4 (11/17): 논문 연도별 수를 단계 판정과 같은 값(long)으로. v3 (11/17, 40 문서 R1): 논문 추이 · 관심 대 실질 · 연구 폭 · 떠오르는 세부 주제 · 주요 기업 · 급증 · 신호 점수 // v2 (11/17): 11/15에 「2개국 이상 출원」을 넣고도 v1 그대로라 예전 묶음이 3일 동안 나갔음 (36 문서 2-6)
  if (!refresh) {
    const hit = await cacheGet(key).catch(() => null)
    if (hit) return hit
  }
  if (running.has(key)) return running.get(key)
  const job = (async () => {
    const cachedTl = (await cachedTimeline(keyword).catch(() => null))?.timeline
    const cached = cachedTl && !(await techStale(cachedTl).catch(() => false)) ? cachedTl : null // 11/21: 연결표가 바뀐 기술은 특허를 다시 셈
    const [tl, mat] = await Promise.all([cached ?? buildTimeline(keyword, { background: true }).catch(() => null), mapMaterials(keyword).catch(() => null)])
    const terms = [keyword, ...(tl?.terms ?? mat?.terms ?? [])]
    const quotes = await commercialQuotes(terms).catch(() => [])
    const mainCat = mat?.categories?.[0]
    const techRule = await techRuleFor(terms).catch(() => null)
    const techComp = techRule ? await techCompetitors(techRule, tl?.terms ?? mat?.terms ?? []).catch(() => null) : null
    const competitors = techComp?.field?.ratio != null ? techComp : mainCat ? await categoryCompetitors(mainCat.id).catch(() => null) : null
    const signal = await techSignal(keyword).catch(() => null)
    // 기억해 둔 시계열에는 급증(TimesFM)이 따로 있음 → 기다리지 않고 있으면 씀 (timeline.js withSurge와 같음)
    const surge = tl?.naver?.status === 'ok' ? (tl.naver.surge ?? (await surgeMonths(tl.naver.months, { wait: false }).catch(() => null))) : null
    const st = tl?.stage
    const bundle = {
      keyword,
      at: new Date().toISOString(),
      stage: tl?.stage ? { stage: tl.stage.stage, why: tl.stage.why, thin: Boolean(tl.thin) } : null,
      patentBasis: tl?.patents?.basis ?? null,
      patentYears: tl?.patents?.status === 'ok' ? tl.patents.years : [],
      owners: mat?.patents ?? [],
      paperKeywords: (mat?.papers ?? []).map((p) => p.word),
      categories: mat?.categories ?? [],
      // 세부 기술 분류 (11/17 R11): 이 키워드 특허가 걸친 카테고리 비중 + 그 카테고리 전체 특허 추이 (categoryTrends)
      categoryMix: categoryMix(mat?.categories, await categoryTrends().catch(() => null)),
      competitors,
      // 소부장 기업 특허 (11/17 R10, suppliers.js): 이 키워드 특허를 낸 소재 · 부품 · 장비 회사 (관리 페이지 목록)
      suppliers: await supplierPatents(tl?.terms, (await getLists().catch(() => null))?.suppliers).catch(() => null),
      quotes,
      // ── v3 (11/17): 기술 시계열에서 더 가져오는 것 ──
      // 논문 연도별 수 · 앞 3년 대비 성장(분야 대비). 연도별 수는 단계 판정이 쓴 값(long, OpenAlex)과 같게 — 11/17 시험에서 디스플레이 논문 모음(corpus) 수를 그려 글(2편)과 그래프(8편)가 달랐음
      papers: (tl?.long?.length || tl?.corpus?.years?.length)
        ? { years: (tl.long?.length ? tl.long : tl.corpus.years).map(({ y, n }) => ({ y, n })), basis: tl.long?.length ? 'openalex' : 'corpus', total: tl.corpus.total ?? null, span: st?.years ?? null, recent: st?.recentPapers ?? null, before: st?.beforePapers ?? null, growth: st?.growth ?? null, relGrowth: st?.relGrowth ?? null }
        : null,
      // 떠오르는 세부 주제: 최근 논문 키워드 중 앞 시기에 없던 것 · 늘어난 것
      rising: (tl?.corpus?.rising ?? []).slice(0, 5).map((x) => ({ name: x.name, before: x.before, recent: x.recent })),
      // 최근 시기 논문의 주요 기업
      makers: tl?.makers?.at(-1)?.makers?.slice(0, 5) ?? [],
      // 연구 폭: 기관 수 · 기업 저자 비율 · FWCI(참고)
      breadth: tl?.breadth
        ? { years: tl.breadth.years, institutions: tl.breadth.institutions ?? null, top: (tl.breadth.topInstitutions ?? []).slice(0, 3).map((x) => x.name), companyShare: st?.companyShareNow ?? null, fwci: tl.breadth.fwci?.mean ?? null }
        : null,
      // ⚠ 네이버 숫자 — 화면 · PPT용. AI 입력(bundleFacts · headlineSeeds)에는 넣지 않는다 (23 문서 2-2)
      attention: st?.attention ? { label: st.attention.label, basis: st.attention.basis } : null,
      surges: surge?.status === 'ok' ? (surge.surges ?? []).slice(-3) : [],
      // 요즘 뜨는 기술 신호 점수 (네이버 신호가 섞인 종합 점수 — 화면 · PPT용)
      signal,
    }
    await cachePut(key, bundle, TTL).catch(() => {})
    return bundle
  })().finally(() => running.delete(key))
  running.set(key, job)
  return job
}

// 요즘 뜨는 기술 종합 점수에서 이 키워드 (이름 · 영어 이름이 같은 것)
const flat = (t) => String(t ?? '').toLowerCase().replace(/[\s\-·_]/g, '')
async function techSignal(keyword) {
  const tt = await getTechTrends({ period: 'week' })
  const k = flat(keyword)
  const hit = (tt.composite ?? []).find((c) => flat(c.name) === k || flat(c.en) === k || flat(c.key) === k)
  return hit ? { score: hit.score, grade: hit.grade, stage: hit.stage ?? null, at: tt.updatedAt ?? null } : null
}

// 키워드 특허의 카테고리 비중 (mapMaterials categories: 그 말 특허 중 카테고리마다 건수) + 카테고리 전체 추이
function categoryMix(categories, trends) {
  const list = (categories ?? []).filter((c) => c.count > 0)
  const total = list.reduce((s, c) => s + c.count, 0)
  if (!total) return null
  const tr = new Map((trends?.items ?? []).map((t) => [t.id, t]))
  return {
    total,
    span: trends?.span ?? null,
    items: list.slice(0, 4).map((c) => ({ id: c.id, name: c.name, count: c.count, share: Math.round((c.count / total) * 100), ratio: tr.get(c.id)?.ratio ?? null })),
  }
}

// 헤드라인 재료 (규칙, 11/12 조장: 「키워드를 헤드라인 핵심 문장으로 빼내는 게 핵심」): 결론을 만들 숫자 · 판정을 미리 골라 준다
// AI는 이 재료와 기사에서 한 문장을 쓴다 (재료에 없는 숫자를 만들지 않게)
export function headlineSeeds(b) {
  if (!b) return []
  const out = []
  const c = b.competitors
  const own = c?.companies.find((x) => x.own)
  const fastest = c?.companies.filter((x) => !x.unsure && !x.own && x.ratio != null).sort((a, b2) => b2.ratio - a.ratio)[0]
  if (c?.verdict === '위협' && fastest && own) out.push(`${c.name} 특허: ${fastest.name} ${fastest.ratio}배 vs 자사 ${own.ratio}배 (분야 ${c.field.ratio}배) → 자사에 위협`)
  if (c?.verdict === '기회' && own) out.push(`${c.name} 특허: 자사 ${own.ratio}배로 경쟁사 중 가장 빠름 (분야 ${c.field.ratio}배) → 자사에 기회`)
  if (b.stage && !b.stage.thin) out.push(`${b.keyword} 기술 단계: ${b.stage.stage}`)
  // v3: 논문이 분야보다 빠르게 늘면 · 떠오르는 세부 주제 (네이버 숫자는 넣지 않음)
  const pp = b.papers
  if (pp?.relGrowth >= 1.3 && pp.recent >= 10) out.push(`${b.keyword} 논문 ${String(pp.span ?? '최근 3년').split(' 대 ')[0]} ${pp.recent}편, 앞 3년의 ${pp.growth}배 (분야 전체보다 ${pp.relGrowth}배 빠름)`)
  const up = (b.rising ?? []).filter((x) => x.recent >= 3)
  if (up.length) out.push(`${b.keyword} 최근 논문에서 늘어난 세부 주제: ${up.slice(0, 3).map((x) => `${x.name}(${x.before}→${x.recent}편)`).join(', ')}`)
  const q = (b.quotes ?? []).find((x) => x.aiOk && x.year)
  if (q) out.push(`상용화 시점 언급: ${q.year}년 (${q.source ?? '기사'})`)
  return out
}

// 보고서 AI 입력용 「[분석]」 근거 (기사 목록에 번호를 붙여 넣는다 → 근거 번호 · 근거 검증이 그대로 동작)
// 숫자는 규칙 계산 그대로. 네이버 기사 문장 · 검색 관심도는 넣지 않는다
export function bundleFacts(b) {
  if (!b) return []
  const src = '테크브리프 분석 · 규칙 계산'
  const out = []
  if (b.stage && !b.stage.thin) {
    out.push({ title: `[분석] ${b.keyword} 기술 단계: ${b.stage.stage}`, source: src, description: `${b.keyword}의 기술 단계는 「${b.stage.stage}」로 판정됨 (논문 · 특허 수 규칙). 이유: ${b.stage.why}` })
  }
  const c = b.competitors
  if (c) {
    const line = c.companies
      .filter((x) => !x.unsure && x.ratio != null)
      .map((x) => `${x.name} ${x.before}→${x.now}건(${x.ratio}배)`)
      .join(', ')
    out.push({
      title: `[분석] ${c.name} 특허 — 경쟁사 비교${c.verdict ? ` · 자사에 ${c.verdict}` : ''}`,
      source: '디스플레이 특허 DB (Google Patents, CC BY 4.0) · 규칙 계산',
      description: `${b.keyword} 특허가 가장 많이 속한 세부 카테고리 「${c.name}」의 특허(같은 발명 한 번, ${c.years}): 분야 전체 ${c.field.before}→${c.field.now}건(${c.field.ratio}배), ${line}.${c.verdict ? ` 규칙 판정: 자사에 ${c.verdict}.` : ''}`,
    })
  }
  if (b.categoryMix?.items?.length) {
    const m = b.categoryMix
    out.push({ title: `[분석] ${b.keyword} 세부 기술 분류 (특허 CPC)`, source: '디스플레이 특허 DB · 규칙 계산', description: `${b.keyword} 특허 ${m.total}건이 걸친 세부 기술 (한 특허가 여러 분류에 걸칠 수 있음): ${m.items.map((x) => `${x.name} ${x.count}건(${x.share}%)${x.ratio != null ? ` — 분류 전체 특허 ${m.span} ${x.ratio}배` : ''}`).join(', ')}` })
  }
  if (b.suppliers?.items?.length) {
    out.push({ title: `[분석] ${b.keyword} 소부장 기업 특허 (${b.suppliers.years})`, source: '특허 DB · 규칙 계산', description: `${b.keyword} 특허를 낸 소재 · 부품 · 장비 회사 (디스플레이 특허, 같은 발명 한 번): ${b.suppliers.items.slice(0, 6).map((x) => `${x.name}(${x.kind}) ${x.count}건`).join(', ')}` })
  }
  if (b.owners?.length) {
    out.push({ title: `[분석] ${b.keyword} 특허 주요 출원인 (최근 6년)`, source: '특허 DB · 규칙 계산', description: `${b.keyword} 특허를 많이 낸 곳 (같은 발명 한 번): ${b.owners.slice(0, 6).map((o) => `${o.word} ${o.count}건`).join(', ')}` })
  }
  // v3 (11/17, 40 문서 R2): 떠오르는 세부 주제 · 연구 폭 (논문 DB 규칙 숫자 — 네이버 숫자 아님)
  const up = (b.rising ?? []).filter((x) => x.recent >= 2)
  if (up.length) {
    out.push({ title: `[분석] ${b.keyword} 최근 논문에서 늘어난 세부 주제`, source: '논문 DB(OpenAlex) · 규칙 계산', description: `${b.keyword} 논문의 키워드 중 앞 시기보다 최근에 늘어난 것 (편수): ${up.map((x) => `${x.name} ${x.before}→${x.recent}편`).join(', ')}${b.makers?.length ? `. 최근 논문의 주요 기업: ${b.makers.join(', ')}` : ''}` })
  }
  const br = b.breadth
  if (br?.institutions) {
    const share = br.companyShare != null ? `, 기업 저자 비율 ${Math.round(br.companyShare * 100)}%` : ''
    out.push({ title: `[분석] ${b.keyword} 연구 폭 (${br.years})`, source: '논문 DB(OpenAlex) · 규칙 계산', description: `${br.years} ${b.keyword} 논문을 낸 기관 ${br.institutions}곳${br.top?.length ? ` (많은 곳: ${br.top.join(', ')})` : ''}${share}. 기관 3곳 미만이면 신생 · 탐색으로 봄 (판단 기준 33 문서)` })
  }
  const ok = (b.quotes ?? []).filter((q) => q.aiOk)
  if (ok.length) {
    out.push({ title: `[분석] ${b.keyword} 상용화 시점 언급 (기사 문장)`, source: '1·2차 출처 기사 · 규칙으로 찾음', description: ok.slice(0, 3).map((q) => `「${q.text}」(${q.source ?? '출처'})`).join(' / ') })
  }
  return out.map((x) => ({ ...x, analysis: true, keyword: b.keyword }))
}
