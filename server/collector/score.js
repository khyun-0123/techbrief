// 중요도 점수 0~100 — 규칙으로 계산하고, 담당자가 최종 판단한다 (08 개발 계획안 5-2)
import { EXPERT_SOURCES } from './normalize.js'

export const HIGH_THRESHOLD = 60 // 이 점수 이상이면 "중요도 높음" (계획안은 70, 실제 데이터로 60에서 시작)

// groupSize: 같은 이슈로 묶인 기사 수(대표 포함)
// competitors: 경쟁사 목록. 사용자가 화면에서 입력한다 (collector/lists.js)
export function scoreArticle(article, groupSize, competitors = []) {
  const text = `${article.title} ${article.description ?? ''}`
  const coverage = Math.min(40, (groupSize - 1) * 8)
  const expert = EXPERT_SOURCES.has(article.source) ? 15 : 0
  const competitorName = competitors.find((c) => text.toLowerCase().includes(c.toLowerCase())) ?? null
  const competitor = competitorName ? 25 : 0
  const hours = (Date.now() - Date.parse(article.publishedAt)) / 3600_000
  const recency = Math.round(20 * Math.max(0, 1 - hours / 72))
  const score = coverage + expert + competitor + recency
  return { score, level: score >= HIGH_THRESHOLD ? 'high' : 'normal', parts: { coverage, expert, competitor, recency, competitorName } }
}
