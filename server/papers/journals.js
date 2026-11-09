// 논문 수집 대상 (확인 2026-11-08, OpenAlex /sources · /topics에서 ID와 이름 직접 조회)
// ① 디스플레이 전문 학술지: 최근 7일 논문 전부
// ② 큰 종합 학술지: 디스플레이 주제(primary_topic)인 논문만
// OpenAlex가 막히면 Crossref(ISSN으로)·Semantic Scholar(학술지 이름으로)로 같은 요청을 한다 (index.js)
import { searchPapers, TTL } from './index.js'

export const DISPLAY_JOURNALS = [
  { openalex: 'S184312719', issn: '1071-0922', name: 'Journal of the Society for Information Display' },
  { openalex: 'S4210171700', issn: '0097-966X', name: 'SID Symposium Digest of Technical Papers' },
  { openalex: 'S2764415853', issn: '1598-0316', name: 'Journal of Information Display' },
  { openalex: 'S2498964232', issn: '2047-7538', name: 'Light: Science & Applications' },
  { openalex: 'S108229257', issn: '2195-1071', name: 'Advanced Optical Materials' },
  { openalex: 'S120392215', issn: '1749-4885', name: 'Nature Photonics' },
  { openalex: 'S4210239724', issn: '2520-1131', name: 'Nature Electronics' },
]

export const BIG_JOURNALS = [
  { openalex: 'S99352657', issn: '0935-9648', name: 'Advanced Materials' },
  { openalex: 'S135204980', issn: '1616-301X', name: 'Advanced Functional Materials' },
  { openalex: 'S135184319', issn: '2330-4022', name: 'ACS Photonics' },
  { openalex: 'S178776955', issn: '1094-4087', name: 'Optics Express' },
  { openalex: 'S19887683', issn: '0741-3106', name: 'IEEE Electron Device Letters' },
  { openalex: 'S162355128', issn: '0018-9383', name: 'IEEE Transactions on Electron Devices' },
  { openalex: 'S99846442', issn: '1566-1199', name: 'Organic Electronics' },
]

// OpenAlex 주제(topic) 이름은 실제 조회값. words는 Crossref·Semantic Scholar·arXiv로 넘어갔을 때 쓸 검색 낱말
export const DISPLAY_TOPICS = [
  { id: 'T10611', name: 'Organic Light-Emitting Diodes Research', words: ['OLED', 'organic light-emitting'] },
  { id: 'T10099', name: 'GaN-based semiconductor devices and materials', words: ['micro-LED', 'microLED'] },
  { id: 'T10321', name: 'Quantum Dots Synthesis And Properties', words: ['quantum dot light-emitting', 'QLED', 'QD-OLED'] },
  { id: 'T10623', name: 'Thin-Film Transistor Technologies', words: ['thin-film transistor', 'oxide TFT'] },
  { id: 'T10306', name: 'Liquid Crystal Research Advancements', words: ['liquid crystal display'] },
  // 이름은 「광학 영상 기술」이지만 홀로그램 · AR 근안 디스플레이 논문이 여기 들어간다 (OpenAlex에 AR/VR 디스플레이 전용 주제는 없음)
  { id: 'T11408', name: 'Advanced Optical Imaging Technologies', words: ['augmented reality display', 'near-eye display', 'holographic display'] },
]

// 경쟁사 기술 표시 (고객사는 WOLED, QD-OLED는 경쟁사 기술)
const QD_OLED = /\bQD[\s-]?OLED\b|quantum[\s-]dot[\s-]organic light/i
export const isCompetitorTech = (w) => QD_OLED.test(`${w.title} ${w.abstract}`)

// 주제 묶음이 넓어서(예: GaN 주제에 심자외선 LED, 광학 영상 주제에 3D 프린팅) OLED 주제가 아니면 디스플레이 낱말이 있어야 남긴다
// (11/08 실측: OLED 주제만 쓴 상위 12편은 모두 OLED, 6개 주제를 합치면 상위 8편 중 3편이 디스플레이와 무관)
const DISPLAY_WORDS = /\b(?:displays?|pixels?|micro[\s-]?LEDs?|mini[\s-]?LEDs?|[AQW]?OLEDs?|QLEDs?)\b|near[\s-]eye|augmented reality|virtual reality|AR glasses|backplane|thin[\s-]film transistor|\bTFTs?\b|liquid crystal|electroluminesc/i
export const isDisplayPaper = (w) => w.topic?.id === 'T10611' || DISPLAY_WORDS.test(`${w.title} ${w.abstract}`)

// 「Issue Information」 · 표지 같은 논문 아닌 항목
const NOT_PAPER = /^(issue information|cover (image|picture)|masthead|front matter|back cover|inside (front|back) cover|table of contents|editorial board|correction)/i

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10)

