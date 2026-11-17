// 검색어 → 영문 검색어 (11/10 조장: 등록 키워드가 아닌 새 키워드도 논문 · 영문 출처를 찾게)
// 순서: 영문만 있으면 그대로 → 저장해 둔 표기(query_terms 표) → 별칭표(aliases.js) → 없으면 새로 만들고 저장
//   새로 만들 때: Google Cloud Translation(특허용 GCP 서비스 계정 키, 0.3초) → 안 되면 맥미니 AI(1~3개, 11/10 실측 20~60초)
//   Cloud Translation API는 GCP 프로젝트에서 켜야 한다 (11/10 확인: 꺼져 있어 403). 꺼져 있으면 1시간 동안 AI로만
// - AI에는 검색어 한 단어만 보낸다 (기사 내용은 넣지 않음 → 네이버 약관의 AI 입력 금지와 무관)
// - AI 대기열이 밀려 WAIT_MS 안에 안 오면 이번 찾기는 논문 없이 돌려주고, 뒤에서 마저 만들어 저장한다 (다음 찾기부터 바로)
// - 관리 페이지 「검색어 영문 표기」에서 고치거나 지울 수 있다 (source 'admin'은 AI가 덮어쓰지 않음)
// 「자주 찾은 새 키워드」 (11/10 조장: 자동 수집 키워드는 회의를 거쳐 관리자가 넣는다): 찾기마다 검색어 · 날짜별 횟수를 세어
// 관리 페이지에 보여 준다. 사람 수는 IP를 그대로 두지 않고 날짜를 섞은 해시 앞 12자리만 둔다
import { createHash } from 'node:crypto'
import { englishOf } from './collector/aliases.js'
import { dbEnabled, query } from './db/index.js'
import { chatJson, PRIORITY } from './llm/client.js'
import { accessToken, readKey } from './patents.js'

const WAIT_MS = 10_000
const MAX_TERMS = 3
const HANGUL = /[가-힣]/

