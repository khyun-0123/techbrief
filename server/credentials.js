// 접속 코드 · 관리자 비밀번호를 관리 페이지에서 바꾸기 (11/20, 관리자 인수인계 — notes/admin-review-1120 S4)
// - 예전: 둘 다 서버 설정 파일(.env.local)에만 있어 담당자가 바뀔 때마다 서버에 들어가야 했다
// - 관리 페이지에서 바꾸면 DB에 저장하고, 설정 파일 값보다 먼저 쓴다. 「설정 파일 값으로 되돌리기」로 지울 수 있다
// - 값 그대로는 어디에도 저장 · 출력하지 않는다: 접속 코드는 쿠키와 같은 해시(accessGate tokenOf), 비밀번호는 scrypt(소금 포함)
// - 접속 코드를 바꾸면 예전 코드로 받은 쿠키는 모두 풀린다 (팀원 · 담당자도 새 코드를 넣어야 함)
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { getSetting, setSetting } from './db/store.js'

const ACCESS_KEY = 'access_code_token'
const PASSWORD_KEY = 'admin_password_hash'
const TTL = 60_000
const G = (globalThis.__techbriefCredentials ??= { accessToken: null, password: null, at: 0 })

export async function loadCredentials({ fresh = false } = {}) {
  if (!fresh && Date.now() - G.at < TTL) return G
  try {
    const a = await getSetting(ACCESS_KEY, null)
    G.accessToken = a?.token && /^[0-9a-f]{64}$/.test(a.token) ? a.token : null
    const p = await getSetting(PASSWORD_KEY, null)
    G.password = p?.salt && p?.hash ? p : null
  } catch {
    // DB를 못 읽으면 설정 파일 값으로 (이미 읽어 둔 값은 그대로)
  }
  G.at = Date.now()
  return G
}

// 동기 값 (accessGate · admin.js가 씀). loadCredentials()로 미리 읽어 둔 값
export const storedAccessToken = () => G.accessToken
export const storedPassword = () => G.password

export function checkNewCode(code) {
  const c = String(code ?? '').trim()
  if (c.length < 6 || c.length > 40) throw Object.assign(new Error('접속 코드는 6~40자로 넣어 주세요.'), { status: 400 })
  return c
}

export async function saveAccessToken(token) {
  await setSetting(ACCESS_KEY, token ? { token, at: new Date().toISOString() } : null)
  G.accessToken = token
  G.at = Date.now()
}

const hashOf = (password, salt) => scryptSync(String(password), salt, 32).toString('hex')

export function matchStoredPassword(input) {
  const p = G.password
  if (!p) return false
  const a = Buffer.from(hashOf(input ?? '', p.salt), 'hex')
  const b = Buffer.from(p.hash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function saveAdminPassword(newPassword) {
  const pw = String(newPassword ?? '')
  if (pw.length < 10 || pw.length > 80) throw Object.assign(new Error('새 비밀번호는 10~80자로 넣어 주세요.'), { status: 400 })
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw Object.assign(new Error('새 비밀번호에는 영문과 숫자를 함께 넣어 주세요.'), { status: 400 })
  const salt = randomBytes(16).toString('hex')
  const value = { salt, hash: hashOf(pw, salt), at: new Date().toISOString() }
  await setSetting(PASSWORD_KEY, value)
  G.password = value
  G.at = Date.now()
}

export async function clearAdminPassword() {
  await setSetting(PASSWORD_KEY, null)
  G.password = null
  G.at = Date.now()
}
