// 기술 시계열 분석 (11/10 조장): 키워드 하나를 던지면 그 기술이 어떤 배경에서 나왔고, 어떻게 컸고, 어디에 쓰이게 됐고,
// 앞으로 어떨지를 시계열로 본다. 「어떤 기술이 트렌드가 될지 · 무엇을 연구할지」 고민하는 기준으로 쓴다
// 원칙(CLAUDE.md 1 · 2): 숫자 · 단계 판정은 규칙으로 계산하고, AI는 그 숫자와 대표 논문을 근거로 글만 쓴다 (근거 번호 [n], 사실 / AI 해설)
// 재료
// - 논문 수(장기): OpenAlex 검색 + 연도별 묶음 1번 ($0.001). 디스플레이 논문 DB에 맞는 논문이 있으면 디스플레이 주제로 좁힌다
// - 출발점 논문: OpenAlex 2017년까지 인용 많은 순 1번 ($0.001)
// - 2018년부터 자세히: 우리 논문 DB (기업 저자 비율 · 회사 · 핵심어 변화 · 시기별 대표 논문) — 비용 없음
// - 특허: BigQuery 제목 기준 해마다 공개 수 + 출원인 (약 26GB, 월 1TB 무료 → 30일 기억)
// - 검색 관심도: 네이버 데이터랩 월별 (2016년~). 약관상 그래프로만 보여 주고 AI에는 넣지 않는다 (23 문서)
// 결과는 7일 기억한다 (paper_cache)
import { dbEnabled, query } from './db/index.js'
import { chatJson, PRIORITY } from './llm/client.js'
import { DISPLAY_TOPICS } from './papers/journals.js'
import { cacheGet, cachePut } from './papers/index.js'
import { abstractFromIndex, bareDoi, clean, openAlexGet } from './papers/providers.js'
import { corpusReady, DISPLAY_MAKERS } from './papers/corpus.js'
import { patentHistory, patternFromTerms } from './patents.js'
import { englishTerms, openAlexQuery, queryKey } from './queryTerms.js'

const DAY = 86_400_000
// 기억 열쇠. 단계 기준(11/11 C)이 바뀌어 v2: 예전 단계 · 그 단계로 쓴 AI 정리는 다시 만든다 (열 때 또는 미리 분석 때)
const TL_KEY = 'timeline:v2:'
const STORY_KEY = 'timeline-story:v2:'
const TTL = 7 * DAY
const PATENT_TTL = 30 * DAY
const PERIODS = [
  { id: 'p1', label: '2018~2020', from: 2018, to: 2020 },
  { id: 'p2', label: '2021~2023', from: 2021, to: 2023 },
  { id: 'p3', label: '2024~', from: 2024, to: 9999 },
]
const periodOf = (y) => PERIODS.find((p) => y >= p.from && y <= p.to)?.id ?? null
const topicFilter = `primary_topic.id:${DISPLAY_TOPICS.map((t) => t.id).join('|')}`

// ── 논문 (장기 · OpenAlex) ──
// display가 아니면(우리 논문 DB에 맞는 논문이 적음) 전체 분야에서 찾으므로 표현 그대로("…")만 센다
// (11/11 검수: 따옴표 없이 찾으면 「media facade」가 media 또는 facade만 들어간 논문까지 해마다 수천 편으로 잡힘)
async function longPapers(en, display, terms = []) {
  const filter = ['type:article|review|conference-paper', ...(display ? [topicFilter] : [])].join(',')
  const search = display || !terms.length ? en : phraseVariants(terms).map((v) => `"${v}"`).join(' OR ')
  const data = await openAlexGet(`/works?search=${encodeURIComponent(search)}&filter=${filter}&group_by=publication_year`)
  const now = new Date().getFullYear()
  return (data.group_by ?? [])
    .map((g) => ({ y: Number(g.key), n: g.count }))
    .filter((x) => x.y >= 2000 && x.y <= now)
    .sort((a, b) => a.y - b.y)
}

