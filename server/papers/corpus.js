// 디스플레이 논문 DB (11/10 조장: 새 키워드로 찾을 때마다 API를 불러 비용 한도에 걸릴까 걱정 → 미리 받아 두고 우리 DB에서 찾는다)
// - OpenAlex 디스플레이 주제 6개(journals.js DISPLAY_TOPICS)의 논문을 2018년부터 받아 papers 표에 둔다
//   목록 받기는 100편에 $0.0001 (검색 1번 $0.001의 1/10). 11/10 실측: 2023년 이후 51,946편 → 2018년부터 약 11만 편 ≈ $0.1, 한 번만
// - 매일: 최근 60일 논문을 다시 받아 새 논문 · 인용 수를 고친다 (약 $0.003). 매주 일요일: 최근 3년 인용 수 (약 $0.04)
// - 찾기: PostgreSQL 전문 검색(제목 · 핵심어 > 초록). 디스플레이 밖 말(HBM 등)은 맞는 논문이 적으면 지금처럼 OpenAlex 검색으로
// - 하루 예산은 팀이 같이 쓴다: 남은 예산이 BUDGET_FLOOR보다 적으면 받기를 멈추고 다음 날 이어 받는다 (사용자 찾기 몫을 남김)
// - 초록은 OpenAlex CC0. 원문은 저장하지 않는다
import { dbEnabled, query } from '../db/index.js'
import { getSetting, setSetting } from '../db/store.js'
import { DISPLAY_JOURNALS, DISPLAY_TOPICS } from './journals.js'
import { abstractFromIndex, bareDoi, clean, openAlexGet } from './providers.js'

const STATE_KEY = 'paper_corpus'
const START_DATE = '2018-01-01'
const BUDGET_FLOOR = 0.3 // 이보다 적게 남으면 받기를 멈춘다 ($)
const PAGE = 100
const SELECT = [
  'id', 'doi', 'title', 'publication_date', 'publication_year', 'type', 'primary_location', 'cited_by_count', 'fwci',
  'citation_normalized_percentile', 'primary_topic', 'topics', 'keywords', 'authorships', 'abstract_inverted_index', 'open_access', 'is_retracted',
].join(',')
const ABSTRACT_MAX = 3_000

const DISPLAY_SOURCE = new Set(DISPLAY_JOURNALS.map((j) => j.openalex))
// 디스플레이 패널 · 소재 · 장비 · 세트 회사 (기업 저자 점수 만점). 그 밖의 기업은 절반
// OpenAlex 기관 이름은 「LG (South Korea)」처럼 나라가 붙고, LG Display가 「LG」로 묶여 나오기도 한다 (11/10 실측)
export const DISPLAY_MAKERS =
  /\b(LG|Samsung|BOE|TCL|CSOT|China Star|Visionox|Govisionox|Tianma|EverDisplay|AU Optronics|AUO|Innolux|Sharp|Japan Display|JOLED|Semiconductor Energy Lab\w*|Universal Display|Merck|Idemitsu|Sumitomo|Duksan|Solus|Kateeva|Canon|Applied Materials|Sony|Apple|Meta|Google|Microsoft|Kopin|eMagin|PlayNitride|Aledia|Porotech|Jade Bird|Seoul Viosys|Nichia|Osram|Corning|HKC|Xiaomi|Huawei)\b/i

