// 자료 자동 선별 (11/15 조장: 「중요도를 기준으로 — 중요한 자료가 많으면 더 많이, 적으면 그래도 최소 기준은 맞게」)
// 규칙 (AI 안 씀, 화면에서 이유를 보여 준다):
// 1. 같은 이슈(묶음)는 가장 점수 높은 글 하나만. AI 입력을 허용하지 않은 자료는 뺀다
// 2. 「중요」(HIGH 45점 이상, server/collector/score.js)는 모두 넣는다 — 단 MAX건까지 (보고서를 한 번에 쓰는 한도, 서버 MAX_REPORT_ARTICLES)
// 3. 중요 자료가 MIN건보다 적으면 다음으로 점수 높은 자료로 MIN건까지 채운다
// 4. 고른 말마다 최소 1건: 고른 말이 든 글이 하나도 안 뽑혔으면 그 말이 든 가장 높은 글을 넣는다 (자리가 없으면 가장 낮은 「채움」 글과 바꿈)
export const AUTO_PICK = { min: 5, max: 10, high: 45 }

const PART_LABEL = { novelty: '신규성', business: '사업 연관', source: '출처', recency: '최신성', coverage: '보도량' }
const PART_MAX = { novelty: 30, business: 25, source: 20, recency: 15, coverage: 10 }

// 왜 골랐는지 한 줄: 점수 + 배점 대비 높은 항목 2개 (예: 「50점 · 사업 연관 25/25 · 신규성 10/30」)
export function reasonOf(a) {
  const parts = Object.entries(PART_LABEL)
    .map(([k, label]) => ({ label, v: a.scoreParts?.[k] ?? 0, max: PART_MAX[k] }))
    .filter((p) => p.v > 0)
    .sort((x, y) => y.v / y.max - x.v / x.max)
    .slice(0, 2)
    .map((p) => `${p.label} ${p.v}/${p.max}`)
  return [`${a.importance ?? 0}점`, ...(a.paper ? ['논문'] : a.collected ? ['1·2차 출처'] : []), ...parts].join(' · ')
}

export function pickMaterials(articles, terms = [], opt = AUTO_PICK) {
  const { min, max, high } = { ...AUTO_PICK, ...opt }
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
  const pool = [...best.values()].sort(byScore)
  const important = pool.filter((a) => (a.importance ?? 0) >= high)
  // 2 · 3. 중요는 모두(최대 max), 모자라면 min까지 채움
  const n = Math.min(max, Math.max(min, important.length), pool.length)
  const chosen = pool.slice(0, n).map((a) => ({ article: a, why: (a.importance ?? 0) >= high ? 'important' : 'fill' }))
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
  chosen.sort((x, y) => byScore(x.article, y.article))
  return { picked: chosen, important: important.length, pool: pool.length, rule: { min, max, high } }
}

// 기사 날짜로 기간 글자: 「11. 1. ~ 11. 8. 기사」 (ReportComposer와 같은 규칙)
export function periodLabelOf(articles) {
  const times = articles.map((a) => Date.parse(a.publishedAt ?? '')).filter(Number.isFinite)
  if (!times.length) return '기사 기준'
  const f = (t) => new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
  const [lo, hi] = [f(Math.min(...times)), f(Math.max(...times))]
  return lo === hi ? `${lo} 기사` : `${lo} ~ ${hi} 기사`
}
