// 논문 출처 사슬 (조장 11/07: "OpenAlex 제한되면 다른 거, 다른 거 제한되면 그다음 거")
// 순서: OpenAlex(키) → Crossref → Semantic Scholar → arXiv (providers.js)
// - 한도(429) · 서버 오류 · 시간 초과면 그 출처를 「언제까지 쉼」으로 적고 다음 출처로 넘어간다
//   OpenAlex: 하루 예산이라 다음 00:00 UTC(한국 09:00)까지 · 나머지: 응답의 Retry-After 또는 10~30분
// - 출처 상태(쉬는 시각 · 마지막 성공 · 마지막 오류)는 app_settings 'paper_sources'에 둔다 → 관리 페이지 「수집 출처」에 보임
// - 받은 결과는 paper_cache 표(DB 없으면 서버 메모리)에 둔다. 검색 6시간, 논문 수 24시간(지난 달 값은 30일)
import { dbEnabled, query } from '../db/index.js'
import { getSetting, setSetting } from '../db/store.js'
import { LimitedError, PROVIDERS, UnsupportedError } from './providers.js'

export { abstractFromIndex, openAlexGet, LimitedError } from './providers.js'

const STATE_KEY = 'paper_sources'
const HOUR = 3600_000
export const TTL = { search: 6 * HOUR, count: 24 * HOUR, pastMonth: 30 * 24 * HOUR, popular: 7 * 24 * HOUR }

// ── 출처 상태 ──
// { [id]: { limitedUntil, reason, lastOk, lastError, lastErrorAt } }
// Vite가 서버를 다시 올려 모듈 사본이 여러 개여도 같은 상태를 보도록 globalThis에 둔다
let loaded = globalThis.__paperState ? Promise.resolve() : null
async function state() {
  loaded ??= getSetting(STATE_KEY, {})
    .catch(() => ({}))
    .then((s) => {
      globalThis.__paperState ??= s ?? {}
    })
  await loaded
  return globalThis.__paperState
}
async function saveState() {
  await setSetting(STATE_KEY, globalThis.__paperState).catch((err) => console.warn(`[papers] 상태 저장 실패: ${err.message}`))
}
async function markLimited(id, until, reason) {
  const s = await state()
  s[id] = { ...s[id], limitedUntil: new Date(until).toISOString(), reason, lastError: reason, lastErrorAt: new Date().toISOString() }
  console.warn(`[papers] ${id} 쉼: ${reason} → ${s[id].limitedUntil}`)
  await saveState()
}
async function markOk(id) {
  const s = await state()
  s[id] = { ...s[id], limitedUntil: null, reason: null, lastOk: new Date().toISOString() }
  await saveState()
}
async function markError(id, message) {
  const s = await state()
  s[id] = { ...s[id], lastError: message, lastErrorAt: new Date().toISOString() }
  await saveState()
}
export async function isLimited(id) {
  const until = Date.parse((await state())[id]?.limitedUntil ?? '')
  return Number.isFinite(until) && until > Date.now() ? until : 0
}

// 시험·관리용: 출처를 일부러 막거나 풀기 (until 없으면 풀기)
export async function forceLimit(id, until, reason = '시험으로 막음') {
  if (until) await markLimited(id, until, reason)
  else await markOk(id)
}

// 관리 페이지용 목록: 정상 / 한도 도달(언제 풀림) / 마지막 성공
export async function paperProviderStatus() {
  const s = await state()
  return PROVIDERS.map((p, i) => {
    const st = s[p.id] ?? {}
    const until = Date.parse(st.limitedUntil ?? '')
    const limited = Number.isFinite(until) && until > Date.now()
    return {
      id: p.id,
      name: p.name,
      order: i + 1,
      state: limited ? 'limited' : 'ok',
      limitedUntil: limited ? st.limitedUntil : null,
      reason: limited ? st.reason : null,
      lastOk: st.lastOk ?? null,
      lastError: st.lastError ?? null,
      lastErrorAt: st.lastErrorAt ?? null,
      keyed: p.id === 'openalex' ? Boolean(process.env.OPENALEX_API_KEY) : p.id === 'semanticscholar' ? Boolean(process.env.SEMANTIC_SCHOLAR_API_KEY) : null,
    }
  })
}

