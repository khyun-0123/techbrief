export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function formatPublished(hoursAgo) {
  const date = new Date(Date.now() - hoursAgo * 60 * 60 * 1000)
  if (hoursAgo < 24) {
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  const md = `${date.getMonth() + 1}.${date.getDate()}`
  // 기사 찾기는 오래된 기사도 나오므로 1년 가까이 지난 것은 연도까지 (예: 25.3.14)
  return hoursAgo > 24 * 300 ? `${String(date.getFullYear()).slice(2)}.${md}` : md
}
