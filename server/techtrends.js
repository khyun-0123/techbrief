// 기술 트렌드 (25 문서, 11/07 조장 결정): 대시보드 첫 줄 「요즘 뜨는 기술」
// 1. 용어 찾기: 모은 기사 제목에서 AI가 기술 용어만 뽑아 사전을 스스로 만든다 (기업·지역·행사·일반 단어는 버림)
//    → 기사 수는 「후보를 찾는 데」만 쓰고 순위 점수에는 넣지 않는다 (담당자 "기사 많음 ≠ 중요")
// 2. 신호 받기: 후보 용어마다 출처 5곳의 추이를 하루 한 번 받아 둔다
//    네이버 검색량(관심, 일별) · Wikipedia 조회수(관심, 일별) · Reddit 글 수(현장 반응, 일별) · 논문 수(OpenAlex, 월별) · 특허 공개(BigQuery, 월별)
// 3. 순위: 요청한 기간(이번 주·지난주·이번 달·직접)과 바로 전 같은 길이 기간을 비교해 출처마다 순위, 출처별 순위를 합쳐 종합 순위
// 바깥 API는 실패하면 지난 값을 그대로 쓰고 받은 시각을 함께 보낸다 (trends.js와 같은 원칙)
import { dbEnabled, query } from './db/index.js'
import { getKeywords, getSetting, setSetting } from './db/store.js'
import { chatJson, PRIORITY, PreemptedError } from './llm/client.js'
import { countPatentsFor } from './patents.js'

const KEY = 'tech_trends'
const DAY = 86_400_000
const UA = 'techbrief/0.1 (university team project; tech trend dashboard)'
const MAX_TERMS = 40 // 신호를 받을 후보 수 (네이버 하루 1,000회 · OpenAlex 하루 약 1,000회 안)
const MIN_ARTICLES = 2 // 최근 60일 기사 2건 이상에 나온 용어만 후보
const HISTORY_DAYS = 120
const BATCH = 40 // AI에게 한 번에 주는 기사 제목 수
const CYCLE_MS = 24 * 3600_000
const REDDIT_GAP_MS = 75_000 // Reddit은 같은 IP에서 1분에 1번도 자주 막힘
const CATEGORIES = ['패널·디스플레이 기술', '공정·장비', '소재·부품', '응용 제품']

export const SOURCES = [
  { id: 'naver', label: '네이버 검색량', axis: '관심', unit: '', daily: true, smooth: 5, min: 10, note: '네이버 데이터랩 · 용어마다 그 기간 최대 100' },
  { id: 'wiki', label: 'Wikipedia 조회수', axis: '관심', unit: '회', daily: true, smooth: 30, min: 50, note: '영문 Wikipedia 문서 조회수' },
  { id: 'reddit', label: 'Reddit 글 수', axis: '현장 반응', unit: '건', daily: true, smooth: 1, min: 3, note: 'Reddit 검색 RSS · 최신 100건씩 쌓음' },
  { id: 'openalex', label: '논문 수', axis: '연구', unit: '편', daily: false, smooth: 1, min: 3, note: 'OpenAlex · 제목·초록 · 월별' },
  { id: 'patents', label: '특허 공개 건수', axis: '개발·투자', unit: '건', daily: false, smooth: 2, min: 5, note: 'Google Patents · 영문 제목 · 월별 (공개까지 약 18개월 늦음)' },
]

