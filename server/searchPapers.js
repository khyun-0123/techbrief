// 자료 현황 「뉴스·논문에서 찾기」의 논문 쪽 (11/08 조장: 이제 네이버만 찾는 게 아님)
// - 논문 출처 순서(OpenAlex → Crossref → …)와 캐시(server/papers)를 그대로 쓴다. 같은 말은 6시간 캐시
// - 검색어가 한글이면 영문 표기(aliases.js)가 있을 때만 찾는다
// - 결과는 기사와 같은 모양으로 돌려준다 (출처 단계 1차 · 「논문」 표시)
import { createHash } from 'node:crypto'
import { englishOf } from './collector/aliases.js'
import { searchPapers } from './papers/index.js'
import { DISPLAY_TOPICS, isDisplayPaper } from './papers/journals.js'

const DAYS = { today: 30, week: 90, all: 730 } // 논문은 하루 · 일주일 안에 거의 없어 조금 넓게
const LIMIT = 10

export async function searchPaperArticles(query, period = 'all') {
  const en = englishOf(query)
  if (!en) return { articles: [], note: '한글 검색어라 논문은 찾지 않았어요 (영문 표기로 찾아 보세요)' }
  const days = DAYS[period] ?? DAYS.all
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  // 디스플레이 주제로 좁힌다 (11/08 시험: 「microLED」만으로는 광유전학 · 생체 논문이 절반)
  const { works, provider } = await searchPapers({ query: en, from, to, sort: period === 'all' ? 'cited' : 'date', limit: 25, topics: DISPLAY_TOPICS })
  const articles = works
    .filter((w) => w.title && isDisplayPaper(w))
    .slice(0, LIMIT)
    .map((w) => {
      const url = w.url || (w.doi ? `https://doi.org/${w.doi}` : '')
      const published = w.date ? new Date(w.date) : new Date()
      return {
        id: `p-${createHash('sha1').update(url || w.title).digest('hex').slice(0, 12)}`,
        url,
        title: w.title,
        description: (w.abstract ?? '').slice(0, 300),
        source: w.journal || '논문',
        keyword: String(query).trim(),
        publishedAt: published.toISOString(),
        tier: 1,
        paper: true,
        cited: w.cited ?? 0,
        relevance: 'high',
        importance: 0,
        sameIssue: 0,
      }
    })
  return { articles, provider, note: null }
}
