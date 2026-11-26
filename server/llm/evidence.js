// 근거 검증 — AI가 단 근거 번호를 규칙으로 다시 확인한다 (10 보고서 계획 3-3)
// 모델은 기사에 없는 일반 지식에도 '기사 근거'나 기사 번호를 붙이는 경우가 있다.
// 문장과 원래 기사 텍스트(제목·요약문·같은 이슈 기사)가 글자 단위로 얼마나 겹치는지 보고,
// 기준보다 적게 겹치면 근거 번호를 지운다. 사실 확인을 완벽히 대신하지는 못한다.
import { tune } from '../tunables.js'

// 실제 요약·보고서 문장으로 측정: 기사 근거 문장 0.39 이상, AI 보충 문장 0.33 이하 → 0.35
// 11/26: 관리 페이지 「세부 설정 › 보고서 한도 › 근거 확인 기준」(server/tunables.js evidenceOverlap, .env.local EVIDENCE_MIN_OVERLAP이 처음 값)
const MIN_OVERLAP = () => tune('evidenceOverlap')

function bigrams(text) {
  const norm = text.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()
  const set = new Set()
  for (let i = 0; i < norm.length - 1; i += 1) set.add(norm.slice(i, i + 2))
  return set
}

// 문장의 글자쌍 중 근거 텍스트에도 있는 비율 (0~1)
export function overlap(text, evidence) {
  const A = bigrams(text)
  if (A.size === 0) return 0
  const B = bigrams(evidence)
  let common = 0
  for (const g of A) if (B.has(g)) common += 1
  return common / A.size
}

export function isSupported(text, evidence, min = MIN_OVERLAP()) {
  return overlap(text, evidence) >= min
}

// 원문 본문처럼 긴 근거와 대조할 때, 모델이 'AI 해설'이라고 한 문장을 사실로 옮기는 기준 (15 문서 F15)
// 실측(기사 3건 원문): 기사 사실 0.66~0.77, 원문에 없는 일반 설명 0.47~0.51 → 0.6
export const STRONG_OVERLAP = 0.6

// 제안·전망 문장 (끝맺음으로 판단). 원문 단어를 많이 써도 AI 해설·제안으로 둔다
const PROPOSAL = /(수 있음|수 있다|기대됨|기대된다|기대할 수|필요함|필요하다|바람직|검토|해야 함|해야 한다|가능함|가능하다|전망됨|전망이다|예상됨|예상된다|것임|것이다)[.\s]*$/

export function isProposal(text) {
  return PROPOSAL.test(text.trim())
}

// 기사 하나의 원래 텍스트
export function evidenceOf(article) {
  return [article.title, article.description, article.body, ...(article.related ?? []).flatMap((r) => [r.title, r.description])]
    .filter(Boolean)
    .join(' ')
}

// 모델이 문장 안에 써 넣은 "[1]", "[1,2]", "(2)" 같은 번호 표기를 지운다 (번호는 refs로만)
export function stripInlineRefs(text) {
  return text.replace(/\s*[[(]\s*\d+(\s*[,·]\s*\d+)*\s*[\])]/g, '').trim()
}

// 한자·중국어가 섞였는지 (qwen 모델이 BOE를 '京东方'으로 쓰는 경우 등)
export function hasHan(text) {
  return /\p{Script=Han}/u.test(text)
}
