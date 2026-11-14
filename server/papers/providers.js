// 논문 출처 4곳 (23 문서 「논문 출처」, 확인 2026-11-08). 순서대로 쓰고, 막히면 다음 곳으로 (index.js)
import { reportSource } from '../sourceGuard.js'
// 모든 출처는 같은 모양의 논문을 돌려준다:
//   { title, doi, url, abstract, journal, date(YYYY-MM-DD), cited, provider }
// 요청 모양 (search):
//   { sources: [{ openalex, issn, name }], topics: [{ id, words }], query, from, to, sort: 'date'|'cited', limit, types }
// - 한도에 걸리면 LimitedError(until)를 던진다 → index.js가 그 출처를 until까지 쉬게 하고 다음 출처로
// - 이 출처가 그 요청을 못 하면(예: arXiv에 학술지 거르기 없음) UnsupportedError → 쉬게 하지 않고 다음으로
const UA = 'techbrief/0.1 (university team project; display tech briefing)'
const TIMEOUT_MS = 25_000
const DAY = 86_400_000

export class LimitedError extends Error {
  constructor(message, until) {
    super(message)
    this.name = 'LimitedError'
    this.until = until // ms
  }
}
export class UnsupportedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UnsupportedError'
  }
}

// 다음 00:00 UTC (= 한국 09:00). OpenAlex 하루 예산이 다시 차는 시각
export function nextUtcMidnight(now = Date.now()) {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

// 출처마다 요청 간격을 지킨다 (Vite가 서버를 다시 올려도 같은 줄을 쓰도록 globalThis)
const gates = (globalThis.__paperGates ??= {})
async function paced(id, gapMs, fn) {
  const prev = gates[id] ?? Promise.resolve()
  let release
  gates[id] = new Promise((r) => (release = r))
  await prev
  try {
    const out = await fn()
    reportSource(id, { ok: true })
    return out
  } catch (err) {
    // 호출 수 · 실패만 센다 (쉬는 시간은 이 파일의 LimitedError가 관리, sourceGuard는 restMs 없음)
    reportSource(id, { ok: false, status: err.status ?? 'network', error: err.message })
    throw err
  } finally {
    setTimeout(release, gapMs)
  }
}

// 공통: 429 · 5xx · 시간 초과를 LimitedError로 바꾼다. backoffMs는 출처별 기본 쉬는 시간
async function httpGet(url, { headers = {}, backoffMs = 15 * 60_000 } = {}) {
  let res
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? '응답 시간 초과' : `연결 실패 (${err.message})`
    throw new LimitedError(msg, Date.now() + 5 * 60_000)
  }
  if (res.status === 429 || res.status >= 500) {
    const retry = Number(res.headers.get('retry-after'))
    const until = Date.now() + (Number.isFinite(retry) && retry > 0 ? retry * 1000 : res.status === 429 ? backoffMs : 5 * 60_000)
    const body = await res.text().catch(() => '')
    throw Object.assign(new LimitedError(res.status === 429 ? '요청 한도 (429)' : `응답 ${res.status}`, until), { status: res.status, body, headers: res.headers })
  }
  if (!res.ok) throw Object.assign(new Error(`응답 ${res.status}`), { status: res.status })
  return res
}

