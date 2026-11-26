// 수집 API 키 (11/26 조장: 「api 폼이 정형화돼 있니? … 유동적인 폼으로」) — 관리 페이지에서 수집 · 검색 API의 키를 넣고 바꾸고 되돌린다
// - 서비스마다 필요한 칸이 다르다 (네이버: Client ID + Secret, ScienceON: Client ID + 키 + MAC, BigQuery: 서비스 계정 JSON …)
//   → 아래 SERVICES에 칸 목록만 적어 두면 화면이 그 목록대로 칸을 그린다. 새 API는 연결 코드를 넣은 뒤 여기 한 줄을 더하면 된다
// - 저장 · 보안은 AI 연결(server/llm/connections.js)과 같다: 넣기만(단방향), AES-256-GCM으로 잠가 DB settings 'api_keys'에,
//   화면에는 칸마다 「있음 · 없음 · 어디서 온 값」만. 키 글자는 응답 · 변경 기록 · 로그 어디에도 싣지 않는다
// - 쓰는 쪽 코드는 그대로 process.env.X를 읽는다: 사이트에서 넣은 값이 있으면 서버가 켜질 때 · 저장할 때 process.env에 얹고,
//   되돌리면 서버 설정(Railway 변수 · .env.local) 값으로 돌려놓는다 (처음 읽은 값을 기억해 둠)
import { getSetting, setSetting } from './db/store.js'
import { seal, unseal, secretSource } from './llm/connections.js'

const SETTING = 'api_keys'

// kind: secret(비밀값) · text(아이디 등) · email · mac · json(서비스 계정 JSON 붙여넣기)
export const SERVICES = [
  {
    id: 'naver',
    label: '네이버 검색 (뉴스)',
    use: '뉴스 수집 · 「논문 · 뉴스에서 찾기」',
    fields: [
      { env: 'NAVER_CLIENT_ID', label: 'Client ID', kind: 'text' },
      { env: 'NAVER_CLIENT_SECRET', label: 'Client Secret', kind: 'secret' },
    ],
  },
  {
    id: 'naver-searchad',
    label: '네이버 검색광고 (검색량)',
    use: '키워드 검색량 · 관련 검색어',
    fields: [
      { env: 'NAVER_SEARCHAD_CUSTOMER_ID', label: 'Customer ID', kind: 'text' },
      { env: 'NAVER_SEARCHAD_ACCESS_LICENSE', label: 'Access License', kind: 'secret' },
      { env: 'NAVER_SEARCHAD_SECRET_KEY', label: 'Secret Key', kind: 'secret' },
    ],
  },
  {
    id: 'kci',
    label: 'KCI (국내 학술지)',
    use: '국내 논문 찾기',
    fields: [{ env: 'KCI_API_KEY', label: 'API 키', kind: 'secret' }],
  },
  {
    id: 'scienceon',
    label: 'ScienceON (KISTI)',
    use: '국내 논문 찾기 — 신청한 IP에서만 됨 (나가는 IP가 고정이 아니면 MAC을 비워 두기)',
    fields: [
      { env: 'SCIENCEON_CLIENT_ID', label: 'Client ID', kind: 'text' },
      { env: 'SCIENCEON_API_KEY', label: 'API 키', kind: 'secret' },
      { env: 'SCIENCEON_MAC', label: 'MAC 주소', kind: 'mac' },
    ],
  },
  {
    id: 'openalex',
    label: 'OpenAlex (해외 논문)',
    use: '해외 논문 찾기 · 인용 수',
    optional: true,
    fields: [
      { env: 'OPENALEX_API_KEY', label: 'API 키 (없어도 됨)', kind: 'secret' },
      { env: 'PAPER_CONTACT_EMAIL', label: '연락 이메일 (빠른 줄)', kind: 'email' },
    ],
  },
  {
    id: 'semantic-scholar',
    label: 'Semantic Scholar',
    use: '해외 논문 찾기 (키가 없으면 느린 공용 한도)',
    optional: true,
    fields: [{ env: 'SEMANTIC_SCHOLAR_API_KEY', label: 'API 키', kind: 'secret' }],
  },
  {
    id: 'gcp',
    label: 'Google Cloud (BigQuery 특허 · 번역)',
    use: '특허 찾기 · 검색어 번역',
    fields: [{ env: 'GCP_KEY_JSON', label: '서비스 계정 JSON', kind: 'json' }],
  },
]
const FIELD = new Map(SERVICES.flatMap((s) => s.fields.map((f) => [f.env, { ...f, service: s.id }])))

// 서버 설정 값(처음 읽은 것) · 저장 기록(암호문) · 푼 값
const S = (globalThis.__techbriefApiKeys ??= { orig: null, stored: {}, plain: new Map(), broken: new Set() })
function rememberOrig() {
  if (S.orig) return
  S.orig = {}
  for (const name of FIELD.keys()) S.orig[name] = process.env[name]
}

function apply() {
  rememberOrig()
  S.plain = new Map()
  S.broken = new Set()
  for (const [name, b] of Object.entries(S.stored)) {
    if (!FIELD.has(name) || !b?.box) continue
    let v = null
    try {
      v = unseal(b.box)
    } catch {
      v = null
    }
    if (v == null) S.broken.add(name)
    else S.plain.set(name, v)
  }
  for (const name of FIELD.keys()) {
    if (S.plain.has(name)) process.env[name] = S.plain.get(name)
    else if (S.orig[name] === undefined) delete process.env[name]
    else process.env[name] = S.orig[name]
  }
}

