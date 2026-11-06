// 중요도 점수 0~100 — 규칙으로 계산하고, 담당자가 최종 판단한다 (08 개발 계획안 5-2)
// 목록의 '중요' 배지·중요도순 정렬과 자동 요약 순서가 이 점수 하나를 같이 쓴다
import { findMention } from './lists.js'
import { EXPERT_SOURCES } from './normalize.js'

export const HIGH_THRESHOLD = 60 // 이 점수 이상이면 "중요도 높음" (계획안은 70, 실제 데이터로 60에서 시작)

// 관련도 배수: 키워드가 본문에 스치기만 한 큰 뉴스(증시 마감, 행사 등)가 보도량만으로 위에 오지 않게
const RELEVANCE_WEIGHT = { high: 1, mid: 0.5, low: 0.2 }

// 제목에 나오는 기술·사업 사건 (1개 5점, 최대 10점)
const EVENT_WORDS = ['개발', '양산', '출시', '공개', '상용화', '최초', '특허', '수주', '공급', '투자', '인수', '합병', '협력', '표준', '공정', '수율', '신제품']
// 사진·인사·홍보·증시 시황·자동 생성 주가 기사 (−15점)
const NOISE_WORDS = ['[포토]', '[사진]', '[인사]', '[부고]', '할인', '이벤트', '모집', '강좌', '특강', '경진대회', '[공시]', '마감시황', '코스피', '코스닥', '주가']
const STOCK_PATTERN = /\d[\d,]*원으로|\d+(\.\d+)?% (상승|하락|급등|급락)|강보합|약보합|상한가|하한가|목표주가/

// groupSize: 같은 이슈로 묶인 기사 수(대표 포함)
// competitors·interests: 경쟁사·관심 기술 목록. 사용자가 화면에서 입력한다 (collector/lists.js)
// relevance: 이슈의 관련도 high(제목에 키워드) / mid(발췌에만) / low
export function scoreArticle(article, groupSize, competitors = [], { relevance = 'high', interests = [] } = {}) {
  const title = article.title
  const text = `${title} ${article.description ?? ''}`
  const coverage = Math.min(40, (groupSize - 1) * 8)
  // 전문 매체: 1·2차 출처(기업 발표·학회·논문·전문매체, feeds.js)도 같은 점수. tier가 없으면 매체 이름으로
  const expert = (article.tier ? article.tier <= 2 : EXPERT_SOURCES.has(article.source)) ? 15 : 0
  // 경쟁사: 제목에 나오면 25점, 발췌에만 스치면 10점 (예: '삼성디스플레이 근처 아파트')
  const competitorInTitle = findMention(title, competitors)
  const competitorName = competitorInTitle ?? findMention(text, competitors)
  const competitor = competitorInTitle ? 25 : competitorName ? 10 : 0
  const interestName = findMention(title, interests)
  const interest = interestName ? 15 : 0
  const eventWords = EVENT_WORDS.filter((w) => title.includes(w)).slice(0, 2)
  const event = eventWords.length * 5
  const noise = NOISE_WORDS.some((w) => title.includes(w)) || STOCK_PATTERN.test(title) ? -15 : 0
  const hours = (Date.now() - Date.parse(article.publishedAt)) / 3600_000
  const recency = Math.round(20 * Math.max(0, 1 - hours / 72))
  const weight = RELEVANCE_WEIGHT[relevance] ?? 1
  const raw = coverage + expert + competitor + interest + event + noise + recency
  const score = Math.max(0, Math.min(100, Math.round(raw * weight)))
  return {
    score,
    level: score >= HIGH_THRESHOLD ? 'high' : 'normal',
    parts: { coverage, expert, competitor, interest, event, noise, recency, weight, competitorName, interestName, eventWords },
  }
}
