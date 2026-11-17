// 자료 현황 한 쪽씩 (11/17, 39 문서 5장 B2 · 41 문서 B2). 실험 기능 「articlesPaging」을 켰을 때만 화면이 쓴다 (server/features.js)
// 예전(지금 기본): /api/articles가 7일치 전체(약 3,300이슈 · 4MB)를 보내고 화면이 거르기 · 정렬 · 쪽 나누기
// 켜면: 대시보드는 /api/articles/home(오늘 숫자 · 48시간 중요 30건)만, 자료 현황은 /api/articles/page로 한 쪽씩,
//       선별해 둔 자료는 /api/articles/by-ids로 필요한 것만
// - 거르기 · 정렬은 화면과 같은 함수(src/articleFilter.js collectedView)
// - 검색어는 제목 · 키워드 · 해시태그로 맞춘다. 사전은 화면과 같음: 자동 수집 키워드 · 회사 목록 · 「요즘 뜨는 기술」 용어(techTermNames)
import { collectedView, PERIOD_HOURS } from '../src/articleFilter.js'
import { buildTagDict, tagsOf, techTermNames } from '../src/hashtags.js'
import { getKeywords } from './db/store.js'
import { getLists } from './collector/lists.js'
import { listMaterials } from './materials.js'
import { getTechTrends } from './techtrends.js'

const HOME_MAX = 30
const SIZES = new Set([10, 20, 30, 50, 100])
const derived = new WeakMap() // 미리 계산한 목록마다 한 번: 키워드로 거른 목록 · 사전

const hoursAgo = (a) => Math.max(0, (Date.now() - Date.parse(a.publishedAt)) / 3600_000)
const countArticles = (list) => list.reduce((n, a) => n + 1 + (a.sameIssue ?? 0), 0)

async function prepare(light) {
  let d = derived.get(light)
  if (d) return d
  const [keywords, lists, trends] = await Promise.all([getKeywords().catch(() => []), getLists().catch(() => null), getTechTrends({ period: 'week' }).catch(() => null)])
  // 화면 App.jsx gathered와 같음: 자동 수집 키워드에 해당하는 기사 + 1·2차 출처
  const gathered = light.articles.filter((a) => keywords.includes(a.keyword) || a.keyword === '1·2차 출처')
  const dict = buildTagDict([keywords, lists?.own, lists?.competitors, lists?.interests, lists?.suppliers, techTermNames(trends)])
  d = { gathered, dict, keywords }
  derived.set(light, d)
  return d
}

// 대시보드 첫 화면
export async function articlesHome(light) {
  const { gathered } = await prepare(light)
  const today = gathered.filter((a) => hoursAgo(a) < 24 && !(a.keyword === '1·2차 출처' && a.relevance === 'low'))
  const home = gathered
    .filter((a) => hoursAgo(a) < 48 && a.relevance !== 'low')
    .sort((x, y) => (y.importance ?? 0) - (x.importance ?? 0))
    .slice(0, HOME_MAX)
  return {
    paging: true,
    lastCollectedAt: light.lastCollectedAt ?? null,
    rule: light.rule ?? null,
    todayIssues: today.length,
    todayArticles: countArticles(today),
    homeIssues: home,
    sources: [...new Set(gathered.map((a) => a.source))].sort(),
    total: gathered.length,
  }
}

// 자료 현황 한 쪽
export async function articlesPage(light, params, clientId = null) {
  const { gathered, dict } = await prepare(light)
  const source = String(params.get('source') ?? 'all')
  const materials = source === 'all' || source === 'material' ? await listMaterials(300, clientId).catch(() => []) : []
  const size = SIZES.has(Number(params.get('size'))) ? Number(params.get('size')) : 20
  const { visible, lowCount, ownCount, listedCount, summarizedCount } = collectedView([...gathered, ...materials], {
    maxHours: PERIOD_HOURS[params.get('period')] ?? PERIOD_HOURS.week,
    source,
    q: String(params.get('q') ?? '').slice(0, 100),
    sort: params.get('sort') === 'latest' ? 'latest' : 'importance',
    summarizedFirst: params.get('sf') === '1',
    showLow: params.get('low') === '1',
    excludeOwn: params.get('own') === '1',
    textFor: (a) => `${a.title} ${a.keyword} ${tagsOf(a, a.summaryLite, dict).map((t) => t.term ?? t).join(' ')}`,
  })
  const pageCount = Math.max(1, Math.ceil(visible.length / size))
  const page = Math.min(Math.max(1, Number(params.get('page')) || 1), pageCount)
  return {
    page,
    size,
    total: visible.length,
    totalArticles: countArticles(visible),
    lowCount,
    ownCount,
    summarizedCount,
    listedCount,
    items: visible.slice((page - 1) * size, page * size),
  }
}

// 선별해 둔 자료 등 id로 (최대 300)
export async function articlesByIds(light, ids) {
  const want = new Set((Array.isArray(ids) ? ids : []).map(String).slice(0, 300))
  return { items: light.articles.filter((a) => want.has(String(a.id))) }
}
