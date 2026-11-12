// 키워드 분석 묶음 (11/12 조장: 「키워드로 검색하면 그 키워드는 미리 준비해서 들고 있어야 한다. 분석에서 보고서 근거 보내기를 누르지 않아도
// 보고서를 만들러 가면 당연히 추가돼야 할 내용」)
// 대시보드에서 키워드를 분석하면(/api/timeline) 뒤에서 이 묶음을 만들어 3일 기억한다. 보고서를 만들 때 주제 키워드의 묶음을 근거로 자동으로 넣는다
// 묶음 = 규칙으로 계산한 숫자만: 기술 단계와 이유 · 특허 출원인 · 세부 카테고리 × 경쟁사 특허(위협 · 기회) · 상용화 시점 문장
// AI 입력 제한(23 문서): 네이버 검색 관심도와 네이버 기사 문장은 보고서 AI 입력(facts)에 넣지 않는다 — 화면용 값에는 남긴다
import { dbEnabled, query } from './db/index.js'
import { commercialQuotes } from './commercial.js'
import { DISPLAY_CATEGORIES } from './displayCategories.js'
import { mapMaterials } from './mapMaterials.js'
import { patentDbReady } from './patentDb.js'
import { cacheGet, cachePut } from './papers/index.js'
import { queryKey } from './queryTerms.js'
import { buildTimeline, cachedTimeline } from './timeline.js'

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
const COMPANIES = [
  { id: 'sdc', name: '삼성디스플레이', like: 'SAMSUNG DISPLAY%' },
  { id: 'lgd', name: 'LG디스플레이 (자사)', like: 'LG DISPLAY%', own: true },
  { id: 'boe', name: 'BOE', like: 'BOE TECHNOLOGY%' },
  { id: 'csot', name: 'CSOT', like: '%CHINA STAR%', unsure: true },
]
// 위협 · 기회 (규칙, [우리 판단] — 33 문서): 경쟁사 중 누군가 분야보다 1.5배 이상 빠르고 자사가 분야보다 느리면 위협,
// 자사가 확실한 경쟁사 모두보다 빠르고 분야 이상이면 기회
export const THREAT_FACTOR = 1.5
export async function categoryCompetitors(catId) {
  const cat = DISPLAY_CATEGORIES.find((c) => c.id === catId)
  if (!cat || !dbEnabled()) return null
  // 특허 DB를 다시 받으면(분기 · 11/13 CPC 전체 코드) 다시 센다
  const meta = await patentDbReady().catch(() => null)
  if (!meta) return null
  const key = `cat-competitors:v1:${catId}:${meta.at}`
  const hit = await cacheGet(key).catch(() => null)
  if (hit) return hit
  const last = new Date().getFullYear() - 1
  const [a, b] = [(last - 5) * 10000, (last - 2) * 10000]
  const cols = COMPANIES.map(
    (c, i) =>
      `count(*) FILTER (WHERE pub >= $2 AND pub < $3 AND EXISTS (SELECT 1 FROM unnest(owners) o WHERE o LIKE $${i + 5}))::int AS b${i},
       count(*) FILTER (WHERE pub >= $3 AND pub < $4 AND EXISTS (SELECT 1 FROM unnest(owners) o WHERE o LIKE $${i + 5}))::int AS r${i}`,
  ).join(', ')
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE pub >= $2 AND pub < $3)::int AS fb, count(*) FILTER (WHERE pub >= $3 AND pub < $4)::int AS fr, ${cols}
       FROM display_patents WHERE pub >= $2 AND pub < $4 AND EXISTS (SELECT 1 FROM unnest(cpc) x WHERE x ~ $1)`,
    [cat.cpc, a, b, (last + 1) * 10000, ...COMPANIES.map((c) => c.like)],
  )
  const r = rows[0]
  if (!r?.fb) return null
  const ratio = (before, now) => (before > 0 ? Math.round((now / before) * 100) / 100 : null)
  const field = ratio(r.fb, r.fr)
  const companies = COMPANIES.map((c, i) => ({ id: c.id, name: c.name, own: Boolean(c.own), unsure: Boolean(c.unsure), before: r[`b${i}`], now: r[`r${i}`], ratio: ratio(r[`b${i}`], r[`r${i}`]) }))
  const sure = companies.filter((c) => !c.unsure && !c.own && c.ratio != null)
  const own = companies.find((c) => c.own)
  const threat = own?.ratio != null && field != null && sure.some((c) => c.ratio >= THREAT_FACTOR * field) && own.ratio < field
  const chance = own?.ratio != null && field != null && sure.every((c) => own.ratio > c.ratio) && own.ratio >= field
  const out = { id: cat.id, name: cat.name, years: `${last - 5}~${last - 3} → ${last - 2}~${last}`, field: { before: r.fb, now: r.fr, ratio: field }, companies, verdict: threat ? '위협' : chance ? '기회' : null }
  await cachePut(key, out, 7 * 86_400_000).catch(() => {})
  return out
}

// ── 묶음 만들기 ──
export async function prepareBundle(raw, { refresh = false } = {}) {
  const keyword = String(raw ?? '').trim().slice(0, 50)
  if (!keyword) return null
  const key = `bundle:v1:${queryKey(keyword)}`
  if (!refresh) {
    const hit = await cacheGet(key).catch(() => null)
    if (hit) return hit
  }
  if (running.has(key)) return running.get(key)
  const job = (async () => {
    const cached = (await cachedTimeline(keyword).catch(() => null))?.timeline
    const [tl, mat] = await Promise.all([cached ?? buildTimeline(keyword, { background: true }).catch(() => null), mapMaterials(keyword).catch(() => null)])
    const terms = [keyword, ...(tl?.terms ?? mat?.terms ?? [])]
    const quotes = await commercialQuotes(terms).catch(() => [])
    const mainCat = mat?.categories?.[0]
    const competitors = mainCat ? await categoryCompetitors(mainCat.id).catch(() => null) : null
    const bundle = {
      keyword,
      at: new Date().toISOString(),
      stage: tl?.stage ? { stage: tl.stage.stage, why: tl.stage.why, thin: Boolean(tl.thin) } : null,
      patentBasis: tl?.patents?.basis ?? null,
      patentYears: tl?.patents?.status === 'ok' ? tl.patents.years : [],
      owners: mat?.patents ?? [],
      paperKeywords: (mat?.papers ?? []).map((p) => p.word),
      categories: mat?.categories ?? [],
      competitors,
      quotes,
    }
    await cachePut(key, bundle, TTL).catch(() => {})
    return bundle
  })().finally(() => running.delete(key))
  running.set(key, job)
  return job
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
  if (b.owners?.length) {
    out.push({ title: `[분석] ${b.keyword} 특허 주요 출원인 (최근 6년)`, source: '특허 DB · 규칙 계산', description: `${b.keyword} 특허를 많이 낸 곳 (같은 발명 한 번): ${b.owners.slice(0, 6).map((o) => `${o.word} ${o.count}건`).join(', ')}` })
  }
  const ok = (b.quotes ?? []).filter((q) => q.aiOk)
  if (ok.length) {
    out.push({ title: `[분석] ${b.keyword} 상용화 시점 언급 (기사 문장)`, source: '1·2차 출처 기사 · 규칙으로 찾음', description: ok.slice(0, 3).map((q) => `「${q.text}」(${q.source ?? '출처'})`).join(' / ') })
  }
  return out.map((x) => ({ ...x, analysis: true, keyword: b.keyword }))
}
