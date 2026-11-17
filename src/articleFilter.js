// 자료 현황 「모은 자료」 목록 거르기 · 줄 세우기 (11/17, 39 문서 5장 B2)
// 화면(App.jsx, 목록 전체를 받은 경우)과 서버(/api/articles/page, 한 쪽씩)가 **같은 함수**를 쓴다 — 거르기 규칙이 두 곳에 생기지 않게
// 찾기 결과(searchArticles) 목록은 여기 들어오지 않는다 (화면이 따로)
import { matchesTerms } from './highlightTerms.js'

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
export function collectedView(list, { maxHours = Infinity, source = 'all', q = '', sort = 'importance', summarizedFirst = false, showLow = false, excludeOwn = false, textFor, hasSummary } = {}) {
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
  const visible = ordered.filter((a) => (showLow || !isLow(a)) && !(excludeOwn && isOwnOnly(a)))
  return { visible, lowCount, ownCount, listedCount: listed.length, summarizedCount: listed.filter(has).length }
}
