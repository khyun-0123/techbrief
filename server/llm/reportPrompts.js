// 보고서 초안 프롬프트와 출력 형식 (10 보고서 초안 계획 3절, 08 개발 계획안 5-4)
import { similarity } from '../collector/dedupe.js'

export const SECTION_KEYS = ['summary', 'tech', 'industry', 'implications']

export const SECTION_TITLES = {
  summary: '핵심 요약',
  tech: '기술 개요',
  industry: '업계 동향',
  implications: '시사점',
}

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
    sections: {
      type: 'object',
      properties: Object.fromEntries(SECTION_KEYS.map((k) => [k, bullets])),
      required: SECTION_KEYS,
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'sections', 'warnings'],
}

export const SECTION_SCHEMA = bullets

const RULES = `규칙
- 개조식, 명사형 종결("~함", "~임"). 서술식 문장 금지.
- 섹션별 글머리 2~4개, 핵심 요약은 3개 이내. 한 글머리는 한 문장.
- 글머리마다 kind를 정한다. 기사(원문 본문·요약문)에 나온 사실이면 "fact", 원리 설명·일반 지식·전망·우리 회사 활용 제안처럼 기사 밖의 해설이면 "ai".
- 한 글머리에 사실과 해설을 섞지 않는다. 섞이면 두 글머리로 나눈다.
- fact 글머리는 근거 기사 번호를 refs에 넣는다. 번호는 아래 기사 목록의 번호만 쓴다.
- ai 글머리는 refs를 빈 배열로 둔다. 요약 항목 중 [AI 보충] 또는 [AI 제안]으로 표시된 내용만으로 쓴 글머리는 ai다.
- 업계 동향은 기사에 나온 타사의 실제 움직임(공급·투자·출시·점유율 등)을 쓰므로 대부분 fact이고 근거 번호를 꼭 넣는다.
- 사실(수치·회사명·날짜·발표 내용)은 '원문 본문'을 먼저 근거로 쓰고, 원문이 없는 기사는 기사 요약문과 6항목 요약을 쓴다.
- 수치·회사명·날짜는 원문이나 기사 요약에 있는 것만 쓴다. 지어내지 않는다.
- 한국어로만 쓴다. 중국어·한자를 쓰지 않는다 (예: BOE는 'BOE').
- 문장 안에 [1] 같은 번호를 쓰지 않는다. 번호는 refs에만 넣는다.
- 여러 기사에 걸친 공통 흐름이 있으면 하나의 글머리로 묶고 refs에 여러 번호를 넣는다.`

const SECTION_GUIDE = `섹션
- summary(핵심 요약): 보고받는 경영진이 가장 먼저 알아야 할 내용
- tech(기술 개요): 어떤 기술이고 어떤 원리인지 (요약의 컨셉·원리)
- industry(업계 동향): 타사의 개발·활용 현황과 장단점 (요약의 타사 현황·장단점)
- implications(시사점): 우리 회사(디스플레이·전자 제조사) 활용 방안과 기대 효과 (요약의 활용 방안·효과성)`

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

export function buildReportMessages(articles, { title, periodLabel }) {
  return [
    {
      role: 'system',
      content: `너는 기술 동향 보고서를 쓰는 담당자를 돕는다. 경영진에게 올라가는 보고서 초안 한 편을 쓴다. 처음부터 끝까지 그대로 읽히는 깔끔한 문서로 쓴다.\n\n${SECTION_GUIDE}\n\n${RULES}\n- warnings에는 근거가 약한 부분을 한 줄씩 적는다.\n- 출력은 JSON만.`,
    },
    {
      role: 'user',
      content: `보고서 제목: ${title}\n기간: ${periodLabel}\n\n기사 (원문 본문 또는 요약문)와 6항목 요약\n${describeArticles(articles)}`,
    },
  ]
}

// 기사가 많아(10건 초과) 몇 건씩 나눠 쓴 초안 조각들을 한 보고서로 합친다 (21 문서 6-3)
// parts: [{ sections: { summary: { bullets: [{ text, refs, kind }] }, ... } }] — refs는 처음부터 전체 기사 번호
export function buildMergeMessages(articles, parts, { title, periodLabel }) {
  const list = articles.map((a) => `[${a.n}] ${a.title} (${a.source ?? '매체 미상'})`).join('\n')
  const drafts = SECTION_KEYS.map((k) => {
    const lines = parts.flatMap((p) =>
      (p.sections?.[k]?.bullets ?? []).map((b) => `  - (${b.kind === 'ai' ? 'ai' : 'fact'}${b.refs?.length ? `, 근거 ${b.refs.join(',')}` : ''}) ${b.text}`),
    )
    return `${k}(${SECTION_TITLES[k]}):\n${lines.join('\n') || '  - (없음)'}`
  }).join('\n\n')
  return [
    {
      role: 'system',
      content: `너는 기술 동향 보고서를 쓰는 담당자를 돕는다. 기사가 많아 몇 묶음으로 나눠 쓴 초안 조각들을 경영진용 보고서 한 편으로 합친다.\n- 같은 내용은 하나의 글머리로 묶고 근거 번호를 모두 refs에 넣는다.\n- 근거 번호는 초안 조각에 적힌 번호를 그대로 쓴다 (전체 기사 번호). 새 번호를 만들지 않는다.\n- fact/ai 구분은 초안 조각의 표시를 따른다. fact와 ai를 한 글머리에 섞지 않는다.\n- 초안 조각에 없는 내용을 새로 지어내지 않는다.\n\n${SECTION_GUIDE}\n\n${RULES}\n- warnings에는 근거가 약한 부분을 한 줄씩 적는다.\n- 출력은 JSON만.`,
    },
    {
      role: 'user',
      content: `보고서 제목: ${title}\n기간: ${periodLabel}\n\n전체 기사 목록\n${list}\n\n초안 조각 (섹션별로 모음)\n${drafts}`,
    },
  ]
}

export function buildSectionMessages(articles, { key, report }) {
  const others = SECTION_KEYS.filter((k) => k !== key)
    .map((k) => `${SECTION_TITLES[k]}: ${(report?.sections?.[k]?.bullets ?? []).map((b) => b.text).join(' / ')}`)
    .join('\n')
  return [
    {
      role: 'system',
      content: `너는 기술 동향 보고서의 한 섹션만 다시 쓴다. 다른 섹션과 겹치지 않게, 기존과 다른 표현으로 쓴다.\n\n${SECTION_GUIDE}\n\n${RULES}\n- 출력은 JSON만 ({ "bullets": [...] }).`,
    },
    {
      role: 'user',
      // 기사가 많으면 문맥 크기를 넘지 않게 이 섹션의 재료 항목만 (원문 본문은 서버가 붙이지 않음)
      content: `다시 쓸 섹션: ${key}(${SECTION_TITLES[key]})\n\n다른 섹션(참고만):\n${others}\n\n기사와 요약\n${describeArticles(articles, articles.length > COMPACT_OVER ? SECTION_ITEMS[key] : undefined)}`,
    },
  ]
}
