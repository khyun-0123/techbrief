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
// 칸 폭으로 맞추기 (11/25 팀 검수: 헤드라인을 60자에서 잘라 두 줄 칸인데도 「…」가 붙었음)
// 글자 폭은 src/reportSlides.js units와 같은 어림 — 한글 1em, 영문 · 숫자 0.55em(글꼴이 없는 PC 기준), 굵은 글씨라 폭의 95%만 씀
const unitsOf = (text) => [...String(text)].reduce((u, ch) => u + (/[ㄱ-힝一-鿿]/.test(ch) ? 1 : ch === ' ' ? 0.3 : /[A-Za-z0-9]/.test(ch) ? 0.55 : 0.45), 0)
const fitBox = (t, pt, widthIn, lines) => {
  const s = String(t ?? '').replace(/[.。]$/, '')
  const cap = ((widthIn * 0.95) / (pt / 72)) * lines
  if (unitsOf(s) <= cap) return s
  let n = [...s].length
  while (n > 10 && unitsOf(cutWords(s, n)) > cap) n--
  return cutWords(s, n)
}
// 업계 동향 쪽 낱말 (회사 · 제품 · 투자 · 공급 · 양산 · 특허 · 시장)
const INDUSTRY = /삼성|LG|BOE|CSOT|애플|Apple|구글|메타|투자|공급|양산|수주|계약|출시|점유율|시장|매출|특허|라인|증설|협력|인수|가격|원가/

const norm = (t) => String(t ?? '').toLowerCase().replace(/\s+/g, '')
const isAnalysis = (a) => /^\[분석\]/.test(a.title ?? '')
const DAY = 86_400_000
const dayKey = (t) => new Date(t).toISOString().slice(0, 10)

// 유첨 2 왼쪽 · 본문 변화율 (11/17): 앱 미리보기(src/reportSlides.js)와 같은 기준 — 이 보고서와 맞는 수집 키워드의 날짜별 기사 수(/api/trends)
// 근거 자료 날짜별 수는 하루 1~2건이라 변화율이 뜻이 없고, 논문 날짜(몇 해 전)가 섞이면 기간이 몇 해로 늘어남 → 맞는 키워드가 없을 때만 기사(논문 · [분석] 뺌)로
// 11/17 검수: 수집 키워드를 제목에 든 말로 맞추면 「디스플레이」가 「마이크로디스플레이」 안에서 맞아 디스플레이 기사 전체가 그려짐
// → 보고서 주제어(topicItems: 모은 기사 중 주제어가 든 기사의 날짜별 수, topicTrendItems)를 먼저 쓰고, 없을 때만 주제어와 같은 수집 키워드 · 근거 기사 날짜
function keywordTrend(entry, arts, trendItems, period, topicItems) {
  const r = entry.report ?? {}
  const topicTotal = (topicItems ?? []).reduce((n, it) => n + it.news.reduce((m, p) => m + p.v, 0), 0)
  // 수집 키워드는 주제어와 같거나 주제어를 품은 것만 (「디스플레이」 ⊂ 「마이크로디스플레이」 같은 넓은 말은 안 씀)
  const topics = [...(r.sources?.topics ?? []), ...(r.analysis ?? []).map((a) => a.keyword)].map(norm).filter(Boolean)
  const same = (trendItems ?? []).filter((it) => it.keyword && (it.news ?? []).length && topics.some((t) => norm(it.keyword).includes(t)))
  const matched = topicTotal > 0 ? topicItems : same
  const news = arts.filter((a) => !a.paper && !isAnalysis(a) && Number.isFinite(Date.parse(a.publishedAt)))
  const daily = new Map()
  let from = ''
  if (matched.length) {
    // 끝난 날까지 (11/17 렌더 확인: 보고서를 만든 날은 반나절이라 「전일 대비 -88.6%」처럼 보였음)
    const end = Date.parse(`${dayKey(entry.createdAt ?? Date.now())}T00:00:00Z`) - DAY
    const first = news.length ? Math.min(...news.map((a) => Date.parse(a.publishedAt))) : end - 7 * DAY
    const start = Math.max(Date.parse(`${dayKey(first)}T00:00:00Z`) - 3 * DAY, end - 181 * DAY)
    for (let t = start; t <= end; t += DAY) daily.set(dayKey(t), 0)
    for (const it of matched) for (const pt of it.news) if (daily.has(pt.t)) daily.set(pt.t, daily.get(pt.t) + pt.v)
    from = topicTotal > 0 ? `「${matched.map((it) => it.keyword).join(', ')}」 든 모은 기사 수` : `수집 키워드 「${matched.map((it) => it.keyword).join(', ')}」 기사 수`
  } else {
    for (const a of news) daily.set(dayKey(a.publishedAt), (daily.get(dayKey(a.publishedAt)) ?? 0) + 1)
    from = '근거 기사 발행일별 수 (맞는 수집 키워드 없음)'
  }
  const keys = [...daily.keys()].sort()
  const weekly = keys.length > 30
  const labels = []
  const values = []
  const step = weekly ? 7 : 1
  for (let i = 0; i < keys.length; i += step) {
    labels.push(md(`${keys[i]}T00:00:00`))
    values.push(keys.slice(i, i + step).reduce((n, k) => n + daily.get(k), 0))
  }
  const ymdKey = (k) => (k ? k.replace(/-/g, '.') : '')
  return { unit: weekly ? '주' : '일', labels, values, source: `${from}${weekly ? ' · 주별' : ' · 일별'}`, period: keys.length ? `${ymdKey(keys[0])}~${ymdKey(keys.at(-1))}` : period, matched: matched.length > 0 }
}

