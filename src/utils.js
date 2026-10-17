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
  return date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
}