// 기준선: 같은 조건(디스플레이 주제 또는 전체 분야)의 해마다 논문 수 (30일 기억, 한 번 $0.001)
// 논문은 분야 전체가 해마다 늘고, 최근 해는 OpenAlex에 덜 올라와 있다 → 그 기술만의 증가인지 보려면 분야 전체 증가로 나눈다 (11/11 C)
async function baselinePapers(display) {
  const key = `timeline-baseline:${display ? 'display' : 'all'}`
  const hit = await cacheGet(key).catch(() => null)
  if (hit) return hit
  const filter = ['type:article|review|conference-paper', ...(display ? [topicFilter] : [])].join(',')
  const data = await openAlexGet(`/works?filter=${filter}&group_by=publication_year`)
  const now = new Date().getFullYear()
  const out = (data.group_by ?? []).map((g) => ({ y: Number(g.key), n: g.count })).filter((x) => x.y >= 2000 && x.y <= now).sort((a, b) => a.y - b.y)
  if (out.length) await cachePut(key, out, 30 * DAY).catch(() => {})
  return out
}

// 논문은 약어보다 풀어 쓴 말을 많이 쓴다 (예: tandem OLED → tandem organic light-emitting, 11/10 실측: 약어로만 찾으면 일반 OLED 총설이 나옴)
const SPELLED = { oled: 'organic light-emitting', oleds: 'organic light-emitting', led: 'light-emitting diode', leds: 'light-emitting diodes', microled: 'micro light-emitting diode', qd: 'quantum dot', tft: 'thin-film transistor', lcd: 'liquid crystal display' }
export function phraseVariants(terms) {
  const out = new Set()
  for (const t of terms) {
    const words = String(t).split(/\s+/)
    out.add(words.join(' '))
    if (words.some((w) => SPELLED[w.toLowerCase().replace(/-/g, '')])) out.add(words.map((w) => SPELLED[w.toLowerCase().replace(/-/g, '')] ?? w).join(' '))
  }
  return [...out].slice(0, 6)
}

// 출발점: 그 말이 「표현 그대로」 들어간 2017년까지 논문 중 인용 많은 순
async function originPapers(terms, display) {
  const filter = ['type:article|review|conference-paper', 'to_publication_date:2017-12-31', ...(display ? [topicFilter] : [])].join(',')
  const search = phraseVariants(terms).map((v) => `"${v}"`).join(' OR ')
  const data = await openAlexGet(
    `/works?search=${encodeURIComponent(search)}&filter=${filter}&sort=cited_by_count:desc&per-page=5&select=id,doi,title,publication_year,cited_by_count,primary_location,authorships,abstract_inverted_index`,
  )
  return (data.results ?? []).map((w) => ({
    title: clean(w.title),
    year: w.publication_year,
    doi: bareDoi(w.doi) || null,
    journal: w.primary_location?.source?.display_name ?? '',
    cited: w.cited_by_count ?? 0,
    companies: [...new Set((w.authorships ?? []).flatMap((a) => a.institutions ?? []).filter((i) => i.type === 'company').map((i) => String(i.display_name).replace(/\s*\([^)]*\)\s*$/, '')))],
    abstract: abstractFromIndex(w.abstract_inverted_index).slice(0, 400),
    origin: true,
  }))
}

// ── 2018년부터 (우리 논문 DB) ──
function tsq(terms, params) {
  return terms
    .map((t) => {
      params.push(t)
      return `phraseto_tsquery('english', $${params.length}) || plainto_tsquery('english', $${params.length})`
    })
    .join(' || ')
}

