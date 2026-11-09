// 기술 트렌드 (25 문서, 11/07 조장 결정): 대시보드 첫 줄 「요즘 뜨는 기술」
// 1. 후보 찾기 (세 갈래, 11/07 조장 결정) — 기사 수는 순위 점수에 넣지 않는다 (담당자 "기사 많음 ≠ 중요")
//    ① 검색: 네이버 검색광고 키워드 도구의 연관 검색어 (키가 있으면) ② 논문: OpenAlex 디스플레이 논문 키워드 중 새로 뜬 것 (신규성)
//    ③ 기사: 모은 기사 제목에서 AI가 기술 용어 뽑기 (보조)
//    → 모은 용어를 AI가 한 번 더 검토해 제품명·일반어는 숨기고, 논문·특허용 영어 검색어를 정한다
// 2. 신호 받기: 후보 용어마다 출처 5곳의 추이를 하루 한 번 받아 둔다
//    네이버 검색량(관심, 일별) · Wikipedia 조회수(관심, 일별) · Reddit 글 수(현장 반응, 일별) · 논문 수(OpenAlex, 월별) · 특허 공개(BigQuery, 월별)
// 3. 순위: 요청한 기간(이번 주·지난주·이번 달·직접)과 바로 전 같은 길이 기간을 비교해 출처마다 순위, 출처별 순위를 합쳐 종합 순위
// 바깥 API는 실패하면 지난 값을 그대로 쓰고 받은 시각을 함께 보낸다 (trends.js와 같은 원칙)
import { dbEnabled, query } from './db/index.js'
import { getKeywords, getSetting, setSetting } from './db/store.js'
import { chatJson, PRIORITY, PreemptedError } from './llm/client.js'
import { countPatentsFor } from './patents.js'
import { flushValues, keepValue, latestValues } from './trendHistory.js'
import { countMonthly, countRecent, forceLimit, isLimited, LimitedError, openAlexGet as papersOpenAlexGet } from './papers/index.js'

const KEY = 'tech_trends'
const DAY = 86_400_000
const UA = 'techbrief/0.1 (university team project; tech trend dashboard)'
const MAX_TERMS = 150 // 안전 상한 (네이버 하루 1,000회 · OpenAlex 하루 $1 = 검색 약 1,000회 안, 논문 수는 캐시로 용어당 하루 2~3회). 기사 수로 자르지 않는다
const MIN_ARTICLES = 2 // 기사 갈래 용어는 최근 60일 기사 2건 이상 (한 번 스친 말 거르기)
const HISTORY_DAYS = 120
const BATCH = 40 // AI에게 한 번에 주는 기사 제목 수
const CYCLE_MS = 24 * 3600_000
const REDDIT_GAP_MS = 75_000 // Reddit은 같은 IP에서 1분에 1번도 자주 막힘
const CATEGORIES = ['패널·디스플레이 기술', '공정·장비', '소재·부품', '응용 제품']

export const SOURCES = [
  { id: 'naver', label: '네이버 검색량', axis: '관심', unit: '', daily: true, smooth: 5, min: 10, note: '네이버 데이터랩 · 용어마다 그 기간 최대 100' },
  { id: 'wiki', label: 'Wikipedia 조회수', axis: '관심', unit: '회', daily: true, smooth: 30, min: 50, note: '영문 Wikipedia 문서 조회수' },
  { id: 'reddit', label: 'Reddit 글 수', axis: '현장 반응', unit: '건', daily: true, smooth: 1, min: 3, note: 'Reddit 검색 RSS · 최신 100건씩 쌓음' },
  { id: 'openalex', label: '논문 수', axis: '연구', unit: '편', daily: false, smooth: 1, min: 3, note: 'OpenAlex(막히면 Semantic Scholar · arXiv) · 제목·초록 · 월별 · 하루 한 번' },
  { id: 'patents', label: '특허 공개 건수', axis: '개발·투자', unit: '건', daily: false, smooth: 2, min: 5, note: 'Google Patents · 영문 제목 · 월별 (공개까지 약 18개월 늦음)' },
]

const status = { running: false, phase: null, startedAt: null, finishedAt: null }
// 진행 단계를 DB에도 남겨, 다른 사본이 받은 화면 요청에서도 「지금 갱신 중: …」을 보여 준다
async function setPhase(phase) {
  status.phase = phase
  if (state) {
    state.progress = phase ? { phase, startedAt: status.startedAt, at: new Date().toISOString() } : null
    await save()
  }
}

// ── 저장 상태 (app_settings 한 줄) ──
// 갱신 중인 사본은 자기 state를 쓰고, 그 밖에는 매번 DB에서 다시 읽는다
// (머지·코드 수정으로 Vite가 서버를 같은 프로세스 안에서 다시 올리면 모듈 사본이 여러 개 생김 — 11/07 실제로 화면이 옛 값을 보여 줌)
let state = null
async function load({ fresh = false } = {}) {
  // 새로 읽을 때 state를 먼저 비우지 않는다: 동시에 부른 다른 요청이 비어 있는 state를 읽어 멈췄음
  // (11/09: 기사 중요도 계산 scoreContext가 함께 부르면서 /api/tech-trends 502 「reading 'terms'」)
  if (fresh && !status.running) state = (await getSetting(KEY, null)) ?? {}
  else state ??= (await getSetting(KEY, null)) ?? {}
  state.terms ??= {} // key → { name, en, category, aliases[], articles{id: day} }
  state.series ??= {} // source → key → { series[{t,v}], at, error?, errorAt? }
  state.reddit ??= {} // key → { posts{id: day}, since }
  state.runs ??= {} // source → 마지막으로 돈 시각
  return state
}
async function save() {
  await setSetting(KEY, state).catch((err) => console.warn(`[techtrends] 저장 실패: ${err.message}`))
  await flushValues()
}

const keyOf = (s) => String(s ?? '').toLowerCase().replace(/[\s·\-_/]+/g, '')
const ymd = (d) => new Date(d).toISOString().slice(0, 10)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clean = (t) => String(t ?? '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').trim()

// ── 1. 용어 찾기 (AI) ──
const TERM_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          name: { type: 'string' },
          en: { type: 'string' },
          category: { type: 'string', enum: [...CATEGORIES, '해당 없음'] },
          tech: { type: 'boolean' },
          titles: { type: 'array', items: { type: 'integer' } },
        },
        required: ['term', 'name', 'en', 'category', 'tech', 'titles'],
      },
    },
  },
  required: ['items'],
}

