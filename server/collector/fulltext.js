// 원문 본문 가져오기 (13 문서 9절 · 원문 본문 활용). 보고서를 만들 때 고른 기사만 가져온다
// - 원문 페이지를 받아 Mozilla Readability(브라우저 '읽기 모드'와 같은 방식)로 본문만 뽑는다
// - DB에는 저장하지 않는다. 같은 기사로 섹션을 다시 쓸 때를 위해 서버 메모리에 잠깐만 둔다
// - 실패하면 null → 보고서는 지금처럼 네이버 발췌문으로 쓴다
import { Readability } from '@mozilla/readability'
import { JSDOM, VirtualConsole } from 'jsdom'
import { cleanText } from './normalize.js'

const TIMEOUT_MS = 10_000
const MAX_HTML = 3_000_000
const CACHE_MAX = 100
const CACHE_MS = 6 * 3600_000
const cache = new Map() // url → { text, at }
const ogTitles = new Map() // url → 원문 페이지 제목 (og:title). 본문을 가져올 때 같이 적어 둔다 (잘린 제목 채우기, titles.js)

// 본문 끝에 붙는 기자 정보·저작권 문구·공유 버튼 같은 줄을 뺀다
const NOISE = /(무단\s*전재|재배포\s*금지|저작권자|Copyright|기자\s*[\w.-]+@|구독하기|좋아요|공유하기|글자크기|기사\s*보내기|이 기사를 추천)/i

function decode(buf, contentType) {
  const head = buf.subarray(0, 4096).toString('latin1')
  const charset = (contentType.match(/charset=([\w-]+)/i)?.[1] || head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] || 'utf-8').toLowerCase()
  try {
    return new TextDecoder(charset).decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}

function clean(text) {
  return text
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 15 && !NOISE.test(l))
    .join('\n')
}

export async function fetchBody(url) {
  if (!url || !/^https?:\/\//.test(url)) return null
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (techbrief report draft)', Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_HTML) return null
    const html = decode(buf, res.headers.get('content-type') ?? '')
    // 페이지의 스크립트·CSS 오류 메시지는 무시한다
    const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() })
    rememberOgTitle(url, dom.window.document.querySelector('meta[property="og:title"]')?.getAttribute('content'))
    const parsed = new Readability(dom.window.document).parse()
    dom.window.close()
    const text = clean(parsed?.textContent ?? '')
    if (text.length < 200) return null // 본문이라 보기 어려움 (목록 페이지, 로그인 페이지 등)
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
    cache.set(url, { text, at: Date.now() })
    return text
  } catch {
    return null
  }
}

function rememberOgTitle(url, title) {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return
  if (ogTitles.size >= CACHE_MAX * 5) ogTitles.delete(ogTitles.keys().next().value)
  ogTitles.set(url, t)
}

// 본문을 가져올 때 적어 둔 원문 제목 (없으면 null)
export function knownOgTitle(url) {
  return ogTitles.get(url) ?? null
}

// 원문 페이지의 제목(og:title)만 가져온다. 본문 분석(JSDOM) 없이 앞부분 HTML에서 찾는다
const HEAD_MAX = 400_000
export async function fetchOgTitle(url) {
  if (!url || !/^https?:\/\//.test(url)) return null
  if (ogTitles.has(url)) return ogTitles.get(url)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (techbrief title check)', Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, HEAD_MAX)
    const html = decode(buf, res.headers.get('content-type') ?? '')
    const tag = html.match(/<meta[^>]+property=["']og:title["'][^>]*>/i)?.[0] ?? html.match(/<meta[^>]+content=[^>]+property=["']og:title["'][^>]*>/i)?.[0]
    const raw = tag?.match(/content=(["'])([\s\S]*?)\1/i)?.[2]
    if (!raw) return null
    rememberOgTitle(url, cleanText(raw)) // &quot; 같은 표시 풀기
    return knownOgTitle(url)
  } catch {
    return null
  }
}

// 여러 기사를 동시에 3건씩 가져온다
export async function fetchBodies(urls, concurrency = 3) {
  const out = new Array(urls.length).fill(null)
  let next = 0
  async function worker() {
    while (next < urls.length) {
      const i = next++
      out[i] = await fetchBody(urls[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker))
  return out
}