async function corpusFacts(terms) {
  if (!dbEnabled()) return null
  const params = []
  const q = tsq(terms, params)
  const base = `FROM papers, (SELECT (${q}) AS q) x WHERE doc @@ q AND NOT retracted AND year >= 2018`
  const [{ rows: years }, { rows: comps }, { rows: kws }, { rows: tops }] = await Promise.all([
    query(`SELECT year AS y, count(*)::int AS n, count(*) FILTER (WHERE jsonb_array_length(companies) > 0)::int AS c ${base} GROUP BY year ORDER BY year`, params),
    query(`SELECT year AS y, c->>'name' AS name, count(*)::int AS n ${base.replace('FROM papers,', 'FROM papers CROSS JOIN LATERAL jsonb_array_elements(companies) c,')} GROUP BY 1, 2`, params),
    query(`SELECT year AS y, k->>'name' AS name, count(*)::int AS n ${base.replace('FROM papers,', 'FROM papers CROSS JOIN LATERAL jsonb_array_elements(keywords) k,')} AND (k->>'score')::real >= 0.4 GROUP BY 1, 2`, params),
    query(
      `SELECT * FROM (
         SELECT id, doi, title, journal, year, cited, pct, companies, left(abstract, 400) AS abstract,
                row_number() OVER (PARTITION BY CASE WHEN year <= 2020 THEN 1 WHEN year <= 2023 THEN 2 ELSE 3 END
                                   ORDER BY (jsonb_array_length(companies) > 0) DESC, coalesce(pct, 0.5) DESC, ts_rank_cd(doc, q, 32) DESC) AS r
         ${base}) t WHERE r <= 3 ORDER BY year`,
      params,
    ),
  ])
  if (!years.length) return { total: 0 }
  // 시기별로 묶기
  const byPeriod = Object.fromEntries(PERIODS.map((p) => [p.id, { papers: 0, withCompany: 0, companies: new Map(), keywords: new Map() }]))
  for (const r of years) {
    const p = byPeriod[periodOf(r.y)]
    if (!p) continue
    p.papers += r.n
    p.withCompany += r.c
  }
  for (const r of comps) byPeriod[periodOf(r.y)]?.companies.set(r.name, (byPeriod[periodOf(r.y)].companies.get(r.name) ?? 0) + r.n)
  const own = new Set(terms.flatMap((t) => t.toLowerCase().split(/[\s-]+/)))
  for (const r of kws) {
    const name = String(r.name)
    if (name.toLowerCase().split(/[\s-]+/).every((w) => own.has(w))) continue // 검색어 자신
    byPeriod[periodOf(r.y)]?.keywords.set(name, (byPeriod[periodOf(r.y)].keywords.get(name) ?? 0) + r.n)
  }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }))
  const periods = PERIODS.map((p) => {
    const x = byPeriod[p.id]
    const kw = top(x.keywords, 12)
    return { id: p.id, label: p.label, papers: x.papers, companyShare: x.papers ? Math.round((x.withCompany / x.papers) * 100) / 100 : null, companies: top(x.companies, 8), keywords: kw }
  })
  // 새로 뜬 핵심어: 마지막 시기에 많고 앞 시기엔 없거나 적던 말 (적용처 · 연관 기술 변화)
  const early = new Map([...byPeriod.p1.keywords, ...byPeriod.p2.keywords].map(([k]) => [k, 0]))
  for (const [k, n] of byPeriod.p1.keywords) early.set(k, (early.get(k) ?? 0) + n)
  for (const [k, n] of byPeriod.p2.keywords) early.set(k, (early.get(k) ?? 0) + n)
  const rising = [...byPeriod.p3.keywords]
    .filter(([, n]) => n >= 2)
    .map(([k, n]) => ({ name: k, recent: n, before: early.get(k) ?? 0 }))
    .filter((x) => x.recent > x.before)
    .sort((a, b) => b.recent - b.before - (a.recent - a.before))
    .slice(0, 10)
  return {
    total: years.reduce((a, r) => a + r.n, 0),
    years: years.map((r) => ({ y: r.y, n: r.n, companyShare: r.n ? Math.round((r.c / r.n) * 100) / 100 : 0 })),
    periods,
    rising,
    papers: tops.map((r) => ({ title: r.title, year: r.year, doi: r.doi, journal: r.journal ?? '', cited: r.cited, pct: r.pct, companies: (r.companies ?? []).map((c) => c.name), abstract: r.abstract ?? '' })),
  }
}

// ── 네이버 데이터랩 월별 (2016년~) — 그래프 전용 ──
async function naverMonthly(word) {
  const id = process.env.NAVER_CLIENT_ID
  const secret = process.env.NAVER_CLIENT_SECRET
  if (!id || !secret) return { status: 'no_key' }
  const url = process.env.NAVER_TREND_URL ?? 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search'
  const end = new Date(Date.now() - DAY)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret },
    body: JSON.stringify({ startDate: '2016-01-01', endDate: end.toISOString().slice(0, 10), timeUnit: 'month', keywordGroups: [{ groupName: word, keywords: [word] }] }),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) return { status: 'not_enabled' }
  if (!res.ok) return { status: 'error', error: data?.error?.message ?? `응답 ${res.status}` }
  const thisMonth = new Date().toISOString().slice(0, 7)
  return { status: 'ok', months: (data.results?.[0]?.data ?? []).filter((p) => !p.period.startsWith(thisMonth)).map((p) => ({ t: p.period.slice(0, 7), v: Math.round(p.ratio * 10) / 10 })) }
}