function termPrompt(titles) {
  return [
    {
      role: 'system',
      content:
        '너는 디스플레이 산업 기술 동향 분석가다. 기사 제목들에서 「디스플레이 산업의 기술 트렌드로 볼 만한 기술 용어」만 뽑는다.\n' +
        '- 디스플레이 패널·소재·부품·장비·공정, 디스플레이를 쓰는 기기와 직접 관련된 것만. 배터리·자동차 반도체·일반 AI·에너지 등 다른 산업 기술은 tech=false\n' +
        '- 약어와 그 약어가 들어간 더 구체적인 말이 같이 나오면 구체적인 말 하나만 (예: AR과 AR 글래스 → AR 글래스)\n' +
        '- 특정 회사 제품 이름(아이패드 미니, 갤럭시 Z 폴드7, 아이폰 등)과 AI·TV·스마트폰·반도체 같은 넓은 말은 tech=false\n' +
        '- 뽑는 것: 디스플레이 방식·패널 기술(예: QD-OLED, 탠덤 OLED, LTPO, 마이크로LED), 공정·장비(잉크젯 프린팅, 증착, 레이저 전사), 소재·부품(OCA, 퀀텀닷, UTG), 새 응용 제품군(AR 글래스, 차량용 디스플레이, OLED 모니터)\n' +
        '- 버리는 것(tech=false): 회사·기관·사람·지역 이름, 쇼핑 행사·할인·가격, 정책·예산, 실적·주가, 「디스플레이」「기술」「패널」「제품」 같은 너무 일반적인 말\n' +
        '- name: 한국에서 통용되는 대표 표기 하나 (같은 기술의 다른 표기는 합친다. 예: 퀀텀닷·양자점 → 퀀텀닷, 마이크로 LED → 마이크로LED)\n' +
        '- en: 영어 표기. 영문 Wikipedia 문서가 있으면 그 문서 제목 그대로 (예: MicroLED, Quantum dot display, Ultra-thin glass)\n' +
        '- titles: 그 용어가 나온 제목 번호들',
    },
    { role: 'user', content: titles.map((t, i) => `${i + 1}. ${t}`).join('\n') },
  ]
}

function upsertTerm(item, articleDays = [], from = 'article') {
  const k = keyOf(item.name)
  if (!k || k.length < 2) return
  // 다른 표기로 이미 있는 용어면 거기에 합친다 (이름 · 영어 · 원문 표기)
  const found =
    state.terms[k] ? k : Object.keys(state.terms).find((x) => [keyOf(state.terms[x].en), ...(state.terms[x].aliases ?? []).map(keyOf)].some((a) => a && (a === k || a === keyOf(item.en) || a === keyOf(item.term))))
  const key = found ?? k
  const t = (state.terms[key] ??= { name: item.name.trim(), en: item.en.trim(), category: item.category, aliases: [], articles: {}, firstSeen: ymd(Date.now()) })
  for (const a of [item.term, item.name, item.en]) if (a && !t.aliases.includes(a.trim())) t.aliases.push(a.trim())
  t.aliases = t.aliases.slice(0, 8)
  for (const [id, day] of articleDays) t.articles[id] = day
  t.from = [...new Set([...(t.from ?? ['article']), from])]
  return t
}

// 아직 안 본 기사 제목을 BATCH개씩 AI에게 보낸다. 사람 요청이 오면 자리를 내주고 다음에 이어서 한다
async function extractTerms(limit = 400) {
  if (!dbEnabled()) return 0
  const since = state.extractedUntil ?? new Date(Date.now() - 60 * DAY).toISOString()
  const { rows } = await query(
    `SELECT id, title, published_at, collected_at FROM articles WHERE collected_at > $1 ORDER BY collected_at LIMIT $2`,
    [since, limit],
  )
  let done = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    let data
    try {
      ;({ data } = await chatJson({ messages: termPrompt(batch.map((r) => clean(r.title))), schema: TERM_SCHEMA, schemaName: 'tech_terms', priority: PRIORITY.BACKGROUND, timeoutMs: 180_000 }))
    } catch (err) {
      if (!(err instanceof PreemptedError)) console.warn(`[techtrends] 용어 찾기 실패: ${err.message}`)
      break // 다음 차례에 같은 기사부터 다시
    }
    for (const item of data.items ?? []) {
      if (!item.tech || !CATEGORIES.includes(item.category)) continue
      const days = (item.titles ?? []).map((n) => batch[n - 1]).filter(Boolean).map((r) => [r.id, ymd(r.published_at)])
      if (days.length) upsertTerm(item, days)
    }
    state.extractedUntil = new Date(batch.at(-1).collected_at).toISOString()
    done += batch.length
    await save()
  }
  // 60일 지난 기사 기록은 지운다
  const cut = ymd(Date.now() - 60 * DAY)
  for (const t of Object.values(state.terms)) for (const [id, day] of Object.entries(t.articles)) if (day < cut) delete t.articles[id]
  return done
}

// 후보: 검색·논문 갈래에서 온 용어 전부 + 기사 갈래는 2건 이상 + 자동 수집 키워드. AI 검토에서 숨긴 용어는 뺀다
// 순서(상한에 걸릴 때만 의미): 자동 수집 키워드 → 검색·논문 갈래 → 최근에 처음 보인 용어
async function candidates() {
  const forced = new Set((dbEnabled() ? await getKeywords() : []).map(keyOf))
  const ok = ([k, t]) => !t.hidden && (forced.has(k) || (t.from ?? []).some((f) => f !== 'article') || Object.keys(t.articles).length >= MIN_ARTICLES)
  const rank = ([k, t]) => (forced.has(k) ? 0 : (t.from ?? []).some((f) => f !== 'article') ? 1 : 2)
  return Object.entries(state.terms)
    .filter(ok)
    .sort((a, b) => rank(a) - rank(b) || String(b[1].firstSeen).localeCompare(String(a[1].firstSeen)))
    .slice(0, MAX_TERMS)
    .map(([k]) => k)
}

// ── AI 검토: 처음 본 용어를 한 번 더 보고 제품명·일반어를 숨기고, 논문·특허용 영어 검색어를 정한다 ──
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          keep: { type: 'boolean' },
          reason: { type: 'string' },
          query_en: { type: 'string' },
        },
        required: ['name', 'keep', 'reason', 'query_en'],
      },
    },
  },
  required: ['items'],
}

