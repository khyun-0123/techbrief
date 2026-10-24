// 검색 API 응답을 화면에서 쓰는 기사 모양으로 정리한다
import { createHash } from 'node:crypto'

const ENTITIES = { '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' }

// <b>OLED</b>, &quot; 같은 표시를 걷어낸다
export function cleanText(text = '') {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&(quot|amp|lt|gt|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

// 원문 주소의 도메인으로 매체명을 정한다. 목록에 없으면 도메인을 그대로 쓴다
const SOURCES = {
  'etnews.com': '전자신문',
  'thelec.kr': '디일렉',
  'zdnet.co.kr': 'ZDNet Korea',
  'dt.co.kr': '디지털타임스',
  'ddaily.co.kr': '디지털데일리',
  'it.chosun.com': 'IT조선',
  'inews24.com': '아이뉴스24',
  'bloter.net': '블로터',
  'hankyung.com': '한국경제',
  'mk.co.kr': '매일경제',
  'sedaily.com': '서울경제',
  'edaily.co.kr': '이데일리',
  'mt.co.kr': '머니투데이',
  'asiae.co.kr': '아시아경제',
  'fnnews.com': '파이낸셜뉴스',
  'heraldcorp.com': '헤럴드경제',
  'yna.co.kr': '연합뉴스',
  'newsis.com': '뉴시스',
  'news1.kr': '뉴스1',
  'chosun.com': '조선일보',
  'joongang.co.kr': '중앙일보',
  'donga.com': '동아일보',
  'hani.co.kr': '한겨레',
  'khan.co.kr': '경향신문',
}

// 기술 전문 매체 (중요도 점수에 씀)
export const EXPERT_SOURCES = new Set(['전자신문', '디일렉', 'ZDNet Korea', '디지털타임스', '디지털데일리', 'IT조선', '아이뉴스24', '블로터'])

export function sourceFromUrl(url) {
  let host
  try {
    host = new URL(url).hostname.replace(/^(www|m)\./, '')
  } catch {
    return '출처 미상'
  }
  const match = Object.keys(SOURCES).find((d) => host === d || host.endsWith(`.${d}`))
  return match ? SOURCES[match] : host
}

// 같은 원문은 같은 id가 되도록 주소로 만든다
export function articleId(url) {
  return createHash('sha1').update(url).digest('hex').slice(0, 12)
}

export function toArticle(item, keyword) {
  const url = item.originallink || item.link
  // 네이버 뉴스 주소의 sid가 섹션 번호 (100 정치, 101 경제, 102 사회, 103 생활/문화, 104 세계, 105 IT/과학)
  const section = String(item.link ?? '').match(/n\.news\.naver\.com\/.*[?&]sid=(\d{3})/)?.[1] ?? null
  const published = new Date(item.pubDate)
  return {
    id: articleId(url),
    title: cleanText(item.title),
    description: cleanText(item.description),
    url,
    section,
    source: sourceFromUrl(url),
    keyword,
    publishedAt: Number.isNaN(published.getTime()) ? new Date().toISOString() : published.toISOString(),
  }
}