// ── 특허 (30일 기억) ──
// cacheOnly: 미리 분석(뒤에서 도는 일)은 BigQuery를 부르지 않는다 (한 번 26GB, 하루 할당량 50GiB) → 사람이 열 때 받는다
async function patents(terms, { cacheOnly = false } = {}) {
  const pattern = patternFromTerms(terms)
  if (!pattern) return { status: 'no_terms' }
  const key = `timeline-patents:${pattern}`
  const hit = await cacheGet(key).catch(() => null)
  if (hit) return hit
  if (cacheOnly) return { status: 'later' }
  const r = await patentHistory(pattern)
  if (r.status !== 'ok') return r
  const total = new Map()
  for (const o of r.owners) total.set(o.name, (total.get(o.name) ?? 0) + o.n)
  const byPeriod = PERIODS.map((p) => {
    const m = new Map()
    for (const o of r.owners) if (o.y >= p.from && o.y <= p.to) m.set(o.name, (m.get(o.name) ?? 0) + o.n)
    return { id: p.id, label: p.label, owners: [...m].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count })) }
  })
  const out = { status: 'ok', years: r.years, periods: byPeriod, topOwners: [...total].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })), basis: '영문 제목' }
  await cachePut(key, out, PATENT_TTL).catch(() => {})
  return out
}

// ── 단계 판정 (규칙) ──
// 끝난 해만 비교: 최근 3년(작년까지) 대 그 앞 3년. 기업 저자 비율 변화로 상용화 쪽인지 본다
// 분야 전체 대비 증가 기준 (rel = 그 기술 증가 ÷ 분야 전체 증가). 출발값, 여러 기술로 돌려 보고 조정
const REL_FAST = 1.4
const REL_MILD = 1.15
const REL_FLAT = 0.85
const sumYears = (list, from, to) => list.filter((x) => x.y >= from && x.y <= to).reduce((a, x) => a + x.n, 0)
// base: 분야 전체 해마다 논문 수 (없으면 예전처럼 그 기술의 증가만 본다)
// 11/11 C: 검수에서 37개 중 26개가 「연구 지속」 — 분야 전체가 3년에 1.2배쯤 늘어 1.5배 미만을 모두 「비슷」으로 봤기 때문.
//   이제 「분야 전체보다 몇 배 빠른가」(rel)로 보고, 조금 빠른 것은 「완만한 성장」으로 따로 둔다
function stageOf(long, corpus, pat, base = []) {
  const last = new Date().getFullYear() - 1
  const recent = sumYears(long, last - 2, last)
  const before = sumYears(long, last - 5, last - 3)
  const growth = (recent + 1) / (before + 1)
  const baseBefore = sumYears(base, last - 5, last - 3)
  const baseGrowth = baseBefore > 0 ? sumYears(base, last - 2, last) / baseBefore : null
  const rel = baseGrowth ? growth / baseGrowth : growth
  const vsBase = baseGrowth ? ` · 분야 전체 ${baseGrowth.toFixed(1)}배보다 ${rel >= 1 ? `${rel.toFixed(2)}배 빠름` : `느림 (${rel.toFixed(2)}배)`}` : ''
  const shares = corpus?.periods?.map((p) => p.companyShare).filter((x) => x != null) ?? []
  const shareNow = corpus?.periods?.[2]?.companyShare ?? null
  const shareThen = corpus?.periods?.[0]?.companyShare ?? null
  const patRecent = pat?.years ? sumYears(pat.years, last - 2, last) : null
  const patBefore = pat?.years ? sumYears(pat.years, last - 5, last - 3) : null
  const patGrowth = patRecent != null ? (patRecent + 1) / (patBefore + 1) : null
  let stage
  let why
  if (recent < 15) {
    stage = '신생 · 탐색'
    why = `최근 3년 논문 ${recent}편으로 아직 적음`
  } else if (rel >= REL_FAST) {
    stage = shareNow != null && shareNow >= 0.2 ? '성장 · 상용화 진입' : '연구 성장'
    why = `논문이 앞 3년보다 ${growth.toFixed(1)}배${vsBase}${shareNow != null ? ` · 기업 저자 비율 ${Math.round(shareNow * 100)}%` : ''}`
  } else if (rel >= REL_MILD) {
    stage = '완만한 성장'
    why = `논문이 앞 3년보다 ${growth.toFixed(1)}배${vsBase}${shareNow != null ? ` · 기업 저자 비율 ${Math.round(shareNow * 100)}%` : ''}`
  } else if (rel >= REL_FLAT) {
    stage = shareNow != null && shareNow >= 0.25 ? '성숙 · 상용화' : '연구 지속'
    why = `논문이 앞 3년보다 ${growth.toFixed(1)}배로 분야 전체와 비슷${vsBase}${shareNow != null ? ` · 기업 저자 비율 ${Math.round(shareNow * 100)}%` : ''}`
  } else {
    stage = '정체 · 감소'
    why = `논문이 앞 3년의 ${growth.toFixed(1)}배${vsBase}`
  }
  return {
    stage,
    why,
    growth: Math.round(growth * 100) / 100,
    baseGrowth: baseGrowth != null ? Math.round(baseGrowth * 100) / 100 : null,
    relGrowth: Math.round(rel * 100) / 100,
    recentPapers: recent,
    beforePapers: before,
    companyShareNow: shareNow,
    companyShareThen: shareThen,
    companyShareTrend: shares.length >= 2 && shareNow != null && shareThen != null ? Math.round((shareNow - shareThen) * 100) / 100 : null,
    patentGrowth: patGrowth != null ? Math.round(patGrowth * 100) / 100 : null,
    years: `${last - 2}~${last} 대 ${last - 5}~${last - 3}`,
  }
}

