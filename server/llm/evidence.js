// 근거 검증 — AI가 단 근거 번호를 규칙으로 다시 확인한다 (10 보고서 계획 3-3)
// 모델은 기사에 없는 일반 지식에도 '기사 근거'나 기사 번호를 붙이는 경우가 있다.
// 문장과 원래 기사 텍스트(제목·요약문·같은 이슈 기사)가 글자 단위로 얼마나 겹치는지 보고,
// 기준보다 적게 겹치면 근거 번호를 지운다. 사실 확인을 완벽히 대신하지는 못한다.

// 실제 요약·보고서 문장으로 측정: 기사 근거 문장 0.39 이상, AI 보충 문장 0.33 이하 → 0.35
const MIN_OVERLAP = Number(process.env.EVIDENCE_MIN_OVERLAP ?? 0.35)

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

export function isSupported(text, evidence) {
  return overlap(text, evidence) >= MIN_OVERLAP
}

// 기사 하나의 원래 텍스트
export function evidenceOf(article) {
  return [article.title, article.description, ...(article.related ?? []).flatMap((r) => [r.title, r.description])]
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
