// 네이버 밖 출처 (14 문서 4-B 출처 4단계 · 15 문서 F16). 키 없이 받을 수 있는 RSS와 논문 검색만 붙인다
// - 1차: 기업 발표 · 학회 · 논문 / 2차: 국내외 전문매체 / 3차: 일반 뉴스(네이버)
// - 피드에는 키워드 검색이 없으므로 받은 글 중 자동 수집 키워드(또는 다른 표기, aliases.js)가 제목·요약에 있는 것만 넣는다
// - 저장은 네이버 기사와 같은 articles 표. section 칸에 'feed:<출처 id>'를 적어 출처 단계를 알아본다 (표는 그대로)
// - 제목 · 요약 · 링크만 저장하고 원문 본문은 저장하지 않는다 (보고서 만들 때만 원문을 읽는 지금 방식과 같음)
// 조사: 2026-11-06 (RSS 주소는 서버에서 직접 열어 확인). 쓸 수 없는 곳: 삼성디스플레이·BOE 뉴스룸(RSS 없음),
//   Display Daily·Counterpoint·GlobeNewswire(접속 차단), Google 뉴스 RSS(개인 피드 리더 전용 약관)
import { JSDOM } from 'jsdom'
import { englishOf, hasKeyword } from './aliases.js'
import { articleId, cleanText } from './normalize.js'
import { keywordPapers, recentPapers } from '../papers/journals.js'

export const TIER_LABEL = { 1: '1차', 2: '2차', 3: '3차' }

// lang: 영문이면 키워드의 영문 표기로도 거른다 · paper: 논문 검색(키워드마다 부름)
export const FEEDS = [
  { id: 'lgd-ko', name: 'LG디스플레이 뉴스룸', tier: 1, url: 'https://news.lgdisplay.com/feed/' },
  { id: 'lgd-en', name: 'LG Display Newsroom', tier: 1, url: 'https://news.lgdisplay.com/en/feed/', lang: 'en' },
  { id: 'newswire-part', name: '뉴스와이어 보도자료(전자부품)', tier: 1, url: 'https://api.newswire.co.kr/rss/industry/601' },
  { id: 'newswire-semi', name: '뉴스와이어 보도자료(반도체)', tier: 1, url: 'https://api.newswire.co.kr/rss/industry/607' },
  { id: 'sid-jsid', name: 'SID 학회지(JSID)', tier: 1, url: 'https://sid.onlinelibrary.wiley.com/feed/19383657/most-recent', lang: 'en' },
  { id: 'sid-digest', name: 'SID Display Week 논문집', tier: 1, url: 'https://sid.onlinelibrary.wiley.com/feed/21680159/most-recent', lang: 'en' },
  { id: 'sid-id', name: 'SID Information Display', tier: 1, url: 'https://sid.onlinelibrary.wiley.com/feed/2637496x/most-recent', lang: 'en' },
  { id: 'crossref', name: '학술 논문', tier: 1, paper: true, lang: 'en' }, // id는 저장된 기사(section 'feed:crossref') 때문에 그대로 둔다
  { id: 'thelec', name: '디일렉', tier: 2, url: 'https://www.thelec.kr/rss/allArticle.xml' },
  { id: 'thelec-en', name: 'The Elec', tier: 2, url: 'https://www.thelec.net/rss/allArticle.xml', lang: 'en' },
  { id: 'oled-info', name: 'OLED-Info', tier: 2, url: 'https://www.oled-info.com/rss.xml', lang: 'en' },
  { id: 'microled-info', name: 'MicroLED-Info', tier: 2, url: 'https://www.microled-info.com/rss.xml', lang: 'en' },
  { id: 'trendforce', name: 'TrendForce', tier: 2, url: 'https://www.trendforce.com/feed/Display.html', lang: 'en' },
  { id: 'ledinside', name: 'LEDinside', tier: 2, url: 'https://www.ledinside.com/rss.xml', lang: 'en' },
  { id: 'ubi-ko', name: '유비리서치', tier: 2, url: 'https://www.ubiresearch.com/feed/' },
  { id: 'ubi-en', name: 'UBI Research', tier: 2, url: 'https://www.ubiresearch.com/en/feed/', lang: 'en' },
  { id: 'kipost', name: 'KIPOST', tier: 2, url: 'https://www.kipost.net/rss/allArticle.xml' },
  { id: 'etnews', name: '전자신문', tier: 2, url: 'https://rss.etnews.com/06.xml' },
  { id: 'zdnet', name: 'ZDNet Korea', tier: 2, url: 'https://feeds.feedburner.com/zdkorea' },
  { id: 'digitimes', name: 'DIGITIMES', tier: 2, url: 'https://www.digitimes.com/rss/daily.xml', lang: 'en' },
  // 11/09 추가 (서버에서 직접 열어 확인, 이용 조건은 미확인 → 제목 · 요약 · 링크만 저장): 기업 1차 발표 · 표준 단체 · 반도체 · AI 전문매체
  { id: 'samsung-ko', name: '삼성전자 뉴스룸', tier: 1, url: 'https://news.samsung.com/kr/feed' },
  { id: 'samsung-en', name: 'Samsung Newsroom', tier: 1, url: 'https://news.samsung.com/global/feed', lang: 'en' },
  { id: 'skhynix-en', name: 'SK hynix Newsroom', tier: 1, url: 'https://news.skhynix.com/en/feed/', lang: 'en' }, // 한국어판 피드는 403
  { id: 'vesa', name: 'VESA', tier: 1, url: 'https://vesa.org/feed/', lang: 'en' },
  { id: 'semi-digest', name: 'Semiconductor Digest', tier: 2, url: 'https://www.semiconductor-digest.com/feed/', lang: 'en' },
  { id: 'semi-eng', name: 'Semiconductor Engineering', tier: 2, url: 'https://semiengineering.com/feed/', lang: 'en' },
  { id: 'eetimes', name: 'EE Times', tier: 2, url: 'https://www.eetimes.com/feed/', lang: 'en' },
  { id: 'ieee-spectrum', name: 'IEEE Spectrum', tier: 2, url: 'https://spectrum.ieee.org/feeds/feed.rss', lang: 'en' },
]
const BY_ID = new Map(FEEDS.map((f) => [f.id, f]))

