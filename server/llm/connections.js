// AI 연결 (11/25 조장: 「사용자가 테크브리프 사이트에서 모든 걸 하게」) — 관리 페이지에서 AI 서버 주소 · API 키를 넣고 바꾸고 끄고, 새 연결을 더한다
// - 키는 넣기만 한다(단방향). 화면에는 「있음 / 없음」과 어디서 온 값인지만 보낸다. 키 글자는 어떤 응답 · 기록 · 로그에도 싣지 않는다
// - DB(settings 'llm_connections')에는 암호화해서 둔다 (AES-256-GCM). 암호 열쇠는 DB 밖(서버 설정 TB_SECRET_KEY, 없으면 관리자 비밀번호 설정값)에서 만든다
//   → DB 덤프만으로는 키를 읽을 수 없다. 암호 열쇠가 바뀌면 예전 키를 못 풀어 「다시 넣어 주세요」로 보인다
// - 기본 세 곳(맥미니 · OpenRouter · EXAONE)은 바꾸기 · 되돌리기 · 끄기만, 지우기는 막는다. 새로 더한 연결은 비밀번호를 다시 넣어야 지울 수 있다
// - 되돌리기: 바로 전 값으로 한 번 (기본 세 곳은 사이트에서 넣은 적이 없으면 서버 설정 파일 값)
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { getSetting, setSetting } from '../db/store.js'

export const BUILTIN_IDS = ['local', 'openrouter', 'exaone']
const SETTING = 'llm_connections'
const MODEL_RE = /^[\w.:/@+-]{2,120}$/
const MAX_CUSTOM = 8

// 메모리: 저장된 기록(암호문 그대로) + 푼 키. 화면으로 나가는 값은 publicConnections()만
const S = (globalThis.__techbriefLlmConnections ??= { stored: { builtin: {}, custom: [] }, plain: new Map(), broken: new Set(), loaded: false })

