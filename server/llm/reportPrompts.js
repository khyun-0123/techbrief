// 보고서 초안 프롬프트와 출력 형식 (10 보고서 초안 계획 3절, 08 개발 계획안 5-4)
import { similarity } from '../collector/dedupe.js'

export const SECTION_KEYS = ['summary', 'tech', 'industry', 'implications']

// 11/12: 담당자 회신(11/10, 35 문서) 형식 — 1페이지 = 헤드라인 · 핵심 사실 근거 · 시사점 및 제언 · 출처, 상세는 유첨
// 저장 · 화면 호환을 위해 섹션 키는 그대로 두고 이름 · 역할만 바꿨다 (summary = 핵심 사실 근거, implications = 시사점 및 제언, tech · industry = 유첨)
export const SECTION_TITLES = {
  summary: '핵심 사실 근거',
  tech: '기술 개요 (유첨)',
  industry: '업계 동향 · 경쟁사 (유첨)',
  implications: '시사점 및 제언',
}
export const TAGS = ['기회', '위협', '할 일']

const bullets = {
  type: 'object',
  properties: {
    bullets: {
      type: 'array',
      items: {
        type: 'object',
        // kind: fact = 기사(원문)에서 확인된 사실, ai = AI 해설·제안 (15 문서 F15: 둘을 섞지 않는다)
        properties: {
          text: { type: 'string' },
          refs: { type: 'array', items: { type: 'integer' } },
          kind: { type: 'string', enum: ['fact', 'ai'] },
          // 시사점 및 제언 글머리만: 자사에 기회 · 위협 · 할 일 (담당자 회신 ③)
          tag: { type: 'string', enum: ['기회', '위협', '할 일', ''] },
        },
        required: ['text', 'refs', 'kind'],
      },
    },
  },
  required: ['bullets'],
}

export const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    // ① 헤드라인: 결론 핵심 문장 하나 (담당자 회신 11/10)
    headline: {
      type: 'object',
      properties: { text: { type: 'string' }, refs: { type: 'array', items: { type: 'integer' } }, kind: { type: 'string', enum: ['fact', 'ai'] } },
      required: ['text', 'refs', 'kind'],
    },
    sections: {
      type: 'object',
      properties: Object.fromEntries(SECTION_KEYS.map((k) => [k, bullets])),
      required: SECTION_KEYS,
    },
    // 한 줄 요약 (11/17, 보고서팀 담당자 양식 summary 칸): 본문 전체를 한 문장으로, 헤드라인과 다른 문장. 예전 보고서에는 없음
    oneLine: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'headline', 'sections', 'warnings'],
}

export const SECTION_SCHEMA = bullets

const RULES = `규칙
- [유료 논문 — 초록까지만 공개] 표시가 있는 논문은 제목 · 저자 · 출처 · 초록에 있는 내용만 쓴다. 초록에 없는 실험 결과 · 수치 · 결론을 추측해서 쓰지 않는다.
- 개조식, 명사형 종결("~함", "~임"). 서술식 문장 금지.
- 섹션별 글머리 2~4개, 핵심 사실 근거는 3~5개. 한 글머리는 한 문장.
- 글머리마다 kind를 정한다. 기사(원문 본문·요약문)에 나온 사실이면 "fact", 원리 설명·일반 지식·전망·우리 회사 활용 제안처럼 기사 밖의 해설이면 "ai".
- 한 글머리에 사실과 해설을 섞지 않는다. 섞이면 두 글머리로 나눈다.
- fact 글머리는 근거 기사 번호를 refs에 넣는다. 번호는 아래 기사 목록의 번호만 쓴다.
- ai 글머리는 refs를 빈 배열로 둔다. 요약 항목 중 [AI 보충] 또는 [AI 제안]으로 표시된 내용만으로 쓴 글머리는 ai다.
- 업계 동향은 기사에 나온 타사의 실제 움직임(공급·투자·출시·점유율 등)을 쓰므로 대부분 fact이고 근거 번호를 꼭 넣는다.
- 사실(수치·회사명·날짜·발표 내용)은 '원문 본문'을 먼저 근거로 쓰고, 원문이 없는 기사는 기사 요약문과 6항목 요약을 쓴다.
- 수치·회사명·날짜는 원문이나 기사 요약에 있는 것만 쓴다. 지어내지 않는다.
- 우리 회사(고객사)는 WOLED가 주력인 디스플레이 제조사다. QD-OLED는 경쟁사 기술이므로 우리 회사가 쓰거나 개발하는 기술로 쓰지 않고, 활용 방안에 'QD-OLED 도입'을 제안하지 않는다. QD-OLED는 타사 현황으로만 다룬다.
- 한국어로만 쓴다. 중국어·한자를 쓰지 않는다 (예: BOE는 'BOE').
- 문장 안에 [1] 같은 번호를 쓰지 않는다. 번호는 refs에만 넣는다.
- 여러 기사에 걸친 공통 흐름이 있으면 하나의 글머리로 묶고 refs에 여러 번호를 넣는다.
- 제목이 [분석]으로 시작하는 자료는 테크브리프가 논문 · 특허 수로 규칙 계산한 숫자다(기술 단계, 경쟁사 특허 비교, 주요 출원인, 상용화 시점 문장). 기사처럼 사실로 쓰고 그 번호를 refs에 넣는다. 숫자를 바꾸거나 반올림하지 않는다. 해석을 덧붙이면 ai 글머리로 나눈다.`

