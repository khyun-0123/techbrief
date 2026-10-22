// 수집 흐름: 키워드별 검색 → 정리 → 원문 주소로 중복 제외 → 같은 이슈 묶기 → 중요도 점수
// 1차: 서버 메모리에만 보관 (서버를 끄면 비워짐. 화면 쪽은 localStorage에 마지막 결과를 둔다)
import { groupArticles } from './dedupe.js'
import { searchNews } from './naver.js'
import { toArticle } from './normalize.js'
import { scoreArticle } from './score.js'

const MAX_KEYWORDS = 10 // API 호출 수를 지키기 위한 한도
const KEEP_DAYS = 7

const store = new Map() // id → article
let lastCollectedAt = null

export async function collect(keywords) {
  const words = [...new Set(keywords.map((k) => String(k).trim()).filter(Boolean))].slice(0, MAX_KEYWORDS)
  if (words.length === 0) throw Object.assign(new Error('수집할 키워드가 없어요.'), { status: 400 })

  let fetched = 0
  let added = 0
  const failed = []
  for (const word of words) {
    try {
      const items = await searchNews(word)
      fetched += items.length
      for (const item of items) {
        const article = toArticle(item, word)
        if (!article.url || !article.title) continue
        if (!store.has(article.id)) added += 1
        store.set(article.id, { ...store.get(article.id), ...article })
      }
    } catch (err) {
      failed.push({ keyword: word, error: err.message })
    }
  }
  if (failed.length === words.length) {
    throw Object.assign(new Error(failed[0].error), { status: 502 })
  }

  // 오래된 기사는 버린다
  const cutoff = Date.now() - KEEP_DAYS * 24 * 3600_000
  for (const [id, a] of store) if (Date.parse(a.publishedAt) < cutoff) store.delete(id)

  lastCollectedAt = new Date().toISOString()
  return { fetched, added, failed, ...listArticles() }
}

// 대표 기사 목록. 같은 이슈 기사는 related로 붙인다
export function listArticles() {
  const grouped = groupArticles([...store.values()])
  const members = new Map()
  for (const a of grouped) {
    if (!members.has(a.groupId)) members.set(a.groupId, [])
    members.get(a.groupId).push(a)
  }
  const articles = grouped
    .filter((a) => a.id === a.groupId)
    .map((rep) => {
      const group = members.get(rep.id)
      const { score, level, parts } = scoreArticle(rep, group.length)
      const related = group
        .filter((a) => a.id !== rep.id)
        .slice(0, 4)
        .map(({ title, source, description, url }) => ({ title, source, description, url }))
      return { ...rep, sameIssue: group.length - 1, importance: score, importanceLevel: level, scoreParts: parts, related }
    })
    .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt))
  return { articles, total: store.size, lastCollectedAt }
}