// ── 저장 상태 (app_settings 한 줄) ──
let state = null
async function load() {
  state ??= (await getSetting(KEY, null)) ?? {}
  state.terms ??= {} // key → { name, en, category, aliases[], articles{id: day} }
  state.series ??= {} // source → key → { series[{t,v}], at, error?, errorAt? }
  state.reddit ??= {} // key → { posts{id: day}, since }
  state.runs ??= {} // source → 마지막으로 돈 시각
  return state
}
async function save() {
  await setSetting(KEY, state).catch((err) => console.warn(`[techtrends] 저장 실패: ${err.message}`))
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
        '- 뽑는 것: 디스플레이 방식·패널 기술(예: QD-OLED, 탠덤 OLED, LTPO, 마이크로LED), 공정·장비(잉크젯 프린팅, 증착, 레이저 전사), 소재·부품(OCA, 퀀텀닷, UTG), 새 응용 제품군(AR 글래스, 차량용 디스플레이, OLED 모니터)\n' +
        '- 버리는 것(tech=false): 회사·기관·사람·지역 이름, 쇼핑 행사·할인·가격, 정책·예산, 실적·주가, 「디스플레이」「기술」「패널」「제품」 같은 너무 일반적인 말\n' +
        '- name: 한국에서 통용되는 대표 표기 하나 (같은 기술의 다른 표기는 합친다. 예: 퀀텀닷·양자점 → 퀀텀닷, 마이크로 LED → 마이크로LED)\n' +
        '- en: 영어 표기. 영문 Wikipedia 문서가 있으면 그 문서 제목 그대로 (예: MicroLED, Quantum dot display, Ultra-thin glass)\n' +
        '- titles: 그 용어가 나온 제목 번호들',
    },
    { role: 'user', content: titles.map((t, i) => `${i + 1}. ${t}`).join('\n') },
  ]
}