async function reviewTerms() {
  const todo = Object.entries(state.terms).filter(([, t]) => !t.reviewed)
  for (let i = 0; i < todo.length; i += 60) {
    const batch = todo.slice(i, i + 60)
    let data
    try {
      ;({ data } = await chatJson({
        messages: [
          {
            role: 'system',
            content:
              '디스플레이 산업 기술 트렌드 대시보드에 올릴 용어 목록이다. 용어마다 판단하라.\n' +
              '- keep=false: 특정 회사 제품 이름(아이패드 미니, 아이폰 듀오, 갤럭시 Z 폴드7 등), 너무 넓은 말(AI, TV, 스마트폰, 반도체, 디스플레이, 터치스크린, 레이저, 증착처럼 분야 전체를 가리키는 말), 디스플레이와 무관한 기술\n' +
              '- keep=true: 디스플레이 패널 방식·소재·부품·공정·장비, 디스플레이를 쓰는 새 기기 범주(AR 글래스, 차량용 디스플레이 등)처럼 트렌드로 볼 만한 구체적인 기술\n' +
              '- query_en: 논문·특허 제목에서 이 기술을 찾을 영어 검색어 하나 (약어가 널리 쓰이면 약어. 예: QD-OLED, micro LED, optically clear adhesive). keep=false면 빈 문자열\n' +
              '- reason: 한 줄',
          },
          { role: 'user', content: batch.map(([, t]) => `${t.name} (${t.en}, ${t.category})`).join('\n') },
        ],
        schema: REVIEW_SCHEMA,
        schemaName: 'term_review',
        priority: PRIORITY.BACKGROUND,
        timeoutMs: 180_000,
      }))
    } catch (err) {
      if (!(err instanceof PreemptedError)) console.warn(`[techtrends] 용어 검토 실패: ${err.message}`)
      return
    }
    const byName = new Map((data.items ?? []).map((x) => [keyOf(x.name.replace(/\s*\(.*$/, '')), x]))
    for (const [k, t] of batch) {
      const r = byName.get(keyOf(t.name)) ?? byName.get(k)
      if (!r) continue
      t.reviewed = true
      t.hidden = !r.keep
      t.reviewNote = r.reason
      t.query = r.keep ? r.query_en.trim() : ''
    }
    await save()
  }
}

// ── 후보 갈래 ② 논문 신규성: OpenAlex 디스플레이 논문 키워드를 최근 6개월과 그 전 6개월로 비교 (일주일에 한 번) ──
const PAPER_QUERY = 'OLED OR microLED OR "micro LED" OR "quantum dot display" OR microdisplay OR "display panel" OR "flexible display"'
const PAPER_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          name: { type: 'string' },
          en: { type: 'string' },
          category: { type: 'string', enum: [...CATEGORIES, '해당 없음'] },
          tech: { type: 'boolean' },
        },
        required: ['keyword', 'name', 'en', 'category', 'tech'],
      },
    },
  },
  required: ['items'],
}

// OpenAlex는 server/papers를 거쳐 부른다: 키 · 요청 간격 · 하루 예산(쉬는 중이면 바로 오류)을 한 곳에서 관리
async function openAlexGet(path) {
  if (await isLimited('openalex')) throw new Error('OpenAlex 하루 예산 도달 (다음 00:00 UTC = 한국 09:00에 풀림)')
  try {
    const data = await papersOpenAlexGet(path)
    if (data.__exhausted) await forceLimit('openalex', data.__exhausted, '하루 예산을 거의 다 씀')
    return data
  } catch (err) {
    if (err instanceof LimitedError) await forceLimit('openalex', err.until, err.message)
    throw err
  }
}

async function discoverPapers() {
  const apiKey = process.env.OPENALEX_API_KEY
  if (!apiKey) return
  const last = state.runs.discoverPapers ? Date.now() - Date.parse(state.runs.discoverPapers) : Infinity
  if (last < 7 * DAY) return
  const today = ymd(Date.now())
  const mid = ymd(Date.now() - 182 * DAY)
  const start = ymd(Date.now() - 364 * DAY)
  const group = async (from, to) =>
    (await openAlexGet(`/works?filter=title_and_abstract.search:${encodeURIComponent(PAPER_QUERY)},from_publication_date:${from},to_publication_date:${to}&group_by=keywords.id`)).group_by ?? []
  const prev = new Map((await group(start, mid)).map((g) => [g.key_display_name, g.count]))
  const cur = await group(mid, today)
  const totPrev = [...prev.values()].reduce((a, b) => a + b, 0) || 1
  const totCur = cur.reduce((a, g) => a + g.count, 0) || 1
  // 비중이 1.5배 이상 늘었거나 그 전 상위 200에 없던 키워드 (상위 200만 주므로 「없음」은 「200위 밖」일 수 있음)
  const rising = cur
    .filter((g) => g.count >= 8)
    .map((g) => ({ kw: g.key_display_name, cur: g.count, prev: prev.get(g.key_display_name) ?? 0, ratio: (g.count / totCur + 0.002) / ((prev.get(g.key_display_name) ?? 0) / totPrev + 0.002) }))
    .filter((x) => x.ratio >= 1.5)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 30)
  if (!rising.length) return
  const { data } = await chatJson({
    messages: [
      {
        role: 'system',
        content:
          '디스플레이 논문에서 최근 늘어난 영어 키워드들이다. 각각 디스플레이 산업의 기술 트렌드로 볼 만한 구체적인 기술인지 판단하라.\n' +
          '- tech=false: 실험 방법·일반 물리 용어(efficiency, energy, simulation 등), 너무 넓은 말, 디스플레이와 무관한 것\n' +
          '- name: 한국 업계에서 통용되는 표기 (예: tandem OLED → 탠덤 OLED, thin film encapsulation → 박막 봉지(TFE)). en: 영문 Wikipedia 문서가 있으면 그 제목',
      },
      { role: 'user', content: rising.map((x) => x.kw).join('\n') },
    ],
    schema: PAPER_SCHEMA,
    schemaName: 'paper_terms',
    priority: PRIORITY.BACKGROUND,
    timeoutMs: 180_000,
  })
  const byKw = new Map(rising.map((x) => [x.kw.toLowerCase(), x]))
  for (const item of data.items ?? []) {
    if (!item.tech || !CATEGORIES.includes(item.category)) continue
    const t = upsertTerm({ term: item.keyword, name: item.name, en: item.en, category: item.category }, [], 'paper')
    const r = byKw.get(item.keyword.toLowerCase())
    if (t && r) {
      t.paperNovelty = { cur: r.cur, prev: r.prev, at: today }
      t.query ||= item.keyword
    }
  }
  state.runs.discoverPapers = new Date().toISOString()
  await save()
}