// 유첨 2 오른쪽 키워드 빈도 (11/17): 양식 규칙 — 근거 자료 AI 요약 핵심어, 자료 1건에 같은 말은 1번, 많은 순 최대 8개
function keywordChart(inputs, period) {
  const count = new Map()
  const label = new Map()
  for (const inp of inputs) {
    const seen = new Set()
    for (const k of inp?.summary?.keywords ?? []) {
      const n = norm(k)
      if (!n || seen.has(n)) continue
      seen.add(n)
      count.set(n, (count.get(n) ?? 0) + 1)
      if (!label.has(n)) label.set(n, String(k).trim())
    }
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  if (top.length < 2) return null
  return { type: '가로막대', title: '키워드 빈도', x_axis: '키워드', y_axis: '언급 기사 수 (건)', unit: '건', period, source: `근거 자료 ${inputs.length}건의 AI 요약 핵심어`, labels: top.map(([n]) => label.get(n)), values: top.map(([, v]) => v) }
}

// 유첨 1 이슈 하나 더 (11/17): 기술 시계열 · 특허 분석 묶음(규칙 계산 숫자) — 양식에 따로 칸이 없어 상세 분석의 이슈로 넣는다
function analysisIssue(an, arts) {
  if (!an || !(an.stage?.stage || an.competitors?.verdict || an.quotes?.length)) return null
  const refs = arts.filter((a) => isAnalysis(a) && norm(a.title).includes(norm(an.keyword).slice(0, 6))).map((a) => a.no)
  const cv = an.competitors
  const own = cv?.companies?.find((c) => c.own)
  const fastest = cv?.companies?.filter((c) => !c.unsure && !c.own && c.ratio != null).sort((a, b) => b.ratio - a.ratio)[0]
  const point = cv?.verdict
    ? `${cv.name} 특허 증가 ${cv.years}: 자사 ${own?.ratio ?? '-'}배 · ${fastest ? `${fastest.name} ${fastest.ratio}배` : '경쟁사 -'} · 분야 ${cv.field?.ratio ?? '-'}배 → 자사에 ${cv.verdict}`
    : an.owners?.length
      ? `특허 출원인 상위: ${an.owners.slice(0, 3).map((o) => `${o.word} ${o.count ?? ''}건`.trim()).join(' · ')}`
      : ''
  const q = (an.quotes ?? []).find((x) => x.year) ?? an.quotes?.[0]
  return {
    issue: cut(`${an.keyword} 기술 단계 · 특허 (규칙 계산)`, 40),
    background: an.stage?.stage ? `[${an.stage.stage}]${an.stage.thin ? ' 논문 적어 참고용' : ''} ${an.stage.why ?? ''}`.trim() : '기술 단계 판정 없음',
    point,
    outlook: q ? `상용화 시점 언급${q.year ? ` ${q.year}년` : ''}: 「${cut(q.text, 50)}」 — ${q.source ?? '기사'}` : '',
    refs,
  }
}

// 유첨 5 기술 시계열 (11/17, 40 문서 R5): 분석 묶음 → 판정 글 · 논문 · 특허 연도별 그래프
function timelineSlide(an, createdAt) {
  if (!an || !(an.stage?.stage || an.papers?.years?.length || an.patentYears?.length)) return null
  const last = new Date(createdAt ?? Date.now()).getFullYear() - 1 // 끝난 해까지
  const series = (list) => {
    // 논문은 편수가 0인 해가 빠져 옴 → 빈 해를 0으로 채운다 (11/17 렌더 확인: 2024년이 없었음)
    const have = new Map((list ?? []).filter((p) => p.y <= last).map((p) => [p.y, p.n]))
    const ys = [...have.keys()]
    const done = ys.length ? Array.from({ length: last - Math.min(...ys) + 1 }, (_, i) => Math.min(...ys) + i).map((y) => ({ y, n: have.get(y) ?? 0 })).slice(-12) : []
    return done.length >= 2 ? { labels: done.map((p) => String(p.y)), values: done.map((p) => p.n) } : null
  }
  const lines = []
  const pp = an.papers
  // 작은 수 보정 (11/15 팀 회의 「1건 → 5건을 500%로 강조하면 안 됨」): 최근 3년 10편 미만이면 배수를 쓰지 않음
  if (pp?.recent != null) lines.push({ head: '논문 추이', text: `${String(pp.span ?? '').split(' 대 ')[0] || '최근 3년'} ${pp.recent}편${pp.recent >= 10 && pp.growth != null ? ` · 앞 3년의 ${pp.growth}배${pp.relGrowth != null ? ` (분야 전체보다 ${pp.relGrowth}배)` : ''}` : ` (앞 3년 ${pp.before ?? '-'}편 — 편수가 적어 배수는 쓰지 않음)`}` })
  const up = (an.rising ?? []).filter((x) => x.recent >= 2)
  if (up.length) lines.push({ head: '최근 논문에서 늘어난 세부 주제', text: up.slice(0, 4).map((x) => `${x.name} ${x.before}→${x.recent}편`).join(' · ') + (an.makers?.length ? ` | 주요 기업: ${an.makers.slice(0, 4).join(', ')}` : '') })
  const br = an.breadth
  if (br?.institutions) lines.push({ head: `연구 폭 (${br.years})`, text: `논문 낸 기관 ${br.institutions}곳${br.companyShare != null ? ` · 기업 저자 ${Math.round(br.companyShare * 100)}%` : ''}${br.fwci != null ? ` · FWCI ${br.fwci}(참고)` : ''}` })
  const cv = an.competitors
  if (cv?.verdict || cv?.field) {
    const own = cv.companies?.find((c) => c.own)
    const others = (cv.companies ?? []).filter((c) => !c.own && !c.unsure && c.ratio != null).map((c) => `${c.name} ${c.ratio}배`)
    lines.push({ head: `세부 기술 특허 「${cv.name}」 (${cv.years})`, text: `자사 ${own?.ratio ?? '-'}배 · ${others.join(' · ') || '경쟁사 -'} · 분야 ${cv.field?.ratio ?? '-'}배${cv.verdict ? ` → 자사에 ${cv.verdict}` : ''}` })
  }
  if (an.attention?.label) lines.push({ head: '관심 대 실질', text: `${an.attention.label} (${an.attention.basis})` })
  if (an.surges?.length) lines.push({ head: '예상 밖 급증 (TimesFM 1달 앞 예상 범위를 넘은 달)', text: an.surges.map((x) => `${x.t} 예상 최대 ${x.hi} → ${x.v}`).join(' · ') })
  if (an.signal?.score != null) lines.push({ head: '요즘 뜨는 기술 신호', text: `${an.signal.score}점 · ${an.signal.grade}${an.signal.stage ? ` · ${an.signal.stage}` : ''} (50 = 평소, 75 = 2배)` })
  const q = (an.quotes ?? []).find((x) => x.year) ?? an.quotes?.[0]
  if (q) lines.push({ head: '상용화 시점 언급', text: `${q.year ? `${q.year}년 — ` : ''}「${cut(q.text, 70)}」 (${q.source ?? '기사'})` })
  return {
    keyword: an.keyword,
    stage: an.stage?.stage ?? null,
    why: an.stage?.why ? `${an.stage.thin ? '(논문 적어 참고용) ' : ''}${an.stage.why}` : '',
    lines,
    papers: series(an.papers?.years),
    patents: series(an.patentYears),
    source: `${an.papers?.basis === 'openalex' ? 'OpenAlex 논문 수(단계 판정과 같은 값)' : '테크브리프 논문 DB'} · 디스플레이 특허 DB${an.attention || an.surges?.length ? ' · 네이버 검색 관심도' : ''}`,
    as_of: `${last}년까지${an.at ? ` · 분석 ${ymd(an.at)}` : ''}`,
    note: '숫자는 규칙으로 센 값 (AI가 만든 숫자 아님) · 판단 기준은 33 문서',
  }
}

// 할 일 「무엇을 — 시점」: 앱 보고서는 시점을 「— 단기」처럼 글 끝에 붙여 씀 → 양식의 priority_or_due 칸으로 가른다
function splitAction(text) {
  // 「… — 단기」 또는 「… (즉시)」 (11/17 새 보고서: 괄호로 씀)
  const m = String(text ?? '').match(/^(.*?)\s*[—–-]\s*([^—–-]{1,14})$/) ?? String(text ?? '').match(/^(.*?)\s*\(([^()]{1,14})\)$/)
  const what = (m ? m[1] : text).replace(/\s*필요함?$/, ' 필요')
  return { what: cut(what, 28), priority_or_due: m ? m[2].trim() : '' }
}

// 보고서 주제어가 든 모은 기사의 날짜별 수 (최근 28일, 한국 날짜). query = server/db의 query (이 파일은 DB를 직접 부르지 않음)
export async function topicTrendItems(entry, query) {
  const r = entry?.report ?? {}
  const byNorm = new Map()
  for (const t of [...(r.sources?.topics ?? []), ...(r.analysis ?? []).map((a) => a.keyword)]) if (norm(t) && !byNorm.has(norm(t))) byNorm.set(norm(t), String(t).trim())
  const terms = [...byNorm.values()].slice(0, 3)
  if (!terms.length) return []
  // 한국 날짜로 보고서를 만든 날 0시까지 (그날은 반나절이라 뺀다), 그 앞 28일
  const created = new Date(entry.createdAt ?? Date.now())
  const end = new Date(`${new Date(created.getTime() + 9 * 3600_000).toISOString().slice(0, 10)}T00:00:00+09:00`)
  const start = new Date(end.getTime() - 28 * DAY)
  const out = []
  for (const term of terms) {
    const { rows } = await query(
      `SELECT to_char(published_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS t, count(*)::int AS v
         FROM articles
        WHERE published_at >= $2 AND published_at < $3
          AND lower(regexp_replace(title || ' ' || coalesce(description, ''), '\\s+', '', 'g')) LIKE $1
        GROUP BY 1`,
      [`%${norm(term).replace(/[%_]/g, '')}%`, start, end],
    )
    out.push({ keyword: term, news: rows })
  }
  return out
}

export function reportToTemplate(entry, { trends = null, trendItems = null, topicItems = null, dept = '' } = {}) {
  const r = entry?.report ?? {}
  const sec = (k) => r.sections?.[k]?.bullets ?? []
  const notes = []
  const refsOf = (b) => (b.refs ?? []).map(NN)

  // 본문: 핵심 사실 3~5개 (사실 줄 먼저). 양식 규칙은 근거 2건 이상이지만, 앱 보고서는 1건짜리도 있어 표시만 한다
  // 양식 규칙 (11/17, 40 문서 R7): 본문에는 근거 2건 이상인 사실을 먼저(근거 많은 순), 3개가 안 되면 1건짜리로 채우고, 남은 1건짜리는 유첨 1 「근거 1건뿐인 사실」로
  const factLines = sec('summary').filter((b) => b.kind === 'fact' || b.refs?.length)
  const strong = factLines.filter((b) => (b.refs?.length ?? 0) >= 2).sort((a, b) => b.refs.length - a.refs.length)
  const weak = factLines.filter((b) => (b.refs?.length ?? 0) < 2)
  const bodyLines = [...strong.slice(0, 5), ...weak.slice(0, Math.max(0, 3 - strong.length))]
  const movedOut = weak.filter((b) => !bodyLines.includes(b))
  const facts = bodyLines.map((b) => ({ text: cut(b.text, 60), refs: refsOf(b), area: INDUSTRY.test(b.text) ? '업계' : '기술' }))
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
    .map((b) => splitAction(b.text))
  if (!actions.length) notes.push('할 일 줄이 없어요')
  else if (actions.length < 2) notes.push('할 일이 1개예요 (양식은 2~3개)')
  if (actions.some((a) => !a.priority_or_due)) notes.push('할 일 중 시점 · 우선순위가 없는 줄이 있어요')

  // 쓴 자료 (번호 = 보고서의 근거 번호 순서)
  const arts = (entry.articles ?? entry.inputs ?? []).map((a, i) => ({ ...a, no: NN(i + 1) }))
  const media = new Set(arts.filter((a) => !isAnalysis(a)).map((a) => a.source).filter(Boolean)) // [분석] 줄(우리 규칙 계산)은 매체가 아님
  // 수집 기간 = 기사 날짜만, 논문은 연도 범위를 따로 (11/17, 40 문서 R8 — 예전 보고서도 자료에서 다시 셈)
  const newsT = arts.filter((a) => !a.paper && !isAnalysis(a)).map((a) => Date.parse(a.publishedAt)).filter(Number.isFinite)
  const papY = arts.filter((a) => a.paper).map((a) => new Date(a.publishedAt).getFullYear()).filter(Number.isFinite)
  const papPart = papY.length ? `${arts.some((a) => a.patent) ? (arts.some((a) => a.paper && !a.patent) ? '논문 · 특허' : '특허') : '논문'} ${Math.min(...papY)}${Math.max(...papY) !== Math.min(...papY) ? `~${Math.max(...papY)}` : ''}년` : ''
  const newsPart = newsT.length ? `${ymd(Math.min(...newsT))}~${ymd(Math.max(...newsT))}` : ''
  const period = [newsPart, papPart].filter(Boolean).join(' · ') || (r.sources?.period ? r.sources.period.replace(/-/g, '.').replace(/\s*~\s*/, '~') : '')
  const keywords = r.sources?.topics ?? []

  // 추이: 받은 trend가 없으면 이 보고서와 맞는 수집 키워드의 날짜별 기사 수 (없으면 근거 기사 날짜별 수)
  let trend = trends
  if (!trend) {
    const { matched, ...t } = keywordTrend(entry, arts, trendItems, period, topicItems)
    trend = t
    if (!matched) notes.push('추이 그래프: 맞는 수집 키워드가 없어 근거 기사 날짜별 수로 그림')
    if (t.labels.length < 2) notes.push('추이 그래프: 구간이 하나뿐이라 비교할 구간이 없어요')
  }

  // 유첨 1: 이슈 = 기술 개요 · 업계 동향 (배경 → 쟁점 → 전망)
  const issue = (name, list) => {
    const facts1 = list.filter((b) => b.kind === 'fact')
    const ai = list.filter((b) => b.kind !== 'fact')
    if (!list.length) return null
    // 같은 줄을 두 칸에 쓰지 않는다 (11/25 팀 검수: 사실 줄이 하나도 없으면 배경과 쟁점에 같은 AI 줄이 들어갔음)
    const background = facts1[0]?.text ?? list[0].text
    const used = new Set([background])
    const pointLine = [facts1[1], ...ai].find((b) => b && !used.has(b.text))
    const point = pointLine?.text ?? ''
    if (point) used.add(point)
    const rest = ai.filter((b) => !used.has(b.text))
    return {
      issue: name,
      background,
      point,
      // 전망 재료(AI 줄)가 없으면 빈칸 대신 알린다 (원칙 2: 빠진 것을 알아챌 수 있게)
      outlook: rest.length ? `${rest[rest.length - 1].text} (추정)` : '근거 자료에서 전망을 찾지 못함 — 확인 필요',
      refs: [...new Set(list.flatMap(refsOf))],
    }
  }
  const analysis = [issue('기술 개요', sec('tech')), issue('업계 동향 · 경쟁사', sec('industry')), ...(r.analysis ?? []).map((an) => analysisIssue(an, arts))].filter(Boolean).slice(0, 4)
  // 이슈의 배경 · 쟁점 · 전망에 이미 쓴 줄은 「근거 1건뿐인 사실」에 다시 싣지 않는다 (11/17 렌더 확인: 같은 줄이 두 번)
  const usedTexts = new Set(analysis.flatMap((x) => [x.background, x.point, x.outlook.replace(/ \(추정\)$/, '')]))
  const single = [...new Set([...movedOut, ...sec('tech'), ...sec('industry')])].filter((b) => b.kind === 'fact' && b.refs?.length === 1 && !usedTexts.has(b.text)).slice(0, 4).map((b) => ({ text: cut(b.text, 60), refs: refsOf(b) }))

  // 유첨 4: 자료마다 요약 첫 항목 (입력에 요약이 있을 때)
  // 순서가 아니라 주소 · 제목으로 맞춘다 (11/17: 자료 11건 · 요약 입력 5건인 보고서에서 순서가 어긋남 — [분석] 줄 · 요약 없는 기사가 섞임)
  const inputs = entry.inputs ?? []
  const inputOf = (a) => inputs.find((x) => (a.url && x.url === a.url) || norm(x.title) === norm(a.title))
  const summaries = arts.map((a) => {
    if (isAnalysis(a)) return { no: a.no, title: cut(a.title, 34), summary: cut(a.description || a.title.replace(/^\[분석\]\s*/, ''), 55), basis: '규칙 계산' }
    const s = inputOf(a)?.summary
    const first = s?.items ? Object.values(s.items).find((x) => x?.text)?.text : null
    const inp = inputOf(a)
    // 논문은 원문을 못 읽으면 초록으로 요약함 (excerpt = 초록)
    const basis = s?.basisSource === 'fulltext' ? '원문' : s?.basisSource === 'abstract' || (a.paper || inp?.paper) ? '초록' : '발췌문'
    // 요약 headline(한 줄)이 있으면 그것, 없으면 첫 항목
    const line = s?.headline || first
    return { no: a.no, title: cut(a.title, 34), summary: line ? cut(line, 55) : '요약 없음 (선별 · 요약하지 않은 자료)', basis: s ? basis : '제목만' }
  })

  return {
    title: fitBox(r.title, 18, 6.4, 1), // 양식 제목 칸: 18pt · 6.4in · 1줄 (11/25: 25자로 잘라 「· 11/…」가 됐음)
    date: ymd(entry.createdAt ?? Date.now()),
    dept,
    headline: fitBox(r.headline?.text ?? '', 14, 8.6, 2), // 양식 헤드라인 칸: 14pt · 8.6in · 2줄
    facts,
    judgment,
    actions,
    trend,
    // article_count = 기사만 (11/17: 논문 10편을 「기사 10건」으로 적었음). counts = 「기사 a · 논문 b · 우리 분석 c」 (양식 출처 줄에 그대로)
    source: (() => {
      const nA = arts.filter((a) => isAnalysis(a)).length
      const nT = arts.filter((a) => a.patent && !isAnalysis(a)).length // 11/22 특허 자료
      const nP = arts.filter((a) => a.paper && !a.patent && !isAnalysis(a)).length
      const nN = arts.length - nA - nP - nT
      return { period, article_count: nN, media_count: media.size, keywords, counts: [`기사 ${nN}건`, nP && `논문 ${nP}편`, nT && `특허 ${nT}건`, nA && `DB 분석 ${nA}`].filter(Boolean).join(' · ') }
    })(),
    one_line_summary: fitBox(r.oneLine ?? '', 11, 7.7, 1), // 양식 한 줄 요약 칸: 11pt · 7.7in · 1줄
    appendix: {
      analysis,
      single_facts: single,
      charts: [keywordChart(inputs, period)].filter(Boolean),
      sources: arts.map((a) => ({ no: a.no, date: ymd(a.publishedAt), media: a.source ?? '', title: cut(a.title, 34), url: a.url ?? '' })),
      summaries,
      timeline: (r.analysis ?? []).map((an) => timelineSlide(an, entry.createdAt)).filter(Boolean),
    },
    _notes: [
      ...notes,
      // 앱 보고서의 경고(AI 해설 근거 못 찾음 · 보충 등)를 그대로 넘긴다 — 양식에는 「확인 필요」 표시 칸이 없어 여기서라도 보이게 (CLAUDE.md 원칙 2)
      ...(r.warnings ?? []).map((w) => `앱 보고서 경고: ${w}`),
      ...(sec('implications').some((b) => b.kind === 'ai' && !(b.refs ?? []).length) ? ['자사 판단 · 할 일 중 근거 번호 없는 AI 제안이 있어요 (앱에서는 「AI 제안」 표시)'] : []), ...(r.oneLine ? [] : ['한 줄 요약 칸은 이 보고서에 없어 비워 둠 (11/17 전 보고서, 헤드라인과 다른 문장으로 채워 주세요)']), ...(dept ? [] : ['작성부서는 비워 둠'])],
  }
}
