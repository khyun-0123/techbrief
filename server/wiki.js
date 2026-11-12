// 용어 백과: 위키백과 요약 (27 문서 4장). 보고서 사실 근거가 아니라 용어를 이해하는 데만 쓴다
// - 한국어 위키백과에서 찾고, 없으면 영어 위키백과
// - 문서 제목을 모르므로 검색 API로 가장 맞는 문서 하나를 고른 뒤 REST 요약을 받는다
// - 라이선스 CC BY-SA: 화면에 출처(위키백과)와 문서 링크를 같이 보여 준다 (23 문서)
import { guardedFetch } from './sourceGuard.js'
const UA = 'techbrief/0.1 (student project; term lookup)'
const CACHE_MS = 24 * 3600_000
const CACHE_MAX = 300
const cache = new Map() // term → { at, data }

// 공용 서버 IP는 위키백과가 짧은 시간에 여러 번 부르면 429로 막는다 (11/08 시험: 용어 5개 연달아 → 429)
// → 한 번에 하나씩, 최소 1초 간격으로 부르고, 한 언어에 한 번만 부른다 (검색 + 요약을 한 요청으로)
let chain = Promise.resolve()
let lastAt = 0
function throttled(fn) {
  const run = chain.then(async () => {
    const wait = lastAt + 1000 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastAt = Date.now()
    return fn()
  })
  chain = run.catch(() => {})
  return run
}

async function getJson(url) {
  const res = await throttled(() => guardedFetch('wikipedia', url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }))
  if (res.status === 429) throw Object.assign(new Error('위키백과가 잠시 요청을 막았어요. 1분쯤 뒤에 다시 찾아 주세요.'), { status: 429 })
  if (!res.ok) throw Object.assign(new Error(`위키백과 응답 ${res.status}`), { status: 502 })
  return res.json()
}

const norm = (s) => String(s).toLowerCase().replace(/[\s\-·()]/g, '')

// 검색 결과 중 제목이 용어와 맞는 문서만 쓴다 (예전: 「탠덤 OLED」 → 장비 회사 문서가 1위로 나와 그대로 보여 줌)
// 1) 제목이 용어를 품거나 용어가 제목을 품음 → exact  2) 용어의 낱말(2글자 이상) 하나가 제목에 있음 → near
function pickPage(pages, term) {
  const t = norm(term)
  // 용어가 제목을 품는 경우는 거의 같은 길이일 때만 (「QD-OLED」가 「OLED」 문서로 가지 않게)
  const exact = pages.find((p) => {
    const n = norm(p.title)
    return n.includes(t) || (t.includes(n) && n.length >= t.length * 0.8)
  })
  if (exact) return { page: exact, near: false }
  const words = term.split(/\s+/).map(norm).filter((w) => w.length >= 2)
  const near = pages.find((p) => words.some((w) => norm(p.title).includes(w)))
  return near ? { page: near, near: true } : null
}

// 검색 상위 5개 문서의 첫 문단을 한 번에 받는다 (뜻이 여러 개인 문서는 뺌)
async function lookupIn(lang, term) {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: term,
    gsrlimit: '5',
    prop: 'extracts|description|info|pageprops',
    exintro: '1',
    explaintext: '1',
    exsentences: '4',
    inprop: 'url',
    ppprop: 'disambiguation',
    redirects: '1',
  })
  const data = await getJson(`https://${lang}.wikipedia.org/w/api.php?${q}`)
  const pages = (data?.query?.pages ?? [])
    .filter((p) => p.extract && !p.pageprops?.disambiguation)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const picked = pickPage(pages, term)
  if (!picked) return null
  const { page, near } = picked
  return {
    near, // 용어와 딱 맞는 문서가 아니라 가장 가까운 문서
    lang,
    title: page.title,
    description: page.description ?? '',
    extract: page.extract,
    url: page.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
  }
}

export async function lookupWiki(raw) {
  const term = String(raw ?? '').trim().slice(0, 60)
  if (!term) throw Object.assign(new Error('찾을 용어를 넣어 주세요.'), { status: 400 })
  const hit = cache.get(term)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data
  // 한국어에서 딱 맞는 문서 → 영어에서 딱 맞는 문서 → 가까운 문서 순
  const ko = await lookupIn('ko', term)
  const en = ko && !ko.near ? null : await lookupIn('en', term)
  const result = [ko, en].find((r) => r && !r.near) ?? ko ?? en ?? null
  const data = { term, result }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
  cache.set(term, { at: Date.now(), data })
  return data
}