function upsertTerm(item, articleDays) {
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

// 후보: 최근 60일 기사 2건 이상에 나온 기술 용어 + 자동 수집 키워드. 숨긴 용어는 뺀다
async function candidates() {
  const forced = new Set((dbEnabled() ? await getKeywords() : []).map(keyOf))
  return Object.entries(state.terms)
    .filter(([k, t]) => !t.hidden && (Object.keys(t.articles).length >= MIN_ARTICLES || forced.has(k)))
    .sort((a, b) => Object.keys(b[1].articles).length - Object.keys(a[1].articles).length)
    .slice(0, MAX_TERMS)
    .map(([k]) => k)
}

// ── 2. 출처별로 받기 ──
function remember(source, key, series) {
  ;(state.series[source] ??= {})[key] = { series, at: new Date().toISOString() }
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

// 최근 13개월 논문을 월별로 센다. 200편 이하면 날짜 목록을 받아 세고, 많으면 달마다 개수만 묻는다
async function fetchOpenAlex(keys) {
  const apiKey = process.env.OPENALEX_API_KEY
  if (!apiKey) throw new Error('OpenAlex 키가 없어요')
  const from = new Date(Date.now() - 400 * DAY)
  from.setUTCDate(1)
  const base = (extra) => {
    const term = encodeURIComponent(`"${extra.term}"`)
    return `https://api.openalex.org/works?filter=title_and_abstract.search:${term},from_publication_date:${extra.from},to_publication_date:${extra.to}&${extra.q}&api_key=${apiKey}`
  }
  const get = async (url) => {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`응답 ${res.status}`)
    return res.json()
  }
  for (const k of keys) {
    const term = state.terms[k].en?.trim()
    if (!term) continue
    try {
      const months = {}
      for (let d = new Date(from); d < new Date(); d.setUTCMonth(d.getUTCMonth() + 1)) months[ymd(d).slice(0, 7)] = 0
      const today = ymd(Date.now())
      const first = await get(base({ term, from: ymd(from), to: today, q: 'select=publication_date&per-page=200' }))
      if (first.meta.count <= 200) {
        for (const w of first.results ?? []) if (w.publication_date?.slice(0, 7) in months) months[w.publication_date.slice(0, 7)]++
      } else {
        for (const m of Object.keys(months)) {
          const [y, mo] = m.split('-').map(Number)
          const last = ymd(Date.UTC(y, mo, 0))
          months[m] = (await get(base({ term, from: `${m}-01`, to: last, q: 'per-page=1&select=id' }))).meta.count
          await sleep(150)
        }
      }
      remember('openalex', k, Object.entries(months).map(([m, v]) => ({ t: `${m}-01`, v })))
    } catch (err) {
      failed('openalex', k, err)
    }
    await sleep(300)
  }
}

// 특허: 후보 전체를 BigQuery 한 번으로 (약 18GB). 후보가 바뀌었고 7일이 지났거나, 30일이 지나면 다시
async function fetchPatents(keys) {
  const last = state.runs.patents ? Date.now() - Date.parse(state.runs.patents) : Infinity
  const have = state.series.patents ?? {}
  const changed = keys.some((k) => !have[k] && state.terms[k].en)
  if (!(last > 30 * DAY || (changed && last > 7 * DAY))) return false
  const esc = (s) => s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[- ]?')
  const cols = keys.filter((k) => state.terms[k].en && state.terms[k].en.length >= 3).map((k) => ({ keyword: k, pattern: `\\b${esc(state.terms[k].en)}` }))
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
const status = { running: false, phase: null, startedAt: null, finishedAt: null }

async function cycle() {
  if (status.running) return
  status.running = true
  status.startedAt = new Date().toISOString()
  try {
    await load()
    status.phase = '용어 찾기'
    // 처음에는 60일치(약 1,700건)라 여러 번에 나눠 한다. 한 번에 400건
    for (let n = 0; n < 5; n++) if ((await extractTerms()) < 400) break
    const keys = await candidates()
    for (const [id, fn] of [
      ['naver', fetchNaver],
      ['wiki', fetchWiki],
      ['openalex', fetchOpenAlex],
      ['patents', fetchPatents],
    ]) {
      status.phase = SOURCES.find((s) => s.id === id).label
      try {
        const ran = await fn(keys)
        if (ran !== false) state.runs[id] = new Date().toISOString()
      } catch (err) {
        for (const k of keys) failed(id, k, err)
      }
      await save()
    }
    status.phase = 'Reddit 글 수 (1분 간격)'
    await fetchReddit(keys)
    state.runs.reddit = new Date().toISOString()
    state.updatedAt = new Date().toISOString()
    await save()
    console.log(`[techtrends] 기술 트렌드 갱신: 용어 ${Object.keys(state.terms).length}개 · 후보 ${keys.length}개`)
  } catch (err) {
    console.warn(`[techtrends] 갱신 실패: ${err.message}`)
  } finally {
    status.running = false
    status.phase = null
    status.finishedAt = new Date().toISOString()
  }
}

// 관리 화면·스크립트에서 바로 한 번 돌리기
export const refreshTechTrends = cycle

// 서버가 켜지면 1분 뒤 한 번, 그 뒤 하루마다. TECH_TRENDS=off면 돌지 않음 (테스트 서버용)
export function startTechTrends() {
  if (process.env.TECH_TRENDS === 'off' || !dbEnabled() || globalThis.__techTrendsTimer) return
  setTimeout(cycle, 60_000).unref?.()
  globalThis.__techTrendsTimer = setInterval(cycle, CYCLE_MS)
  globalThis.__techTrendsTimer.unref?.()
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
  const n = Math.max(1, Math.round(win.days / 30))
  const lastFull = ymd(Date.now()).slice(0, 7) + '-01'
  const months = series.filter((p) => p.t < lastFull && p.t <= win.cur[1])
  if (months.length < n * 2) return null
  const cur = months.slice(-n)
  const prev = months.slice(-2 * n, -n)
  return { cur: cur.reduce((s, p) => s + p.v, 0), prev: prev.reduce((s, p) => s + p.v, 0), range: [prev[0].t, cur.at(-1).t], label: `${cur[0].t.slice(0, 7)}${n > 1 ? `~${cur.at(-1).t.slice(0, 7)}` : ''} vs 그 전 ${n}달` }
}

export async function getTechTrends({ period, from, to } = {}) {
  await load()
  const win = windowOf(period, from, to)
  const keys = await candidates()
  const sources = SOURCES.map((src) => {
    const out = { id: src.id, label: src.label, axis: src.axis, unit: src.unit, note: src.note, daily: src.daily, at: state.runs[src.id] ?? null, ranking: [], skipped: [] }
    if (!src.daily && win.days < 28) {
      out.unavailable = '월 단위 자료예요. 「이번 달」이나 4주 이상으로 설정하면 보여요.'
      return out
    }
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
      const e = (byKey[r.key] ??= { key: r.key, name: r.name, en: r.en, category: r.category, parts: {} })
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
    candidates: keys.length,
    extractedUntil: state.extractedUntil ?? null,
    updatedAt: state.updatedAt ?? null,
    status: { ...status },
  }
}
