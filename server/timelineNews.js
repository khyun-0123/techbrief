// 기술 시계열의 「최근 소식」 (11/17, 37 문서 P8 · 36 문서 4-3 「시계열은 모은 기사 · 요약을 전혀 쓰지 않는다」)
// 우리가 모은 기사(네이버 수집 키워드 · 1·2차 출처 RSS) 중 최근 30일 안에 그 말이 든 이슈를 중요도 순으로 몇 개 보여 준다
// - 같은 이슈는 한 번 (저장된 묶음 번호), 점수는 자료 현황과 같은 저장 점수(article_scores, 최신성은 지금 기준)
// - AI 요약이 있으면 요약 한 줄(headline)을 함께 (요약은 이미 만들어 둔 것만, 여기서 AI를 부르지 않음)
// - 찾기로만 받은 기사(from_search)는 뺀다 — 자료 현황과 같은 범위
// - 단계 판정 · AI 흐름 정리에는 넣지 않는다 (판정은 논문 · 특허 규칙 그대로). 보여 주기만
import { dbEnabled, query } from './db/index.js'
import { storedScores } from './collector/index.js'

const DAYS = 30
const MAX = 6

export async function timelineNews(raw, { days = DAYS, max = MAX } = {}) {
  const q = String(raw ?? '').trim().slice(0, 50)
  if (!q || !dbEnabled()) return { query: q, items: [], total: 0 }
  const like = `%${q.toLowerCase().replace(/\s+/g, '').replace(/[%_\\]/g, '\\$&')}%`
  const { rows } = await query(
    `SELECT DISTINCT ON (coalesce(a.group_id, a.id)) coalesce(a.group_id, a.id) AS g, a.id, coalesce(a.full_title, a.title) AS title, a.source, a.url,
            a.published_at, coalesce(a.section, '') AS section, s.content->>'headline' AS headline
       FROM articles a
       LEFT JOIN summaries s ON s.article_id = coalesce(a.group_id, a.id) OR s.article_id = a.id
      WHERE NOT a.from_search
        AND a.published_at > now() - make_interval(days => $2)
        AND coalesce(a.section, '') <> 'feed:crossref'
        AND lower(regexp_replace(coalesce(a.full_title, a.title) || ' ' || coalesce(a.description, ''), '\\s+', '', 'g')) LIKE $1
      ORDER BY coalesce(a.group_id, a.id), (s.content IS NOT NULL) DESC, (a.id = coalesce(a.group_id, a.id)) DESC, a.published_at DESC`,
    [like, days],
  )
  const scores = await storedScores(rows.map((r) => r.g)).catch(() => new Map())
  const items = rows
    .map((r) => {
      const sc = scores.get(r.g)
      return {
        id: r.g,
        title: r.title,
        source: r.source,
        url: r.url,
        publishedAt: r.published_at.toISOString(),
        feed: r.section.startsWith('feed:'), // 1·2차 출처
        score: sc?.score ?? null,
        high: sc?.level === 'high',
        headline: r.headline || null,
      }
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  return { query: q, days, total: items.length, items: items.slice(0, max) }
}
