// 수집 키워드의 다른 표기 (영문 출처·띄어쓰기 차이). 출처 확대(14 문서 4-B)로 영문 기사가 들어오면서 필요해졌다
// - 키워드가 이 표에 있으면 그 표기 중 하나만 맞아도 같은 키워드로 본다 (RSS 거르기 · 관련도)
// - 없는 키워드는 지금처럼 키워드의 단어가 모두 들어 있어야 한다
const ALIASES = {
  마이크로led: ['마이크로led', '마이크로 led', 'microled', 'micro led', 'micro-led', 'μled', 'µled'],
  '마이크로 디스플레이': ['마이크로디스플레이', '마이크로 디스플레이', 'microdisplay', 'micro display', 'micro-display', 'oledos', 'oled on silicon', 'ledos', '올레도스', '레도스'],
  oled: ['oled', '올레드', '유기발광'],
  무기발광: ['무기발광', 'inorganic', 'qd-el', 'qdel', 'microled', '마이크로led'],
  'qd-oled': ['qd-oled', 'qdoled', 'qd oled'],
  qdel: ['qd-el', 'qdel', 'qd el', 'electroluminescent quantum dot'],
  oledos: ['oledos', 'oled on silicon', 'oled-on-silicon', '올레도스'],
  ledos: ['ledos', 'led on silicon', 'led-on-silicon', '레도스'],
  폴더블: ['폴더블', 'foldable'],
  롤러블: ['롤러블', 'rollable'],
  디스플레이: ['디스플레이', 'display'],
  반도체: ['반도체', 'semiconductor'],
}

const squash = (t) => String(t ?? '').toLowerCase().replace(/[\s·]+/g, '')

// 키워드 → 맞춰 볼 표기 목록 (공백을 뺀 소문자). 각 표기는 단어 배열: 모두 들어 있어야 맞음
export function matchersOf(keyword) {
  const key = String(keyword).trim().toLowerCase()
  const alias = ALIASES[key] ?? ALIASES[key.replace(/\s+/g, '')]
  if (alias) return alias.map((a) => [squash(a)])
  return [String(keyword).split(/\s+/).filter(Boolean).map(squash)]
}

// text에 키워드(또는 다른 표기)가 들어 있는지
export function hasKeyword(text, keyword) {
  const t = squash(text)
  return matchersOf(keyword).some((words) => words.every((w) => t.includes(w)))
}