export const clean = (s) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10)
export const bareDoi = (d) => (d ? String(d).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').toLowerCase() : '')
const topicRegex = (topics) => {
  const words = (topics ?? []).flatMap((t) => t.words ?? [])
  // 낱말 경계를 지킨다 ("OLED"가 "cooled"에 맞지 않게, 실측 11/08)
  return words.length ? new RegExp(`\\b(?:${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]?')).join('|')})s?\\b`, 'i') : null
}

// OpenAlex 초록은 단어 → 위치 목록(abstract_inverted_index)으로 온다. 위치 순서로 다시 잇는다
export function abstractFromIndex(index) {
  if (!index) return ''
  const words = []
  for (const [w, positions] of Object.entries(index)) for (const p of positions) words[p] = w
  return words.filter(Boolean).join(' ')
}

// ── 1. OpenAlex (키 OPENALEX_API_KEY, 무료 하루 $1 · 키 없으면 같은 IP 공용 $0.10, 00:00 UTC에 다시 참) ──
// 실측 2026-11-08: 목록·필터 1회 $0.0001, 검색(title_and_abstract.search)·검색+group_by $0.001, autocomplete $0
// 응답 머리글 X-RateLimit-Remaining-USD로 남은 예산을 보고, 거의 다 쓰면 미리 쉬게 한다
const OA = 'https://api.openalex.org'
export async function openAlexGet(pathAndQuery) {
  const key = process.env.OPENALEX_API_KEY
  const mail = process.env.PAPER_CONTACT_EMAIL
  const sep = pathAndQuery.includes('?') ? '&' : '?'
  const url = `${OA}${pathAndQuery}${key ? `${sep}api_key=${encodeURIComponent(key)}` : mail ? `${sep}mailto=${encodeURIComponent(mail)}` : ''}`
  return paced('openalex', 150, async () => {
    let res
    try {
      res = await httpGet(url, { backoffMs: 2 * 60_000 })
    } catch (err) {
      if (err.status === 429) {
        // 「Plan upgrade required」(유료 기능, 예: created_date 정렬)도 429로 온다 → 한도가 아니라 오류
        if (/plan upgrade/i.test(err.body ?? '')) throw new Error('OpenAlex 유료 기능이라 쓸 수 없어요')
        const left = Number(err.headers?.get('x-ratelimit-remaining-usd'))
        if (!Number.isFinite(left) || left < 0.002) throw new LimitedError('OpenAlex 하루 예산을 다 썼어요', nextUtcMidnight())
      }
      throw err
    }
    const data = await res.json()
    const left = Number(res.headers.get('x-ratelimit-remaining-usd'))
    // 남은 예산이 검색 2번 값보다 적으면 다음부터는 쉬게 한다 (이번 응답은 쓴다)
    if (Number.isFinite(left) && left < 0.002) data.__exhausted = nextUtcMidnight()
    if (Number.isFinite(left)) Object.defineProperty(data, '__left', { value: left }) // 남은 하루 예산 (논문 DB 받기가 사용자 몫을 남기려고 봄)
    return data
  })
}

function oaWork(w) {
  const loc = w.primary_location ?? {}
  return {
    title: clean(w.title ?? w.display_name),
    doi: bareDoi(w.doi),
    url: w.doi || loc.landing_page_url || w.id,
    abstract: abstractFromIndex(w.abstract_inverted_index),
    journal: loc.source?.display_name ?? '',
    date: w.publication_date ?? '',
    cited: w.cited_by_count ?? 0,
    fwci: w.fwci ?? null,
    topic: w.primary_topic ? { id: w.primary_topic.id.split('/').pop(), name: w.primary_topic.display_name } : null,
    oaUrl: w.open_access?.oa_url ?? null, // 무료로 볼 수 있는 원문 주소 (나중에 전문 분석에 씀)
    // 유료 여부 (11/14, 보고서팀 작업 이식): OpenAlex가 오픈 액세스라고 하면 open, 아니라고 하면 paid, 정보가 없으면 unknown
    access: w.open_access ? (w.open_access.is_oa ? 'open' : 'paid') : 'unknown',
    authors: (w.authorships ?? []).map((a) => a.author?.display_name).filter(Boolean).slice(0, 6),
    // 11/10 논문 점수(corpus.js paperScore2)용: 인용 백분위 · 기업 저자 · 학술지 (같은 비용으로 받음)
    pct: w.citation_normalized_percentile?.value ?? null,
    top10: Boolean(w.citation_normalized_percentile?.is_in_top_10_percent),
    source_id: loc.source?.id ? String(loc.source.id).split('/').pop() : null,
    is_core: Boolean(loc.source?.is_core),
    retracted: Boolean(w.is_retracted),
    keywords: (w.keywords ?? []).map((k) => ({ name: k.display_name, score: k.score })),
    companies: [...new Map((w.authorships ?? []).flatMap((a) => a.institutions ?? []).filter((i) => i.type === 'company').map((i) => [String(i.display_name).replace(/\s*\([^)]*\)\s*$/, ''), { name: String(i.display_name).replace(/\s*\([^)]*\)\s*$/, ''), country: i.country_code ?? null }])).values()],
    provider: 'openalex',
  }
}