// 최근 days일 논문 (① + ②). 결과: { works: [...], providers: ['openalex', ...] }
// SID Digest는 OpenAlex에서 conference-paper라 그 종류도 받는다
export async function recentPapers(days = 7) {
  const from = ymd(Date.now() - days * 86_400_000)
  const to = ymd(Date.now())
  const a = await searchPapers({ sources: DISPLAY_JOURNALS, from, to, sort: 'date', limit: 100, types: ['article', 'conference-paper'] })
  const b = await searchPapers({ sources: BIG_JOURNALS, topics: DISPLAY_TOPICS, from, to, sort: 'date', limit: 100 })
  const seen = new Set()
  const works = []
  for (const w of [...a.works, ...b.works.filter(isDisplayPaper)]) {
    const id = w.doi || w.url
    if (!w.title || NOT_PAPER.test(w.title) || seen.has(id)) continue
    seen.add(id)
    works.push({ ...w, competitorTech: isCompetitorTech(w) })
  }
  return { works, providers: [...new Set([a.provider, b.provider])] }
}

// 「요즘 많이 인용되는 논문」 (일주일 캐시): 디스플레이 주제 + 최근 12개월, 인용 많은 순으로 받아
// 오래된 논문이 유리하지 않게 「인용 수 ÷ 나온 뒤 개월 수」로 다시 줄 세운다
export async function popularPapers(limit = 10) {
  const from = ymd(Date.now() - 365 * 86_400_000)
  const to = ymd(Date.now())
  const { works, provider } = await searchPapers({ topics: DISPLAY_TOPICS, from, to, sort: 'cited', limit: 50, types: ['article'] }, { ttlMs: TTL.popular })
  const months = (d) => Math.max(1, (Date.now() - Date.parse(d)) / (30.4 * 86_400_000))
  return {
    provider,
    works: works
      .filter((w) => w.title && w.date && !NOT_PAPER.test(w.title) && isDisplayPaper(w))
      .map((w) => ({ ...w, perMonth: Math.round((w.cited / months(w.date)) * 10) / 10, competitorTech: isCompetitorTech(w) }))
      .sort((x, y) => y.perMonth - x.perMonth)
      .slice(0, limit),
  }
}

// ── 키워드로 논문 찾기 (11/09 조장: 저장 키워드는 주기적으로 모으고, 검색하면 그 키워드로 논문 목록 + 초록) ──
// - OpenAlex search.title_and_abstract (관련도순), 한 번에 최대 100편 (검색 1회 $0.001)
// - 디스플레이 용어로 찾을 때만 디스플레이 주제로 좁힌다 (「microLED」만으로는 광유전학 · 생체 논문이 절반, 11/08 시험).
//   반도체 · AI 같은 다른 키워드는 좁히지 않는다 (예전에는 늘 좁혀서 0건이었음)
// - 초록이 빈 논문은 Semantic Scholar에서 DOI로 채운다
const DISPLAY_QUERY = /\b(?:displays?|pixels?|micro[\s-]?LEDs?|mini[\s-]?LEDs?|[AQW]?OLEDs?|QD[\s-]?OLEDs?|QLEDs?|OLEDoS|LCDs?|TFTs?|quantum[\s-]dots?|near[\s-]eye|holograph\w*|backplane|liquid crystal|electroluminesc\w*)\b/i
export const isDisplayQuery = (en) => DISPLAY_QUERY.test(en)

export async function keywordPapers(en, { from, to, limit = 100, sort = 'relevance' } = {}) {
  const display = isDisplayQuery(en)
  const { works, provider } = await searchPapers({
    query: en,
    from,
    to,
    sort,
    limit,
    types: ['article', 'review', 'conference-paper'],
    ...(display ? { topics: DISPLAY_TOPICS } : {}),
    fillAbstracts: true,
  })
  const seen = new Set()
  const out = []
  for (const w of works) {
    const id = w.doi || w.url
    if (!w.title || NOT_PAPER.test(w.title) || seen.has(id) || (display && !isDisplayPaper(w))) continue
    seen.add(id)
    out.push({ ...w, competitorTech: isCompetitorTech(w), displayJournal: DISPLAY_JOURNALS.some((j) => j.name === w.journal) })
  }
  return { works: out, provider, display }
}

// 논문 중요도 0~100 (30 문서 3장 제안을 단순하게, 가중치는 결정 3에서 바꿈)
// 검색 관련도 35 · 월평균 인용 25 · 분야 보정 인용(FWCI) 20 · 디스플레이 전문지 10 · 최근성 10
export function paperScore(w, rank, total) {
  const months = w.date ? Math.max(1, (Date.now() - Date.parse(w.date)) / (30.4 * 86_400_000)) : 12
  const perMonth = (w.cited ?? 0) / months
  const parts = {
    relevance: Math.round(35 * (1 - rank / Math.max(1, total))),
    citations: Math.round(25 * Math.min(1, perMonth / 3)),
    fwci: Math.round(20 * Math.min(1, (w.fwci ?? 0) / 3)),
    journal: w.displayJournal ? 10 : 0,
    recency: Math.round(10 * Math.max(0, 1 - months / 12)),
  }
  const score = Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0))
  return { score, parts: { ...parts, cited: w.cited ?? 0, fwciValue: w.fwci ?? null, perMonth: Math.round(perMonth * 10) / 10 } }
}
