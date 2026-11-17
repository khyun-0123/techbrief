// 자료 현황 「뉴스·논문에서 찾기」의 논문 쪽 (11/08 조장: 이제 네이버만 찾는 게 아님)
// 11/09 조장: 찾을 때마다 그 키워드로 논문 목록을 넉넉히 + 초록을 같이 보여 준다. 쓸 논문만 나중에 원문으로 분석
// - OpenAlex 관련도순 100편 (한 번에 받을 수 있는 최대, papers/journals.js keywordPapers). 같은 말은 6시간 캐시
// - 초록 전체를 함께 보낸다 (OpenAlex · 빈 것은 Semantic Scholar). 초록은 CC0 · 출처 표시 조건이라 화면에 보여도 된다 (23 문서)
// - 검색어가 한글이면 영문 검색어(queryTerms.js: 별칭표 → 저장된 표기 → AI가 1~3개)로 찾는다 (11/10). 여러 개면 OR로
// - 결과는 기사와 같은 모양 (출처 단계 1차 · 「논문」 표시). 중요도는 논문 점수(corpus.js paperScore2, 11/10)
// - 11/10: 먼저 우리 논문 DB(papers 표, 디스플레이 주제 2018년~)에서 찾는다 → API 비용 없음.
//   맞는 논문이 CORPUS_MIN편보다 적으면(디스플레이 밖 말 등) 지금처럼 OpenAlex 검색($0.001, 6시간 캐시)
// - 100편 중 25자리는 최근 1년 논문 몫 (인용이 쌓이기 전인 새 논문이 밀려나지 않게, 「신규성」)
import { createHash } from 'node:crypto'
import { englishTerms, openAlexQuery } from './queryTerms.js'
import { isCompetitorTech, keywordPapers } from './papers/journals.js'
import { corpusReady, paperScore2, searchCorpus } from './papers/corpus.js'
import { kciReady, searchKci } from './papers/kci.js'

const DAYS = { today: 90, week: 365, all: 365 * 3 } // 논문은 하루 · 일주일 안에 거의 없어 넓게
const LIMIT = 100
const RECENT_SLOTS = 25
const CORPUS_MIN = 15
const ABSTRACT_MAX = 2_000
const PAPER_HIGH = 60 // 논문 점수는 기사 점수와 따로라 「중요」 기준도 따로

const fromCorpus = (r) => ({
  title: r.title,
  doi: r.doi,
  url: r.doi ? `https://doi.org/${r.doi}` : `https://openalex.org/${r.id}`,
  abstract: r.abstract ?? '',
  journal: r.journal ?? '',
  date: r.published,
  cited: r.cited,
  fwci: r.fwci,
  pct: r.pct,
  top10: r.top10,
  source_id: r.source_id,
  is_core: r.is_core,
  companies: r.companies ?? [],
  keywords: r.keywords ?? [],
  oaUrl: r.oa_url,
  oaLicense: r.oa_license,
  competitorTech: isCompetitorTech({ title: r.title, abstract: r.abstract ?? '' }),
})

// 점수 순 상위 + 최근 1년 몫
function pick(scored) {
  const byScore = [...scored].sort((a, b) => b.score - a.score)
  const yearAgo = Date.now() - 365 * 86_400_000
  const recent = byScore.filter((x) => Date.parse(x.w.date) >= yearAgo).slice(0, RECENT_SLOTS)
  // 국내 논문(KCI, 11/17): 인용 백분위 같은 점수 재료가 없어 점수순으로는 늘 밀림 → 받은 것은 모두 자리를 남긴다 (최대 20편)
  const domestic = byScore.filter((x) => x.w.provider === 'kci')
  const chosen = new Set([...domestic, ...recent])
  for (const x of byScore) {
    if (chosen.size >= LIMIT) break
    chosen.add(x)
  }
  return byScore.filter((x) => chosen.has(x))
}