// ── 후보 갈래 ① 검색: 네이버 검색광고 키워드 도구 (연관 검색어 + 월 검색수). 키가 있어야 함 (일주일에 한 번) ──
// 키: NAVER_SEARCHAD_CUSTOMER_ID · NAVER_SEARCHAD_ACCESS_LICENSE · NAVER_SEARCHAD_SECRET_KEY (searchad.naver.com → 도구 → API 사용 관리)
const SEARCH_SEEDS = ['디스플레이', 'OLED', '마이크로LED', '디스플레이 패널']
async function discoverSearch() {
  const customer = process.env.NAVER_SEARCHAD_CUSTOMER_ID
  const license = process.env.NAVER_SEARCHAD_ACCESS_LICENSE
  const secret = process.env.NAVER_SEARCHAD_SECRET_KEY
  if (!customer || !license || !secret) {
    state.searchStatus = 'no_key'
    return
  }
  const last = state.runs.discoverSearch ? Date.now() - Date.parse(state.runs.discoverSearch) : Infinity
  if (last < 7 * DAY) return
  const { createHmac } = await import('node:crypto')
  const seeds = [...new Set([...SEARCH_SEEDS, ...(dbEnabled() ? await getKeywords() : [])])].slice(0, 5) // 한 번에 5개까지
  const uri = '/keywordstool'
  const ts = String(Date.now())
  const sig = createHmac('sha256', secret).update(`${ts}.GET.${uri}`).digest('base64')
  const res = await fetch(`https://api.searchad.naver.com${uri}?hintKeywords=${encodeURIComponent(seeds.map((x) => x.replace(/\s+/g, '')).join(','))}&showDetail=1`, {
    headers: { 'X-Timestamp': ts, 'X-API-KEY': license, 'X-Customer': customer, 'X-Signature': sig },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    state.searchStatus = `error ${res.status}`
    return
  }
  const list = ((await res.json()).keywordList ?? [])
    .map((x) => ({ kw: x.relKeyword, n: (Number(x.monthlyPcQcCnt) || 5) + (Number(x.monthlyMobileQcCnt) || 5) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 400)
  // 연관 검색어 상위는 키오스크·65인치TV·전광판 같은 광고·쇼핑 검색어가 대부분 (11/07 실측: 1,200개)
  // → 400개를 100개씩 AI에게 보여 기술 용어만 고른다 (검색수가 적은 기술 용어도 빠지지 않게)
  const volumeOf = new Map(list.map((x) => [keyOf(x.kw), x.n]))
  for (let i = 0; i < list.length; i += 100) {
    const part = list.slice(i, i + 100)
    let data
    try {
      ;({ data } = await chatJson({ messages: termPrompt(part.map((x) => `${x.kw} (월 검색 ${x.n}회)`)), schema: TERM_SCHEMA, schemaName: 'tech_terms', priority: PRIORITY.BACKGROUND, timeoutMs: 180_000 }))
    } catch (err) {
      if (!(err instanceof PreemptedError)) console.warn(`[techtrends] 검색어 후보 실패: ${err.message}`)
      return // 다음 차례에 처음부터
    }
    for (const item of data.items ?? []) {
      if (!item.tech || !CATEGORIES.includes(item.category)) continue
      const t = upsertTerm(item, [], 'search')
      const n = volumeOf.get(keyOf(item.term))
      if (t && n) t.searchVolume = { n, at: ymd(Date.now()) } // 월 검색수(PC+모바일) 한 장면
    }
  }
  state.searchStatus = 'ok'
  state.runs.discoverSearch = new Date().toISOString()
  await save()
}

// ── 2. 출처별로 받기 ──
function remember(source, key, series) {
  const at = new Date().toISOString()
  ;(state.series[source] ??= {})[key] = { series, at }
  keepValue(source, key, 'series', '', { series, at })
}

// 상태에 값이 없거나(처음 · 저장 꼬임) 이번 구간 값을 못 받았으면 기록(tech_trend_values)에서 가장 최근 값을 채운다
async function fillFromHistory() {
  const rows = await latestValues('')
  for (const r of rows) {
    if (r.source.startsWith('kw:')) continue
    const slot = ((state.series[r.source] ??= {})[r.term] ??= { series: [] })
    if (r.kind === 'series' && !slot.series?.length && r.value?.series?.length) Object.assign(slot, { series: r.value.series, at: r.value.at, fromHistory: true })
    if (r.kind === 'recent' && !slot.recent && r.value) slot.recent = { ...r.value, fromHistory: true }
  }
}
function failed(source, key, err) {
  const slot = ((state.series[source] ??= {})[key] ??= { series: [] })
  slot.error = err.message
  slot.errorAt = new Date().toISOString()
}

async function fetchNaver(keys) {
  const id = process.env.NAVER_CLIENT_ID
  const secret = process.env.NAVER_CLIENT_SECRET
  if (!id || !secret) throw new Error('네이버 API 키가 없어요')
  const url = process.env.NAVER_TREND_URL ?? 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search'
  const end = new Date(Date.now() - DAY)
  const start = new Date(end.getTime() - HISTORY_DAYS * DAY)
  // 한 번에 5개 (데이터랩 한도). 값은 묶음 안 최대 = 100인 상대값이지만, 같은 용어끼리 기간을 비교하므로 상관없다
  for (let i = 0; i < keys.length; i += 5) {
    const group = keys.slice(i, i + 5)
    const keywordGroups = group.map((k) => ({ groupName: k, keywords: [...new Set([state.terms[k].name, ...state.terms[k].aliases])].slice(0, 5) }))
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret },
        body: JSON.stringify({ startDate: ymd(start), endDate: ymd(end), timeUnit: 'date', keywordGroups }),
        signal: AbortSignal.timeout(20_000),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error?.message ?? data?.errorMessage ?? `응답 ${res.status}`)
      for (const r of data.results ?? []) remember('naver', r.title, (r.data ?? []).map((p) => ({ t: p.period, v: Math.round(p.ratio * 10) / 10 })))
    } catch (err) {
      for (const k of group) failed('naver', k, err)
    }
  }
}

// AI가 준 영어 표기를 실제 문서 제목으로 바꾼다 (넘겨주기 따라감: Organic light-emitting diode → OLED). 조회수는 넘겨주기를 따라가지 않음
async function wikiTitleOf(t) {
  if (t.wikiTitle !== undefined) return t.wikiTitle
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.en.trim().replace(/ /g, '_'))}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 404) return (t.wikiTitle = null)
  if (!res.ok) throw new Error(`응답 ${res.status}`)
  const data = await res.json()
  // 뜻이 여러 개인 말(동음이의 문서)은 쓰지 않는다
  t.wikiTitle = data.type === 'disambiguation' ? null : (data.titles?.canonical ?? null)
  return t.wikiTitle
}