const FEED_DAYS = 14 // 이보다 오래된 글은 넣지 않는다 (화면 목록은 7일)
const PAPER_DAYS = 7 // 학술지 14곳 최근 7일 (OpenAlex에 새 논문이 보이기까지 보통 하루, SID Digest는 몇 주)
// 키워드 논문 (11/09 조장: 저장 키워드는 주기적으로 모은다): 키워드마다 최근 PAPER_KEYWORD_DAYS일 관련도순 PAPER_PER_KEYWORD편
// OpenAlex 검색 키워드당 1회 ($0.001), 6시간 캐시 → 키워드 10개면 하루 많아야 $0.04
export const PAPER_KEYWORD_DAYS = 30
const PAPER_PER_KEYWORD = 50
const DESC_MAX = 400
const PAPER_DESC_MAX = 2_000 // 논문은 초록 전체를 저장한다 (초록이 첫 요약 역할, 11/09 조장). OpenAlex 초록 CC0
const TIMEOUT_MS = 15_000
const UA = 'Mozilla/5.0 (techbrief news collector)'

// 저장된 기사의 출처 단계: 피드 기사는 section 'feed:<id>', 네이버 기사는 전문 매체면 2차, 아니면 3차
export function tierOf(article, expertSources) {
  const feed = String(article.section ?? '').startsWith('feed:') ? BY_ID.get(article.section.slice(5)) : null
  if (feed) return feed.tier
  return expertSources.has(article.source) ? 2 : 3
}

const text = (el, sel) => el.querySelector(sel)?.textContent?.trim() ?? ''

// RSS 2.0과 Atom 둘 다
// VESA 피드는 XML 선언 앞에 빈 줄이 있어 그대로 읽으면 오류 (11/09) → 앞 공백을 떼고 읽는다
function parseFeed(xml) {
  const doc = new JSDOM(xml.trimStart(), { contentType: 'text/xml' }).window.document
  const items = [...doc.querySelectorAll('item, entry')]
  return items.map((el) => {
    const linkEl = el.querySelector('link')
    const link = linkEl?.getAttribute('href') || linkEl?.textContent?.trim() || ''
    const title = cleanText(text(el, 'title'))
    // 워드프레스 요약은 '… 제목 더 보기 » The post …'뿐이라 걷어 내고, 남는 게 없으면 본문 앞부분을 쓴다
    const strip = (s) => s.replace(/The post .* (appeared first|first appeared) on .*$/, '').replace(/더 보기\s*»|Read more\s*»|Continue reading.*$/gi, '').replace(title, '').replace(/^[\s.…]+/, '').trim()
    let desc = strip(cleanText(text(el, 'description') || text(el, 'summary')))
    if (desc.length < 20) desc = strip(cleanText(el.getElementsByTagName('content:encoded')[0]?.textContent ?? text(el, 'content')))
    const date = text(el, 'pubDate') || text(el, 'published') || text(el, 'updated') || el.getElementsByTagName('dc:date')[0]?.textContent || el.getElementsByTagName('prism:coverDate')[0]?.textContent || ''
    return { title, link, description: desc.slice(0, DESC_MAX), date }
  })
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`응답 ${res.status}`)
  return res.text()
}

