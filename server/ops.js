// 운영 상태 (19 문서 6장): 일반 화면(/)을 정상 · 공지 · AI 기능 정지 · 점검 중으로 바꾼다
// 관리자(로그인 쿠키)는 어떤 상태에서도 그대로 쓸 수 있다 → 테스트 페이지에서 고친 것을 확인하고 재개
// 화면만 가리는 게 아니라 서버가 일반 사용자의 요청을 막는다. 팀원 서버가 같은 DB를 보므로 상태는 app_settings에 둔다
import { getSetting, setSetting } from './db/store.js'

const KEY = 'ops_state'
export const OPS_MODES = ['normal', 'notice', 'ai_off', 'maintenance']
export const OPS_LABEL = { normal: '정상', notice: '공지', ai_off: 'AI 기능 정지', maintenance: '점검 중' }
const DEFAULT = { mode: 'normal', message: '', until: '' }

// 요청마다 DB를 읽지 않게 잠깐 기억한다. 다른 팀원 서버에서 바꾼 것도 이 시간 안에 반영
const CACHE_MS = 5_000
let cache = null

export async function getOps() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value
  const value = { ...DEFAULT, ...(await getSetting(KEY, DEFAULT)) }
  cache = { at: Date.now(), value }
  return value
}

export async function saveOps(body, by) {
  const mode = OPS_MODES.includes(body?.mode) ? body.mode : null
  if (!mode) throw Object.assign(new Error('없는 운영 상태예요.'), { status: 400 })
  const message = String(body.message ?? '').trim().slice(0, 200)
  const until = String(body.until ?? '').trim().slice(0, 40)
  const value = { mode, message: mode === 'normal' ? '' : message, until: mode === 'normal' ? '' : until, updatedAt: new Date().toISOString(), by }
  await setSetting(KEY, value)
  cache = { at: Date.now(), value }
  return value
}

// 화면에 보여 줄 만큼만 (누가 바꿨는지는 빼고)
export function publicOps({ mode, message, until, updatedAt }) {
  return { mode, message, until, updatedAt: updatedAt ?? null }
}

// AI가 드는 요청 (요약 · 보고서)
const AI_ROUTES = ['POST /api/summaries', 'POST /api/reports', 'POST /api/reports/section']
// 점검 중에도 열어 두는 것: 상태 확인 · 운영 상태 · 실험 기능 목록 · 관리자 로그인 등
const ALWAYS_OPEN = ['GET /api/health', 'GET /api/ops', 'GET /api/features', 'POST /api/usage']

// 일반 사용자의 요청을 막아야 하면 이유를 담은 오류를 던진다 (관리자는 부르지 않음)
export async function checkOps(req) {
  const route = `${req.method} ${req.url.split('?')[0]}`
  if (route.startsWith('GET /api/admin') || route.startsWith('POST /api/admin') || ALWAYS_OPEN.includes(route)) return
  const ops = await getOps()
  const until = ops.until ? ` (${ops.until} 재개 예정)` : ''
  if (ops.mode === 'maintenance') {
    throw Object.assign(new Error(`점검 중이에요${until}. ${ops.message}`.trim()), { status: 503, ops: true })
  }
  if (ops.mode === 'ai_off' && AI_ROUTES.includes(route)) {
    throw Object.assign(new Error(`지금은 AI 요약·보고서를 잠시 멈췄어요${until}. ${ops.message}`.trim()), { status: 503, ops: true })
  }
}

// 자동 요약(서버가 혼자 도는 AI)도 AI 정지 · 점검 중에는 멈춘다
export async function aiPaused() {
  const { mode } = await getOps()
  return mode === 'ai_off' || mode === 'maintenance'
}
