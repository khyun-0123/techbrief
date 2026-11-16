export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

// 브라우저 저장 (11/17): 실패해도 화면을 멈추지 않는다. 브라우저 한도(약 5MB)를 넘으면 QuotaExceededError가 나는데,
// 예전엔 이 오류를 잡지 않아 화면 전체가 하얗게 꺼졌다 (AI 요약이 3,000건을 넘자 요약 전체를 저장하다 넘침). 저장 못 하면 이번 화면에서만 기억
export function save(key, value) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
    return true
  } catch (err) {
    console.warn(`[저장] ${key} 저장 못 함: ${err?.name ?? err}`)
    return false
  }
}

// 발행 시각 표시 (16 문서 A9): 시각인지 날짜인지 한눈에 보이게 말로 붙인다
// 오늘 10:30 · 어제 14:05 · 10월 3일 · 25년 3월 14일 (오늘·어제는 달력 기준, 이틀 넘으면 시각은 뺌)
export function formatPublished(hoursAgo, now = new Date()) {
  const date = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const time = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  if (date >= startOfToday) return `오늘 ${time}`
  if (date >= new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000)) return `어제 ${time}`
  const md = `${date.getMonth() + 1}월 ${date.getDate()}일`
  // 기사 찾기는 오래된 기사도 나오므로 해가 다르면 연도까지
  return date.getFullYear() === now.getFullYear() ? md : `${String(date.getFullYear()).slice(2)}년 ${md}`
}

// 대시보드에서 마지막으로 분석한 키워드 (11/12): 보고서 주제 키워드 → 그 분석 묶음이 보고서 근거로 자동으로 들어간다
export const LAST_ANALYZED_KEY = 'techbrief.lastAnalyzed'

// 페이지 배율 (11/15): 작은 노트북(1366·1280, 높이 760 미만)은 html에 zoom 0.9를 준다 (App.css 「작은 노트북 배율」).
// getBoundingClientRect · clientX · innerWidth는 화면 픽셀, style의 top · left 등은 배율 전 CSS 픽셀이라 이 값으로 나눠 맞춘다
export function pageZoom() {
  if (typeof document === 'undefined') return 1
  const z = parseFloat(getComputedStyle(document.documentElement).zoom)
  return z > 0 ? z : 1
}
