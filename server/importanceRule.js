// 중요도 기준 (11/15 팀 회의: 「중요도 기준을 관리자 페이지에서 수정」) — 다섯 칸 배점과 「중요」 기준 점수
// - 기본값: 신규성 30 · 사업 연관성 25 · 출처 신뢰도 20 · 최신성 15 · 보도량 10 (합 100), 45점 이상 「중요」 (11/09 재설계, 08 문서 5-2 · 33 문서)
// - 바꾸는 방식: 칸마다 계산 규칙은 그대로 두고 칸 점수를 「새 배점 ÷ 기본 배점」만큼 늘리거나 줄인다 (score.js). 그래서 배점 0이면 그 칸을 안 봄
// - 안전장치: 합계 100 · 칸마다 0~50 · 기준 20~80, 저장 전 미리보기(지금 자료로 중요 몇 건), 기본값으로 되돌리기, 바꾼 기록(변경 기록 + 이 설정 이력)
// - 점수는 저장하지 않고 목록을 부를 때마다 계산하므로 저장하면 다음 목록부터 바로 반영. 「중요」 찾기 결과는 자동 요약되므로 기준을 낮추면 AI 요약이 늘어난다
import { getSetting, setSetting } from './db/store.js'

export const PARTS = [
  ['novelty', '신규성', '처음 나온 소식 · 새 기술 낱말 · 요즘 뜨는 기술'],
  ['business', '사업 연관성', '경쟁사 · 관심 기술 · 사업 사건 · 자사'],
  ['source', '출처 신뢰도', '1차(기업 발표 · 학회 · 논문) · 2차(전문매체) · 일반 뉴스'],
  ['recency', '최신성', '7일에 걸쳐 0으로'],
  ['coverage', '보도량', '같은 이슈를 다룬 서로 다른 매체 수'],
]
export const DEFAULT_RULE = Object.freeze({ weights: Object.freeze({ novelty: 30, business: 25, source: 20, recency: 15, coverage: 10 }), high: 45 })
const KEY = 'importance_rule'
const HISTORY_KEY = 'importance_rule_history'
const TTL = 60_000

const G = (globalThis.__techbriefImportance ??= { rule: DEFAULT_RULE, at: 0 })

// 들어온 값 검사 — 틀리면 오류(400)
export function checkRule(input) {
  const weights = {}
  for (const [k, label] of PARTS) {
    const v = Number(input?.weights?.[k])
    if (!Number.isInteger(v) || v < 0 || v > 50) throw Object.assign(new Error(`「${label}」 배점은 0~50 사이 정수여야 해요.`), { status: 400 })
    weights[k] = v
  }
  const sum = Object.values(weights).reduce((a, b) => a + b, 0)
  if (sum !== 100) throw Object.assign(new Error(`배점 합계가 100이어야 해요 (지금 ${sum}).`), { status: 400 })
  const high = Number(input?.high)
  if (!Number.isInteger(high) || high < 20 || high > 80) throw Object.assign(new Error('「중요」 기준은 20~80 사이 정수여야 해요.'), { status: 400 })
  return { weights, high }
}

// 지금 기준 (동기 — 점수 계산에서 씀). loadImportanceRule()로 미리 읽어 둔 값
export const importanceRule = () => G.rule

// DB에서 읽기 (1분 기억). 점수를 계산하기 전에 부른다 (collector scoreContext)
export async function loadImportanceRule({ fresh = false } = {}) {
  if (!fresh && Date.now() - G.at < TTL) return G.rule
  try {
    const saved = await getSetting(KEY, null)
    G.rule = saved ? checkRule(saved) : DEFAULT_RULE
  } catch {
    G.rule = DEFAULT_RULE // 저장된 값이 깨졌으면 기본값
  }
  G.at = Date.now()
  return G.rule
}

export async function saveImportanceRule(input, who = '관리자') {
  const rule = checkRule(input)
  await setSetting(KEY, rule)
  const history = await getSetting(HISTORY_KEY, []).catch(() => [])
  history.unshift({ at: new Date().toISOString(), name: who, rule })
  await setSetting(HISTORY_KEY, history.slice(0, 30))
  G.rule = rule
  G.at = Date.now()
  return rule
}

export const ruleHistory = () => getSetting(HISTORY_KEY, []).catch(() => [])

export const describeRule = (r) => `${PARTS.map(([k, label]) => `${label} ${r.weights[k]}`).join(' · ')}, ${r.high}점 이상 중요`

// 미리보기: 지금 이슈들의 원래 칸 점수(parts.raw)로 새 기준 점수를 다시 셈
export function previewRule(articles, rule) {
  const d = DEFAULT_RULE.weights
  const scoreWith = (a, r) => {
    const p = a.scoreParts
    const raw = Object.entries(d).reduce((sum, [k, dk]) => sum + ((p.raw?.[k] ?? 0) * r.weights[k]) / dk, 0)
    return Math.max(0, Math.min(100, Math.round(raw * (p.weight ?? 1) * (p.noise ?? 1))))
  }
  const list = articles.filter((a) => !a.paper && a.scoreParts?.raw)
  const now = importanceRule()
  const rows = list.map((a) => ({ id: a.id, title: a.title, source: a.source, before: scoreWith(a, now), after: scoreWith(a, rule) }))
  const isHigh = (s, r) => s >= r.high
  const entering = rows.filter((x) => !isHigh(x.before, now) && isHigh(x.after, rule)).sort((a, b) => b.after - a.after)
  const leaving = rows.filter((x) => isHigh(x.before, now) && !isHigh(x.after, rule)).sort((a, b) => a.after - b.after)
  return {
    total: rows.length,
    nowHigh: rows.filter((x) => isHigh(x.before, now)).length,
    nextHigh: rows.filter((x) => isHigh(x.after, rule)).length,
    entering: entering.slice(0, 6),
    leaving: leaving.slice(0, 6),
    enteringCount: entering.length,
    leavingCount: leaving.length,
  }
}