const openalex = {
  id: 'openalex',
  name: 'OpenAlex',
  canCount: true,
  async search(req) {
    const f = [`from_publication_date:${req.from}`, `to_publication_date:${req.to}`]
    if (req.sources?.length) f.push(`primary_location.source.id:${req.sources.map((s) => s.openalex).join('|')}`)
    if (req.topics?.length) f.push(`primary_topic.id:${req.topics.map((t) => t.id).join('|')}`)
    f.push(`type:${(req.types ?? ['article']).join('|')}`)
    // 검색어는 search.title_and_abstract 매개변수로 (11/09: 예전 filter 방식보다 관련도순 정렬이 됨, 검색 1회 $0.001)
    const search = req.query ? `&search.title_and_abstract=${encodeURIComponent(req.query)}` : ''
    // sort: 'relevance'(검색어가 있을 때만, 관련도순) · 'cited' · 'date'
    const sort = req.sort === 'relevance' && req.query ? '' : `&sort=${req.sort === 'cited' ? 'cited_by_count:desc' : 'publication_date:desc'}`
    const select = 'id,doi,title,publication_date,primary_location,cited_by_count,fwci,primary_topic,abstract_inverted_index,open_access,citation_normalized_percentile,authorships,keywords,is_retracted'
    // 한 쪽 최대 100편 (OpenAlex 공식, 200은 없앨 예정 · 2026-11-09 확인)
    const data = await openAlexGet(`/works?filter=${f.join(',')}${search}${sort}&per-page=${Math.min(req.limit ?? 50, 100)}&select=${select}`)
    return Object.assign((data.results ?? []).map(oaWork), { exhausted: data.__exhausted })
  },
  // 기간 안 논문 수 (제목·초록에 그 말이 그대로 있는 것). 검색이라 1회 $0.001
  async count(term, from, to) {
    const data = await openAlexGet(`/works?filter=title_and_abstract.search:${encodeURIComponent(`"${term}"`)},from_publication_date:${from},to_publication_date:${to}&per-page=1&select=id`)
    return Object.assign({ value: data.meta?.count ?? 0 }, { exhausted: data.__exhausted })
  },
  // 13개월을 한 번에: 200편 이하이면 날짜 목록 한 번으로 달마다 센다 (그 이상이면 null → 달마다 count)
  async countDates(term, from, to) {
    const data = await openAlexGet(`/works?filter=title_and_abstract.search:${encodeURIComponent(`"${term}"`)},from_publication_date:${from},to_publication_date:${to}&per-page=200&select=publication_date`)
    if ((data.meta?.count ?? 0) > 200) return { dates: null, exhausted: data.__exhausted }
    return { dates: (data.results ?? []).map((w) => w.publication_date).filter(Boolean), exhausted: data.__exhausted }
  },
}