async function fetchWiki(keys) {
  const end = new Date(Date.now() - DAY)
  const start = new Date(end.getTime() - HISTORY_DAYS * DAY)
  const f = (d) => ymd(d).replace(/-/g, '')
  for (const k of keys) {
    if (!state.terms[k].en?.trim()) continue
    try {
      const title = await wikiTitleOf(state.terms[k])
      await sleep(1000)
      if (!title) continue
      const res = await fetch(
        `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g, '_'))}/daily/${f(start)}/${f(end)}`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) },
      )
      if (!res.ok) throw new Error(`응답 ${res.status}`)
      const data = await res.json()
      remember('wiki', k, (data.items ?? []).map((p) => ({ t: `${p.timestamp.slice(0, 4)}-${p.timestamp.slice(4, 6)}-${p.timestamp.slice(6, 8)}`, v: p.views })))
    } catch (err) {
      failed('wiki', k, err)
    }
    await sleep(2000) // 공용 IP라 Wikipedia 제한에 쉽게 걸림 (11/07 실측)
  }
}

// 최근 13개월 논문을 월별로 센다 (server/papers의 사슬 + 캐시)
// - 출처: OpenAlex(키) → 막히면 Semantic Scholar → arXiv. 한 용어의 달 값은 한 출처에서만 받는다 (섞으면 추이가 틀어짐)
//   지난 값이 있는데 쓰던 출처가 한도에 걸렸으면 다른 출처로 바꾸지 않고 지난 값을 그대로 둔다 (월별 값이라 하루 늦어도 됨)
// - 용어마다 하루 한 번만 (20시간 안에 받았으면 건너뜀). 끝난 달은 30일 캐시라 보통 최근 두 달만 다시 받는다
//   예전에는 200편 넘는 용어마다 13번씩 검색(1번 $0.001)해 하루 예산 $1을 이 단계에서 다 썼다 (11/07)
// - 최근 4주(어제까지 28일)와 그 전 28일 논문 수도 용어마다 하루 한 번 센다 (짧은 기간 비교용, 조장 11/08)
//   날짜 목록 한 번으로 이번 달 · 지난달 값도 같이 채워서, 하루 OpenAlex 호출 수는 예전(최근 두 달 = 2번)보다 늘지 않는다
const OPENALEX_EVERY_MS = 20 * 3600_000
// 끝은 「어제」(한국 날짜). OpenAlex는 논문이 실린 뒤 보통 하루 늦게 들어와 오늘까지 세면 마지막 날이 늘 덜 잡힌다 (조장 11/08)
// 서버 시계는 UTC라 한국 날짜로 바꿔서 하루를 뺀다
export function recentWindows(now = Date.now()) {
  const end = Date.parse(ymd(now + 9 * 3600_000)) - DAY
  return { cur: [ymd(end - 27 * DAY), ymd(end)], prev: [ymd(end - 55 * DAY), ymd(end - 28 * DAY)] }
}
async function fetchOpenAlex(keys) {
  const from = new Date(Date.now() - 400 * DAY)
  from.setUTCDate(1)
  const monthList = []
  for (let d = new Date(from); d < new Date(); d.setUTCMonth(d.getUTCMonth() + 1)) monthList.push(ymd(d).slice(0, 7))
  const windows = recentWindows()
  for (const k of keys) {
    const term = (state.terms[k].query || state.terms[k].en)?.trim()
    if (!term) continue
    const slot = state.series.openalex?.[k]
    const monthlyFresh = slot?.series?.length && !slot.error && Date.now() - Date.parse(slot.at) < OPENALEX_EVERY_MS
    const recentDue = slot?.recent?.cur?.[1] !== windows.cur[1]
    if (monthlyFresh && !recentDue) continue
    // 최근 4주: 실패하면 지난 값(있으면)을 그대로 두고 recentError만 적는다
    let recent = slot?.recent ?? null
    let recentError = null
    if (recentDue) {
      try {
        const r = await countRecent(term, windows, { prefer: slot?.provider, months: monthList.slice(-2), big: Boolean(slot?.recent?.big) })
        recent = { cur: windows.cur, prev: windows.prev, curN: r.cur, prevN: r.prev, provider: r.provider, big: r.big, at: new Date().toISOString() }
        keepValue('openalex', k, 'recent', windows.cur[1], recent)
      } catch (err) {
        recentError = err.message
      }
    }
    if (monthlyFresh) {
      slot.recent = recent
      slot.recentError = recentError
      continue
    }
    try {
      const { months, provider } = await countMonthly(term, monthList, { prefer: slot?.provider, hasHistory: Boolean(slot?.series?.length) })
      remember('openalex', k, monthList.map((m) => ({ t: `${m}-01`, v: months[m] ?? 0 })))
      state.series.openalex[k].provider = provider
    } catch (err) {
      failed('openalex', k, err)
    }
    state.series.openalex[k].recent = recent
    state.series.openalex[k].recentError = recentError
  }
}

// 특허: 후보 전체를 BigQuery 한 번으로 (약 18GB). 후보가 바뀌었고 7일이 지났거나, 30일이 지나면 다시
async function fetchPatents(keys) {
  const last = state.runs.patents ? Date.now() - Date.parse(state.runs.patents) : Infinity
  const have = state.series.patents ?? {}
  const changed = keys.some((k) => !have[k] && state.terms[k].query)
  if (!(last > 30 * DAY || (changed && last > 7 * DAY))) return false
  const esc = (s) => s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[- ]?')
  // AI 검토에서 정한 영어 검색어(약어 포함)와 영어 별칭을 함께 찾는다. 검색어가 없으면(너무 넓은 말) 빼기
  const words = (t) => [...new Set([t.query, ...(t.aliases ?? [])].filter((a) => a && /^[\x20-\x7e]+$/.test(a) && a.length >= 3).map((a) => a.toLowerCase()))]
  const cols = keys.filter((k) => state.terms[k].query).map((k) => ({ keyword: k, pattern: words(state.terms[k]).map((w) => `\\b${esc(w)}`).join('|') }))
  try {
    const series = await countPatentsFor(cols)
    // 데이터셋의 마지막 달은 갱신 도중이라 빼 둔다
    for (const [k, s] of Object.entries(series)) remember('patents', k, s.slice(0, -1))
  } catch (err) {
    for (const c of cols) failed('patents', c.keyword, err)
  }
  return true
}