// 돌려주는 값: { query, terms, stage, long, corpus, patents, naver, origins, at } (7일 기억)
// background: 미리 분석 (특허는 기억해 둔 것만). 사람이 열었을 때 특허가 「나중에」였으면 그때 받아 채운다
export async function buildTimeline(rawQuery, { refresh = false, background = false } = {}) {
  const q = String(rawQuery ?? '').trim().slice(0, 50)
  if (!q) throw Object.assign(new Error('기술 키워드를 입력해 주세요.'), { status: 400 })
  const key = `${TL_KEY}${queryKey(q)}`
  if (!refresh) {
    const hit = await cacheGet(key).catch(() => null)
    if (hit && !(hit.patents?.status === 'later' && !background)) return { ...withThin(hit), cached: true }
    if (hit) {
      // 미리 분석해 둔 값에 특허만 채운다
      const pat = await patents(hit.terms).catch((err) => ({ status: 'error', error: err.message }))
      const out = { ...hit, patents: pat }
      out.stage = stageOf(out.long.length ? out.long : (out.corpus?.years ?? []).map((x) => ({ y: x.y, n: x.n })), out.corpus, pat.status === 'ok' ? pat : null, out.base ?? [])
      await cachePut(key, out, pat.status === 'error' ? 10 * 60_000 : TTL).catch(() => {})
      return { ...withThin(out), cached: false }
    }
  }
  const t = await englishTerms(q, { waitMs: 60_000 })
  if (!t.terms.length) throw Object.assign(new Error(t.pending ? '영문 검색어를 만드는 중이에요. 잠시 뒤 다시 눌러 주세요.' : '영문 검색어를 만들지 못했어요. 영문으로 입력해 보세요.'), { status: 503 })
  const en = openAlexQuery(t.terms)
  const corpus = await corpusFacts(t.terms).catch((err) => ({ error: err.message }))
  const display = (corpus?.total ?? 0) >= THIN_MIN
  const settle = (p) => p.then((value) => ({ value }), (err) => ({ error: err.message }))
  let [long, origins, pat, naver, base] = await Promise.all([settle(longPapers(en, display, t.terms)), settle(originPapers(t.terms, display)), settle(patents(t.terms, { cacheOnly: background })), settle(naverMonthly(q)), settle(baselinePapers(display))])
  // OpenAlex가 큰 묶음에서 504(시간 초과)를 주기도 한다 (11/10 실측: micro led) → 한 번 더
  if (long.error) long = await settle(longPapers(en, display, t.terms))
  const out = {
    query: q,
    terms: t.terms,
    termsSource: t.source,
    display,
    long: long.value ?? [],
    longError: long.error ?? null,
    origins: origins.value ?? [],
    corpus,
    patents: pat.value ?? { status: 'error', error: pat.error },
    naver: naver.value ?? { status: 'error', error: naver.error },
    at: new Date().toISOString(),
  }
  // 장기 논문 수를 못 받았으면 단계 판정은 논문 DB(2018년~) 숫자로 (빈 값으로 「신생」이라 하지 않게)
  const basis = out.long.length ? out.long : (corpus?.years ?? []).map((x) => ({ y: x.y, n: x.n }))
  // 기준선: OpenAlex 숫자로 판정할 때만 (논문 DB 숫자로 판정할 때는 기준선 단위가 달라 쓰지 않음)
  out.base = out.long.length ? base.value ?? [] : []
  out.stage = stageOf(basis, corpus, out.patents.status === 'ok' ? out.patents : null, out.base)
  if (!out.long.length && basis.length) out.stage.why += ' (OpenAlex 응답이 없어 논문 DB 기준)'
  // 디스플레이 근거가 적은 말: 다른 분야 논문이 섞일 수 있어 숫자 · 단계는 참고만, AI 흐름 정리는 하지 않는다 (11/11 검수: DDI → 유전체 · 전력 소자 논문)
  out.thin = display ? null : thinReason(corpus)
  out.makers = (corpus?.periods ?? []).map((p) => ({ label: p.label, makers: p.companies.filter((c) => DISPLAY_MAKERS.test(c.name)).map((c) => c.name) }))
  out.corpusPartial = !(await corpusReady())
  // 논문 DB 처음 받기가 안 끝났으면 일부만 본 결과라 1시간만 기억
  // 일부 출처가 실패했으면 10분만 기억 (다음에 다시 받음)
  const failed = out.longError || out.patents.status === 'error'
  await cachePut(key, out, failed ? 10 * 60_000 : out.corpusPartial ? 3600_000 : TTL).catch(() => {})
  return { ...out, cached: false }
}

