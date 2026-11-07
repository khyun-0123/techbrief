// 키워드 추이 (22 문서 6-4 ①②, 21 문서 6-2 시각화). 자동 수집 키워드마다 네 가지 신호를 모은다
// 1. 뉴스 기사량: 우리 DB keyword_daily (매 수집 때 최근 7일을 다시 셈) — 언급량·급증
// 2. 네이버 검색량: NAVER API HUB 검색어 트렌드 (앱에서 「검색어 트렌드」를 켜야 함, 안 켜져 있으면 not_enabled)
// 3. 전 세계 관심도: Wikipedia(영문) 문서 조회수 — 키 없음
// 4. 해외 보도량: GDELT — 키 없음, 5초에 1회 제한. 이 서버 IP는 늘 막혀 있어(24 문서 5-1) 30분마다 따로 다시 시도,
//    24시간 동안 한 번도 못 받으면 그래프에서 뺀다 (11/07 조장 결정)
// 바깥 API가 실패하면 마지막으로 받은 정상 값을 그대로 보여 주고, 언제 값인지(at)를 함께 보낸다 (DB에 저장 → 서버를 다시 켜도 남음)
// 약관(23 문서): 데이터랩 숫자는 그래프로만 보여 주고 AI에 넣지 않는다. Wikipedia·GDELT는 출처 표시
// 바깥 API는 느리고 제한이 있어 6시간 동안 기억해 두고, 오래되면 뒤에서 새로 받는다 (그동안은 지난 값)
import { dbEnabled, query } from './db/index.js'
import { getKeywords, getSetting, setSetting } from './db/store.js'
import { flushValues, keepValue, latestValues } from './trendHistory.js'
import { getPatentTrends, patentPatternOf } from './patents.js'

const CACHE_MS = 6 * 3600_000
const UA = 'techbrief/0.1 (university team project; tech news briefing)'
const DAY = 86_400_000

// 키워드 → 영문 위키 문서 · 영문 검색어 (없으면 그 신호는 빠짐)
const GLOBAL = {
  마이크로led: { wiki: 'MicroLED', en: 'microled' },
  '마이크로 디스플레이': { wiki: 'Microdisplay', en: 'microdisplay' },
  oled: { wiki: 'OLED', en: 'OLED display' },
  'qd-oled': { wiki: 'Quantum_dot_display', en: 'QD-OLED' },
  무기발광: { wiki: 'MicroLED', en: 'microled' },
  폴더블: { wiki: 'Foldable_smartphone', en: 'foldable display' },
  롤러블: { wiki: 'Rollable_display', en: 'rollable display' },
  반도체: { wiki: 'Semiconductor', en: 'semiconductor' },
}
const globalOf = (k) => GLOBAL[String(k).trim().toLowerCase()] ?? null

const ymd = (d) => d.toISOString().slice(0, 10)

async function newsSeries(keywords) {
  if (!dbEnabled()) return {}
  const { rows } = await query(
    `SELECT keyword, day::text AS day, articles FROM keyword_daily
      WHERE keyword = ANY($1) AND day > now() - interval '60 days' ORDER BY day`,
    [keywords],
  )
  const out = {}
  for (const r of rows) (out[r.keyword] ??= []).push({ t: r.day, v: r.articles })
  return out
}

// 네이버 검색어 트렌드: 주 단위 6개월, 키워드마다 그 구간 최댓값 = 100
async function naverSeries(keywords) {
  const id = process.env.NAVER_CLIENT_ID
  const secret = process.env.NAVER_CLIENT_SECRET
  if (!id || !secret) return { status: 'no_key' }
  const url = process.env.NAVER_TREND_URL ?? 'https://naverapihub.apigw.ntruss.com/search-trend/v1/search'
  const end = new Date(Date.now() - DAY)
  const start = new Date(end.getTime() - 182 * DAY)
  const out = {}
  // 키워드마다 따로 부른다: 같이 부르면 가장 많이 찾은 키워드 기준 100이 되어 작은 키워드 그래프가 바닥에 붙음
  for (const keyword of keywords) {
    const groups = [{ groupName: keyword, keywords: [keyword] }]
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret },
      body: JSON.stringify({ startDate: ymd(start), endDate: ymd(end), timeUnit: 'week', keywordGroups: groups }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) return { status: 'not_enabled' } // 앱에서 「검색어 트렌드」가 꺼져 있음
    if (!res.ok) return { status: 'error', error: data?.error?.message ?? `응답 ${res.status}` }
    // 이번 주(아직 안 끝난 주)는 줄어 보이므로 뺀다
    const done = (p) => Date.parse(p.period) + 7 * DAY <= Date.now()
    for (const r of data.results ?? []) out[r.title] = (r.data ?? []).filter(done).map((p) => ({ t: p.period, v: Math.round(p.ratio * 10) / 10 }))
  }
  return { status: 'ok', series: out }
}