export const queryKey = (q) => String(q ?? '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 50)

const memTerms = (globalThis.__queryTerms ??= new Map()) // DB 없을 때
const pending = (globalThis.__queryTermsPending ??= new Map()) // 같은 말을 AI에 두 번 보내지 않게

// 영문 검색어로 쓸 수 있는 말만 (영문 · 숫자 · 기호, 60자 이내), 중복 없이 최대 3개
export function cleanTerms(list) {
  const out = []
  for (const t of Array.isArray(list) ? list : []) {
    // 괄호 속 덧붙임은 뺀다 (예: 'charge generation layer (CG layer)' → 같은 말이 두 번 되지 않게)
    const s = String(t ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
    if (!s || s.length > 60 || HANGUL.test(s) || !/[a-z]/i.test(s)) continue
    if (out.some((x) => x.toLowerCase() === s.toLowerCase())) continue
    out.push(s)
    if (out.length === MAX_TERMS) break
  }
  return out
}

async function storedTerms(key) {
  if (!dbEnabled()) return memTerms.get(key) ?? null
  const { rows } = await query('SELECT terms, source FROM query_terms WHERE query = $1', [key])
  return rows[0] ? { terms: rows[0].terms, source: rows[0].source } : null
}

async function storeTerms(key, terms, source) {
  if (!dbEnabled()) {
    const before = memTerms.get(key)
    if (before?.source === 'admin' && source !== 'admin') return
    memTerms.set(key, { terms, source, updatedAt: new Date().toISOString() })
    return
  }
  await query(
    `INSERT INTO query_terms (query, terms, source) VALUES ($1, $2, $3)
     ON CONFLICT (query) DO UPDATE SET terms = EXCLUDED.terms, source = EXCLUDED.source, updated_at = now()
      WHERE query_terms.source <> 'admin' OR EXCLUDED.source = 'admin'`,
    [key, JSON.stringify(terms), source],
  )
}

const SCHEMA = {
  type: 'object',
  properties: { terms: { type: 'array', items: { type: 'string' } } },
  required: ['terms'],
}

// Google Cloud Translation v3 (서비스 계정). 실패하면 null → AI로. 꺼져 있거나 권한이 없으면 한동안 부르지 않는다
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/cloud-translation'
const googleState = (globalThis.__googleTranslate ??= { token: null, tokenUntil: 0, offUntil: 0, lastError: null })
async function googleTranslate(q) {
  if (Date.now() < googleState.offUntil) return null
  const key = readKey()
  if (!key?.project_id) return null
  try {
    if (!googleState.token || Date.now() > googleState.tokenUntil) {
      googleState.token = await accessToken(key, GOOGLE_SCOPE)
      googleState.tokenUntil = Date.now() + 50 * 60_000
    }
    const res = await fetch(`https://translation.googleapis.com/v3/projects/${key.project_id}:translateText`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${googleState.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [q], sourceLanguageCode: 'ko', targetLanguageCode: 'en', mimeType: 'text/plain' }),
      signal: AbortSignal.timeout(5_000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      googleState.lastError = `${res.status} ${data.error?.status ?? ''}`.trim()
      if (res.status === 403 || res.status === 401) googleState.offUntil = Date.now() + 3600_000
      return null
    }
    googleState.lastError = null
    return cleanTerms([data.translations?.[0]?.translatedText])
  } catch (err) {
    googleState.lastError = err.message
    return null
  }
}
export const translateStatus = () => ({ google: Date.now() < googleState.offUntil ? 'off' : 'try', googleError: googleState.lastError })

async function translate(q) {
  const google = await googleTranslate(q)
  if (google?.length) return { terms: google, source: 'google' }
  return { terms: await translateLlm(q), source: 'llm' }
}

async function translateLlm(q) {
  const { data } = await chatJson({
    kind: 'translate',
    priority: PRIORITY.USER,
    timeoutMs: 60_000,
    schema: SCHEMA,
    schemaName: 'search_terms',
    messages: [
      {
        role: 'system',
        content: `너는 디스플레이 · 반도체 기술 분야 검색어를 영어 논문 · 영문 기사 검색어로 옮긴다.
- 업계와 논문에서 실제로 쓰는 영어 용어로 1~3개. 첫 번째가 가장 일반적인 표기.
- 약어가 흔하면 약어도 하나 넣는다 (예: 유기발광다이오드 → OLED). 이미 영어인 부분(OLED, QD 등)은 그대로 둔다.
- 회사 이름은 공식 영문 이름으로 (예: 삼성디스플레이 → Samsung Display).
- 설명 없이 JSON만: {"terms": ["...", "..."]}`,
      },
      { role: 'user', content: q },
    ],
  })
  return cleanTerms(data?.terms)
}

// 돌려주는 값: { terms: [...], source: 'as-is' | 'alias' | 'llm' | 'admin' | null, pending?: true, error?: string }
export async function englishTerms(rawQuery, { waitMs = WAIT_MS } = {}) {
  const q = String(rawQuery ?? '').trim().slice(0, 50)
  if (!q) return { terms: [], source: null }
  if (!HANGUL.test(q)) return { terms: [q], source: 'as-is' }
  const key = queryKey(q)
  const stored = await storedTerms(key).catch(() => null)
  if (stored?.terms?.length) return { terms: stored.terms, source: stored.source }
  const alias = englishOf(q)
  if (alias) return { terms: [alias], source: 'alias' }
  let job = pending.get(key)
  if (!job) {
    job = translate(q)
      .then(async (r) => {
        if (r.terms.length) await storeTerms(key, r.terms, r.source).catch((err) => console.warn(`[queryTerms] 저장 실패: ${err.message}`))
        return r
      })
      .finally(() => pending.delete(key))
    pending.set(key, job)
  }
  let timer
  const timeout = new Promise((resolve) => (timer = setTimeout(() => resolve(null), waitMs)))
  try {
    const r = await Promise.race([job, timeout])
    if (r === null) return { terms: [], source: null, pending: true }
    return { terms: r.terms, source: r.terms.length ? r.source : null }
  } catch (err) {
    return { terms: [], source: null, error: err.message }
  } finally {
    clearTimeout(timer)
  }
}

// 저장된 표기만 (AI를 부르지 않음). 자동 수집처럼 뒤에서 도는 곳에서 쓴다
export async function knownTerms(rawQuery) {
  const q = String(rawQuery ?? '').trim()
  if (!q) return []
  if (!HANGUL.test(q)) return [q]
  const stored = await storedTerms(queryKey(q)).catch(() => null)
  if (stored?.terms?.length) return stored.terms
  const alias = englishOf(q)
  return alias ? [alias] : []
}

// 이미 영문 이름을 아는 말(요즘 뜨는 기술의 en 등)을 저장해 번역을 건너뛴다. 관리자가 고친 값은 덮어쓰지 않음
export async function rememberTerms(rawQuery, terms, source = 'trend') {
  const clean = cleanTerms(terms)
  if (!HANGUL.test(String(rawQuery)) || !clean.length) return
  await storeTerms(queryKey(rawQuery), clean, source)
}

// OpenAlex 검색어: 여러 표기를 OR로 (띄어 쓴 말은 괄호로 묶음)
export const openAlexQuery = (terms) => (terms.length === 1 ? terms[0] : terms.map((t) => (t.includes(' ') ? `(${t})` : t)).join(' OR '))

// ── 관리 페이지 ──
export async function listQueryTerms() {
  if (!dbEnabled()) return [...memTerms].map(([q, v]) => ({ query: q, ...v }))
  const { rows } = await query('SELECT query, terms, source, updated_at FROM query_terms ORDER BY updated_at DESC LIMIT 200')
  return rows.map((r) => ({ query: r.query, terms: r.terms, source: r.source, updatedAt: r.updated_at.toISOString() }))
}

// terms가 비면 지운다 (다음 찾기 때 AI가 다시 만듦)
export async function setQueryTerms(rawQuery, terms) {
  const key = queryKey(rawQuery)
  if (!key) throw Object.assign(new Error('검색어가 비었어요.'), { status: 400 })
  const clean = cleanTerms(terms)
  if (!clean.length) {
    if (dbEnabled()) await query('DELETE FROM query_terms WHERE query = $1', [key])
    else memTerms.delete(key)
    return { query: key, terms: [], source: null }
  }
  await storeTerms(key, clean, 'admin')
  return { query: key, terms: clean, source: 'admin' }
}

// ── 검색어 횟수 ──
const memCounts = (globalThis.__searchCounts ??= new Map())
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10) // 한국 날짜
const personOf = (ip, day) => createHash('sha256').update(`${day}|${ip ?? ''}`).digest('hex').slice(0, 12)

// open: 키워드 분석을 연 것 (11/17 P12). 찾은 횟수(searches)와 따로 opens로 센다. 사람 수는 같이 (그 말을 쓴 사람)
export async function recordSearch(rawQuery, ip, { open = false } = {}) {
  const key = queryKey(rawQuery)
  if (!key) return
  const day = today()
  const person = personOf(ip, day)
  if (!dbEnabled()) {
    const k = `${key}|${day}`
    const e = memCounts.get(k) ?? { query: key, day, searches: 0, opens: 0, people: new Set() }
    if (open) e.opens = (e.opens ?? 0) + 1
    else e.searches += 1
    e.people.add(person)
    memCounts.set(k, e)
    return
  }
  await query(
    `INSERT INTO search_counts (query, day, searches, opens, people) VALUES ($1, $2, $4, $5, ARRAY[$3])
     ON CONFLICT (query, day) DO UPDATE SET searches = search_counts.searches + $4, opens = search_counts.opens + $5,
       people = CASE WHEN $3 = ANY(search_counts.people) THEN search_counts.people ELSE array_append(search_counts.people, $3) END`,
    [key, day, person, open ? 0 : 1, open ? 1 : 0],
  )
}

// 최근 days일 동안 찾은 횟수 (자동 수집 키워드 · 추천 검색어는 exclude로 뺀다)
// people은 날짜마다 따로 세서 더한 값이라 「사람 · 일」에 가깝다 (같은 사람이 이틀 찾으면 2)
export async function frequentSearches({ days = 14, exclude = [], limit = 30 } = {}) {
  const skip = new Set(exclude.map(queryKey))
  const since = new Date(Date.now() + 9 * 3600_000 - days * 86_400_000).toISOString().slice(0, 10)
  let rows
  if (!dbEnabled()) {
    const by = new Map()
    for (const e of memCounts.values()) {
      if (e.day < since) continue
      const x = by.get(e.query) ?? { query: e.query, searches: 0, opens: 0, people: 0, last_day: e.day }
      x.searches += e.searches
      x.opens += e.opens ?? 0
      x.people += e.people.size
      if (e.day > x.last_day) x.last_day = e.day
      by.set(e.query, x)
    }
    rows = [...by.values()]
  } else {
    ;({ rows } = await query(
      `SELECT query, sum(searches)::int AS searches, sum(opens)::int AS opens, sum(cardinality(people))::int AS people, max(day)::text AS last_day
         FROM search_counts WHERE day >= $1 GROUP BY query`,
      [since],
    ))
  }
  const terms = new Map((await listQueryTerms().catch(() => [])).map((t) => [t.query, t]))
  return rows
    .filter((r) => !skip.has(r.query))
    .sort((a, b) => b.people - a.people || b.searches + b.opens - (a.searches + a.opens))
    .slice(0, limit)
    .map((r) => ({ query: r.query, searches: r.searches, opens: r.opens ?? 0, people: r.people, lastDay: r.last_day, terms: terms.get(r.query)?.terms ?? null, termsSource: terms.get(r.query)?.source ?? null }))
}

export async function pruneSearchCounts() {
  if (!dbEnabled()) return
  await query("DELETE FROM search_counts WHERE day < (now() - interval '90 days')::date")
}