// ── 2. Crossref (키 없음. 공용 풀은 실측 1초 1회 · 동시 1개, 2026-11-08 응답 머리글) ──
// 주제(topic) 거르기가 없어서 주제 낱말로 검색한 뒤 제목·초록을 한 번 더 거른다. 논문 수 세기는 안 함 (검색이 낱말 아무거나 맞춰 수가 부풀어서)
const crossref = {
  id: 'crossref',
  name: 'Crossref',
  canCount: false,
  async search(req) {
    const mail = process.env.PAPER_CONTACT_EMAIL
    const issns = (req.sources ?? []).map((s) => s.issn).filter(Boolean)
    const filters = [`from-pub-date:${req.from}`, `until-pub-date:${req.to}`, 'type:journal-article', 'type:proceedings-article', ...issns.map((i) => `issn:${i}`)]
    const words = (req.topics ?? []).flatMap((t) => t.words ?? []).slice(0, 12)
    const q = req.query || words.join(' ')
    const params = new URLSearchParams({
      filter: filters.join(','),
      sort: req.sort === 'cited' ? 'is-referenced-by-count' : req.sort === 'relevance' && q ? 'score' : 'published',
      order: 'desc',
      rows: String(Math.min(req.limit ?? 50, 100)),
      select: 'DOI,title,abstract,container-title,published,URL,is-referenced-by-count',
    })
    if (q) params.set('query.bibliographic', q)
    if (mail) params.set('mailto', mail)
    const res = await paced('crossref', 1100, () => httpGet(`https://api.crossref.org/works?${params}`, { backoffMs: 10 * 60_000 }))
    const items = (await res.json()).message?.items ?? []
    const re = topicRegex(req.topics)
    return items
      .map((w) => {
        const p = w.published?.['date-parts']?.[0] ?? []
        return {
          title: clean(w.title?.[0]),
          doi: bareDoi(w.DOI),
          url: w.DOI ? `https://doi.org/${w.DOI}` : w.URL || '',
          abstract: clean(w.abstract).replace(/^Abstract\s*/i, ''),
          journal: clean(w['container-title']?.[0]),
          date: p.length ? ymd(Date.UTC(p[0], (p[1] ?? 1) - 1, p[2] ?? 1)) : '',
          cited: w['is-referenced-by-count'] ?? 0,
          provider: 'crossref',
        }
      })
      .filter((w) => !re || re.test(`${w.title} ${w.abstract}`))
  },
}

// ── 3. Semantic Scholar (키 SEMANTIC_SCHOLAR_API_KEY 있으면 1초 1회. 키 없으면 모든 사용자 공용 풀이라 429가 잦음, 2026-11-08 실측 429) ──
// 약관: 화면이나 자료에 「Semantic Scholar」 출처 표시 필요
const S2 = 'https://api.semanticscholar.org/graph/v1/paper/search/bulk'
async function s2Get(params) {
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY
  const res = await paced('semanticscholar', 1100, () => httpGet(`${S2}?${params}`, { headers: key ? { 'x-api-key': key } : {}, backoffMs: 10 * 60_000 }))
  return res.json()
}
const semanticscholar = {
  id: 'semanticscholar',
  name: 'Semantic Scholar',
  canCount: true,
  async search(req) {
    const words = (req.topics ?? []).flatMap((t) => t.words ?? [])
    const q = req.query || words.map((w) => (w.includes(' ') ? `"${w}"` : w)).join(' | ')
    if (!q) throw new UnsupportedError('검색어 없이 학술지로만 거르기는 Semantic Scholar에서 안 해요')
    const params = new URLSearchParams({
      query: q,
      publicationDateOrYear: `${req.from}:${req.to}`,
      fields: 'title,abstract,venue,publicationDate,externalIds,citationCount,url',
      sort: req.sort === 'date' ? 'publicationDate:desc' : 'citationCount:desc', // bulk 검색에는 관련도순이 없어 인용순으로
    })
    const venues = (req.sources ?? []).map((s) => s.name).filter(Boolean)
    if (venues.length) params.set('venue', venues.join(','))
    const data = await s2Get(params)
    return (data.data ?? []).slice(0, req.limit ?? 50).map((p) => ({
      title: clean(p.title),
      doi: bareDoi(p.externalIds?.DOI),
      url: p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : p.url,
      abstract: clean(p.abstract),
      journal: p.venue ?? '',
      date: p.publicationDate ?? '',
      cited: p.citationCount ?? 0,
      provider: 'semanticscholar',
    }))
  },
  async count(term, from, to) {
    const data = await s2Get(new URLSearchParams({ query: `"${term}"`, publicationDateOrYear: `${from}:${to}`, fields: 'paperId' }))
    return { value: data.total ?? 0 }
  },
}