const ymd = (d) => new Date(d).toISOString().slice(0, 10)
const companyName = (n) => String(n ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim()

function toRow(w) {
  const loc = w.primary_location ?? {}
  const companies = []
  for (const a of w.authorships ?? [])
    for (const i of a.institutions ?? [])
      if (i.type === 'company' && !companies.some((c) => c.name === companyName(i.display_name))) companies.push({ name: companyName(i.display_name), country: i.country_code ?? null })
  const keywords = (w.keywords ?? []).map((k) => ({ name: k.display_name, score: Math.round((k.score ?? 0) * 100) / 100 }))
  return {
    id: String(w.id ?? '').split('/').pop(),
    doi: bareDoi(w.doi) || null,
    title: clean(w.title),
    abstract: abstractFromIndex(w.abstract_inverted_index).slice(0, ABSTRACT_MAX) || null,
    journal: loc.source?.display_name ?? null,
    source_id: loc.source?.id ? String(loc.source.id).split('/').pop() : null,
    is_core: Boolean(loc.source?.is_core),
    type: w.type ?? null,
    published: w.publication_date ?? null,
    year: w.publication_year ?? null,
    cited: w.cited_by_count ?? 0,
    fwci: w.fwci ?? null,
    pct: w.citation_normalized_percentile?.value ?? null,
    top10: Boolean(w.citation_normalized_percentile?.is_in_top_10_percent),
    topic_id: w.primary_topic?.id ? String(w.primary_topic.id).split('/').pop() : null,
    topics: (w.topics ?? []).map((t) => ({ id: String(t.id).split('/').pop(), name: t.display_name, score: Math.round((t.score ?? 0) * 100) / 100 })),
    keywords,
    keyword_text: keywords.map((k) => k.name).join(' · ') || null,
    companies,
    oa_url: w.open_access?.oa_url ?? null,
    oa_license: loc.license ?? null,
    retracted: Boolean(w.is_retracted),
  }
}

const COLS = ['id', 'doi', 'title', 'abstract', 'journal', 'source_id', 'is_core', 'type', 'published', 'year', 'cited', 'fwci', 'pct', 'top10', 'topic_id', 'topics', 'keywords', 'keyword_text', 'companies', 'oa_url', 'oa_license', 'retracted']
const JSON_COLS = new Set(['topics', 'keywords', 'companies'])

async function upsert(rows) {
  const valid = rows.filter((r) => r.id && r.title)
  if (!valid.length) return 0
  const params = []
  const tuples = valid.map((r) => `(${COLS.map((c) => (params.push(JSON_COLS.has(c) ? JSON.stringify(r[c]) : r[c]), `$${params.length}`)).join(',')})`)
  await query(
    `INSERT INTO papers (${COLS.join(',')}) VALUES ${tuples.join(',')}
     ON CONFLICT (id) DO UPDATE SET ${COLS.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, fetched_at = now()`,
    params,
  )
  return valid.length
}

const topicFilter = () => `primary_topic.id:${DISPLAY_TOPICS.map((t) => t.id).join('|')}`

// from ~ to 기간 논문을 쪽마다 받아 넣는다. 이어 받기용 cursor를 state에 남긴다
async function harvest(job, { from, to, cursor = '*' }, onPage) {
  let next = cursor
  let pages = 0
  let saved = 0
  while (next) {
    const data = await openAlexGet(`/works?filter=${topicFilter()},from_publication_date:${from},to_publication_date:${to}&per-page=${PAGE}&cursor=${encodeURIComponent(next)}&select=${SELECT}`)
    saved += await upsert((data.results ?? []).map(toRow))
    pages += 1
    next = data.meta?.next_cursor ?? null
    await onPage({ cursor: next, pages, saved, total: data.meta?.count ?? null })
    if (Number.isFinite(data.__left) && data.__left < BUDGET_FLOOR) {
      return { stopped: `남은 예산 $${data.__left.toFixed(2)} → 사용자 찾기 몫을 남기려고 멈춤 (내일 이어서)`, cursor: next, pages, saved }
    }
  }
  return { done: true, pages, saved }
}

// ── 상태 · 일정 ──
const run = (globalThis.__paperCorpusRun ??= { busy: false, timer: null })

export async function corpusStatus() {
  const state = await getSetting(STATE_KEY, {})
  if (!dbEnabled()) return { ...state, enabled: false }
  const { rows } = await query(`SELECT count(*)::int AS n, count(abstract)::int AS with_abstract, min(published)::text AS first, max(published)::text AS last FROM papers`)
  return { ...state, enabled: true, busy: run.busy, papers: rows[0].n, withAbstract: rows[0].with_abstract, first: rows[0].first, last: rows[0].last }
}

async function saveState(patch) {
  const now = await getSetting(STATE_KEY, {})
  await setSetting(STATE_KEY, { ...now, ...patch })
}

// 한 번 돌기: 처음 받기가 안 끝났으면 이어서, 끝났으면 날마다 최근 60일 · 일요일엔 최근 3년
export async function runCorpus({ force = null } = {}) {
  if (!dbEnabled() || run.busy) return { skipped: true }
  run.busy = true
  const today = ymd(Date.now())
  try {
    const state = await getSetting(STATE_KEY, {})
    let job
    if (force === 'backfill' || !state.backfillDone) {
      job = { name: 'backfill', from: START_DATE, to: today, cursor: state.backfillCursor ?? '*' }
    } else if (force === 'citations' || (new Date().getUTCDay() === 0 && state.citationsDay !== today)) {
      job = { name: 'citations', from: ymd(Date.now() - 3 * 365 * 86_400_000), to: today, cursor: '*' }
    } else if (force === 'recent' || state.recentDay !== today) {
      job = { name: 'recent', from: ymd(Date.now() - 60 * 86_400_000), to: today, cursor: '*' }
    } else return { skipped: true, reason: '오늘 할 일 없음' }
    await saveState({ phase: job.name, startedAt: new Date().toISOString(), error: null })
    const r = await harvest(job, job, async (p) => {
      if (job.name === 'backfill') await saveState({ backfillCursor: p.cursor, backfillTotal: p.total })
    })
    const patch = { phase: null, lastRun: new Date().toISOString(), lastJob: job.name, lastPages: r.pages, lastSaved: r.saved, stopped: r.stopped ?? null }
    if (r.done && job.name === 'backfill') Object.assign(patch, { backfillDone: today, backfillCursor: null, recentDay: today })
    if (r.done && job.name === 'citations') patch.citationsDay = today
    if (r.done && job.name === 'recent') patch.recentDay = today
    await saveState(patch)
    console.log(`[corpus] ${job.name}: ${r.pages}쪽 · ${r.saved}편${r.stopped ? ` · ${r.stopped}` : ''}`)
    return r
  } catch (err) {
    await saveState({ phase: null, error: err.message, errorAt: new Date().toISOString() }).catch(() => {})
    console.warn(`[corpus] 받기 실패: ${err.message}`)
    return { error: err.message }
  } finally {
    run.busy = false
  }
}

// 서버가 켜지고 3분 뒤, 그 뒤 6시간마다 (처음 받기는 멈춘 곳부터 이어 받음). PAPER_CORPUS=off면 안 함
export function startCorpus() {
  if (process.env.PAPER_CORPUS === 'off' || !dbEnabled()) return
  clearTimeout(run.timer)
  const tick = () => {
    runCorpus().finally(() => {
      run.timer = setTimeout(tick, 6 * 3600_000)
    })
  }
  run.timer = setTimeout(tick, 3 * 60_000)
}

// ── 찾기 ──
// 처음 받기가 끝난 뒤에만 찾기에 쓴다 (받는 중에는 일부만 있어 OpenAlex 검색보다 적게 나옴, 11/10 실측). 5분 기억
let readyCache = { at: 0, value: false }
export async function corpusReady() {
  if (!dbEnabled()) return false
  if (Date.now() - readyCache.at < 5 * 60_000) return readyCache.value
  const state = await getSetting(STATE_KEY, {}).catch(() => ({}))
  readyCache = { at: Date.now(), value: Boolean(state.backfillDone) }
  return readyCache.value
}

// terms: 영문 검색어 (queryTerms.js). 표현 그대로 맞는 것(phrase) 또는 낱말이 모두 든 것(plain)
// 돌려주는 값: 관련도 순서(rank)가 붙은 논문 행 (최대 limit)
export async function searchCorpus(terms, { from, to, limit = 400 } = {}) {
  if (!dbEnabled() || !terms?.length) return []
  const params = []
  const tq = terms
    .map((t) => {
      params.push(t)
      return `phraseto_tsquery('english', $${params.length}) || plainto_tsquery('english', $${params.length})`
    })
    .join(' || ')
  params.push(from, to, limit)
  const n = params.length
  const { rows } = await query(
    `SELECT id, doi, title, abstract, journal, source_id, is_core, type, published::text AS published, cited, fwci, pct, top10,
            topics, keywords, companies, oa_url, oa_license, ts_rank_cd(doc, q, 32) AS rank
       FROM papers, (SELECT (${tq}) AS q) x
      WHERE doc @@ q AND NOT retracted AND published BETWEEN $${n - 2} AND $${n - 1}
      ORDER BY rank DESC LIMIT $${n}`,
    params,
  )
  return rows
}

// ── 논문 점수 (11/10, 0~100) ──
// 관련도 35(결과 안 순위 백분위) · 기업 저자 10(디스플레이 회사 만점, 그 밖의 기업 절반) · 산업 응용 10 · 영향력 20 · 최신성 15 · 전문 학술지 10
// 11/15 팀 회의: 기업 저자 20점은 논문 93%(학계 · 개인 · 소기업, 12만 편 중 기업 저자 6.9%)가 늘 0점이라 응용 연구를 한 학계 논문이 덜 반영됨
//   → 기업 저자 20 → 10, 남은 10은 저자와 상관없이 제목 · 초록의 산업 응용 말(양산 · 공정 · 수율 · 대면적 · 패널 · 수명 · 봉지 …) 1개 5점 · 2개 이상 10점
//   표본 4,000편(2022~, 핵심지): 응용 5점 이상 — 디스플레이 기업 48% · 학계 21% · 그 밖의 기업 27%. 영향력은 올리지 않음(2년 안 된 논문은 인용 정보가 거의 없어 신규성과 반대 — 33 문서)
export const APPLIED_WORDS =
  /\b(mass[- ]production|manufactur\w*|fabrication process|large[- ]area|yield|pilot[- ]line|prototype|commerciali[sz]\w*|commercial|panel|\d+(\.\d+)?[- ]?inch|gen(eration)?[- ]?\d+(\.\d+)?|throughput|low[- ]cost|cost[- ]effective|reliabilit\w*|lifetime|mura|inkjet[- ]print\w*|roll[- ]to[- ]roll|scalab\w*|encapsulat\w*|backplane|driving circuit|module)\b/gi
// 영향력: 2년 넘은 논문은 분야 · 연도 보정 인용 백분위. 2년 안 된 논문은 백분위가 의미 없어(인용 0도 0.68, 11/10 실측) FWCI, 없으면 중간값
export function paperScore2(w, relPct) {
  const ageYears = w.date || w.published ? Math.max(0, (Date.now() - Date.parse(w.date || w.published)) / (365.25 * 86_400_000)) : 3
  const companies = w.companies ?? []
  const maker = companies.find((c) => DISPLAY_MAKERS.test(c.name))
  const impact = ageYears >= 2 && w.pct != null ? w.pct : w.fwci > 0 ? Math.min(1, w.fwci / 3) : 0.5
  const venue = w.displayJournal || DISPLAY_SOURCE.has(w.source_id) ? 1 : w.is_core ? 0.5 : 0
  const parts = {
    relevance: Math.round(35 * relPct),
    company: maker ? 10 : companies.length ? 5 : 0,
    applied: Math.min(10, 5 * new Set([...`${w.title ?? ''} ${w.abstract ?? ''}`.matchAll(APPLIED_WORDS)].map((m) => m[0].toLowerCase())).size),
    impact: Math.round(20 * impact),
    recency: Math.round(15 * Math.exp(-ageYears / 3)),
    journal: Math.round(10 * venue),
  }
  const score = Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0))
  return {
    score,
    parts: { ...parts, cited: w.cited ?? 0, fwciValue: w.fwci ?? null, pctValue: w.pct ?? null, top10: Boolean(w.top10), companies: companies.map((c) => c.name).slice(0, 4), maker: maker?.name ?? null, appliedWords: [...new Set([...`${w.title ?? ''} ${w.abstract ?? ''}`.matchAll(APPLIED_WORDS)].map((m) => m[0].toLowerCase()))].slice(0, 3) },
  }
}
