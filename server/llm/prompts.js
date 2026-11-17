// 기사 요약 프롬프트와 출력 형식 (08 개발 계획안 5-3 기준)
// 6항목: 컨셉 · 원리 · 장단점 · 타사 현황 · 활용 방안 · 효과성 (1차 인터뷰)

export const ITEM_KEYS = ['concept', 'principle', 'pros_cons', 'competitors', 'application', 'effect']

const item = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    // article: 기사 근거 / ai_background: 기사에 없어 일반 지식으로 보충 / ai_suggestion: AI 제안
    basis: { type: 'string', enum: ['article', 'ai_background', 'ai_suggestion'] },
    refs: { type: 'array', items: { type: 'integer' } },
  },
  required: ['text', 'basis', 'refs'],
}

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    items: {
      type: 'object',
      properties: Object.fromEntries(ITEM_KEYS.map((k) => [k, item])),
      required: ITEM_KEYS,
    },
    keywords: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    // 11/17: 긍정·중립·부정(sentiment)은 뺌 (담당자 「크게 도움 안 됨」, 14 문서). 예전 요약에 남은 값은 쓰지 않음
  },
  required: ['headline', 'items', 'keywords', 'warnings'],
}

const SYSTEM = `너는 기술 동향 보고 담당자를 돕는 분석가다.
주어진 기사 정보로 아래 6항목 요약을 만든다.
- concept: 어떤 기술인지
- principle: 기술 원리
- pros_cons: 장점과 단점
- competitors: 타사의 개발·활용 현황
- application: 우리 회사(WOLED 중심 디스플레이 제조사) 활용 방안
- effect: 기대 효과

규칙
- 개조식, 명사형 종결("~함", "~임"). 항목당 1~2문장.
- 기사에 있는 내용이면 basis를 "article"로, refs에 기사 번호를 넣는다. '원문 본문'이 있으면 본문을 먼저 근거로 쓴다.
- 기사에 없어 일반 지식으로 보충한 내용은 basis를 "ai_background"로, refs는 빈 배열.
- 활용 방안처럼 너의 제안이면 basis를 "ai_suggestion"으로, refs는 빈 배열.
- 수치·회사명·날짜는 기사에 있는 것만 쓴다. 지어내지 않는다.
- 우리 회사(고객사)는 WOLED가 주력인 디스플레이 제조사다. QD-OLED는 경쟁사 기술이므로 우리 회사가 쓰거나 개발하는 기술로 쓰지 않고, 활용 방안에 'QD-OLED 도입'을 제안하지 않는다. QD-OLED는 타사 현황으로만 다룬다.
- 한국어로만 쓴다. 중국어·한자를 쓰지 않는다.
- 기사에 직접 나오지 않는 설명(원리·일반적인 장단점 등)은 basis를 반드시 'ai_background'로.
- 기사 정보가 부족해 보충했다면 warnings에 한 줄로 적는다.
- keywords는 핵심 키워드 3개.
- 출력은 JSON만.`

// articles: [{ title, source, keyword, description? }] — 첫 기사가 대표, 나머지는 같은 이슈 기사
export function buildSummaryMessages(articles) {
  const lines = articles.map((a, i) => {
    const parts = [`[${i + 1}] 제목: ${a.title}`, `매체: ${a.source ?? '미상'}`]
    if (a.keyword) parts.push(`수집 키워드: ${a.keyword}`)
    if (a.description) parts.push(`요약문: ${a.description}`)
    // 원문 본문이 있으면 요약문보다 본문을 먼저 근거로 쓴다 (11/07 결정: 요약도 원문 기반)
    if (a.body) parts.push(`원문 본문:\n${a.body}`)
    return parts.join(' / ')
  })
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `기사 정보\n${lines.join('\n')}` },
  ]
}