// Wikipedia 영문 문서 일별 조회수 (최근 60일)
async function wikiSeries(article) {
  const end = new Date(Date.now() - DAY)
  const start = new Date(end.getTime() - 60 * DAY)
  const f = (d) => ymd(d).replace(/-/g, '')
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(article)}/daily/${f(start)}/${f(end)}`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`응답 ${res.status}`)
  const data = await res.json()
  return (data.items ?? []).map((p) => ({ t: `${p.timestamp.slice(0, 4)}-${p.timestamp.slice(4, 6)}-${p.timestamp.slice(6, 8)}`, v: p.views }))
}

// GDELT 해외 뉴스 보도량 (최근 3개월, 일별 기사 수). 5초에 1회만 부른다
let lastGdeltAt = 0
async function gdeltSeries(term, retry = true) {
  const wait = lastGdeltAt + 6000 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastGdeltAt = Date.now()
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(term.includes(' ') ? `"${term}"` : term)}&mode=timelinevolraw&timespan=3m&format=json`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
  const text = await res.text()
  if (text.startsWith('Please limit') && retry) return gdeltSeries(term, false) // 한 번만 6초 뒤 다시
  if (!res.ok || !text.startsWith('{')) throw new Error(text.startsWith('Please limit') ? '요청 제한' : `응답 ${res.status}`)
  const data = JSON.parse(text)
  return (data.timeline?.[0]?.data ?? []).map((p) => ({ t: `${p.date.slice(0, 4)}-${p.date.slice(4, 6)}-${p.date.slice(6, 8)}`, v: p.value }))
}

// ── 지난 정상 값 (출처별 · 키별) ──
const GOOD_KEY = 'trends_last_good'
let good = null
// 11/08: 지난 정상 값은 기록 표(tech_trend_values, 출처 이름 앞에 'kw:')에도 쌓는다.
// 상태 묶음(trends_last_good)에 없는 값은 기록에서 가장 최근 값으로 채운다 (저장이 꼬이거나 처음 켤 때)
async function loadGood() {
  if (!good) {
    good = await getSetting(GOOD_KEY, {}).catch(() => ({}))
    for (const r of await latestValues('kw:')) {
      const source = r.source.slice(3)
      if (r.kind === 'series' && r.value?.series?.length && !good[source]?.[r.term]) (good[source] ??= {})[r.term] = { ...r.value, fromHistory: true }
    }
  }
  return good
}
async function remember(source, key, series) {
  const g = await loadGood()
  const at = new Date().toISOString()
  ;(g[source] ??= {})[key] = { series, at }
  await setSetting(GOOD_KEY, g).catch(() => {})
  keepValue(`kw:${source}`, key, 'series', '', { series, at })
  await flushValues()
}
// 새로 받기: 성공하면 기억, 실패하면 지난 값 { series, at, stale: true, error }
async function withLastGood(source, key, fetcher) {
  try {
    const series = await fetcher()
    if (series?.length) await remember(source, key, series)
    return { series, at: new Date().toISOString() }
  } catch (err) {
    const last = (await loadGood())[source]?.[key]
    return last ? { series: last.series, at: last.at, stale: true, error: err.message } : { series: [], error: err.message }
  }
}