// ── 암호화 ──
function secretSource() {
  if (process.env.TB_SECRET_KEY) return 'dedicated'
  if (process.env.ADMIN_PASSWORD || process.env.REFRESH_PASSWORD) return 'admin'
  return 'none'
}
function cryptKey() {
  const s = process.env.TB_SECRET_KEY || process.env.ADMIN_PASSWORD || process.env.REFRESH_PASSWORD
  if (!s) throw Object.assign(new Error('서버에 암호 열쇠가 없어 API 키를 저장할 수 없어요. 서버 설정에 TB_SECRET_KEY(또는 ADMIN_PASSWORD)가 필요해요.'), { status: 503 })
  return scryptSync(s, 'techbrief-llm-connections-v1', 32)
}
function seal(text) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', cryptKey(), iv)
  const body = Buffer.concat([c.update(String(text), 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join(':')
}
function open(box) {
  const [v, iv, tag, body] = String(box ?? '').split(':')
  if (v !== 'v1' || !body) return null
  try {
    const d = createDecipheriv('aes-256-gcm', cryptKey(), Buffer.from(iv, 'base64'))
    d.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

// ── 값 확인 ──
const bad = (msg) => Object.assign(new Error(msg), { status: 400 })
function checkUrl(v) {
  const s = String(v ?? '').trim().replace(/\/$/, '')
  let u
  try {
    u = new URL(s)
  } catch {
    throw bad('AI 서버 주소를 https://… 형태로 넣어 주세요.')
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw bad('AI 서버 주소는 http(s) 주소만 넣을 수 있어요 (주소 안에 아이디 · 비밀번호는 넣지 않아요).')
  return s.slice(0, 300)
}
// Vertex AI (11/26 조장 「GCP 크레딧으로 젬마 병렬」): 키 대신 서버의 Google 서비스 계정(GCP_KEY_JSON)으로 1시간짜리 토큰을 받아 쓴다 (client.js)
export const isVertexUrl = (u) => /^https:\/\/([a-z0-9-]+-)?aiplatform\.googleapis\.com(\/|$)/.test(String(u ?? ''))
// 동시에 보낼 AI 요청 수 (11/26): 맥미니는 모델 하나라 1, 상용 API는 여럿. 1이면 예전과 똑같이 하나씩
export const PARALLEL_MAX = 16
function checkParallel(v) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1 || n > PARALLEL_MAX) throw bad(`동시 요청 수는 1~${PARALLEL_MAX} 사이 정수로 넣어 주세요.`)
  return n
}
function checkKey(v) {
  const s = String(v ?? '').trim()
  if (s.length < 8 || s.length > 500 || /\s/.test(s)) throw bad('API 키는 띄어쓰기 없이 8~500자로 넣어 주세요.')
  return s
}
function checkModel(v, label, required) {
  const s = String(v ?? '').trim()
  if (!s) {
    if (required) throw bad(`${label}을 넣어 주세요.`)
    return ''
  }
  if (!MODEL_RE.test(s)) throw bad(`${label} 「${s.slice(0, 40)}」에 쓸 수 없는 글자가 있어요.`)
  return s
}
function checkLabel(v) {
  const s = String(v ?? '').trim()
  if (s.length < 1 || s.length > 30) throw bad('이름은 1~30자로 넣어 주세요.')
  return s
}

// ── 읽기 · 쓰기 ──
function unpack() {
  S.plain = new Map()
  S.broken = new Set()
  const take = (id, box) => {
    if (!box) return
    const v = open(box)
    if (v == null) S.broken.add(id)
    else S.plain.set(id, v)
  }
  for (const [id, b] of Object.entries(S.stored.builtin ?? {})) take(id, b.key)
  for (const c of S.stored.custom ?? []) take(c.id, c.key)
}
export async function loadConnections() {
  const v = await getSetting(SETTING, null)
  S.stored = { builtin: v?.builtin && typeof v.builtin === 'object' ? v.builtin : {}, custom: Array.isArray(v?.custom) ? v.custom.slice(0, MAX_CUSTOM) : [] }
  unpack()
  S.loaded = true
}
async function persist() {
  await setSetting(SETTING, S.stored)
  unpack()
}

// client.js가 쓰는 값 (키 포함 — 서버 안에서만)
export function builtinOverride(id) {
  const b = S.stored.builtin?.[id] ?? {}
  return { baseUrl: b.baseUrl || '', apiKey: S.plain.get(id) || '', disabled: Boolean(b.disabled), parallel: b.parallel || 1 }
}
export function customConnections() {
  return (S.stored.custom ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    baseUrl: c.baseUrl,
    apiKey: S.plain.get(c.id) || '',
    model: c.model,
    reportModel: c.reportModel || '',
    disabled: Boolean(c.disabled),
    parallel: c.parallel || 1,
    vertex: isVertexUrl(c.baseUrl),
  }))
}
export const isCustomId = (id) => (S.stored.custom ?? []).some((c) => c.id === id)

// 관리 페이지로 보내는 값: 키 글자 없이 있음 · 없음 · 어디서 온 값인지만
const ENV_KEY = { local: 'LLM_API_KEY', openrouter: 'OPENROUTER_API_KEY', exaone: 'EXAONE_API_KEY' }
const ENV_URL = { local: 'LLM_BASE_URL', openrouter: 'OPENROUTER_BASE_URL', exaone: 'EXAONE_BASE_URL' }
const DEFAULT_URL = { openrouter: 'https://openrouter.ai/api/v1', exaone: 'https://api.exaone.ai/v1' }
export function publicConnections() {
  const builtin = BUILTIN_IDS.map((id) => {
    const b = S.stored.builtin?.[id] ?? {}
    const envKey = Boolean(process.env[ENV_KEY[id]])
    const siteKey = S.plain.has(id)
    return {
      id,
      builtin: true,
      key: siteKey ? 'site' : S.broken.has(id) ? 'broken' : envKey ? 'env' : 'none',
      envKey,
      baseUrl: b.baseUrl || process.env[ENV_URL[id]] || DEFAULT_URL[id] || '',
      baseUrlFrom: b.baseUrl ? 'site' : process.env[ENV_URL[id]] ? 'env' : DEFAULT_URL[id] ? 'default' : 'none',
      disabled: Boolean(b.disabled),
      parallel: b.parallel || 1,
      revert: b.prev ? (b.prev.key || b.prev.baseUrl ? 'previous' : 'env') : null,
      changedAt: b.changedAt ?? null,
    }
  })
  const custom = (S.stored.custom ?? []).map((c) => ({
    id: c.id,
    builtin: false,
    label: c.label,
    baseUrl: c.baseUrl,
    model: c.model,
    reportModel: c.reportModel || '',
    key: S.plain.has(c.id) ? 'site' : S.broken.has(c.id) ? 'broken' : isVertexUrl(c.baseUrl) ? 'google' : 'none',
    disabled: Boolean(c.disabled),
    parallel: c.parallel || 1,
    vertex: isVertexUrl(c.baseUrl),
    revert: c.prev ? 'previous' : null,
    changedAt: c.changedAt ?? null,
  }))
  return { builtin, custom, secret: secretSource(), max: MAX_CUSTOM, parallelMax: PARALLEL_MAX }
}

// 기본 세 곳: 주소 · 키 바꾸기 (빈 칸은 그대로 둠)
export async function updateBuiltin(id, input) {
  if (!BUILTIN_IDS.includes(id)) throw bad('없는 AI 연결이에요.')
  const b = { ...(S.stored.builtin?.[id] ?? {}) }
  const next = { ...b }
  const changed = []
  if (input.baseUrl !== undefined && String(input.baseUrl).trim()) {
    next.baseUrl = checkUrl(input.baseUrl)
    changed.push('주소')
  }
  if (input.key !== undefined && String(input.key).trim()) {
    next.key = seal(checkKey(input.key))
    changed.push('API 키')
  }
  if (!changed.length) throw bad('바꿀 값(주소 또는 API 키)을 넣어 주세요.')
  next.prev = { key: b.key ?? null, baseUrl: b.baseUrl ?? null } // 되돌리기: 바로 전 값 (둘 다 없으면 = 설정 파일 값)
  next.changedAt = new Date().toISOString()
  S.stored.builtin = { ...S.stored.builtin, [id]: next }
  await persist()
  return changed
}

// 되돌리기: 바로 전 값으로 한 번
export async function revertConnection(id) {
  if (BUILTIN_IDS.includes(id)) {
    const b = S.stored.builtin?.[id]
    if (!b?.prev) throw bad('되돌릴 이전 값이 없어요.')
    const next = { ...b, key: b.prev.key ?? undefined, baseUrl: b.prev.baseUrl ?? undefined, prev: null, changedAt: new Date().toISOString() }
    if (!next.key) delete next.key
    if (!next.baseUrl) delete next.baseUrl
    S.stored.builtin = { ...S.stored.builtin, [id]: next }
    await persist()
    return b.prev.key || b.prev.baseUrl ? '이전에 넣은 값' : '서버 설정 파일 값'
  }
  const i = (S.stored.custom ?? []).findIndex((c) => c.id === id)
  if (i < 0) throw bad('없는 AI 연결이에요.')
  const c = S.stored.custom[i]
  if (!c.prev) throw bad('되돌릴 이전 값이 없어요.')
  S.stored.custom[i] = { ...c, ...c.prev, prev: null, changedAt: new Date().toISOString() }
  await persist()
  return '이전에 넣은 값'
}

export async function setConnectionDisabled(id, disabled) {
  if (BUILTIN_IDS.includes(id)) {
    S.stored.builtin = { ...S.stored.builtin, [id]: { ...(S.stored.builtin?.[id] ?? {}), disabled: Boolean(disabled) } }
  } else {
    const i = (S.stored.custom ?? []).findIndex((c) => c.id === id)
    if (i < 0) throw bad('없는 AI 연결이에요.')
    S.stored.custom[i] = { ...S.stored.custom[i], disabled: Boolean(disabled) }
  }
  await persist()
}

// 동시 요청 수 바꾸기 (11/26). 키를 건드리지 않아 비밀번호 다시 확인은 묻지 않는다
export async function setConnectionParallel(id, value) {
  const n = checkParallel(value)
  if (BUILTIN_IDS.includes(id)) {
    S.stored.builtin = { ...S.stored.builtin, [id]: { ...(S.stored.builtin?.[id] ?? {}), parallel: n } }
  } else {
    const i = (S.stored.custom ?? []).findIndex((c) => c.id === id)
    if (i < 0) throw bad('없는 AI 연결이에요.')
    S.stored.custom[i] = { ...S.stored.custom[i], parallel: n }
  }
  await persist()
  return n
}

// 새 연결 (OpenAI 호환 /chat/completions)
export async function addCustom(input) {
  if ((S.stored.custom ?? []).length >= MAX_CUSTOM) throw bad(`새 연결은 ${MAX_CUSTOM}개까지 더할 수 있어요.`)
  const baseUrl = checkUrl(input.baseUrl)
  // Vertex AI 주소면 키 없이 (서버의 Google 서비스 계정으로)
  const noKey = isVertexUrl(baseUrl) && !String(input.key ?? '').trim()
  const c = {
    id: `c-${randomBytes(4).toString('hex')}`,
    label: checkLabel(input.label),
    baseUrl,
    model: checkModel(input.model, '요약 모델', true),
    reportModel: checkModel(input.reportModel, '보고서 모델', false),
    ...(noKey ? {} : { key: seal(checkKey(input.key)) }),
    disabled: false,
    parallel: input.parallel !== undefined && input.parallel !== '' ? checkParallel(input.parallel) : isVertexUrl(baseUrl) ? 8 : 1,
    createdAt: new Date().toISOString(),
  }
  S.stored.custom = [...(S.stored.custom ?? []), c]
  await persist()
  return c.id
}

export async function updateCustom(id, input) {
  const i = (S.stored.custom ?? []).findIndex((c) => c.id === id)
  if (i < 0) throw bad('없는 AI 연결이에요.')
  const c = S.stored.custom[i]
  const next = { ...c }
  const changed = []
  const set = (k, v, name) => {
    next[k] = v
    changed.push(name)
  }
  const given = (k) => input[k] !== undefined && String(input[k] ?? '').trim() !== ''
  if (given('label') && input.label.trim() !== c.label) set('label', checkLabel(input.label), '이름')
  if (given('baseUrl') && checkUrl(input.baseUrl) !== c.baseUrl) set('baseUrl', checkUrl(input.baseUrl), '주소')
  if (given('model') && input.model.trim() !== c.model) set('model', checkModel(input.model, '요약 모델', true), '요약 모델')
  if (input.reportModel !== undefined && String(input.reportModel ?? '').trim() !== (c.reportModel || '')) set('reportModel', checkModel(input.reportModel, '보고서 모델', false), '보고서 모델')
  if (given('key')) set('key', seal(checkKey(input.key)), 'API 키')
  if (!changed.length) throw bad('바뀐 값이 없어요.')
  next.prev = { label: c.label, baseUrl: c.baseUrl, model: c.model, reportModel: c.reportModel || '', key: c.key }
  next.changedAt = new Date().toISOString()
  S.stored.custom[i] = next
  await persist()
  return changed
}

export async function deleteCustom(id) {
  if (BUILTIN_IDS.includes(id)) throw Object.assign(new Error('기본 AI 연결은 지울 수 없어요. 바꾸거나 끌 수만 있어요.'), { status: 403 })
  const c = (S.stored.custom ?? []).find((x) => x.id === id)
  if (!c) throw bad('없는 AI 연결이에요.')
  S.stored.custom = S.stored.custom.filter((x) => x.id !== id)
  await persist()
  return c.label
}

// 수집 API 키(server/apiKeys.js)도 같은 암호 열쇠로 잠근다 (11/26)
export { seal, open as unseal, secretSource }