// 11/17 (39 문서 E, 보고서팀 담당자 양식 templates/report-prompt.md 「칸 크기」): 본문이 한 장에 들어가게 칸마다 길이를 정한다.
// 글자 크기를 줄일 수 없는 양식이라, 넘치는 내용은 유첨(tech · industry)으로 보낸다
const SECTION_GUIDE = `형식 (담당자 지정: 1페이지 = 헤드라인 · 핵심 사실 근거 · 시사점 및 제언 · 출처, 상세는 유첨)
본문은 PPT 한 장에 들어가야 한다. 아래 길이를 넘기지 않는다 (글자 크기를 줄일 수 없음). 넘치면 문장을 줄이거나 유첨(tech · industry)으로 옮긴다.
- title 25자 이내 · headline 60자 이내 · summary 글머리 3~5개, 각 50자 이내 · implications 기회/위협 판단 1개(50자 이내) + 할 일 2~3개(각 28자 이내, 「무엇을 — 시점 또는 우선순위」) · oneLine 50자 이내
- summary에는 근거 번호가 2개 이상인 사실을 먼저 쓴다. 근거가 1개뿐인 사실은 tech · industry(유첨)로 보낸다
- oneLine(한 줄 요약): 본문 전체를 한 문장으로 — 무슨 일이 있었고 우리 회사는 무엇을 할지. headline과 다른 문장 · 다른 표현
- headline(헤드라인): 주제 키워드에 대한 **결론 핵심 문장 하나**. 무엇이 일어났고 우리 회사에 무슨 뜻인지를 한 문장으로. 「헤드라인 재료」가 있으면 그중 가장 중요한 것을 중심에 두고, **구체적 사실(숫자 · 회사 · 시점) 하나 이상**과 **근거 번호 1개 이상**을 꼭 넣는다(kind는 fact). 「핵심 동력으로 부상」 「주목받고 있음」 같은 일반론은 쓰지 않는다. 예: 「마이크로 · 미니 LED 특허 자사 2.04배로 경쟁사 중 가장 빠르게 늘어 — 차세대 마이크로 LED 선점 기회」
- summary(핵심 사실 근거): 헤드라인을 뒷받침하는 사실. 모두 근거 번호가 있는 fact. [분석] 자료의 숫자(단계 · 특허 · 경쟁사 비교 · 상용화 시점)를 적극 쓴다.
- implications(시사점 및 제언): 우리 회사(WOLED 중심 디스플레이 제조사)에 **기회인지 위협인지**, **할 일은 무엇인지**. 글머리마다 tag를 '기회' · '위협' · '할 일' 중 하나로. [분석] 자료에 「규칙 판정: 자사에 위협 / 기회」가 있으면 그 판정을 따르고 뒤집지 않는다.
- tech(유첨 · 기술 개요): 컨셉 · 원리 · 장단점 (요약의 컨셉 · 원리 · 장단점)
- industry(유첨 · 업계 동향 · 경쟁사): 경쟁사의 개발 · 검토 현황과 상용화 시점 언급 (요약의 타사 현황, [분석]의 경쟁사 비교 · 상용화 문장)
- 출처(수집 기간 · 기사 수)는 서버가 붙이므로 쓰지 않는다.`

const ITEM_LABELS = {
  concept: '컨셉',
  principle: '원리',
  pros_cons: '장단점',
  competitors: '타사 현황',
  application: '활용 방안',
  effect: '효과성',
}
const BASIS_TAG = { article: '', ai_background: ' [AI 보충]', ai_suggestion: ' [AI 제안]' }

