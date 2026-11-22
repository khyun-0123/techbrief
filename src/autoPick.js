// 자료 자동 선별 (11/15 조장: 「중요도를 기준으로 — 중요한 자료가 많으면 더 많이, 적으면 그래도 최소 기준은 맞게」)
// 규칙 (AI 안 씀, 화면에서 이유를 보여 준다):
// 1. 같은 이슈(묶음)는 가장 점수 높은 글 하나만. AI 입력을 허용하지 않은 자료는 뺀다
// 2. 「중요」(HIGH 45점 이상, server/collector/score.js)는 모두 넣는다 — 단 MAX건까지 (보고서를 한 번에 쓰는 한도, 서버 MAX_REPORT_ARTICLES)
// 3. 중요 자료가 MIN건보다 적으면 다음으로 점수 높은 자료로 MIN건까지 채운다
// 4. 고른 말마다 최소 1건: 고른 말이 든 글이 하나도 안 뽑혔으면 그 말이 든 가장 높은 글을 넣는다 (자리가 없으면 가장 낮은 「채움」 글과 바꿈)
export const AUTO_PICK = { min: 5, max: 10 }
// 서버가 기준을 안 보냈을 때만 쓰는 값 (11/17: 예전엔 opt 기본값에 high: 45가 있어 관리 페이지 기준을 바꿔도 늘 45였음, 36 문서 1장)
const FALLBACK_HIGH = 45

const PART_LABEL = { novelty: '신규성', business: '사업 연관', source: '출처', recency: '최신성', coverage: '보도량' }
const PART_MAX = { novelty: 30, business: 25, source: 20, recency: 15, coverage: 10 } // 서버가 배점(scoreParts.max)을 안 보냈을 때만

// 왜 골랐는지 한 줄: 점수 + 배점 대비 높은 항목 2개 (예: 「50점 · 사업 연관 25/25 · 신규성 10/30」)
export function reasonOf(a) {
  const parts = Object.entries(PART_LABEL)
    .map(([k, label]) => ({ label, v: a.scoreParts?.[k] ?? 0, max: a.scoreParts?.max?.[k] ?? PART_MAX[k] }))
    .filter((p) => p.v > 0)
    .sort((x, y) => y.v / y.max - x.v / x.max)
    .slice(0, 2)
    .map((p) => `${p.label} ${p.v}/${p.max}`)
  return [`${a.importance ?? 0}점`, ...(a.patent ? ['특허'] : a.paper ? ['논문'] : a.collected ? ['1·2차 출처'] : []), ...parts].join(' · ')
}

// 섞인 목록 줄 세우기 (11/17, 37 문서 P7 · 36 문서 1장 「섞인 목록」): 기사(45점 기준)와 논문(60점 기준) 점수를 한 숫자로 비교하지 않는다
// 「중요」 표시가 붙은 것 먼저, 같은 묶음 안에서는 점수를 각자 「중요」 기준에 맞춰 견줌(논문 60점 = 기사 45점 → 논문 점수 × 0.75)
// 자동 선별(pickMaterials)과 같은 순서. 찾기 결과 「중요도순」 · 보고서 상위 10건이 쓴다
const PAPER_RATIO = 45 / 60
export const isHighOf = (a, high = FALLBACK_HIGH) => (a.importanceLevel ? a.importanceLevel === 'high' : (a.importance ?? 0) >= high)
export const rankOf = (a) => (a.paperParts ? (a.importance ?? 0) * PAPER_RATIO : (a.importance ?? 0))
export const byRank = (a, b) => Number(isHighOf(b)) - Number(isHighOf(a)) || rankOf(b) - rankOf(a)

export function pickMaterials(articles, terms = [], opt = AUTO_PICK) {
  // 「중요」 기준은 서버(관리 페이지 「중요도 기준」, 11/15)가 정한 importanceLevel을 따름. 없으면 점수로
  const high = opt.high ?? articles?.find((a) => a.scoreParts?.high != null)?.scoreParts.high ?? FALLBACK_HIGH
  const { min, max } = { ...AUTO_PICK, ...opt }
  const isHigh = (a) => (a.importanceLevel ? a.importanceLevel === 'high' : (a.importance ?? 0) >= high)
  const time = (a) => Date.parse(a.publishedAt ?? '') || 0
  const byScore = (a, b) => (b.importance ?? 0) - (a.importance ?? 0) || time(b) - time(a)
  // 1. 이슈마다 하나
  const best = new Map()
  for (const a of articles ?? []) {
    if (!a?.url || a.aiAllowed === false) continue
    const k = a.groupId ?? a.url
    const cur = best.get(k)
    if (!cur || byScore(a, cur) < 0) best.set(k, a)
  }
  // 「중요」 표시가 붙은 자료 먼저, 그다음 점수 순 (논문은 「중요」 기준이 60점으로 달라 점수만으로 줄 세우면 50점대 논문이 「중요」 뉴스를 앞섬)
  const pool = [...best.values()].sort((a, b) => Number(isHigh(b)) - Number(isHigh(a)) || rankOf(b) - rankOf(a) || time(b) - time(a))
  const important = pool.filter(isHigh)
  // 2 · 3. 중요는 모두(최대 max), 모자라면 min까지 채움
  const n = Math.min(max, Math.max(min, important.length), pool.length)
  const chosen = pool.slice(0, n).map((a) => ({ article: a, why: isHigh(a) ? 'important' : 'fill' }))
  // 4. 고른 말마다 최소 1건
  for (const t of terms) {
    if (chosen.some((c) => c.article.scopeHits?.includes(t))) continue
    const cand = pool.find((a) => a.scopeHits?.includes(t) && !chosen.some((c) => c.article === a))
    if (!cand) continue
    if (chosen.length < max) chosen.push({ article: cand, why: 'term', term: t })
    else {
      // 자리가 없으면 가장 낮은 「채움」 글과 바꾼다 (그 글이 다른 고른 말의 유일한 글이면 건드리지 않음)
      const only = (c) => (c.article.scopeHits ?? []).some((h) => terms.includes(h) && chosen.filter((x) => x.article.scopeHits?.includes(h)).length === 1)
      const idx = chosen.map((c, i) => [c, i]).reverse().find(([c]) => c.why === 'fill' && !only(c))?.[1]
      if (idx != null) chosen[idx] = { article: cand, why: 'term', term: t }
    }
  }
  chosen.sort((x, y) => Number(isHigh(y.article)) - Number(isHigh(x.article)) || rankOf(y.article) - rankOf(x.article) || time(y.article) - time(x.article))
  return { picked: chosen, important: important.length, pool: pool.length, rule: { min, max, high } }
}

// 기사 날짜로 기간 글자: 「11. 1. ~ 11. 8. 기사」 (ReportComposer와 같은 규칙)
export function periodLabelOf(articles) {
  const times = articles.map((a) => Date.parse(a.publishedAt ?? '')).filter(Number.isFinite)
  if (!times.length) return '자료 기준'
  const f = (t) => new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
  const [lo, hi] = [f(Math.min(...times)), f(Math.max(...times))]
  return lo === hi ? `${lo} 자료` : `${lo} ~ ${hi} 자료`
}
