// 네이버 뉴스 검색 (NAVER API HUB). 키는 .env.local의 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET
// 기존 개발자센터(openapi.naver.com) 키·주소와 다르다

import { guardedFetch } from '../sourceGuard.js'

const DEFAULT_URL = 'https://naverapihub.apigw.ntruss.com/search/v1/news'

// start: 몇 번째 기사부터 (1~1000). 100건씩 넘겨 받을 때 101, 201, …
// background: 자동 수집 (하루 한도의 80%에서 멈춤, 사람이 찾기는 98%까지 — sourceGuard.js)
export async function searchNews(keyword, { display = 100, sort = 'date', start = 1, background = false } = {}) {
  const id = process.env.NAVER_CLIENT_ID
  const secret = process.env.NAVER_CLIENT_SECRET
  if (!id || !secret) {
    throw new Error('네이버 API 설정이 없어요. .env.local에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET을 넣어 주세요.')
  }
  const url = new URL(process.env.NAVER_NEWS_URL ?? DEFAULT_URL)
  url.searchParams.set('query', keyword)
  url.searchParams.set('display', String(display))
  url.searchParams.set('sort', sort)
  if (start > 1) url.searchParams.set('start', String(start))

  const res = await guardedFetch(
    'naver-news',
    url,
    { headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret }, signal: AbortSignal.timeout(15_000) },
    { background },
  )
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`네이버 뉴스 API 오류 ${res.status} ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  return data.items ?? []
}
