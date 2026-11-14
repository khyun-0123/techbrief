// 중요도 점수 0~100 — 규칙으로 계산하고, 담당자가 최종 판단한다 (08 개발 계획안 5-2)
// 목록의 '중요' 배지·중요도순 정렬과 자동 요약 순서가 이 점수 하나를 같이 쓴다
import { findMention } from './lists.js'
import { EXPERT_SOURCES } from './normalize.js'
import { offTopicOf } from './relevance.js'
import { DEFAULT_RULE, importanceRule } from '../importanceRule.js'

// 이 점수 이상이면 "중요도 높음". 11/09 재설계 뒤 실제 데이터(모은 이슈 421개)로 다시 맞춤:
// 새 점수는 보도량이 10점으로 줄어 최고점이 60 근처 → 예전(60점 이상 8건, 약 2%)과 비슷한 비율이 되도록 45점 (약 4%)
export const HIGH_THRESHOLD = 45 // 기본값. 실제 기준은 관리 페이지 「중요도 기준」(importanceRule.js, 11/15)
const RECENCY_HOURS = 168
const RISING_FRESH_DAYS = 30
const NOISE_WEIGHT = 0.3

// 관련도 배수: 키워드가 본문에 스치기만 한 큰 뉴스(증시 마감, 행사 등)가 보도량만으로 위에 오지 않게
const RELEVANCE_WEIGHT = { high: 1, mid: 0.5, low: 0.2 }

// ── 11/09 재설계 (14 문서 4-A 배점안 · 24 문서 ⑤ · 26 문서: 「보도량보다 신규성」) ──
// 신규성 30 · 사업 연관성 25 · 출처 신뢰도 20 · 최신성 15 · 보도량 10 (합 100) − 잡음, × 관련도 배수
// 11/11 조정 (31 · 08 문서, LGD 입장 키워드 30개 검수): 경쟁사 제목 20 · 발췌 10, 자사는 단독 5 · 경쟁사와 함께(비교 기사) 10,
//   최신성은 7일(주간 브리핑 주기)에 걸쳐 0으로. 예전 72시간이면 4~7일 된 경쟁사 기사(HKC 투자 지연 등)가 최신성 0점이라 「중요」에서 빠졌다
// 예전: 보도량 40 · 경쟁사 25 · 최신성 20 · 전문 매체 15 · 관심 기술 15 · 사건 낱말 10

// 신규성 ① 새 기술 · 처음 나온 소식 낱말 (제목). 1개 6점, 2개 이상 10점
const NEW_WORDS = ['최초', '세계 첫', '첫 ', '신기술', '개발', '공개', '상용화', '시연', '신제품', '출시', '양산', '특허', '표준', '시제품', '선보', 'first', 'unveil', 'launch', 'develop', 'breakthrough', 'prototype', 'demonstrat', 'introduc', 'record']
// 사업 연관성의 사업 사건 낱말 (제목). 5점
const BIZ_WORDS = ['수주', '공급', '투자', '인수', '합병', '협력', '계약', '증설', '수율', '공정', '라인', '점유율', 'supply', 'invest', 'acquir', 'partner', 'contract', 'capacity', 'yield']
// 사진 · 인사 · 홍보 · 증시 시황 · 자동 생성 주가 기사 (×0.3, 11/11 — 예전 −15점)
const NOISE_WORDS = ['[포토]', '[사진]', '[인사]', '[부고]', '할인', '이벤트', '모집', '강좌', '특강', '경진대회', '[공시]', '마감시황', '코스피', '코스닥', '주가']
const STOCK_PATTERN = /\d[\d,]*원으로|\d+(\.\d+)?% (상승|하락|급등|급락)|강보합|약보합|상한가|하한가|목표주가/

const has = (text, words) => words.filter((w) => text.toLowerCase().includes(w.toLowerCase()))
// 사건 낱말로 잘못 잡히는 이름: 「한국투자증권」의 「투자」, 「공정위」 · 「공정거래」의 「공정」 (11/11)
const BIZ_FALSE = /투자증권|공정위|공정거래/g
// 성능 기록 (연구 성과): 「수명 3배 늘린」 · 「세계 최고」 · record → 새 기술 낱말 하나로 친다
const RECORD = /\d+(\.\d+)?\s*배\s*(늘|향상|높|개선|증가|길)|세계\s*최고|최고\s*(효율|성능|휘도)|\brecord\b/i
// 영문 · 숫자 용어(OCA 등)는 다른 영어 낱말 속에 들어 있으면 안 맞게 (11/09: 「local」 속 OCA 오검출, hashtags.js와 같은 규칙)
export function mentions(text, term) {
  const t = String(term ?? '').trim().toLowerCase()
  if (t.length < 2) return false
  const low = text.toLowerCase()
  if (!/^[a-z0-9][a-z0-9\s\-]*$/.test(t)) return low.includes(t)
  return new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]?')}s?($|[^a-z0-9])`).test(low) // 복수형(TFTs)도 (11/11)
}

