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
import { getTechTrends } from './techtrends.js'
import { buildTimeline, cachedTimeline } from './timeline.js'
import { surgeMonths } from './timesfm.js'

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
// 작은 수 보정 (11/15 팀 회의: 「1건 → 5건을 500% 늘었다고 강조하면 안 됨 — 근원값을 보고 가중해서」):
// - 앞 · 뒤 기간 합이 RATIO_MIN건 미만이면 비율을 내지 않음(「건수 적음」, 판정에서 뺌) — Porter 외 2019 「최소 7건」과 같은 일회성 방지, 10은 timeline.js PAT_MIN과 맞춤
// - 비율은 양쪽에 RATIO_PRIOR건씩 더해 계산 (가법 보정 · 작은 표본일수록 1배 쪽으로 당겨짐): 1→5건 = 5배가 아니라 (5+5)/(1+5) = 1.67배, 100→500건은 4.9배로 거의 그대로
export const RATIO_MIN = 10
export const RATIO_PRIOR = 5
export async function categoryCompetitors(catId) {
  const cat = DISPLAY_CATEGORIES.find((c) => c.id === catId)
  if (!cat || !dbEnabled()) return null
  // 특허 DB를 다시 받으면(분기 · 11/13 CPC 전체 코드) 다시 센다
  const meta = await patentDbReady().catch(() => null)
  if (!meta) return null
  const key = `cat-competitors:v3:${catId}:${meta.at}` // v2: 작은 수 보정 · v3: 2개국 이상 출원 비율 (11/15)
  const hit = await cacheGet(key).catch(() => null)
  if (hit) return hit
  const last = new Date().getFullYear() - 1
  const [a, b] = [(last - 5) * 10000, (last - 2) * 10000]
  const cols = COMPANIES.map(
    (c, i) =>
      `count(*) FILTER (WHERE pub >= $2 AND pub < $3 AND EXISTS (SELECT 1 FROM unnest(owners) o WHERE o LIKE $${i + 5}))::int AS b${i},
       count(*) FILTER (WHERE pub >= $3 AND pub < $4 AND EXISTS (SELECT 1 FROM unnest(owners) o WHERE o LIKE $${i + 5}))::int AS r${i},
       count(*) FILTER (WHERE pub >= $3 AND pub < $4 AND cardinality(countries) >= 2 AND EXISTS (SELECT 1 FROM unnest(owners) o WHERE o LIKE $${i + 5}))::int AS i${i}`,
  ).join(', ')
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE pub >= $2 AND pub < $3)::int AS fb, count(*) FILTER (WHERE pub >= $3 AND pub < $4)::int AS fr,
            count(*) FILTER (WHERE pub >= $3 AND pub < $4 AND cardinality(countries) >= 2)::int AS fi, ${cols}
       FROM display_patents WHERE pub >= $2 AND pub < $4 AND EXISTS (SELECT 1 FROM unnest(cpc) x WHERE x ~ $1)`,
    [cat.cpc, a, b, (last + 1) * 10000, ...COMPANIES.map((c) => c.like)],
  )
  const r = rows[0]
  if (!r?.fb) return null
  const ratio = (before, now) => (before + now >= RATIO_MIN ? Math.round(((now + RATIO_PRIOR) / (before + RATIO_PRIOR)) * 100) / 100 : null)
  const field = ratio(r.fb, r.fr)
  const companies = COMPANIES.map((c, i) => ({ id: c.id, name: c.name, own: Boolean(c.own), unsure: Boolean(c.unsure), before: r[`b${i}`], now: r[`r${i}`], ratio: ratio(r[`b${i}`], r[`r${i}`]), intl: r[`r${i}`] ? Math.round((r[`i${i}`] / r[`r${i}`]) * 100) / 100 : null }))
  const sure = companies.filter((c) => !c.unsure && !c.own && c.ratio != null)
  const own = companies.find((c) => c.own)
  const threat = own?.ratio != null && field != null && sure.some((c) => c.ratio >= THREAT_FACTOR * field) && own.ratio < field
  const chance = own?.ratio != null && field != null && sure.every((c) => own.ratio > c.ratio) && own.ratio >= field
  const out = { id: cat.id, name: cat.name, years: `${last - 5}~${last - 3} → ${last - 2}~${last}`, field: { before: r.fb, now: r.fr, ratio: field, intl: r.fr ? Math.round((r.fi / r.fr) * 100) / 100 : null }, companies, verdict: threat ? '위협' : chance ? '기회' : null }
  await cachePut(key, out, 7 * 86_400_000).catch(() => {})
  return out
}

// ── 묶음 만들기 ──
export async function prepareBundle(raw, { refresh = false } = {}) {
  const keyword = String(raw ?? '').trim().slice(0, 50)
  if (!keyword) return null
  const key = `bundle:v3:${queryKey(keyword)}` // v3 (11/17, 40 문서 R1): 논문 추이 · 관심 대 실질 · 연구 폭 · 떠오르는 세부 주제 · 주요 기업 · 급증 · 신호 점수 // v2 (11/17): 11/15에 「2개국 이상 출원」을 넣고도 v1 그대로라 예전 묶음이 3일 동안 나갔음 (36 문서 2-6)
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
      competitors,
      quotes,
      // ── v3 (11/17): 기술 시계열에서 더 가져오는 것 ──
      // 논문 연도별 수 · 앞 3년 대비 성장(분야 대비)
      papers: tl?.corpus?.years?.length
        ? { years: tl.corpus.years.map(({ y, n }) => ({ y, n })), total: tl.corpus.total ?? null, span: st?.years ?? null, recent: st?.recentPapers ?? null, before: st?.beforePapers ?? null, growth: st?.growth ?? null, relGrowth: st?.relGrowth ?? null }
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