// Reddit 검색 RSS: 최신 100건씩 받아 글 번호·날짜를 쌓는다. 처음에는 그 100건이 덮는 기간만 있음
// ⚠️ 보도에 따르면 Reddit RSS는 2026-11-13 종료 예정, 무료 Data API도 2027-03 종료 (25 문서 · 23 문서)
async function fetchReddit(keys) {
  for (const k of keys) {
    const t = state.terms[k]
    const term = t.en?.trim() || t.name
    try {
      const res = await fetch(`https://www.reddit.com/search.rss?q=${encodeURIComponent(`"${term}"`)}&sort=new&type=link&limit=100`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(25_000),
      })
      if (!res.ok) throw new Error(res.status === 429 ? '요청 제한' : `응답 ${res.status}`)
      const xml = await res.text()
      const words = [term, t.name, ...t.aliases].map(keyOf).filter((w) => w.length >= 2)
      const slot = (state.reddit[k] ??= { posts: {}, since: null })
      let oldest = null
      for (const e of xml.split('<entry>').slice(1)) {
        const id = e.match(/<id>([^<]+)<\/id>/)?.[1]
        const day = e.match(/<published>([^<]+)<\/published>/)?.[1]?.slice(0, 10)
        if (!id || !day || !e.includes('/comments/')) continue
        oldest = !oldest || day < oldest ? day : oldest
        const text = keyOf(clean((e.match(/<title>([^<]*)/)?.[1] ?? '') + ' ' + (e.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? '').replace(/&lt;[^&]*&gt;/g, ' ')))
        if (words.some((w) => text.includes(w))) slot.posts[id] = day
      }
      // 언제부터 빠짐없이 모았는지: 처음 받은 100건의 가장 오래된 날 (그 전 날짜는 비교에 쓰지 않음)
      slot.since ??= oldest
      const cut = ymd(Date.now() - HISTORY_DAYS * DAY)
      for (const [id, day] of Object.entries(slot.posts)) if (day < cut) delete slot.posts[id]
      const counts = {}
      for (const day of Object.values(slot.posts)) counts[day] = (counts[day] ?? 0) + 1
      const series = []
      if (slot.since) for (let d = Date.parse(slot.since); d <= Date.now() - DAY; d += DAY) series.push({ t: ymd(d), v: counts[ymd(d)] ?? 0 })
      remember('reddit', k, series)
    } catch (err) {
      failed('reddit', k, err)
    }
    await save()
    await sleep(REDDIT_GAP_MS)
  }
}

// ── 하루 한 번 도는 일 ──

async function cycle(opts = {}) {
  if (status.running || globalThis.__techTrendsRunning) return
  globalThis.__techTrendsRunning = true
  status.running = true
  status.startedAt = new Date().toISOString()
  try {
    await load()
    await setPhase('후보 찾기: 검색어')
    await discoverSearch().catch((err) => console.warn(`[techtrends] 검색어 후보 실패: ${err.message}`))
    await setPhase('후보 찾기: 논문 신규 키워드')
    await discoverPapers().catch((err) => console.warn(`[techtrends] 논문 후보 실패: ${err.message}`))
    await setPhase('후보 찾기: 기사')
    // 처음에는 60일치(약 1,700건)라 여러 번에 나눠 한다. 한 번에 400건
    for (let n = 0; n < 5; n++) if ((await extractTerms()) < 400) break
    await setPhase('용어 검토 (제품명·넓은 말 거르기)')
    await reviewTerms()
    const keys = await candidates()
    for (const [id, fn] of [
      ['naver', fetchNaver],
      ['wiki', fetchWiki],
      ['openalex', fetchOpenAlex],
      ['patents', fetchPatents],
    ]) {
      await setPhase(SOURCES.find((s) => s.id === id).label)
      try {
        const ran = await fn(keys)
        if (ran !== false) state.runs[id] = new Date().toISOString()
      } catch (err) {
        for (const k of keys) failed(id, k, err)
      }
      await save()
    }
    if (!opts.skipReddit) {
      await setPhase('Reddit 글 수 (1분 간격)')
      await fetchReddit(keys)
      state.runs.reddit = new Date().toISOString()
    }
    state.updatedAt = new Date().toISOString()
    await save()
    console.log(`[techtrends] 기술 트렌드 갱신: 용어 ${Object.keys(state.terms).length}개 · 후보 ${keys.length}개`)
  } catch (err) {
    console.warn(`[techtrends] 갱신 실패: ${err.message}`)
  } finally {
    status.running = false
    globalThis.__techTrendsRunning = false
    await setPhase(null)
    status.finishedAt = new Date().toISOString()
  }
}

// 키를 새로 넣었을 때 검색어 갈래만 바로 한 번 (일주일 기다리지 않고). 검토까지 해서 돌려준다
export async function discoverSearchNow() {
  await load()
  state.runs.discoverSearch = null
  await discoverSearch()
  await reviewTerms()
  await save()
  const found = Object.values(state.terms).filter((t) => (t.from ?? []).includes('search'))
  return { status: state.searchStatus, found: found.map((t) => ({ name: t.name, category: t.category, hidden: Boolean(t.hidden), volume: t.searchVolume?.n ?? null })) }
}

// 관리 화면·스크립트에서 바로 한 번 돌리기
export const refreshTechTrends = cycle

// 논문 수만 지금 한 번 (최근 4주 값을 하루 갱신까지 기다리지 않고 받을 때, 11/08). 뉴스 · Reddit 등은 돌지 않는다
export async function refreshPapersNow() {
  if (status.running || globalThis.__techTrendsRunning) throw new Error('기술 트렌드 갱신이 이미 돌고 있어요')
  globalThis.__techTrendsRunning = true
  status.running = true
  try {
    await load({ fresh: true })
    const keys = await candidates()
    await fetchOpenAlex(keys)
    state.runs.openalex = new Date().toISOString()
    await save()
    const got = keys.filter((k) => state.series.openalex?.[k]?.recent).length
    return { candidates: keys.length, recent: got, window: recentWindows() }
  } finally {
    status.running = false
    globalThis.__techTrendsRunning = false
  }
}

// 서버가 켜지면 1분 뒤 한 번, 그 뒤 하루마다. TECH_TRENDS=off면 돌지 않음 (테스트 서버용)
export function startTechTrends() {
  if (process.env.TECH_TRENDS === 'off' || !dbEnabled()) return
  globalThis.__techTrendsCycle = cycle // 서버가 다시 올라오면 새 코드의 cycle로 바뀜
  schedulePaperRetry()
  if (globalThis.__techTrendsTimer) return
  setTimeout(() => globalThis.__techTrendsCycle(), 60_000).unref?.()
  globalThis.__techTrendsTimer = setInterval(() => globalThis.__techTrendsCycle(), CYCLE_MS)
  globalThis.__techTrendsTimer.unref?.()
}