// ── 캐시 (paper_cache 표 · DB 없으면 메모리) ──
const memCache = (globalThis.__paperCache ??= new Map())
export async function cacheGet(key) {
  if (!dbEnabled()) {
    const hit = memCache.get(key)
    return hit && hit.expires > Date.now() ? hit.value : null
  }
  const { rows } = await query('SELECT value FROM paper_cache WHERE key = $1 AND expires_at > now()', [key])
  return rows[0]?.value ?? null
}
export async function cachePut(key, value, ttlMs) {
  if (!dbEnabled()) {
    memCache.set(key, { value, expires: Date.now() + ttlMs })
    return
  }
  await query(
    `INSERT INTO paper_cache (key, value, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
    [key, JSON.stringify(value), Math.round(ttlMs / 1000)],
  )
  // 가끔 지난 것 지우기
  if (Math.random() < 0.02) await query('DELETE FROM paper_cache WHERE expires_at < now()').catch(() => {})
}

// ── 사슬로 부르기 ──
// fn(provider) 를 순서대로 시도한다. 쉬는 중이면 건너뛰고, 한도면 쉬게 하고 다음으로
// 결과: { value, provider } · 모두 실패하면 마지막 오류(모두 쉬는 중이면 LimitedError)
async function viaChain(ids, fn) {
  let lastErr = null
  let soonest = Infinity
  for (const p of PROVIDERS.filter((x) => ids.includes(x.id))) {
    const until = await isLimited(p.id)
    if (until) {
      soonest = Math.min(soonest, until)
      continue
    }
    try {
      const value = await fn(p)
      await markOk(p.id)
      // 이번 응답으로 예산을 거의 다 썼으면 다음부터 쉬게 (OpenAlex 머리글)
      if (value?.exhausted) await markLimited(p.id, value.exhausted, '하루 예산을 거의 다 씀')
      return { value, provider: p.id }
    } catch (err) {
      if (err instanceof UnsupportedError) continue
      if (err instanceof LimitedError) {
        await markLimited(p.id, err.until, err.message)
        soonest = Math.min(soonest, err.until)
      } else await markError(p.id, err.message)
      lastErr = err
    }
  }
  if (lastErr && !(lastErr instanceof LimitedError)) throw lastErr
  throw new LimitedError('논문 출처가 모두 한도에 걸렸거나 쓸 수 없어요', Number.isFinite(soonest) ? soonest : Date.now() + HOUR)
}

const reqKey = (req) => JSON.stringify([req.sources?.map((s) => s.openalex), req.topics?.map((t) => t.id), req.query ?? '', req.from, req.to, req.sort ?? 'date', req.limit ?? 50, req.allowPreprints ?? false])

// 논문 검색 (같은 요청은 6시간 캐시). 결과: { works, provider, cached }
export async function searchPapers(req, { ttlMs = TTL.search, providers = PROVIDERS.map((p) => p.id) } = {}) {
  const key = `search:${reqKey(req)}`
  const hit = await cacheGet(key).catch(() => null)
  if (hit) return { ...hit, cached: true }
  const { value, provider } = await viaChain(providers, (p) => p.search(req))
  const out = { works: [...value], provider }
  await cachePut(key, out, ttlMs).catch((err) => console.warn(`[papers] 캐시 저장 실패: ${err.message}`))
  return { ...out, cached: false }
}

// ── 논문 수 (월별) ──
// 한 줄(용어 하나)의 달 값은 반드시 한 출처에서 받는다 (출처마다 모으는 범위가 달라 섞으면 추이가 틀어짐)
// - prefer: 지난번에 쓴 출처. 그 출처가 쉬는 중이고 지난 값이 있으면 다른 출처로 바꾸지 않고 LimitedError → 부르는 쪽이 지난 값을 그대로 씀
// - 지난 값이 없을 때만 다음 출처로 (Crossref는 낱말 아무거나 맞춰 수가 부풀어서 빼고, Semantic Scholar → arXiv)
// - 끝난 달(이번 달 · 지난달 말고)은 30일 캐시, 최근 두 달은 24시간 캐시 → 하루에 용어 하나당 많아야 2~3번
const COUNT_IDS = PROVIDERS.filter((p) => p.canCount).map((p) => p.id)
const monthEnd = (m) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)
}
export async function countMonthly(term, months, { prefer = null, hasHistory = false } = {}) {
  const now = new Date().toISOString().slice(0, 7)
  const prevMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 7)
  const recent = (m) => m === now || m === prevMonth
  let order = COUNT_IDS
  if (prefer && COUNT_IDS.includes(prefer)) {
    const until = await isLimited(prefer)
    if (until && hasHistory) throw new LimitedError(`${PROVIDERS.find((p) => p.id === prefer).name} 한도 도달 · 지난 값 사용`, until)
    if (!until) order = [prefer, ...COUNT_IDS.filter((id) => id !== prefer)]
  }
  const t = term.toLowerCase()
  const { value, provider } = await viaChain(order, async (p) => {
    const out = {}
    const missing = []
    for (const m of months) {
      const hit = await cacheGet(`count:${p.id}:${t}:${m}`).catch(() => null)
      if (hit != null) out[m] = hit
      else missing.push(m)
    }
    let exhausted = null
    // OpenAlex: 빈 달이 여러 개면 날짜 목록 한 번(200편 이하일 때)으로 채워 본다
    if (p.countDates && missing.length > 2) {
      const r = await p.countDates(term, `${missing[0]}-01`, monthEnd(missing.at(-1)))
      exhausted = r.exhausted ?? exhausted
      if (r.dates) {
        for (const m of missing) out[m] = 0
        for (const d of r.dates) if (d.slice(0, 7) in out && missing.includes(d.slice(0, 7))) out[d.slice(0, 7)]++
        missing.length = 0
      }
    }
    for (const m of missing) {
      const r = await p.count(term, `${m}-01`, monthEnd(m))
      exhausted = r.exhausted ?? exhausted
      out[m] = r.value
    }
    for (const m of months) await cachePut(`count:${p.id}:${t}:${m}`, out[m], recent(m) ? TTL.count : TTL.pastMonth).catch(() => {})
    return Object.assign(out, exhausted ? { exhausted } : {})
  })
  delete value.exhausted
  return { months: value, provider }
}

export { PROVIDERS }