const DESC_MAX = 160 // 기사 요약문은 앞부분만 (원래 사실을 근거로 쓰게)
const COMPACT_OVER = 10 // 이보다 기사가 많으면 섹션 다시 쓰기에서 재료를 줄인다
const SAME_ITEM = 0.3 // 기사끼리 이 이상 비슷한 'AI 보충·제안' 항목은 처음 한 번만 넣는다

// 보고서 입력을 압축한다 (10 보고서 계획 · '요약한 것을 또 요약'하는 부담 줄이기)
// - 기사 근거 항목은 그대로, 기사 요약문(원래 사실)을 함께 넣는다
// - 여러 기사에 반복되는 AI 보충·제안(같은 원리 설명 등)은 한 번만 넣는다
// 섹션을 다시 쓸 때 기사가 많으면(10건 초과) 그 섹션의 재료 항목만 넣는다 (화면 ReportDraft의 SECTION_PLAN과 같은 구성)
const SECTION_ITEMS = {
  summary: ['concept', 'effect'],
  tech: ['concept', 'principle'],
  industry: ['competitors', 'pros_cons'],
  implications: ['application', 'effect'],
}

// articles: [{ n, title, source, publishedAt, description, summary: { items: {...} } }]
// itemKeys: 넣을 요약 항목 (없으면 6항목 전부)
function describeArticles(articles, itemKeys = Object.keys(ITEM_LABELS)) {
  const seenAi = [] // { label, text }
  return articles
    .map((a) => {
      const head = `[${a.n}] ${a.title} (${a.source ?? '매체 미상'}${a.publishedAt ? `, ${a.publishedAt.slice(0, 10)}` : ''})`
      const lines = [head]
      // 유료 논문 (11/14, 보고서팀 작업 이식): 제목 · 저자 · 출처 · 초록까지만 넣고 표시한다. 6항목 요약은 초록 밖 추측이 섞일 수 있어 넣지 않음
      const paid = a.paper && !a.body && a.access === 'paid'
      if (a.paper) {
        lines[0] += paid ? ' [유료 논문 — 초록까지만 공개]' : ' [논문]'
        if (a.authors?.length) lines.push(`  - 저자: ${a.authors.slice(0, 6).join(', ')}`)
      }
      if (paid) {
        if (a.abstract || a.description) lines.push(`  - 초록: ${String(a.abstract || a.description).replace(/\n+/g, ' ').slice(0, 1200)}`)
        return lines.join('\n')
      }
      if (a.body) lines.push(`  - 원문 본문: ${a.body.replace(/\n+/g, ' ')}`)
      else if (a.description) lines.push(`  - 기사 요약문: ${a.description.slice(0, DESC_MAX)}`)
      for (const [key, label] of Object.entries(ITEM_LABELS).filter(([k]) => itemKeys.includes(k))) {
        const item = a.summary?.items?.[key]
        if (!item?.text) continue
        if (item.basis !== 'article') {
          if (seenAi.some((x) => x.label === label && similarity(x.text, item.text) >= SAME_ITEM)) continue
          seenAi.push({ label, text: item.text })
        }
        lines.push(`  - ${label}: ${item.text}${BASIS_TAG[item.basis] ?? ''}`)
      }
      return lines.join('\n')
    })
    .join('\n\n')
}

// 보고서 방향 (11/08 조장): 작성자가 한 줄로 준 주제 · 방향. 지시문에 넣어 무엇을 앞에 두고 강조할지 정하게 한다
// 방향에 맞는 내용이 기사에 없으면 지어내지 않고 warnings에 적게 한다 (원칙 2)
const DIRECTION_RULE = `- 작성자가 준 '보고서 방향'이 있으면 그 방향에 맞는 내용을 핵심 요약과 각 섹션 앞쪽에 두고 강조한다. 방향과 관계없는 내용은 줄인다.
- 방향에 맞는 근거가 기사에 없으면 지어내지 말고 warnings에 '방향에 맞는 근거 부족: …'으로 적는다.`
function directionLine(direction, topics = [], seeds = []) {
  const d = String(direction ?? '').trim().slice(0, 300)
  const t = topics.length ? `주제 키워드: ${topics.join(', ')} — 헤드라인은 이 키워드에 대한 결론으로 쓴다\n` : ''
  const sd = seeds.length ? `헤드라인 재료 (규칙 계산, 이 중 가장 중요한 것을 결론으로 — 숫자는 그대로):\n${seeds.map((x) => `  - ${x}`).join('\n')}\n` : ''
  return `${t}${sd}${d ? `보고서 방향(작성자 요청): ${d}\n` : ''}`
}

