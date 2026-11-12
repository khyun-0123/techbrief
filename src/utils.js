export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
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
