// 검색어 강조 (27 문서 6장). 자료 현황에서 찾거나 키워드로 거를 때 제목 · 발췌 · 요약에서 그 말을 강조한다
// - 대소문자와 띄어쓰기 차이(마이크로 LED / 마이크로LED)는 같은 말로 본다
// - 색만으로 알리지 않게 굵게도 한다 (연한 주황 바탕 #ffede0 + 검정 글자, 대비 약 18:1)
import { useMemo } from 'react'
import { highlightPattern } from './highlightTerms.js'

function Highlight({ text, terms }) {
  const re = useMemo(() => highlightPattern(terms), [terms])
  const value = String(text ?? '')
  if (!re || !value) return value
  const out = []
  let last = 0
  for (const m of value.matchAll(re)) {
    if (!m[0]) continue
    if (m.index > last) out.push(value.slice(last, m.index))
    out.push(
      <mark key={m.index} className="hl">
        {m[0]}
      </mark>,
    )
    last = m.index + m[0].length
  }
  if (out.length === 0) return value
  if (last < value.length) out.push(value.slice(last))
  return out
}

export default Highlight