export function buildReportMessages(articles, { title, periodLabel, direction, topics = [], seeds = [] }) {
  return [
    {
      role: 'system',
      content: `너는 기술 동향 보고서를 쓰는 담당자를 돕는다. 경영진에게 올라가는 보고서 초안 한 편을 쓴다. 처음부터 끝까지 그대로 읽히는 깔끔한 문서로 쓴다.\n\n${SECTION_GUIDE}\n\n${RULES}\n${DIRECTION_RULE}\n- warnings에는 근거가 약한 부분을 한 줄씩 적는다.\n- 출력은 JSON만.`,
    },
    {
      role: 'user',
      content: `보고서 제목: ${title}\n기간: ${periodLabel}\n${directionLine(direction, topics, seeds)}\n기사 (원문 본문 또는 요약문)와 6항목 요약 · [분석] 자료\n${describeArticles(articles)}`,
    },
  ]
}

// 기사가 많아(10건 초과) 몇 건씩 나눠 쓴 초안 조각들을 한 보고서로 합친다 (21 문서 6-3)
// parts: [{ sections: { summary: { bullets: [{ text, refs, kind }] }, ... } }] — refs는 처음부터 전체 기사 번호
export function buildMergeMessages(articles, parts, { title, periodLabel, direction, topics = [], seeds = [] }) {
  const list = articles.map((a) => `[${a.n}] ${a.title} (${a.source ?? '매체 미상'})`).join('\n')
  const drafts = SECTION_KEYS.map((k) => {
    const lines = parts.flatMap((p) =>
      (p.sections?.[k]?.bullets ?? []).map((b) => `  - (${b.kind === 'ai' ? 'ai' : 'fact'}${b.refs?.length ? `, 근거 ${b.refs.join(',')}` : ''}${b.tag ? `, ${b.tag}` : ''}) ${b.text}`),
    )
    return `${k}(${SECTION_TITLES[k]}):\n${lines.join('\n') || '  - (없음)'}`
  }).join('\n\n')
  const heads = parts.map((p) => p.headline?.text).filter(Boolean).map((t) => `  - ${t}`).join('\n')
  return [
    {
      role: 'system',
      content: `너는 기술 동향 보고서를 쓰는 담당자를 돕는다. 기사가 많아 몇 묶음으로 나눠 쓴 초안 조각들을 경영진용 보고서 한 편으로 합친다.\n- 헤드라인은 조각들의 헤드라인 후보를 보고 보고서 전체의 결론 한 문장으로 다시 쓴다.\n- 같은 내용은 하나의 글머리로 묶고 근거 번호를 모두 refs에 넣는다.\n- 근거 번호는 초안 조각에 적힌 번호를 그대로 쓴다 (전체 기사 번호). 새 번호를 만들지 않는다.\n- fact/ai 구분은 초안 조각의 표시를 따른다. fact와 ai를 한 글머리에 섞지 않는다.\n- 초안 조각에 없는 내용을 새로 지어내지 않는다.\n\n${SECTION_GUIDE}\n\n${RULES}\n${DIRECTION_RULE}\n- warnings에는 근거가 약한 부분을 한 줄씩 적는다.\n- 출력은 JSON만.`,
    },
    {
      role: 'user',
      content: `보고서 제목: ${title}\n기간: ${periodLabel}\n${directionLine(direction, topics, seeds)}\n전체 기사 목록\n${list}\n\n헤드라인 후보 (조각마다)\n${heads || '  - (없음)'}\n\n초안 조각 (섹션별로 모음)\n${drafts}`,
    },
  ]
}

export function buildSectionMessages(articles, { key, report, direction }) {
  const others = SECTION_KEYS.filter((k) => k !== key)
    .map((k) => `${SECTION_TITLES[k]}: ${(report?.sections?.[k]?.bullets ?? []).map((b) => b.text).join(' / ')}`)
    .join('\n')
  return [
    {
      role: 'system',
      content: `너는 기술 동향 보고서의 한 섹션만 다시 쓴다. 다른 섹션과 겹치지 않게, 기존과 다른 표현으로 쓴다.\n\n${SECTION_GUIDE}\n\n${RULES}\n${DIRECTION_RULE}\n- 출력은 JSON만 ({ "bullets": [...] }).`,
    },
    {
      role: 'user',
      // 기사가 많으면 문맥 크기를 넘지 않게 이 섹션의 재료 항목만 (원문 본문은 서버가 붙이지 않음)
      content: `다시 쓸 섹션: ${key}(${SECTION_TITLES[key]})\n${directionLine(direction)}\n다른 섹션(참고만):\n${others}\n\n기사와 요약\n${describeArticles(articles, articles.length > COMPACT_OVER ? SECTION_ITEMS[key] : undefined)}`,
    },
  ]
}