// OpenAlex 하루 예산이 풀리는 때(00:00 UTC = 한국 09:00) 10분 뒤, 최근 4주 논문 수가 비어 있는 용어가 있으면 논문만 다시 센다
// 하루 갱신(24시간마다)을 기다리지 않게 (11/08)
function schedulePaperRetry() {
  if (globalThis.__techTrendsPaperRetry) return
  const next = new Date()
  next.setUTCHours(24, 10, 0, 0)
  globalThis.__techTrendsPaperRetry = setTimeout(async () => {
    globalThis.__techTrendsPaperRetry = null
    try {
      await load({ fresh: true })
      const keys = await candidates()
      const want = recentWindows().cur[1]
      if (keys.some((k) => state.series.openalex?.[k]?.recent?.cur?.[1] !== want)) {
        const r = await refreshPapersNow()
        console.log(`[techtrends] 논문 최근 4주 다시 셈: 후보 ${r.candidates}개 중 ${r.recent}개`)
      }
    } catch (err) {
      console.warn(`[techtrends] 논문 다시 세기 실패: ${err.message}`)
    } finally {
      schedulePaperRetry()
    }
  }, next.getTime() - Date.now())
  globalThis.__techTrendsPaperRetry.unref?.()
}

// ── 3. 기간 비교 · 순위 ──
const PERIOD_LABEL = { week: '이번 주 (최근 7일)', lastweek: '지난주', month: '이번 달 (최근 30일)', custom: '직접 설정' }

export function windowOf(period = 'week', from, to) {
  const yesterday = Date.parse(ymd(Date.now() - DAY))
  let start
  let end
  if (period === 'custom' && from && to && Date.parse(from) <= Date.parse(to)) {
    start = Date.parse(from)
    end = Math.min(Date.parse(to), yesterday)
  } else if (period === 'lastweek') {
    end = yesterday - 7 * DAY
    start = end - 6 * DAY
  } else if (period === 'month') {
    end = yesterday
    start = end - 29 * DAY
  } else {
    period = 'week'
    end = yesterday
    start = end - 6 * DAY
  }
  const days = Math.round((end - start) / DAY) + 1
  return { period, label: PERIOD_LABEL[period], days, cur: [ymd(start), ymd(end)], prev: [ymd(start - days * DAY), ymd(start - DAY)] }
}

const sumIn = (series, [a, b]) => series.filter((p) => p.t >= a && p.t <= b).reduce((s, p) => s + p.v, 0)

// 월별 출처: 기간이 4주 이상일 때만. 기간 길이만큼의 달(최소 1달)을 데이터의 마지막 온전한 달에서부터 센다
function monthWindows(series, win) {
  const n = Math.max(3, Math.round(win.days / 30)) // 한 달은 편수가 적어 흔들림 → 최소 3개월끼리
  const lastFull = ymd(Date.now()).slice(0, 7) + '-01'
  const months = series.filter((p) => p.t < lastFull && p.t <= win.cur[1])
  if (months.length < n * 2) return null
  const cur = months.slice(-n)
  const prev = months.slice(-2 * n, -n)
  return { cur: cur.reduce((s, p) => s + p.v, 0), prev: prev.reduce((s, p) => s + p.v, 0), range: [prev[0].t, cur.at(-1).t], label: `${cur[0].t.slice(0, 7)}${n > 1 ? `~${cur.at(-1).t.slice(0, 7)}` : ''} vs 그 전 ${n}달` }
}

// 월별 출처를 4주보다 짧은 기간에 보여 줄 때 (조장 11/08)
// - 논문: 하루 한 번 센 「최근 28일 vs 그 전 28일」(fetchOpenAlex의 recent). 날짜가 매일 있는 OpenAlex 값이라 진짜 4주 비교
// - 특허: 데이터셋에 공개가 몇 달 늦게 들어와 최근 4주 값이 없다 → 마지막 온전한 달 vs 그 전 달로 바꾸고, 실제 날짜를 적는다
// out.basis.note는 탭 위에 작게 보이고, 종합 표의 열 이름 옆에도 out.basis.short가 붙는다 (종합도 탭과 같은 값을 씀)
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const monthLastDay = (t) => ymd(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 0))
function shortMonthly(src, out, keys) {
  const row = (k, slot, cur, prev, extra) => ({
    key: k,
    name: state.terms[k].name,
    en: state.terms[k].en,
    category: state.terms[k].category,
    from: state.terms[k].from ?? ['article'],
    cur,
    prev,
    growth: (cur + src.smooth) / (prev + src.smooth),
    change: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null,
    points: slot.series.filter((p) => p.t >= ymd(Date.now() - 400 * DAY)),
    at: slot.at ?? null,
    ...extra,
  })
  const want = recentWindows()
  if (src.id === 'openalex') {
    const slots = keys.map((k) => [k, state.series.openalex?.[k]]).filter(([, s]) => s?.recent && s.series?.length)
    // 용어마다 센 날이 다를 수 있다 (오늘 실패한 용어) → 가장 최근 구간 하나로만 비교한다
    const latest = slots.map(([, s]) => s.recent.cur[1]).sort().at(-1)
    const w = latest ? slots.find(([, s]) => s.recent.cur[1] === latest)[1].recent : want
    // 이번 구간(어제까지)을 못 받아 기록의 지난 값으로 보여 주는 중이면 그렇다고 적는다
    const old = latest && latest !== want.cur[1] ? ` · 최신 값을 못 받아 ${md(slots.map(([, s]) => s.recent.at).filter(Boolean).sort().at(-1) ?? latest)} 받은 지난 값` : ''
    out.basis = { short: '최근 4주', cur: w.cur, prev: w.prev, note: `논문은 최근 4주(${md(w.cur[0])}~${md(w.cur[1])}) 기준 · 그 전 4주(${md(w.prev[0])}~${md(w.prev[1])})와 비교 (월별 자료라 짧은 기간 대신)${old}` }
    out.at = slots.map(([, s]) => s.recent.at).sort().at(-1) ?? out.at
    for (const [k, slot] of slots) {
      const name = state.terms[k].name
      if (slot.recent.cur[1] !== latest) {
        out.skipped.push({ key: k, name, why: '최근 4주 값을 아직 못 받았어요' })
        continue
      }
      const { curN: cur, prevN: prev } = slot.recent
      if (cur + prev === 0) out.skipped.push({ key: k, name, why: '최근 8주 동안 논문이 없어요' })
      else if (cur + prev < src.min) out.skipped.push({ key: k, name, why: '값이 너무 적어요' })
      else out.ranking.push(row(k, slot, cur, prev, { basis: `${md(w.cur[0])}~${md(w.cur[1])} vs 그 전 4주`, stale: Boolean(slot.recentError || slot.recent.fromHistory || latest !== want.cur[1]) }))
    }
    const limited = keys.some((k) => /한도|예산/.test(state.series.openalex?.[k]?.recentError ?? ''))
    if (!out.ranking.length)
      out.empty = limited
        ? '논문 자료(OpenAlex)가 하루 한도에 걸려 최근 4주 값을 아직 못 받았어요. 한도가 풀리는 오전 9시 10분쯤 다시 받아요.'
        : latest
          ? '최근 4주 동안 확인할 수 있는 논문 자료가 없어요.'
          : '최근 4주 논문 수를 아직 못 받았어요. 논문 자료(OpenAlex) 한도가 풀리는 오전 9시 10분쯤 다시 받아요.'
  } else {
    const lastFull = ymd(Date.now()).slice(0, 7) + '-01'
    const monthsOf = (slot) => slot.series.filter((p) => p.t < lastFull)
    const slots = keys.map((k) => [k, state.series[src.id]?.[k]]).filter(([, s]) => s?.series?.length && monthsOf(s).length >= 2)
    const last = slots.map(([, s]) => monthsOf(s).at(-1).t).sort().at(-1)
    if (last) {
      const before = ymd(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)) - 2, 1))
      const cur = [last, monthLastDay(last)]
      const prev = [before, monthLastDay(before)]
      const why = cur[1] < want.cur[0] ? '데이터셋에 늦게 들어와 최근 4주 자료가 없어요 → ' : ''
      out.basis = { short: `${Number(last.slice(5, 7))}월`, cur, prev, note: `특허는 ${why}마지막 온전한 달(${md(cur[0])}~${md(cur[1])}) 기준 · 그 전 달(${md(prev[0])}~${md(prev[1])})과 비교` }
      for (const [k, slot] of slots) {
        const v = (t) => slot.series.find((p) => p.t === t)?.v ?? 0
        const [c, p] = [v(last), v(before)]
        const name = state.terms[k].name
        if (c + p === 0) out.skipped.push({ key: k, name, why: '그 두 달 동안 특허가 없어요' })
        else if (c + p < src.min) out.skipped.push({ key: k, name, why: '값이 너무 적어요' })
        else out.ranking.push(row(k, slot, c, p, { basis: `${last.slice(0, 7)} vs ${before.slice(0, 7)}`, stale: Boolean(slot.errorAt && (!slot.at || slot.errorAt > slot.at)) }))
      }
    }
    if (!out.ranking.length) out.empty = '최근 4주 동안 확인할 수 있는 특허 자료가 없어요.'
  }
  out.ranking.sort((a, b) => b.growth - a.growth)
  return out
}

