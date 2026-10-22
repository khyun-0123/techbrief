// 중요도 점수 0~100 — 규칙으로 계산하고, 담당자가 최종 판단한다 (08 개발 계획안 5-2)
import { EXPERT_SOURCES } from './normalize.js'

export const HIGH_THRESHOLD = 60 // 이 점수 이상이면 "중요도 높음" (계획안은 70, 실제 데이터로 60에서 시작)

// 경쟁사·관심 기업. 고객사에게 목록을 받으면 바꾼다 (1차 인터뷰 후속 질문)
const COMPETITORS = (process.env.COMPETITORS ?? '삼성디스플레이,LG디스플레이,BOE,CSOT,티엔마,샤프,JDI,삼성전자,애플')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// groupSize: 같은 이슈로 묶인 기사 수(대표 포함)
export function scoreArticle(article, groupSize) {
  const text = `${article.title} ${article.description ?? ''}`
  const coverage = Math.min(40, (groupSize - 1) * 8)
  const expert = EXPERT_SOURCES.has(article.source) ? 15 : 0
  const competitor = COMPETITORS.some((c) => text.includes(c)) ? 25 : 0
  const hours = (Date.now() - Date.parse(article.publishedAt)) / 3600_000
  const recency = Math.round(20 * Math.max(0, 1 - hours / 72))
  const score = coverage + expert + competitor + recency
  return { score, level: score >= HIGH_THRESHOLD ? 'high' : 'normal', parts: { coverage, expert, competitor, recency } }
}