// terms: 이미 만든 영문 검색어 결과(englishTerms)를 넘기면 다시 만들지 않는다
export async function searchPaperArticles(query, period = 'all', terms = null) {
  const t = terms ?? (await englishTerms(query))
  if (!t.terms.length) {
    const note = t.pending ? '논문 검색어(영문)를 만드는 중이에요. 다 되면 논문이 이 목록에 더해져요' : '영문 검색어를 만들지 못해 논문은 찾지 않았어요 (영문으로 찾아 보세요)'
    return { articles: [], note, terms: [], pending: Boolean(t.pending) }
  }
  const en = openAlexQuery(t.terms)
  const days = DAYS[period] ?? DAYS.all
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  let works
  let provider
  const rows = !(await corpusReady()) ? [] : await searchCorpus(t.terms, { from, to }).catch((err) => {
    console.warn(`[papers] 논문 DB 찾기 실패: ${err.message}`)
    return []
  })
  if (rows.length >= CORPUS_MIN) {
    works = rows.map(fromCorpus)
    provider = 'corpus'
  } else {
    ;({ works, provider } = await keywordPapers(en, { from, to, limit: LIMIT }))
    works = works.filter((w) => !w.retracted)
  }
  // 국내 논문 (11/17, KCI · 39 문서 D1): 키가 있으면 한글 검색어로 20편까지 더한다 (DOI · 제목이 같으면 한 번)
  let kciCount = 0
  if (kciReady()) {
    const kci = await searchKci(query, { from, to, limit: 20 }).catch((err) => {
      console.warn(`[papers] KCI 찾기 실패: ${err.message}`)
      return []
    })
    const seen = new Set(works.flatMap((w) => [w.doi?.toLowerCase(), w.title?.toLowerCase()]).filter(Boolean))
    const fresh = kci.filter((w) => !seen.has(w.doi?.toLowerCase()) && !seen.has(w.title.toLowerCase()))
    kciCount = fresh.length
    works = [...works, ...fresh]
  }
  const scored = works.map((w, i) => ({ w, ...paperScore2(w, 1 - i / Math.max(1, works.length)) }))
  const articles = pick(scored).map(({ w, score, parts }) => {
    const url = w.url || (w.doi ? `https://doi.org/${w.doi}` : '')
    const published = w.date ? new Date(w.date) : new Date()
    return {
      id: `p-${createHash('sha1').update(url || w.title).digest('hex').slice(0, 12)}`,
      url,
      title: w.title,
      description: `${w.competitorTech ? '[경쟁사 기술 · QD-OLED] ' : ''}${(w.abstract ?? '').slice(0, 300)}`,
      abstract: (w.abstract ?? '').slice(0, ABSTRACT_MAX),
      ...(w.abstractFrom ? { abstractFrom: w.abstractFrom } : {}),
      ...(w.oaUrl ? { oaUrl: w.oaUrl } : {}),
      // 유료 여부 (11/14, 보고서팀 작업 이식): open · paid · unknown. 논문 DB · OpenAlex는 무료 원문 주소가 없으면 paid(OpenAlex가 열린 사본을 못 찾음)
      access: w.access ?? (w.oaUrl || w.provider === 'arxiv' ? 'open' : provider === 'corpus' || w.provider === 'openalex' ? 'paid' : 'unknown'),
      ...(w.authors?.length ? { authors: w.authors } : {}),
      ...(w.doi ? { doi: w.doi } : {}),
      source: w.journal || '논문',
      keyword: String(query).trim(),
      publishedAt: published.toISOString(),
      tier: 1,
      paper: true,
      cited: w.cited ?? 0,
      relevance: 'high',
      importance: score,
      importanceLevel: score >= PAPER_HIGH ? 'high' : 'normal',
      paperParts: parts,
      paperKeywords: (w.keywords ?? []).slice(0, 6).map((k) => k.name),
      sameIssue: 0,
    }
  })
  const noAbstract = articles.filter((a) => !a.abstract).length
  const notes = []
  const how = { llm: ' (AI 번역)', google: ' (Google 번역)', admin: '', alias: '' }
  if (t.source in how) notes.push(`논문은 「${t.terms.join(' · ')}」로 찾았어요${how[t.source]}`)
  if (provider === 'corpus') notes.push(`우리 논문 DB ${rows.length}편 중 중요도 순`)
  if (noAbstract) notes.push(`논문 ${noAbstract}편은 초록을 받지 못했어요 (출판사가 공개하지 않음)`)
  if (kciCount) notes.push(`국내 논문(KCI) ${kciCount}편 더함`)
  return { articles, provider, note: notes.join(' · ') || null, terms: t.terms }
}