// ── GDELT: 6시간 묶음과 따로 30분마다 다시 시도 ──
const GDELT_EVERY = 30 * 60_000
const GDELT_GIVE_UP = 24 * 3600_000 // 이만큼 계속 실패하고 한 번도 못 받았으면 그래프에서 뺀다
const GDELT_STALE_MAX = 7 * DAY // 지난 값이 이보다 오래되면 보여 주지 않는다
const gdelt = { terms: [], startedAt: null, lastTryAt: null, lastOkAt: null, timer: null, running: false }

async function gdeltRound() {
  if (gdelt.running || gdelt.terms.length === 0) return
  gdelt.running = true
  gdelt.lastTryAt = new Date().toISOString()
  try {
    for (const term of gdelt.terms) {
      const r = await withLastGood('gdelt', term, () => gdeltSeries(term))
      if (!r.error) gdelt.lastOkAt = r.at
    }
  } finally {
    gdelt.running = false
  }
  const ok = gdelt.lastOkAt ? '받음' : '실패'
  console.log(`[trends] GDELT 30분 시도: ${ok} (${gdelt.terms.join(', ')})`)
}

function startGdelt(terms) {
  gdelt.terms = [...new Set(terms)]
  if (gdelt.timer) return
  gdelt.startedAt = new Date().toISOString()
  gdeltRound()
  gdelt.timer = setInterval(gdeltRound, GDELT_EVERY)
  gdelt.timer.unref?.()
}

// 화면에 줄 GDELT 상태: 지난 값이 있으면 그 값, 없으면 시도 중 / 24시간 실패면 retired(그래프 빼기)
async function gdeltView(term) {
  const last = (await loadGood()).gdelt?.[term]
  const fresh = last && Date.now() - Date.parse(last.at) < GDELT_STALE_MAX
  if (fresh) return { term, series: last.series, at: last.at, stale: Date.now() - Date.parse(last.at) > GDELT_EVERY * 2 }
  const failingFor = Date.now() - Date.parse(gdelt.startedAt ?? new Date().toISOString())
  if (!gdelt.lastOkAt && failingFor >= GDELT_GIVE_UP) return { term, retired: true }
  return { term, series: [], error: '요청 제한', retryAt: gdelt.lastTryAt }
}

// 급증: 최근 7일 합이 그 전 21일 주평균의 1.5배 이상이고 5건 이상 (뉴스 기사량 기준)
// 비교할 과거가 14일 이상 쌓이기 전에는 판단하지 않는다 (수집을 시작한 직후·출처를 늘린 직후는 늘어 보이기만 함)
// 수집 방식이 바뀐 날(출처 20곳 추가, 22 문서 1장). 그 전 기사 수는 지금과 기준이 달라 급증 비교에서 뺀다
// (10/31 빠짐없는 수집, 11/06 출처 확대로 기사 수가 계단처럼 늘었음)
const BASELINE_SINCE = Date.parse('2026-11-06')

export function surgeOf(all = []) {
  if (all.length === 0) return null
  const last = Date.parse(all.at(-1).t)
  const inRange = (list, from, to) => list.filter((p) => Date.parse(p.t) > last - to * DAY && Date.parse(p.t) <= last - from * DAY)
  // 최근 7일 기사 수는 그대로 보여 주고, 비교(급증)는 기준일 이후 데이터로만
  const week = inRange(all, 0, 7).reduce((s, p) => s + p.v, 0)
  const past = inRange(all.filter((p) => Date.parse(p.t) >= BASELINE_SINCE), 7, 28)
  const before = past.reduce((s, p) => s + p.v, 0) / 3
  const enough = past.length >= 14
  return { week, before: Math.round(before * 10) / 10, enough, surge: enough && week >= 5 && before > 0 && week >= before * 1.5 }
}

