// 사용 현황 기록 (17 문서 4장). 일반 화면(/)에서만 보낸다 — 관리·테스트 페이지는 빼서 숫자를 흐리지 않게
// 개인 정보 없음: 브라우저에 만든 무작위 id만 같이 보낸다 (대략적인 사용자 수용). IP·이름은 서버가 저장하지 않는다
const CLIENT_KEY = 'techbrief.clientId'
const VISIT_KEY = 'techbrief.lastVisit'

let enabled = false

// App이 일반 화면일 때만 켠다
export function enableUsage(on) {
  enabled = on
}

export function clientId() {
  try {
    let id = localStorage.getItem(CLIENT_KEY)
    if (!id) {
      id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
      localStorage.setItem(CLIENT_KEY, id)
    }
    // AI 대기열의 「내 작업」 표시용 (11/15): 같은 번호를 쿠키로도 보낸다. 서버는 저장하지 않는다 (server/index.js clientOf)
    if (!document.cookie.includes(`tb_client=${id}`)) document.cookie = `tb_client=${id}; path=/; max-age=31536000; SameSite=Lax`
    return id
  } catch {
    return null // 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)는 기록하지 않음
  }
}

// type: search · select · summary · open · report · export(pdf|ppt|copy) · visit
// value: 숫자 하나 (export는 보고서 초안이 만들어지고 몇 초 뒤에 내보냈는지 — 사람 확인 시간, 11/19)
// 기록 실패는 사용에 영향이 없어야 하므로 기다리지 않고, 오류도 무시한다
export function track(type, detail = '', value) {
  if (!enabled) return
  const id = clientId()
  if (!id) return
  fetch('/api/usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, detail: String(detail ?? '').slice(0, 80), clientId: id, ...(Number.isFinite(value) ? { value } : {}) }),
    keepalive: true,
  }).catch(() => {})
}

// 보고서 초안이 만들어진 뒤 지난 초 (createdAt이 없거나 이상하면 undefined → 기록하지 않음)
export function secondsSince(saved) {
  const t = Date.parse(saved?.createdAt ?? '')
  if (!Number.isFinite(t)) return undefined
  const s = Math.round((Date.now() - t) / 1000)
  return s >= 0 ? s : undefined
}

// 방문: 브라우저당 하루 한 번 (서버도 한 번 더 거른다)
export function trackVisit() {
  if (!enabled) return
  const today = new Date().toDateString()
  try {
    if (localStorage.getItem(VISIT_KEY) === today) return
    localStorage.setItem(VISIT_KEY, today)
  } catch {
    return
  }
  track('visit')
}
