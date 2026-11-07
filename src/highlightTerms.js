// 검색어 강조·거르기 기준 (Highlight.jsx와 자료 현황 목록이 같이 쓴다)
// 대소문자와 띄어쓰기 차이(마이크로 LED / 마이크로LED)는 같은 말로 본다
const escape = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 찾는 말들 → 정규식. 글자 사이에 공백이 있어도 없어도 맞게 (공백을 뺀 2글자 이상만)
export function highlightPattern(terms) {
  const words = [...new Set((terms ?? []).map((t) => String(t ?? '').replace(/\s+/g, '')).filter((t) => t.length >= 2))]
  if (words.length === 0) return null
  // 긴 말을 먼저 맞춘다 (예: 'OLED'보다 'QD-OLED')
  words.sort((a, b) => b.length - a.length)
  return new RegExp(words.map((w) => [...w].map(escape).join('\\s*')).join('|'), 'gi')
}

// 띄어쓰기·대소문자를 무시하고 text에 terms 중 하나가 있는지 (목록 거르기에도 같은 기준을 쓴다)
export function matchesTerms(text, terms) {
  const re = highlightPattern(terms)
  return Boolean(re && re.test(String(text ?? '')))
}