// ── AI 글: 배경 · 성장 · 적용 · 전망 · 연구 제안 ──
const SECTIONS = ['background', 'growth', 'application', 'outlook', 'research']
const bullets = {
  type: 'object',
  properties: {
    bullets: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, refs: { type: 'array', items: { type: 'integer' } }, kind: { type: 'string', enum: ['fact', 'ai'] } },
        required: ['text', 'refs', 'kind'],
      },
    },
  },
  required: ['bullets'],
}
const STORY_SCHEMA = { type: 'object', properties: Object.fromEntries(SECTIONS.map((k) => [k, bullets])), required: SECTIONS }

function storyInput(tl) {
  const papers = [...tl.origins, ...(tl.corpus?.papers ?? [])].slice(0, 14)
  const lines = []
  lines.push(`기술: ${tl.query} (영문 검색어: ${tl.terms.join(', ')})`)
  lines.push(`규칙으로 판정한 단계: ${tl.stage.stage} — ${tl.stage.why} (비교 구간 ${tl.stage.years})`)
  // 올해는 아직 안 끝나 적게 잡히므로 AI에 주지 않는다 (11/10 실측: 올해 값을 「증가」로 씀)
  const done = (list) => list.filter((x) => x.y < new Date().getFullYear())
  lines.push(`논문 수 (OpenAlex, 해마다, 끝난 해만${tl.display ? ', 디스플레이 주제' : ''}): ${done(tl.long).map((x) => `${x.y}년 ${x.n}편`).join(', ')}`)
  lines.push('시기별 (우리 논문 DB, 2018년부터. 시기 이름을 바꾸지 말고 그대로 쓸 것):')
  for (const p of tl.corpus?.periods ?? []) {
    lines.push(`- ${{ p1: '2018~2020년', p2: '2021~2023년', p3: '2024년~현재' }[p.id]}: 논문 ${p.papers}편, 기업 저자 비율 ${p.companyShare != null ? `${Math.round(p.companyShare * 100)}%` : '-'}, 논문 낸 회사 ${p.companies.map((c) => `${c.name}(${c.count})`).join(', ') || '없음'}, 많이 나온 핵심어 ${p.keywords.map((k) => k.name).join(', ')}`)
  }
  if (tl.corpus?.rising?.length) lines.push(`2024년 이후 새로 늘어난 핵심어 (2018~2023년 편수 → 2024년 이후 편수): ${tl.corpus.rising.map((r) => `${r.name}(${r.before}→${r.recent})`).join(', ')}`)
  if (tl.patents?.status === 'ok') {
    lines.push(`특허 공개 수 (영문 제목 기준, 해마다, 끝난 해만): ${done(tl.patents.years).map((x) => `${x.y}년 ${x.n}건`).join(', ')}`)
    lines.push(`특허 많은 출원인: ${tl.patents.topOwners.map((o) => `${o.name}(${o.count})`).join(', ')}`)
  }
  lines.push('\n근거 논문 목록 (refs에는 이 번호만):')
  papers.forEach((p, i) => lines.push(`[${i + 1}] ${p.year} · ${p.title} · ${p.journal || '-'} · 인용 ${p.cited}${p.companies?.length ? ` · 기업: ${p.companies.join(', ')}` : ''}${p.origin ? ' · (초기 대표 논문)' : ''}\n    ${String(p.abstract ?? '').slice(0, 300)}`))
  return { text: lines.join('\n'), papers }
}

