// 자료 현황 「핵심어」 해시태그 (11/09 조장: 수집 키워드 대신 기사 핵심어를 여러 개)
// 1) 사전 맞추기(규칙, AI 안 씀): 제목 · 설명에 들어 있는 우리 용어
//    — 자동 수집 키워드 · 추천 검색어 · 자사 · 경쟁사 · 관심 기술 · 요즘 뜨는 기술 용어
//    네이버 기사는 약관상 AI에 넣지 않으므로(23 문서) 사전 맞추기가 기본이다
// 2) 이미 요약된 기사면 요약의 핵심 키워드(AI, 언론사 원문 기준)로 빈자리를 채운다
// 긴 용어를 먼저 고르고, 이미 고른 용어 안에 들어 있는 짧은 용어(예: QD-OLED 안의 OLED)는 뺀다

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s\-·_]/g, '')

const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 영문 · 숫자로만 된 용어(OCA, LED 등)는 다른 영어 단어 속에 들어 있어도 걸리지 않게 앞뒤가 영문 · 숫자가 아닐 때만 인정 (11/09: 「OCA」 오검출)
function asciiPattern(key) {
  if (!/^[a-z0-9]+$/.test(key)) return null
  return new RegExp(`(^|[^a-z0-9])${[...key].map(esc).join('[\\s\\-·_]?')}($|[^a-z0-9])`)
}

// 사전: [{ term, key, re }] 긴 것부터
export function buildTagDict(groups) {
  const seen = new Map()
  for (const list of groups) {
    for (const raw of list ?? []) {
      const term = String(raw ?? '').trim()
      const key = norm(term)
      if (key.length < 2 || seen.has(key)) continue
      seen.set(key, { term, key, re: asciiPattern(key) })
    }
  }
  return [...seen.values()].sort((a, b) => b.key.length - a.key.length)
}

// 기사 하나의 핵심어 (전부). 화면은 앞 몇 개만 보여 준다
export function tagsOf(article, summary, dict) {
  const raw = `${article.title ?? ''} ${article.description ?? ''} ${summary?.headline ?? ''}`.toLowerCase()
  const text = norm(raw)
  const picked = []
  const take = (term) => {
    const key = norm(term)
    if (key.length < 2 || picked.some((p) => p.key.includes(key) || key.includes(p.key))) return
    picked.push({ term: String(term).trim(), key })
  }
  for (const d of dict) if (d.re ? d.re.test(raw) : text.includes(d.key)) take(d.term)
  for (const k of summary?.keywords ?? []) take(k)
  // 아무것도 없으면 모아 온 키워드 (키워드에 안 맞아 모은 「1·2차 출처」 글은 빼고)
  if (picked.length === 0 && article.keyword && article.keyword !== '1·2차 출처') take(article.keyword)
  return picked.map((p) => p.term)
}