export async function loadApiKeys() {
  rememberOrig()
  try {
    const v = await getSetting(SETTING, null)
    S.stored = v && typeof v === 'object' ? v : {}
  } catch {
    S.stored = {}
  }
  apply()
}
async function persist() {
  await setSetting(SETTING, S.stored)
  apply()
}

// ── 값 확인 ──
const bad = (msg) => Object.assign(new Error(msg), { status: 400 })
function check(f, raw) {
  const s = String(raw ?? '').trim()
  if (f.kind === 'json') {
    let text = s
    if (!text.startsWith('{')) text = Buffer.from(text, 'base64').toString('utf8') // base64로 넣어도 됨 (Railway 변수와 같게)
    let o
    try {
      o = JSON.parse(text)
    } catch {
      throw bad(`${f.label}: JSON 파일 내용을 그대로 붙여 넣어 주세요.`)
    }
    if (!o?.client_email || !o?.private_key || !o?.project_id) throw bad(`${f.label}: 서비스 계정 키 JSON이 아니에요 (client_email · private_key · project_id가 필요).`)
    if (s.length > 20_000) throw bad(`${f.label}이 너무 길어요.`)
    return s
  }
  if (/\s/.test(s)) throw bad(`${f.label}에는 띄어쓰기를 넣지 않아요.`)
  if (f.kind === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw bad(`${f.label}: 이메일 형식으로 넣어 주세요.`)
  if (f.kind === 'mac' && !/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(s)) throw bad(`${f.label}: 00-11-22-33-44-55 형식으로 넣어 주세요.`)
  if ((f.kind === 'secret' || f.kind === 'text') && (s.length < 2 || s.length > 500)) throw bad(`${f.label}: 2~500자로 넣어 주세요.`)
  return s
}

// ── 화면으로 보내는 값: 글자 없이 상태만 ──
function fieldState(name) {
  if (S.plain.has(name)) return 'site'
  if (S.broken.has(name)) return 'broken'
  return S.orig?.[name] ? 'env' : 'none'
}
export function publicApiKeys() {
  rememberOrig()
  const services = SERVICES.map((s) => {
    const fields = s.fields.map((f) => ({ env: f.env, label: f.label, kind: f.kind, state: fieldState(f.env) }))
    const have = fields.filter((f) => f.state === 'site' || f.state === 'env').length
    const changedAt = s.fields.map((f) => S.stored[f.env]?.at).filter(Boolean).sort().at(-1) ?? null
    return {
      id: s.id,
      label: s.label,
      use: s.use,
      optional: Boolean(s.optional),
      fields,
      ready: s.optional ? true : have === fields.length,
      have,
      canRevert: s.fields.some((f) => S.stored[f.env]?.prev !== undefined),
      canReset: s.fields.some((f) => S.stored[f.env]),
      changedAt,
    }
  })
  return { services, secret: secretSource() }
}

const serviceOf = (id) => {
  const s = SERVICES.find((x) => x.id === id)
  if (!s) throw bad('없는 서비스예요.')
  return s
}

// 칸마다 넣은 값만 바꾼다 (빈 칸은 그대로). 바로 전 값은 prev로 한 번 기억 (null = 서버 설정 값이었음)
export async function updateApiKeys(id, values = {}) {
  const s = serviceOf(id)
  const changed = []
  const next = { ...S.stored }
  for (const f of s.fields) {
    const raw = values?.[f.env]
    if (raw === undefined || String(raw).trim() === '') continue
    const v = check(f, raw)
    next[f.env] = { box: seal(v), prev: S.stored[f.env]?.box ?? null, at: new Date().toISOString() }
    changed.push(f.label)
  }
  if (!changed.length) throw bad('바꿀 값을 하나 이상 넣어 주세요.')
  // 되돌리기는 이번에 바꾼 칸만: 이번에 안 바꾼 칸의 예전 되돌리기 정보는 지운다
  for (const f of s.fields) {
    if (changed.includes(f.label) || !next[f.env]) continue
    const { prev: _drop, ...rest } = next[f.env]
    next[f.env] = rest
  }
  S.stored = next
  await persist()
  return changed
}

// 되돌리기: 칸마다 바로 전 값으로 한 번 (전 값이 서버 설정 값이었으면 사이트 값을 지움)
export async function revertApiKeys(id) {
  const s = serviceOf(id)
  const next = { ...S.stored }
  let n = 0
  for (const f of s.fields) {
    const b = next[f.env]
    if (!b || b.prev === undefined) continue
    if (b.prev) next[f.env] = { box: b.prev, at: new Date().toISOString() }
    else delete next[f.env]
    n++
  }
  if (!n) throw bad('되돌릴 이전 값이 없어요.')
  S.stored = next
  await persist()
}

// 서버 설정 값으로: 이 서비스의 사이트 값을 모두 지운다 (서버 설정에도 없으면 그 칸은 「없음」)
export async function resetApiKeys(id) {
  const s = serviceOf(id)
  const next = { ...S.stored }
  for (const f of s.fields) delete next[f.env]
  S.stored = next
  await persist()
}

export const apiKeyServiceLabel = (id) => SERVICES.find((x) => x.id === id)?.label ?? id