// 디스플레이 근거가 적은 이유 (화면 · AI 흐름 정리 공통)
const THIN_MIN = 15
// 11/11 이전에 기억해 둔 값에는 thin이 없다 → 꺼낼 때 채운다
const withThin = (tl) => (tl.thin !== undefined ? tl : { ...tl, thin: tl.display ? null : thinReason(tl.corpus) })
function thinReason(corpus) {
  const n = corpus?.total ?? 0
  return `우리 디스플레이 논문 DB(2018년~)에 맞는 논문이 ${n}편뿐이에요 (${THIN_MIN}편 미만). 다른 분야 논문이 섞였을 수 있어 숫자 · 단계는 참고만 하고, AI 흐름 정리는 하지 않아요. 영문 검색어를 고치면 나아질 수 있어요 (관리 페이지 「수집 대상 › 검색어 영문 표기」)`
}

// 근거 번호도 숫자도 없는 「사실」은 확인할 길이 없어 「AI 해설」로 내린다 (CLAUDE.md 2, 11/11 검수: 38개 정리에 54개)
// 예전에 만들어 둔 정리에도 꺼낼 때 같은 기준을 적용한다
const demoteBare = (b) => (b.kind === 'fact' && !b.refs?.length && !/\d/.test(b.text) ? { ...b, kind: 'ai' } : b)
const demoteStory = (out) => ({ ...out, story: Object.fromEntries(Object.entries(out.story ?? {}).map(([k, list]) => [k, (list ?? []).map(demoteBare)])) })

// 같은 말의 AI 흐름 정리가 이미 도는 중이면 그 결과를 함께 기다린다 (11/11: 정리 중에 화면을 닫았다 다시 열면 AI를 한 번 더 불렀다)
const storyRuns = new Map()
export function timelineStory(rawQuery, opts = {}) {
  const k = `${queryKey(String(rawQuery ?? ''))}|${opts.refresh ? 'r' : ''}${opts.background ? 'b' : ''}` // 미리 분석(낮은 순위)과 사람 요청은 따로: 사람이 뒤로 밀리지 않게
  const running = storyRuns.get(k)
  if (running) return running
  const run = makeTimelineStory(rawQuery, opts).finally(() => storyRuns.delete(k))
  storyRuns.set(k, run)
  return run
}

