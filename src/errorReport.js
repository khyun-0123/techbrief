// 화면에서 난 오류를 서버 오류 기록으로 보낸다 (11/26 조장: 「오류나는거 다 로그로 남겨둬」, server/errorLog.js)
// 서버가 다시 켜지는 중(502 · 503 · 504)이거나 연결이 끊겨 보내지 못하면 이 브라우저에 모아 두고, 다시 연결되면 한꺼번에 보낸다
import { clientId } from './usage.js'

const KEY = 'techbrief-error-buffer'
const MAX = 100

// 서버가 잠깐 없는 오류 — 기다렸다가 다시 하면 되는 것 (머지 → Railway 다시 배포 때 502)
export const isTransient = (err) => Boolean(err && (err.transient || [0, 502, 503, 504].includes(err.status)))

function readBuf() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}
function writeBuf(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)))
  } catch {
    // 저장 공간이 막히면 버림
  }
}

let flushing = false
export async function flushErrors() {
  if (flushing) return
  const items = readBuf()
  if (!items.length) return
  flushing = true
  try {
    const res = await fetch('/api/client-errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: clientId(), items: items.slice(0, 30) }) })
    if (res.ok) writeBuf(readBuf().slice(items.slice(0, 30).length))
  } catch {
    // 아직 서버가 없음 — 다음에
  } finally {
    flushing = false
  }
}

export function reportError(kind, err, path = '') {
  const item = { kind, path, status: err?.status ?? null, message: String(err?.message ?? err ?? '').slice(0, 500), at: new Date().toISOString() }
  writeBuf([...readBuf(), item])
  if (!isTransient(err)) flushErrors()
}

// 서버가 다시 응답할 때까지 기다림 (5초마다, 최대 maxMs). 돌아오면 모아 둔 오류도 보냄
export async function waitForServer(maxMs = 10 * 60_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      if (res.ok) {
        flushErrors()
        return true
      }
    } catch {
      // 아직
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  return false
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flushErrors())
  setTimeout(() => flushErrors(), 3000) // 지난번에 못 보낸 것
}
