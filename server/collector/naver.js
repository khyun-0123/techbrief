// 네이버 뉴스 검색 (NAVER API HUB). 키는 .env.local의 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET
// 기존 개발자센터(openapi.naver.com) 키·주소와 다르다

const DEFAULT_URL = 'https://naverapihub.apigw.ntruss.com/search/v1/news'

export async function searchNews(keyword, { display = 100, sort = 'date' } = {}) {
  const id = process.env.NAVER_CLIENT_ID
  const secret = process.env.NAVER_CLIENT_SECRET
  if (!id || !secret) {
    throw new Error('네이버 API 설정이 없어요. .env.local에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET을 넣어 주세요.')
  }
  const url = new URL(process.env.NAVER_NEWS_URL ?? DEFAULT_URL)
  url.searchParams.set('query', keyword)
  url.searchParams.set('display', String(display))
  url.searchParams.set('sort', sort)

  const res = await fetch(url, {
    headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`네이버 뉴스 API 오류 ${res.status} ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  return data.items ?? []
}