async function makeTimelineStory(rawQuery, { refresh = false, background = false } = {}) {
  const tl = await buildTimeline(rawQuery, { background })
  const key = `${STORY_KEY}${queryKey(tl.query)}`
  const thin = withThin(tl).thin
  if (thin) return { query: tl.query, story: Object.fromEntries(SECTIONS.map((k) => [k, []])), papers: [], thin, at: new Date().toISOString(), cached: false }
  if (!refresh) {
    const hit = await cacheGet(key).catch(() => null)
    if (hit) return { ...demoteStory(hit), cached: true }
  }
  const { text, papers } = storyInput(tl)
  const { data, model } = await chatJson({
    kind: 'timeline',
    priority: background ? PRIORITY.BACKGROUND : PRIORITY.USER, // 미리 분석은 사람 요청에 자리를 내준다
    timeoutMs: 240_000,
    schema: STORY_SCHEMA,
    schemaName: 'tech_timeline',
    messages: [
      {
        role: 'system',
        content: `너는 디스플레이 회사 기술 기획 담당자를 돕는다. 아래 숫자와 근거 논문만 보고 한 기술의 흐름을 개조식으로 정리한다.
섹션: background(어떤 문제 · 배경에서 나왔나), growth(어떻게 커졌나 — 논문 · 특허 수, 기업 참여 변화), application(어디에 쓰이게 됐나 — 핵심어 변화, 제품 분야), outlook(앞으로 — 규칙 판정 단계를 따르고 이유를 숫자로), research(우리 회사가 연구 · 검토할 만한 것).
- 섹션마다 글머리 2~4개, 한 글머리 한 문장, 명사형 종결("~함", "~임").
- 숫자 · 회사 · 연도는 주어진 것만 쓴다. 지어내지 않는다.
- 근거 논문에서 확인되는 사실은 kind "fact"와 refs(번호). 해석 · 전망 · 제안은 kind "ai", refs는 빈 배열.
- 주어진 숫자(논문 수, 기업 비율, 특허 수)로 쓴 글머리는 kind "fact", refs는 빈 배열이어도 된다. 근거 번호도 주어진 숫자도 없는 글머리는 kind "ai".
- 우리 회사(고객사)는 WOLED가 주력인 디스플레이 제조사다. QD-OLED는 경쟁사 기술이므로 우리 회사 연구 제안으로 'QD-OLED 도입'을 쓰지 않는다.
- 분석하는 기술이 경쟁사 주력 기술(QD-OLED, 양자점 색변환 등)이면 research는 그 기술을 우리가 개발하자는 제안이 아니라, 우리 WOLED와의 비교 · 대응 방안 · 계속 지켜볼 지표(경쟁사 양산 · 효율 · 수명 · 원가 등)로 쓴다.
- 한국어로만. 영문 핵심어는 한국어로 옮기고 처음 한 번만 괄호에 영문 (예: 누화 감소(crosstalk reduction)). 문장 안에 [1] 같은 번호를 쓰지 않는다.
- outlook 첫 글머리에 단계 이름만 되풀이하지 말고, 그 단계로 본 이유를 숫자로 쓴다. 분야 전체 증가와 견준 값이 있으면 그것을 쓴다.`,
      },
      { role: 'user', content: text },
    ],
  })
  const max = papers.length
  // 「사실」 글머리의 숫자가 입력에 없으면 AI 해설로 돌리고 확인 필요 표시 (CLAUDE.md 2: AI가 틀려도 알아챌 수 있게)
  const known = new Set(text.match(/\d+(?:\.\d+)?/g) ?? [])
  const checkNumbers = (b) => {
    const missing = (b.text.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !known.has(n))
    if (b.kind === 'fact' && missing.length) return { ...b, kind: 'ai', unverified: missing }
    return demoteBare(b)
  }
  const story = Object.fromEntries(
    SECTIONS.map((k) => [
      k,
      (data?.[k]?.bullets ?? [])
        .slice(0, 5)
        .map((b) => ({ text: String(b.text ?? '').replace(/\s*\[\d+(?:,\s*\d+)*\]/g, '').trim(), kind: b.kind === 'fact' ? 'fact' : 'ai', refs: (b.refs ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= max) }))
        .filter((b) => b.text)
        .map(checkNumbers),
    ]),
  )
  const out = { query: tl.query, story, papers: papers.map((p) => ({ title: p.title, year: p.year, journal: p.journal, doi: p.doi, cited: p.cited, companies: p.companies ?? [] })), model, at: new Date().toISOString() }
  await cachePut(key, out, TTL).catch(() => {})
  return { ...out, cached: false }
}

// 미리 분석해 둔 값만 꺼낸다 (부르지 않음): 대시보드 「미리 분석된 키워드」 · 미리 분석 일이 건너뛸지 볼 때
export async function cachedTimeline(rawQuery) {
  const k = queryKey(rawQuery)
  const [tl, story] = await Promise.all([cacheGet(`${TL_KEY}${k}`).catch(() => null), cacheGet(`${STORY_KEY}${k}`).catch(() => null)])
  return { timeline: tl, story }
}