async function build() {
  const keywords = dbEnabled() ? await getKeywords() : []
  const news = await newsSeries(keywords).catch(() => ({}))
  startGdelt(keywords.map(globalOf).filter(Boolean).map((g) => g.en))
  let naver = await naverSeries(keywords).catch((err) => ({ status: 'error', error: err.message }))
  // 네이버: 성공하면 키워드별로 기억, 실패하면 지난 값 (키 없음·권한 꺼짐은 그대로 안내)
  if (naver.status === 'ok') {
    for (const [k, series] of Object.entries(naver.series)) if (series.length) await remember('naver', k, series)
    naver.at = new Date().toISOString()
  } else if (naver.status === 'error') {
    const last = (await loadGood()).naver ?? {}
    const keys = keywords.filter((k) => last[k])
    if (keys.length) naver = { status: 'ok', stale: true, error: naver.error, at: keys.map((k) => last[k].at).sort()[0], series: Object.fromEntries(keys.map((k) => [k, last[k].series])) }
  }
  // 특허: 30일에 한 번 BigQuery로 받아 둔 값 (patents.js). 처음 받는 중이면 끝날 때까지 기다린다
  let patents = await getPatentTrends(keywords).catch((err) => ({ status: 'error', error: err.message }))
  if (patents.status === 'loading') {
    await patents.wait
    patents = await getPatentTrends(keywords).catch((err) => ({ status: 'error', error: err.message }))
  }
  // 특허: 받은 값은 기록, 못 받으면 기록의 지난 값 (11/08)
  if (patents.status === 'ok') {
    for (const [k, series] of Object.entries(patents.series ?? {})) if (series?.length) keepValue('kw:patents', k, 'series', '', { series, at: patents.at ?? new Date().toISOString() })
    await flushValues()
  } else if (patents.status === 'error') {
    const last = (await loadGood()).patents ?? {}
    const keys = keywords.filter((k) => last[k])
    if (keys.length) patents = { status: 'ok', stale: true, error: patents.error, at: keys.map((k) => last[k].at).sort()[0], series: Object.fromEntries(keys.map((k) => [k, last[k].series])) }
  }
  const items = []
  for (const keyword of keywords) {
    const g = globalOf(keyword)
    const item = { keyword, news: news[keyword] ?? [], newsSurge: surgeOf(news[keyword] ?? []), naver: naver.status === 'ok' ? naver.series[keyword] ?? [] : null }
    if (g) {
      item.wiki = { article: g.wiki, url: `https://en.wikipedia.org/wiki/${g.wiki}`, ...(await withLastGood('wiki', g.wiki, () => wikiSeries(g.wiki))) }
      item.gdelt = { term: g.en } // 실제 값은 getTrends에서 요청 때마다 채움 (30분마다 바뀜)
    }
    item.patents = patents.status === 'ok' && patentPatternOf(keyword) ? patents.series[keyword] ?? [] : null
    items.push(item)
  }
  return {
    items,
    naverStatus: naver.status,
    naverError: naver.error ?? null,
    naverAt: naver.at ?? null,
    naverStale: Boolean(naver.stale),
    patentStatus: patents.status,
    patentAt: patents.at ?? null,
    patentStale: Boolean(patents.stale),
    updatedAt: new Date().toISOString(),
  }
}

let cache = null
let building = null

// 오래된 값이 있으면 그것을 바로 주고 뒤에서 새로 받는다. 처음이면 기다린다
export async function getTrends({ fresh = false } = {}) {
  const stale = !cache || fresh || Date.now() - Date.parse(cache.updatedAt) > CACHE_MS
  if (stale && !building) {
    building = build()
      .then((v) => (cache = v))
      .catch((err) => console.warn(`[trends] 추이 받기 실패: ${err.message}`))
      .finally(() => (building = null))
  }
  if (!cache || fresh) await building
  return cache ? withGdelt(cache) : { items: [], naverStatus: 'error', updatedAt: null }
}

// GDELT 칸은 30분마다 바뀌므로 6시간 묶음 위에 요청 때마다 덮어쓴다
async function withGdelt(base) {
  const items = await Promise.all(base.items.map(async (it) => (it.gdelt?.term ? { ...it, gdelt: await gdeltView(it.gdelt.term) } : it)))
  return { ...base, items, gdelt: { every: '30분', startedAt: gdelt.startedAt, lastTryAt: gdelt.lastTryAt, lastOkAt: gdelt.lastOkAt } }
}