// 초록이 빈 논문을 DOI로 Semantic Scholar에서 한 번에 채운다 (11/09 조장: 찾을 때마다 초록을 보여 주고 싶음)
// OpenAlex는 일부 출판사(엘스비어 등) 초록을 주지 않는다 (11/09 실측: WOLED 100편 중 9편 빔)
// 요청 1번(최대 500편). 키가 없으면 공용 풀이라 막힐 수 있음 → 실패하면 그냥 비워 둔다. 약관상 「Semantic Scholar」 출처 표시
export async function s2Abstracts(dois) {
  const ids = [...new Set(dois.filter(Boolean))].slice(0, 500)
  if (!ids.length) return new Map()
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY
  try {
    const res = await paced('semanticscholar', 1100, () =>
      fetch('https://api.semanticscholar.org/graph/v1/paper/batch?fields=abstract,externalIds', {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/json', ...(key ? { 'x-api-key': key } : {}) },
        body: JSON.stringify({ ids: ids.map((d) => `DOI:${d}`) }),
        signal: AbortSignal.timeout(8_000),
      }),
    )
    if (!res.ok) return new Map()
    const out = new Map()
    for (const p of await res.json()) {
      const doi = bareDoi(p?.externalIds?.DOI)
      if (doi && p.abstract) out.set(doi, clean(p.abstract))
    }
    return out
  } catch {
    return new Map()
  }
}

// ── 4. arXiv (키 없음. 3초에 1번 · 연결 1개, 메타데이터 CC0. 학술지 논문이 아니라 프리프린트) ──
const ARXIV = 'https://export.arxiv.org/api/query'
const arxivDate = (s, end) => `${s.replace(/-/g, '')}${end ? '2359' : '0000'}`
async function arxivGet(searchQuery, extra = {}) {
  const params = new URLSearchParams({ search_query: searchQuery, ...extra })
  const res = await paced('arxiv', 3100, () => httpGet(`${ARXIV}?${params}`, { backoffMs: 30 * 60_000 }))
  return res.text()
}
const arxiv = {
  id: 'arxiv',
  name: 'arXiv',
  canCount: true,
  async search(req) {
    const words = req.query ? [req.query] : (req.topics ?? []).flatMap((t) => t.words ?? [])
    if (!words.length || !req.allowPreprints) throw new UnsupportedError('arXiv는 학술지 논문이 아니라 프리프린트라 이 요청에는 안 써요')
    const terms = words.slice(0, 8).map((w) => `abs:"${w}"`).join(' OR ')
    const xml = await arxivGet(`(${terms}) AND submittedDate:[${arxivDate(req.from)} TO ${arxivDate(req.to, true)}]`, {
      sortBy: 'submittedDate',
      sortOrder: 'descending',
      max_results: String(Math.min(req.limit ?? 50, 100)),
    })
    // arXiv 검색은 엉뚱한 글도 섞어 준다 (실측: 수학 논문) → 주제 낱말이 제목·초록에 있는 것만
    const re = topicRegex(req.query ? [{ words: [req.query] }] : req.topics)
    return xml
      .split('<entry>')
      .slice(1)
      .map((e) => {
        const tag = (t) => e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? ''
        const doi = tag('arxiv:doi')
        return {
          title: clean(tag('title')),
          doi: bareDoi(doi),
          url: clean(tag('id')),
          abstract: clean(tag('summary')),
          journal: 'arXiv (프리프린트)',
          date: tag('published').slice(0, 10),
          cited: 0,
          provider: 'arxiv',
        }
      })
      .filter((w) => !re || re.test(`${w.title} ${w.abstract}`))
  },
  async count(term, from, to) {
    // max_results=0이면 500을 준다 (2026-11-08 실측) → 1
    const xml = await arxivGet(`abs:"${term}" AND submittedDate:[${arxivDate(from)} TO ${arxivDate(to, true)}]`, { max_results: '1' })
    return { value: Number(xml.match(/<opensearch:totalResults[^>]*>(\d+)/)?.[1] ?? 0) }
  },
}

// 이 순서대로 쓴다 (조장 11/07: OpenAlex가 막히면 다음, 그것도 막히면 그다음)
export const PROVIDERS = [openalex, crossref, semanticscholar, arxiv]
export { DAY }
