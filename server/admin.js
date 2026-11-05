// 관리자 로그인과 권한 확인 (17 문서). 관리자 계정 하나: 아이디 + 비밀번호
// - 아이디: .env.local의 ADMIN_ID (없으면 admin)
// - 비밀번호: .env.local의 ADMIN_PASSWORD (예전 REFRESH_PASSWORD도 받음). 둘 다 없으면 관리자 기능이 잠긴다
// - 잠금 리셋: 로그인 칸에 ADMIN_RESET_ID / ADMIN_RESET_PASSWORD를 넣으면 로그인 대기만 풀린다 (로그인은 안 됨, 19 문서)
// - 로그인하면 httpOnly 쿠키로 세션을 준다. 비밀번호는 브라우저에 남기지 않는다
// - 모두에게 영향을 주는 설정을 바꾸는 API는 handleApi에서 requireAdmin으로 막는다 (화면에서 숨기는 것만으로는 못 막음)
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { getSetting, setSetting } from './db/store.js'

const COOKIE = 'tb_admin'
const SESSION_MS = 8 * 3600_000
const MAX_FAILS = 5
const LOCK_MS = 10 * 60_000
const LOG_KEY = 'admin_log'
const LOG_MAX = 200

const sessions = new Map() // token → { name(아이디), expiresAt }. 서버를 다시 켜면 다시 로그인
let fails = 0
let lockedUntil = 0
const reset = { fails: 0, lockedUntil: 0 } // 리셋 조합도 따로 횟수를 막는다 (맞혀서 무한히 풀지 못하게)

function adminId() {
  return process.env.ADMIN_ID || 'admin'
}

// 잠금 리셋 조합. 둘 다 있어야 켜진다 (코드에 적지 않고 .env.local에만)
function resetPair() {
  const id = process.env.ADMIN_RESET_ID
  const password = process.env.ADMIN_RESET_PASSWORD
  return id && password ? { id, password } : null
}

function adminPassword() {
  return process.env.ADMIN_PASSWORD || process.env.REFRESH_PASSWORD || ''
}

export function adminConfigured() {
  return Boolean(adminPassword())
}

function samePassword(input, expected) {
  const a = Buffer.from(String(input ?? ''))
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

function cookieHeader(token, maxAgeSec) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`
}

// 로그인한 관리자면 { name }, 아니면 null
export function adminOf(req) {
  const token = readCookie(req, COOKIE)
  const session = token && sessions.get(token)
  if (!session) return null
  if (session.expiresAt < Date.now()) {
    sessions.delete(token)
    return null
  }
  return { name: session.name }
}

export function requireAdmin(req) {
  const admin = adminOf(req)
  if (!admin) throw Object.assign(new Error('관리자만 할 수 있어요. 관리 페이지(/admin)에서 로그인해 주세요.'), { status: 403 })
  return admin
}

const wrong = (left) =>
  Object.assign(new Error(`아이디 또는 비밀번호가 맞지 않아요.${left > 0 ? ` (남은 시도 ${left}번)` : ''}`), { status: 401 })

// 잠금 리셋 조합이면 처리하고 결과를 돌려준다. 아니면 null
// 잠겨 있어도 받는다 — 관리자 비밀번호와 다른 비밀이라 관리자 비밀번호를 맞혀 보는 통로가 되지 않는다
function tryReset(id, password) {
  const pair = resetPair()
  if (!pair || !samePassword(String(id ?? '').trim(), pair.id)) return null
  if (Date.now() < reset.lockedUntil) throw wrong(0) // 리셋도 막혀 있으면 이유를 드러내지 않는다
  if (!samePassword(password, pair.password)) {
    reset.fails += 1
    if (reset.fails >= MAX_FAILS) {
      reset.fails = 0
      reset.lockedUntil = Date.now() + LOCK_MS
    }
    throw wrong(0)
  }
  reset.fails = 0
  fails = 0
  lockedUntil = 0
  console.log('[admin] 로그인 대기를 리셋했어요')
  return { reset: true }
}

// 성공하면 { cookie, name }, 잠금 리셋이면 { reset: true }
export function login({ id, password }) {
  if (!adminConfigured()) {
    throw Object.assign(new Error('관리자 비밀번호가 설정되지 않았어요. 서버 .env.local에 ADMIN_PASSWORD를 넣어 주세요.'), { status: 503 })
  }
  const resetResult = tryReset(id, password)
  if (resetResult) return resetResult
  if (Date.now() < lockedUntil) {
    const min = Math.ceil((lockedUntil - Date.now()) / 60_000)
    throw Object.assign(new Error(`비밀번호를 여러 번 틀려 로그인이 ${min}분 동안 막혔어요.`), { status: 429, locked: true })
  }
  // 아이디와 비밀번호를 둘 다 비교한다 (어느 쪽이 틀렸는지는 알려 주지 않음)
  const idOk = samePassword(String(id ?? '').trim(), adminId())
  const pwOk = samePassword(password, adminPassword())
  if (!idOk || !pwOk) {
    fails += 1
    if (fails >= MAX_FAILS) {
      fails = 0
      lockedUntil = Date.now() + LOCK_MS
      throw Object.assign(new Error(`비밀번호를 ${MAX_FAILS}번 틀려 로그인이 ${LOCK_MS / 60_000}분 동안 막혔어요.`), { status: 429, locked: true })
    }
    throw wrong(MAX_FAILS - fails)
  }
  fails = 0
  const token = randomBytes(32).toString('hex')
  const who = adminId()
  sessions.set(token, { name: who, expiresAt: Date.now() + SESSION_MS })
  return { cookie: cookieHeader(token, SESSION_MS / 1000), name: who }
}

export function logout(req) {
  const token = readCookie(req, COOKIE)
  if (token) sessions.delete(token)
  return cookieHeader('', 0)
}

// ── 설정 변경 기록 (17 문서 5장 1번) ──
// 누가(로그인한 아이디) 언제 무엇을 바꿨는지. 최근 LOG_MAX건만 남긴다
export async function logChange(admin, action, detail = '') {
  const log = await getSetting(LOG_KEY, [])
  log.unshift({ at: new Date().toISOString(), name: admin?.name ?? '관리자', action, detail: String(detail).slice(0, 300) })
  await setSetting(LOG_KEY, log.slice(0, LOG_MAX))
}

export function changeLog() {
  return getSetting(LOG_KEY, [])
}

// 목록 두 개의 차이를 "추가: a, b / 삭제: c" 로
export function diffWords(before = [], after = []) {
  const added = after.filter((w) => !before.includes(w))
  const removed = before.filter((w) => !after.includes(w))
  return [added.length && `추가: ${added.join(', ')}`, removed.length && `삭제: ${removed.join(', ')}`].filter(Boolean).join(' / ') || '변경 없음'
}
