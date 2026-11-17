// 자료 현황 「모은 자료」 목록 거르기 · 줄 세우기 (11/17, 39 문서 5장 B2)
// 화면(App.jsx, 목록 전체를 받은 경우)과 서버(/api/articles/page, 한 쪽씩)가 **같은 함수**를 쓴다 — 거르기 규칙이 두 곳에 생기지 않게
// 찾기 결과(searchArticles) 목록은 여기 들어오지 않는다 (화면이 따로)
import { matchesTerms } from './highlightTerms.js'

// 긍정 · 중립 · 부정 (13 문서 F5): AI 요약의 판단이 있으면 그것, 없으면 제목 기준. 예전 이름(호재 · 악재)도 읽음
// 화면 표시(SentimentBadge.jsx)와 거르기(화면 · 서버)가 같이 쓴다
const OLD_LABEL = { 호재: '긍정', 악재: '부정' }
export function sentimentLabel(sentiment) {
  const label = sentiment?.label
  return OLD_LABEL[label] ?? label
}
export function sentimentOf(article, summary) {
  return summary?.sentiment ?? article?.titleSentiment ?? null
}

export const PERIOD_HOURS = { today: 24, week: 24 * 7, all: Infinity }

const hoursAgoOf = (a) => a.hoursAgo ?? Math.max(0, (Date.now() - Date.parse(a.publishedAt)) / 3600_000)
// 자사·자회사만 나온 기사 (경쟁사도 함께 나오면 경쟁사 소식이라 남긴다)
export const isOwnOnly = (a) => Boolean(a.own) && !a.scoreParts?.competitorName
export const isLow = (a) => a.relevance === 'low'

// 출처 거르기: 'all' · 'tier:1' · 'tier:2' · 'tier:3' · 'material'(직접 추가) · 매체 이름
export const sourceMatches = (a, source) =>
  source === 'all' || (source === 'material' ? Boolean(a.material) : source.startsWith('tier:') ? String(a.tier ?? 3) === source.slice(5) : a.source === source)

// list: 모은 자료 + 직접 추가한 자료
// opts.textFor(a): 검색어를 맞출 글 (화면: 제목 · 키워드 · 해시태그), opts.hasSummary(a): 요약 먼저에 씀
// 돌려주는 값: { visible(거른 뒤 · 순서대로), lowCount, ownCount } — 개수는 「관련 낮음 · 자사만」 거르기 전 기준 (화면 안내 문구)
// opts.sentiment: '긍정' · '중립' · '부정'이면 그것만 (all · 없음이면 거르지 않음), opts.summaryFor(a): 요약(감성 판단에 씀, 없으면 summaryLite)
export function collectedView(list, { maxHours = Infinity, source = 'all', q = '', sort = 'importance', summarizedFirst = false, showLow = false, excludeOwn = false, sentiment = 'all', textFor, hasSummary, summaryFor } = {}) {
  const query = String(q ?? '').trim().toLowerCase()
  const listed = list
    .filter(
      (a) =>
        // 「직접 추가한 자료」만 볼 때는 기간과 상관없이 모두
        (hoursAgoOf(a) < maxHours || source === 'material') &&
        sourceMatches(a, source) &&
        (!query || matchesTerms(textFor ? textFor(a) : `${a.title} ${a.keyword}`, [query])),
    )
    .sort((a, b) => (sort === 'importance' ? (b.importance ?? 0) - (a.importance ?? 0) : 0) || hoursAgoOf(a) - hoursAgoOf(b))
  const lowCount = listed.filter(isLow).length
  const ownCount = listed.filter(isOwnOnly).length
  const has = hasSummary ?? ((a) => Boolean(a.summaryLite))
  const ordered = summarizedFirst ? [...listed.filter(has), ...listed.filter((a) => !has(a))] : listed
  const sumOf = summaryFor ?? ((a) => a.summaryLite)
  const sentimentOk = (a) => !sentiment || sentiment === 'all' || sentimentLabel(sentimentOf(a, sumOf(a))) === sentiment
  const visible = ordered.filter((a) => (showLow || !isLow(a)) && !(excludeOwn && isOwnOnly(a)) && sentimentOk(a))
  return { visible, lowCount, ownCount, listedCount: listed.length, summarizedCount: listed.filter(has).length }
}
