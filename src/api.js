// 요약 API 서버(npm run server) 호출 모음. 접속 키는 서버에만 있고 여기에는 없다.

export async function requestSummary(article, { refresh = false } = {}) {
  const res = await fetch('/api/summaries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      article: { id: article.id, title: article.title, source: article.source, keyword: article.keyword },
      refresh,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error ?? `요약 서버 오류 (${res.status}). npm run server가 켜져 있는지 확인해 주세요.`)
  }
  return data
}
