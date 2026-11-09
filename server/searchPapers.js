// 자료 현황 「뉴스·논문에서 찾기」의 논문 쪽 (11/08 조장: 이제 네이버만 찾는 게 아님)
// 11/09 조장: 찾을 때마다 그 키워드로 논문 목록을 넉넉히 + 초록을 같이 보여 준다. 쓸 논문만 나중에 원문으로 분석
// - OpenAlex 관련도순 100편 (한 번에 받을 수 있는 최대, papers/journals.js keywordPapers). 같은 말은 6시간 캐시
// - 초록 전체를 함께 보낸다 (OpenAlex · 빈 것은 Semantic Scholar). 초록은 CC0 · 출처 표시 조건이라 화면에 보여도 된다 (23 문서)
// - 검색어가 한글이면 영문 검색어(queryTerms.js: 별칭표 → 저장된 표기 → AI가 1~3개)로 찾는다 (11/10). 여러 개면 OR로
// - 결과는 기사와 같은 모양 (출처 단계 1차 · 「논문」 표시). 중요도는 논문 점수(paperScore)
import { createHash } from 'node:crypto'
import { englishTerms, openAlexQuery } from './queryTerms.js'
import { keywordPapers, paperScore } from './papers/journals.js'

const DAYS = { today: 90, week: 365, all: 365 * 3 } // 논문은 하루 · 일주일 안에 거의 없어 넓게
const LIMIT = 100
const ABSTRACT_MAX = 2_000
const PAPER_HIGH = 60 // 논문 점수(paperScore)는 기사 점수와 따로라 「중요」 기준도 따로

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
  const { works, provider } = await keywordPapers(en, { from, to, limit: LIMIT })
  const articles = works.map((w, i) => {
    const url = w.url || (w.doi ? `https://doi.org/${w.doi}` : '')
    const published = w.date ? new Date(w.date) : new Date()
    const { score, parts } = paperScore(w, i, works.length)
    return {
      id: `p-${createHash('sha1').update(url || w.title).digest('hex').slice(0, 12)}`,
      url,
      title: w.title,
      description: `${w.competitorTech ? '[경쟁사 기술 · QD-OLED] ' : ''}${(w.abstract ?? '').slice(0, 300)}`,
      abstract: (w.abstract ?? '').slice(0, ABSTRACT_MAX),
      ...(w.abstractFrom ? { abstractFrom: w.abstractFrom } : {}),
      ...(w.oaUrl ? { oaUrl: w.oaUrl } : {}),
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
      sameIssue: 0,
    }
  })
  const noAbstract = articles.filter((a) => !a.abstract).length
  const notes = []
  const how = { llm: ' (AI 번역)', google: ' (Google 번역)', admin: '', alias: '' }
  if (t.source in how) notes.push(`논문은 「${t.terms.join(' · ')}」로 찾았어요${how[t.source]}`)
  if (noAbstract) notes.push(`논문 ${noAbstract}편은 초록을 받지 못했어요 (출판사가 공개하지 않음)`)
  return { articles, provider, note: notes.join(' · ') || null, terms: t.terms }
}