export async function getTechTrends({ period, from, to } = {}) {
  await load({ fresh: true })
  await fillFromHistory() // API가 막혀 비어 있는 값은 기록에서 가장 최근 값으로 (11/08)
  const win = windowOf(period, from, to)
  const keys = await candidates()
  const sources = SOURCES.map((src) => {
    const out = { id: src.id, label: src.label, axis: src.axis, unit: src.unit, note: src.note, daily: src.daily, at: state.runs[src.id] ?? null, ranking: [], skipped: [] }
    // 월별 출처(논문 · 특허)인데 고른 기간이 4주보다 짧으면 (조장 11/08): 「못 보여 줌」 대신 최근 4주로 바꿔 비교한다
    if (!src.daily && win.days < 28) return shortMonthly(src, out, keys)
    for (const k of keys) {
      const slot = state.series[src.id]?.[k]
      const t = state.terms[k]
      if (!slot?.series?.length) continue
      let cur
      let prev
      let points
      let basis
      if (src.daily) {
        // 비교 기간 앞부분이 비어 있으면(아직 덜 쌓임) 순위에서 뺀다
        if (slot.series[0].t > win.prev[0]) {
          out.skipped.push({ key: k, name: t.name, why: `${slot.series[0].t}부터 쌓여 비교 기간이 모자라요` })
          continue
        }
        cur = sumIn(slot.series, win.cur)
        prev = sumIn(slot.series, win.prev)
        points = slot.series.filter((p) => p.t >= win.prev[0] && p.t <= win.cur[1])
      } else {
        const m = monthWindows(slot.series, win)
        if (!m) continue
        ;({ cur, prev } = m)
        basis = m.label
        points = slot.series.filter((p) => p.t >= ymd(Date.now() - 400 * DAY))
      }
      if (cur + prev < src.min) {
        out.skipped.push({ key: k, name: t.name, why: '값이 너무 적어요' })
        continue
      }
      out.ranking.push({
        key: k,
        name: t.name,
        en: t.en,
        category: t.category,
        from: t.from ?? ['article'],
        cur: Math.round(cur * 10) / 10,
        prev: Math.round(prev * 10) / 10,
        growth: (cur + src.smooth) / (prev + src.smooth),
        change: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null,
        basis,
        points,
        at: slot.at ?? null,
        stale: Boolean(slot.errorAt && (!slot.at || slot.errorAt > slot.at)),
      })
    }
    out.ranking.sort((a, b) => b.growth - a.growth)
    return out
  })

  // 종합: 출처마다 순위를 0~100 백분위로 바꿔 평균. 출처 2곳 이상에 값이 있는 용어만
  const byKey = {}
  for (const s of sources) {
    const n = s.ranking.length
    if (n < 2) continue
    s.ranking.forEach((r, i) => {
      const e = (byKey[r.key] ??= { key: r.key, name: r.name, en: r.en, category: r.category, from: r.from, parts: {} })
      e.parts[s.id] = { pct: Math.round((1 - i / (n - 1)) * 100), change: r.change, growth: r.growth, rank: i + 1, of: n }
    })
  }
  const composite = Object.values(byKey)
    .filter((e) => Object.keys(e.parts).length >= 2)
    .map((e) => ({ ...e, score: Math.round(Object.values(e.parts).reduce((s, p) => s + p.pct, 0) / Object.keys(e.parts).length) }))
    .sort((a, b) => b.score - a.score)

  return {
    window: win,
    sources: sources.map((s) => ({ ...s, ranking: s.ranking })),
    composite,
    terms: Object.keys(state.terms).length,
    hidden: Object.values(state.terms).filter((t) => t.hidden).length,
    from: Object.fromEntries(['search', 'paper', 'article'].map((f) => [f, keys.filter((k) => (state.terms[k].from ?? ['article']).includes(f)).length])),
    searchStatus: state.searchStatus ?? 'no_key',
    candidates: keys.length,
    extractedUntil: state.extractedUntil ?? null,
    updatedAt: state.updatedAt ?? null,
    status: status.running
      ? { ...status }
      : state.progress && Date.now() - Date.parse(state.progress.at) < 15 * 60_000
        ? { running: true, phase: state.progress.phase, startedAt: state.progress.startedAt }
        : { running: false, phase: null },
  }
}