// groupSize: 같은 이슈로 묶인 기사 수(대표 포함). outlets: 그중 서로 다른 매체 수 (없으면 groupSize)
// competitors · interests · own: 경쟁사 · 관심 기술 · 자사 목록 (collector/lists.js)
// relevance: 이슈의 관련도 high / mid / low
// rising: 「요즘 뜨는 기술」 상위 용어 [{ name, en, firstSeen }] (techtrends.js 종합 순위) → 신규성. 처음 잡힌 지 30일 안의 용어만
// rerun: 3~21일 전에 비슷한 제목의 이슈가 이미 있었음(재탕) → 신규성의 「첫 소식」 점수 없음
export function scoreArticle(article, groupSize, competitors = [], { relevance = 'high', interests = [], own = [], rising = [], rerun = false, outlets } = {}) {
  const title = article.title
  const text = `${title} ${article.description ?? ''}`

  // 1. 신규성 (최대 30): 첫 소식 10 + 새 기술 · 처음 낱말 최대 10 + 요즘 뜨는 기술 용어 10
  const newWords = [...has(title, NEW_WORDS), ...(RECORD.test(title) ? ['성능 기록'] : [])].slice(0, 2)
  // 11/11: 뜨는 기술 용어는 처음 잡힌 지 30일 안일 때만 (오래 뜬 용어는 더는 새 소식이 아님. 검수: 찾기 결과 1,754개 중 684개가 이 10점)
  const fresh = (t) => !t.firstSeen || Date.now() - Date.parse(t.firstSeen) <= RISING_FRESH_DAYS * 86_400_000
  const risingName = rising.find((t) => fresh(t) && (mentions(text, t.name) || mentions(text, t.en)))?.name ?? null
  const firstNews = rerun ? 0 : 10
  const novelty = firstNews + (newWords.length >= 2 ? 10 : newWords.length * 6) + (risingName ? 10 : 0)

  // 2. 사업 연관성 (최대 25): 경쟁사(제목 20 · 발췌 10) + 관심 기술(제목 10 · 발췌 4) + 사업 사건 5 + 자사(단독 5 · 경쟁사와 함께 10)
  //    자사 단독 소식은 담당자가 사내에서 이미 아는 내용이라 낮게, 경쟁사와 견주는 기사는 비교 보고서 재료라 높게 (11/11)
  const competitorInTitle = findMention(title, competitors)
  const competitorName = competitorInTitle ?? findMention(text, competitors)
  const interestInTitle = findMention(title, interests)
  const interestName = interestInTitle ?? findMention(text, interests)
  const bizWords = has(title.replace(BIZ_FALSE, ''), BIZ_WORDS).slice(0, 2)
  const ownName = findMention(text, own)
  const business = Math.min(
    25,
    (competitorInTitle ? 20 : competitorName ? 10 : 0) + (interestInTitle ? 10 : interestName ? 4 : 0) + (bizWords.length ? 5 : 0) + (ownName ? (competitorName ? 10 : 5) : 0),
  )

  // 3. 출처 신뢰도 (최대 20): 1차(기업 발표 · 학회 · 논문) 20 · 2차(전문매체) 12 · 일반 뉴스 5 (11/11, 예전 0)
  const tier = article.tier ?? (EXPERT_SOURCES.has(article.source) ? 2 : 3)
  const source = tier === 1 ? 20 : tier === 2 ? 12 : 5

  // 4. 최신성 (최대 15): 7일(168시간)에 걸쳐 0으로 (11/11, 예전 72시간)
  // 날짜가 비거나 깨졌으면 최신성 0 (11/11: 그대로 두면 점수가 NaN이 되어 정렬이 흐트러짐)
  const hours = (Date.now() - Date.parse(article.publishedAt)) / 3600_000
  const recency = Number.isFinite(hours) ? Math.round(15 * Math.max(0, 1 - hours / RECENCY_HOURS)) : 0

  // 5. 보도량 (최대 10): 2.5 × log₂(서로 다른 매체 수) — 2곳 2.5 · 4곳 5 · 16곳 10 (11/11, 예전 기사 1건당 2점)
  //    같은 매체의 중복 기사는 세지 않고, 받아쓰는 매체가 늘수록 더해지는 점수가 줄어든다 (「보도량보다 신규성」)
  const coverage = Math.min(10, Math.round(2.5 * Math.log2(Math.max(1, Number(outlets ?? groupSize) || 1)) * 10) / 10)

  // 잡음: 사진 · 인사 · 증시 시황, 그리고 제목 주제가 생활 · 행사 · 쇼핑 · 정치(예: 시의회 방문)인 기사 (relevance.js 주제 목록)
  const offTopic = ['생활·행사', '쇼핑', '정책·정치'].includes(offTopicOf(title))
  // 11/11: −15점 대신 ×0.3 (점수가 높은 시황 · 홍보 기사도 확실히 내려가게)
  const noise = NOISE_WORDS.some((w) => title.includes(w)) || STOCK_PATTERN.test(title) || offTopic ? NOISE_WEIGHT : 1
  const weight = RELEVANCE_WEIGHT[relevance] ?? 1
  // 관리 페이지 배점 (11/15): 칸마다 「새 배점 ÷ 기본 배점」만큼. 기본값이면 그대로
  const rule = importanceRule()
  const raw = { novelty, business, source, recency, coverage }
  const scaled = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.round(((v * rule.weights[k]) / DEFAULT_RULE.weights[k]) * 10) / 10]))
  const total = Object.values(scaled).reduce((a, b) => a + b, 0)
  const score = Math.max(0, Math.min(100, Math.round(total * weight * noise)))
  return {
    score,
    level: score >= rule.high ? 'high' : 'normal',
    parts: {
      ...scaled, noise, weight, raw, max: rule.weights, high: rule.high,
      firstNews: Boolean(firstNews), rerun, newWords, risingName,
      competitorName, interestName, bizWords, ownName, tier,
    },
  }
}
