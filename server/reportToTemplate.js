// 앱 보고서 → 보고서팀 PPT 양식 JSON (11/17, 39 문서 E · templates/report-prompt.md 「[B] 자동 채우기용」)
// 보고서팀 양식: 4:3 가로 · 본문 1장 + 유첨 4장 (1 상세 분석 → 2 트렌드 그래프 → 3 출처 목록 → 4 원문 요약)
// 앱 보고서(server/llm/reportPrompts.js)는 칸 구성이 조금 달라 옮기면서 맞춘다. 못 채운 칸은 지어내지 않고 _notes에 적는다
// - 핵심 사실 = 「핵심 사실 근거」(summary)의 사실 줄, 기술 · 업계는 낱말로 가른다
// - 자사 판단 = 「시사점」의 [기회] · [위협] 줄, 할 일 = [할 일] 줄
// - 유첨 1 상세 분석 = 기술 개요(tech) · 업계 동향(industry) 줄, 근거 1건뿐인 사실은 따로
// - 유첨 2 그래프 = 보고서에 쓴 자료의 날짜별 수 (trend가 오면 그것) · 유첨 3 = 쓴 자료 목록 · 유첨 4 = 자료마다 요약 첫 항목

const NN = (n) => `#${String(n).padStart(2, '0')}`
const ymd = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}
const md = (iso) => {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
// 낱말 단위로 줄이기 (11/17: AI가 한 줄 요약을 60자 넘게 쓰는 일이 있어, 칸(50자)에 맞춰 마지막 낱말을 자르지 않고 줄임)
const cutWords = (t, n) => {
  const s = String(t ?? '').replace(/[.。]$/, '')
  if ([...s].length <= n) return s
  const head = s.slice(0, n - 1)
  const at = head.lastIndexOf(' ')
  return `${(at > n * 0.6 ? head.slice(0, at) : head).replace(/[,\s·]+$/, '')}…`
}
const cut = (t, n) => (String(t ?? '').length > n ? `${String(t).slice(0, n - 1)}…` : String(t ?? ''))
// 업계 동향 쪽 낱말 (회사 · 제품 · 투자 · 공급 · 양산 · 특허 · 시장)
const INDUSTRY = /삼성|LG|BOE|CSOT|애플|Apple|구글|메타|투자|공급|양산|수주|계약|출시|점유율|시장|매출|특허|라인|증설|협력|인수|가격|원가/

export function reportToTemplate(entry, { trends = null, dept = '' } = {}) {
  const r = entry?.report ?? {}
  const sec = (k) => r.sections?.[k]?.bullets ?? []
  const notes = []
  const refsOf = (b) => (b.refs ?? []).map(NN)

  // 본문: 핵심 사실 3~5개 (사실 줄 먼저). 양식 규칙은 근거 2건 이상이지만, 앱 보고서는 1건짜리도 있어 표시만 한다
  const factLines = sec('summary').filter((b) => b.kind === 'fact' || b.refs?.length)
  const facts = factLines.slice(0, 5).map((b) => ({ text: cut(b.text, 60), refs: refsOf(b), area: INDUSTRY.test(b.text) ? '업계' : '기술' }))
  if (facts.some((f) => f.refs.length < 2)) notes.push('핵심 사실 중 근거가 1건뿐인 줄이 있어요 (양식은 2건 이상). 확인 후 쓰세요')
  if (facts.length < 3) notes.push(`핵심 사실이 ${facts.length}개예요 (양식은 3~5개)`)

  const imp = sec('implications')
  const judge = imp.filter((b) => b.tag === '기회' || b.tag === '위협')
  const types = [...new Set(judge.map((b) => b.tag))]
  const judgment = judge.length
    ? { type: types.length > 1 ? '기회·위협 공존' : types[0], reason: cut(judge[0].text, 50) }
    : { type: '검토 필요', reason: '보고서에 기회 · 위협 판단 줄이 없음' }
  const actions = imp
    .filter((b) => b.tag === '할 일')
    .slice(0, 3)
    .map((b) => ({ what: cut(b.text.replace(/\s*필요함?$/, ' 필요'), 28), priority_or_due: '' }))
  if (!actions.length) notes.push('할 일 줄이 없어요')

  // 쓴 자료 (번호 = 보고서의 근거 번호 순서)
  const arts = (entry.articles ?? entry.inputs ?? []).map((a, i) => ({ ...a, no: NN(i + 1) }))
  const media = new Set(arts.map((a) => a.source).filter(Boolean))
  const period = r.sources?.period ? r.sources.period.replace(/-/g, '.').replace(/\s*~\s*/, '~') : ''
  const keywords = r.sources?.topics ?? []

  // 추이: 받은 trend가 없으면 보고서에 쓴 자료의 날짜별 수 (일별, 30일 넘으면 주별)
  let trend = trends
  if (!trend) {
    const days = new Map()
    for (const a of arts) {
      const t = Date.parse(a.publishedAt)
      if (!Number.isFinite(t)) continue
      const k = new Date(t).toISOString().slice(0, 10)
      days.set(k, (days.get(k) ?? 0) + 1)
    }
    const keys = [...days.keys()].sort()
    trend = { unit: '일', labels: keys.map(md), values: keys.map((k) => days.get(k)), source: '보고서에 쓴 자료의 날짜별 수', period }
    if (keys.length < 2) notes.push('추이 그래프: 날짜가 하나뿐이라 비교할 구간이 없어요')
  }

  // 유첨 1: 이슈 = 기술 개요 · 업계 동향 (배경 → 쟁점 → 전망)
  const issue = (name, list) => {
    const facts1 = list.filter((b) => b.kind === 'fact')
    const ai = list.filter((b) => b.kind !== 'fact')
    if (!list.length) return null
    // 같은 줄을 두 칸에 쓰지 않는다: 쟁점이 AI 줄을 썼으면 전망은 그다음 AI 줄
    const point = facts1[1]?.text ?? ai[0]?.text ?? ''
    const rest = facts1[1] ? ai : ai.slice(1)
    return {
      issue: name,
      background: facts1[0]?.text ?? list[0].text,
      point,
      outlook: rest.length ? `${rest[rest.length - 1].text} (추정)` : '',
      refs: [...new Set(list.flatMap(refsOf))],
    }
  }
  const analysis = [issue('기술 개요', sec('tech')), issue('업계 동향 · 경쟁사', sec('industry'))].filter(Boolean)
  const single = [...sec('tech'), ...sec('industry')].filter((b) => b.kind === 'fact' && b.refs?.length === 1).slice(0, 4).map((b) => ({ text: cut(b.text, 60), refs: refsOf(b) }))

  // 유첨 4: 자료마다 요약 첫 항목 (입력에 요약이 있을 때)
  const inputs = entry.inputs ?? []
  const summaries = arts.map((a, i) => {
    const s = inputs[i]?.summary
    const first = s?.items ? Object.values(s.items).find((x) => x?.text)?.text : null
    const basis = s?.basisSource === 'fulltext' ? '원문' : s?.basisSource === 'abstract' ? '초록' : '발췌문'
    return { no: a.no, title: cut(a.title, 34), summary: first ? cut(first, 55) : '요약 없음', basis }
  })

  return {
    title: cut(r.title, 25),
    date: ymd(entry.createdAt ?? Date.now()),
    dept,
    headline: cut(r.headline?.text ?? '', 60),
    facts,
    judgment,
    actions,
    trend,
    source: { period, article_count: r.sources?.articles ?? arts.length, media_count: media.size, keywords },
    one_line_summary: cutWords(r.oneLine ?? '', 50),
    appendix: {
      analysis,
      single_facts: single,
      charts: [],
      sources: arts.map((a) => ({ no: a.no, date: ymd(a.publishedAt), media: a.source ?? '', title: cut(a.title, 34), url: a.url ?? '' })),
      summaries,
    },
    _notes: [...notes, ...(r.oneLine ? [] : ['한 줄 요약 칸은 이 보고서에 없어 비워 둠 (11/17 전 보고서, 헤드라인과 다른 문장으로 채워 주세요)']), ...(dept ? [] : ['작성부서는 비워 둠'])],
  }
}
