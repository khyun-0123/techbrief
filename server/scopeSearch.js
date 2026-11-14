// 범위 찾기 (11/10): 대시보드 「키워드 분석」에서 고른 범위(중심 키워드 + 고른 말)로 자료 현황 목록을 만든다 (32 문서)
// - 뉴스: 「중심」과 「중심 + 고른 말」을 각각 네이버에서 찾아 합친다 (고른 말 하나에 1번, 최대 6개)
// - 이미 모은 1·2차 출처 · 논문: 중심 키워드로 찾고(지금 찾기와 같음), 고른 말(영문 표기 포함)이 든 글에 표시
// - 글마다 scopeHits = 제목 · 요약 · 초록에 실제로 든 고른 말. 화면 범위 칩([QD-OLED 31] …)이 이 값으로 거른다
// - 11/14 조장: 넓게/좁게를 없애고 늘 「고른 말이 하나 이상 함께 나온 자료만」. 사용자의 의도 없이 넓게 담으면 가치가 떨어짐 —
//   자동 고르기(레버)로 좁게 시작하고, 더 넓게 보고 싶으면 맵에서 말을 더 고른다. 고른 말이 없으면 중심 키워드 자료 전부
//   중심 키워드는 늘 들어간다 (「게이밍 → 닌텐도 스위치」처럼 주제가 새지 않게)
import { searchArticles, searchCollected } from './collector/index.js'
import { searchPaperArticles } from './searchPapers.js'
import { englishTerms } from './queryTerms.js'

const MAX_TERMS = 30 // 거르기에 쓰는 고른 말 (11/14: 레버 끝 = 맵의 말 전부)
const MAX_SEARCH = 6 // 그중 네이버를 따로 부르고 영문 표기를 찾는 말 — 앞에서부터 (고른 말 하나에 네이버 1번)
const squash = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '')

export async function scopeSearch({ query, terms = [], period = 'all' } = {}) {
  const center = String(query ?? '').trim().slice(0, 50)
  if (!center) throw Object.assign(new Error('찾을 말을 입력해 주세요.'), { status: 400 })
  const picked = [...new Set(terms.map((t) => String(t).trim()).filter((t) => t && squash(t) !== squash(center)))].slice(0, MAX_TERMS)
  // 고른 말의 영문 표기 (논문 · 영문 출처에 표시하려고). 영문 말은 그대로, 한글은 저장된 표기 · Google 번역
  const [centerTerms, ...pickedTerms] = await Promise.all([englishTerms(center), ...picked.map((t, i) => (i < MAX_SEARCH ? englishTerms(t, { waitMs: 8_000 }) : { terms: [] }))])
  const variants = picked.map((t, i) => [t, ...(pickedTerms[i]?.terms ?? [])].map(squash))

  const [news, ...more] = await Promise.all([
    searchArticles(center, { period }),
    ...picked.slice(0, MAX_SEARCH).map((t) => searchArticles(`${center} ${t}`, { period }).catch(() => ({ articles: [] }))),
  ])
  const [collected, papers] = await Promise.all([
    searchCollected(center, centerTerms.terms, { period }).catch(() => ({ articles: [] })),
    searchPaperArticles(center, period, centerTerms).catch((err) => ({ articles: [], note: `논문을 찾지 못했어요 (${err.message})` })),
  ])

  const hitsOf = (a) => {
    const text = squash(`${a.fullTitle ?? a.title} ${a.description ?? ''} ${a.abstract ?? ''}`)
    return picked.filter((t, i) => variants[i].some((v) => v && text.includes(v)))
  }
  const seen = new Set()
  const all = []
  for (const a of [...news.articles, ...more.flatMap((r) => r.articles), ...collected.articles, ...papers.articles]) {
    if (!a.url || seen.has(a.url)) continue
    seen.add(a.url)
    const scopeHits = hitsOf(a)
    if (picked.length && !scopeHits.length) continue
    all.push({ ...a, scopeHits })
  }
  const counts = Object.fromEntries(picked.map((t) => [t, all.filter((a) => a.scopeHits.includes(t)).length]))
  const newsList = all.filter((a) => !a.paper && !a.collected)
  return {
    ...news,
    query: center,
    articles: all,
    newsCount: newsList.length,
    collectedCount: all.filter((a) => a.collected).length,
    paperCount: all.filter((a) => a.paper).length,
    paperNote: papers.note ?? null,
    paperTerms: papers.terms ?? [],
    paperPending: Boolean(papers.pending),
    paperProvider: papers.provider ?? null,
    truncated: news.truncated || more.some((r) => r.truncated),
    scope: { query: center, terms: picked, counts, termsEn: Object.fromEntries(picked.map((t, i) => [t, pickedTerms[i]?.terms ?? []])) },
    newsArticles: newsList, // 자동 요약 대기열에 넣을 뉴스
  }
}
