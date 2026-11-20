// 접속 코드 문 (11/18, 43 문서 · 외부 배포용). ACCESS_CODE가 있을 때만 켜진다 — 공용 서버 3038에는 없으므로 영향 없음. 개발 모드에서도 화면 · 소스 파일 · API 앞에 선다(11/18 시험)
// - 화면 · API · 관리 페이지 모두: 코드를 한 번 넣으면 쿠키(30일)로 통과. 없으면 코드 입력 화면(화면) 또는 401(API)
// - 틀린 코드는 IP마다 15분에 10번까지 (그 뒤 15분 쉼)
// - 외부 주소(Tailscale Funnel · Cloudflare Tunnel)로 들어오면 서버에는 127.0.0.1에서 온 것으로 보인다 → 「이 컴퓨터에서 온 요청은 통과」 예외를 두지 않는다
// - 코드는 화면 · 기록 어디에도 그대로 남기지 않는다 (쿠키에는 코드로 만든 해시만)
import { createHash, timingSafeEqual } from 'node:crypto'
import { clientIp, secureCookie } from './admin.js'
import { loadCredentials, storedAccessToken } from './credentials.js'

const COOKIE = 'tb_access'
const MAX_AGE = 30 * 86_400
const WINDOW_MS = 15 * 60_000
const MAX_TRIES = 10
const tries = new Map() // ip → { n, since }

const code = () => String(process.env.ACCESS_CODE ?? '').trim()
// 코드 없이도 내려 주는 공개 파일: 브라우저 탭 아이콘뿐 (막으면 브라우저가 주소 첫 글자를 대신 띄움, 11/18)
const PUBLIC_PATHS = new Set(['/favicon.svg'])
// 11/20: 관리 페이지에서 바꾼 코드(DB, 해시만)가 있으면 그것을, 없으면 설정 파일 ACCESS_CODE
export const accessGateOn = () => code().length > 0 || Boolean(storedAccessToken())
export const tokenOf = (c) => createHash('sha256').update(`techbrief-access|${c}`).digest('hex')
export const envAccessCodeSet = () => code().length > 0
export const ACCESS_COOKIE = COOKIE
export const ACCESS_MAX_AGE = MAX_AGE

function readCookie(req, name) {
  const m = String(req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return m ? decodeURIComponent(m[1]) : null
}
function sameToken(a, b) {
  const x = Buffer.from(String(a ?? ''))
  const y = Buffer.from(String(b ?? ''))
  return x.length === y.length && timingSafeEqual(x, y)
}

const page = (msg = '') => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>테크브리프 · 접속 코드</title><link rel="icon" type="image/svg+xml" href="/favicon.svg?v=3">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f5f3; color: #1c2533; font-family: Pretendard, -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
  form { width: min(360px, calc(100vw - 32px)); padding: 28px 24px; background: #fff; border: 1px solid #e3e0da; border-radius: 16px; box-shadow: 0 10px 30px rgba(28,37,51,.08); }
  h1 { margin: 0 0 6px; font-size: 20px; } p { margin: 0 0 16px; color: #5a6270; font-size: 14px; line-height: 1.5; }
  input { box-sizing: border-box; width: 100%; height: 44px; padding: 0 12px; border: 1px solid #cfcac2; border-radius: 10px; font-size: 16px; }
  button { width: 100%; height: 44px; margin-top: 10px; border: 0; border-radius: 10px; background: #1c2533; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
  .err { margin: 10px 0 0; color: #b42318; font-size: 13px; }
</style></head><body>
<form method="post" action="/__access">
  <h1>테크브리프</h1>
  <p>시험 기간에는 접속 코드가 있어야 들어올 수 있어요. 받은 코드를 넣어 주세요.</p>
  <label for="code" style="position:absolute;left:-9999px">접속 코드</label>
  <input id="code" name="code" type="password" autocomplete="current-password" autofocus required>
  <button type="submit">들어가기</button>
  ${msg ? `<p class="err" role="alert">${msg}</p>` : ''}
</form></body></html>`

async function readForm(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 2_000) break
  }
  return new URLSearchParams(raw)
}

// Vite(개발 · 운영 모드) 미들웨어: 통과면 next(), 아니면 여기서 답한다
export async function accessGate(req, res, next) {
  await loadCredentials()
  if (!accessGateOn()) return next()
  const want = storedAccessToken() ?? tokenOf(code())
  if (sameToken(readCookie(req, COOKIE), want)) return next()
  if ((req.method === 'GET' || req.method === 'HEAD') && PUBLIC_PATHS.has(String(req.url ?? '').split('?')[0])) return next()

  if (req.method === 'POST' && req.url === '/__access') {
    const ip = clientIp(req) ?? 'unknown'
    const t = tries.get(ip)
    if (t && Date.now() - t.since < WINDOW_MS && t.n >= MAX_TRIES) {
      res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(page('여러 번 틀려서 15분 동안 쉬어요. 잠시 뒤 다시 넣어 주세요.'))
    }
    const form = await readForm(req)
    if (sameToken(tokenOf(String(form.get('code') ?? '').trim()), want)) {
      tries.delete(ip)
      res.writeHead(303, { Location: '/', 'Set-Cookie': secureCookie(`${COOKIE}=${want}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; SameSite=Lax`, req) })
      return res.end()
    }
    const cur = t && Date.now() - t.since < WINDOW_MS ? t : { n: 0, since: Date.now() }
    cur.n += 1
    tries.set(ip, cur)
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(page('코드가 맞지 않아요.'))
  }
  if (req.url?.startsWith('/api/')) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ error: '접속 코드가 필요해요. 화면을 새로 고쳐 코드를 넣어 주세요.' }))
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  return res.end(page())
}