// 논문 (server/papers): 디스플레이 학술지 최근 7일 + 큰 학술지의 디스플레이 주제 논문
// OpenAlex(키) → Crossref → Semantic Scholar 순서로, 막힌 곳은 건너뛴다. 같은 요청은 6시간 캐시
// QD-OLED 논문은 경쟁사 기술이라 요약 앞에 표시한다 (고객사 기술은 WOLED)
const paperItem = (w, keyword) => ({
  title: w.title,
  link: w.doi ? `https://doi.org/${w.doi}` : w.url,
  doi: w.doi,
  // 학술지 이름을 요약 앞에 붙인다 (매체 칸은 '학술 논문' 하나로 두어 출처 목록이 길어지지 않게)
  description: `${w.competitorTech ? '[경쟁사 기술 · QD-OLED] ' : ''}${w.journal ? `[${w.journal}] ` : ''}${w.abstract}`.slice(0, PAPER_DESC_MAX),
  date: w.date ? `${w.date}T00:00:00Z` : '',
  ...(keyword ? { keyword } : {}),
})

async function searchPapers(words) {
  const { works, providers } = await recentPapers(PAPER_DAYS)
  const items = works.map((w) => paperItem(w))
  // 키워드마다 OpenAlex 검색 (한글 키워드는 영문 표기가 있을 때만). 한 키워드가 막혀도 나머지는 계속
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - PAPER_KEYWORD_DAYS * 86_400_000).toISOString().slice(0, 10)
  const via = new Set(providers)
  for (const word of words) {
    const en = englishOf(word)
    if (!en) continue
    try {
      const r = await keywordPapers(en, { from, to, limit: PAPER_PER_KEYWORD })
      via.add(r.provider)
      items.push(...r.works.map((w) => paperItem(w, word)))
    } catch (err) {
      console.warn(`[feeds] 키워드 논문 「${word}」 실패: ${err.message}`)
    }
  }
  return Object.assign(items, { via: [...via] })
}

function toFeedArticle(item, feed, keyword) {
  let url = item.link
  if (url.startsWith('//')) url = `https:${url}` // LEDinside
  url = url.replace(/[?&]sourceType=rss$/, '') // 뉴스와이어
  const published = new Date(item.date)
  return {
    id: articleId(url),
    title: item.title,
    description: item.description,
    url,
    section: `feed:${feed.id}`,
    source: feed.name,
    keyword,
    // 날짜가 없거나 앞날(학술지 인쇄 예정일 등)이면 받은 시각으로
    publishedAt: Number.isNaN(published.getTime()) || published.getTime() > Date.now() ? new Date().toISOString() : published.toISOString(),
  }
}

// words: 자동 수집 키워드, disabled: 관리자가 끈 출처 id
// 결과: articles(넣을 기사), results(출처마다 받은 글 수 · 맞은 글 수 · 오류)
export async function collectFeeds(words, { disabled = [] } = {}) {
  const since = Date.now() - FEED_DAYS * 86_400_000
  const paperSince = Date.now() - PAPER_KEYWORD_DAYS * 86_400_000
  const feeds = FEEDS.filter((f) => !disabled.includes(f.id))
  const articles = []
  const results = []
  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const items = feed.paper ? await searchPapers(words) : parseFeed(await getText(feed.url))
        let matched = 0
        for (const item of items) {
          if (!item.title || !item.link) continue
          const at = Date.parse(item.date)
          if (!Number.isNaN(at) && at < (feed.paper ? paperSince : since)) continue
          // 키워드로 찾은 논문은 그 키워드 (초록에만 영문 다른 표기로 있을 수 있음)
          const keyword = item.keyword ?? words.find((w) => hasKeyword(`${item.title} ${item.description}`, w))
          if (!keyword) continue
          matched += 1
          articles.push(toFeedArticle(item, feed, keyword))
        }
        results.push({ id: feed.id, ok: true, items: items.length, matched, ...(items.via ? { via: items.via } : {}) })
      } catch (err) {
        results.push({ id: feed.id, ok: false, error: err.name === 'TimeoutError' ? '응답 시간 초과' : err.message })
      }
    }),
  )
  // 같은 논문이 SID RSS와 논문 검색에 둘 다 오면 RSS 쪽만 (DOI로 비교)
  const doiOf = (u) => u.match(/10\.\d{4,}\/[^?#\s]+/)?.[0]?.toLowerCase()
  const rssDois = new Set(articles.filter((a) => a.section !== 'feed:crossref').map((a) => doiOf(a.url)).filter(Boolean))
  const kept = articles.filter((a) => a.section !== 'feed:crossref' || !rssDois.has(doiOf(a.url)))
  const unique = [...new Map(kept.map((a) => [a.url, a])).values()]
  return { articles: unique, results: FEEDS.filter((f) => !disabled.includes(f.id)).map((f) => results.find((r) => r.id === f.id)) }
}

// 관리 화면용 목록
export function feedList() {
  return FEEDS.map(({ id, name, tier, url, lang, paper }) => ({ id, name, tier, url: url ?? 'https://api.openalex.org', lang: lang ?? 'ko', paper: Boolean(paper) }))
}
