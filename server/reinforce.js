// AI 보충 문장의 근거 찾기 (11/08 조장): 보고서에서 'AI 해설·제안'으로 나온 글머리를
// 1) 우리 자료(이 보고서의 기사 원문 · DB의 기사 · 원문 · 직접 추가한 자료)와 2) 백과(위키백과)에서 근거를 찾아
// 근거가 있는 부분만 남겨 고쳐 쓴다. 근거가 없으면 그대로 두고 「근거 못 찾음」으로 알린다 (원칙 2: AI가 틀려도 알아챌 수 있게)
// - 찾기는 규칙(낱말 겹침)으로, 고쳐 쓰기만 AI로 (원칙 1)
// - 고쳐 쓴 문장은 찾은 자료와 다시 대조(isSupported)해서 맞을 때만 받아들인다
import { dbEnabled, query } from './db/index.js'
import { getArticleText, getSummaries } from './db/store.js'
import { chatJson, PRIORITY } from './llm/client.js'
import { isSupported, stripInlineRefs } from './llm/evidence.js'
import { lookupWiki } from './wiki.js'

const MAX_PASSAGES = 5
const PASSAGE_MAX = 600 // 자료 한 조각 글자 수

// 개조식 끝맺음 · 조사 · 너무 흔한 말은 찾는 낱말에서 뺀다
const STOP = new Set(
  '여러 우리 회사 기술 필요 기대 통해 위해 있음 있는 대한 경우 강화 확보 전략 활용 방안 가능 위한 관련 등의 이를 또한 및 등 더 수 것 중 각 그 이 해당 측면 분야 시장 업계 산업 제품 개발 효과 향상 중요 요구 부분 제공 지원 경쟁력 대응 고려 검토 모색 추진'.split(' '),
)
const SUFFIX = /(으로써|으로서|에서는|에서도|으로는|에게|에서|으로|부터|까지|처럼|보다|에는|에도|하는|하며|하고|하여|해야|되는|된|함|임|됨|은|는|이|가|을|를|의|에|로|와|과|도|만)$/

export function termsOf(text) {
  const raw = String(text)
    .replace(/[[\]()「」『』"'“”‘’·,.:;!?%~]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(SUFFIX, '').trim())
    .filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w))
  const uniq = [...new Set(raw)]
  // 영문 · 약어(OLED, TADF)와 긴 말을 먼저
  return uniq.sort((a, b) => Number(/[A-Za-z]/.test(b)) - Number(/[A-Za-z]/.test(a)) || b.length - a.length).slice(0, 6)
}

export function sentencesOf(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?。]|[다음임함됨]\.)\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15)
}

const has = (s, t) => s.toLowerCase().includes(t.toLowerCase())

// 문서에서 낱말이 가장 많이 겹치는 두 문장 조각
export function bestPassage(text, terms) {
  const sents = sentencesOf(text)
  let best = null
  sents.forEach((s, i) => {
    const window = [s, sents[i + 1] ?? ''].join(' ')
    const hit = terms.filter((t) => has(window, t)).length
    if (hit && (!best || hit > best.hit)) best = { hit, text: window.slice(0, PASSAGE_MAX) }
  })
  return best
}

export async function dbCandidates(terms) {
  if (!dbEnabled() || terms.length === 0) return []
  const pats = terms.map((t) => `%${t}%`)
  const [arts, texts, mats] = await Promise.all([
    query(
      `SELECT id, title, description, source, url, published_at FROM articles
        WHERE published_at > now() - interval '90 days' AND (title ILIKE ANY($1) OR description ILIKE ANY($1))
        ORDER BY published_at DESC LIMIT 80`,
      [pats],
    ),
    query(
      `SELECT t.article_id AS id, a.title, a.source, a.url, a.published_at, t.body FROM article_texts t
         JOIN articles a ON a.id = t.article_id WHERE t.body ILIKE ANY($1) LIMIT 20`,
      [pats],
    ),
    query(
      `SELECT id, title, source, url, published_at, body FROM materials
        WHERE ai_allowed AND (title ILIKE ANY($1) OR body ILIKE ANY($1)) ORDER BY added_at DESC LIMIT 20`,
      [pats],
    ),
  ])
  const rows = [
    ...texts.rows.map((r) => ({ ...r, text: `${r.title}. ${r.body}`, kind: 'data' })),
    ...mats.rows.map((r) => ({ ...r, text: `${r.title}. ${r.body ?? ''}`, kind: 'data', material: true })),
    ...arts.rows.map((r) => ({ ...r, text: `${r.title}. ${r.description ?? ''}`, kind: 'data' })),
  ]
  const seen = new Set()
  const uniq = rows.filter((r) => !seen.has(r.id) && seen.add(r.id))
  // 요약이 있는 기사는 요약 항목도 근거 글에 붙인다. 요약이 없는 「모은 기사」는 발췌뿐이라 needsSummary로 표시
  const sums = await getSummaries(uniq.filter((r) => !r.material).map((r) => String(r.id))).catch(() => ({}))
  return uniq.map((r) => {
    const sum = sums[r.id]?.summary
    if (sum) {
      const items = Object.values(sum.items ?? {})
        .filter((it) => it.basis === 'article')
        .map((it) => it.text)
        .join(' ')
      return { ...r, text: `${r.text} ${sum.headline ?? ''} ${items}`, summarized: true }
    }
    return { ...r, summarized: Boolean(r.material || r.body) }
  })
}

// inputs: 보고서에 쓴 기사들 (화면이 보낸 inputs: id · title · url · description · summary)
export async function inputCandidates(inputs) {
  return Promise.all(
    inputs.map(async (a, i) => {
      const body = await getArticleText(String(a.id ?? '')).catch(() => null)
      const items = Object.values(a.summary?.items ?? {})
        .filter((it) => it.basis === 'article')
        .map((it) => it.text)
        .join(' ')
      return { ...a, n: i + 1, text: [a.title, body ?? a.description ?? '', items].join('. '), kind: 'input', summarized: true }
    }),
  )
}

const SCHEMA = {
  type: 'object',
  properties: {
    supported: { type: 'boolean' },
    text: { type: 'string' },
    refs: { type: 'array', items: { type: 'integer' } },
  },
  required: ['supported', 'text', 'refs'],
}

export function messages(bullet, passages) {
  const list = passages.map((p, i) => `[R${i + 1}] (${p.label}) ${p.title}\n${p.text}`).join('\n\n')
  return [
    {
      role: 'system',
      content: `너는 기술 동향 보고서의 한 문장을 근거 자료로 보강한다.
- 원래 문장은 기사에서 확인되지 않은 'AI 해설'이다. 아래 참고 자료에 나온 내용만으로 원래 문장의 뜻을 살려 고쳐 쓴다.
- 참고 자료에 없는 수치 · 회사명 · 날짜 · 주장은 넣지 않는다. 뒷받침되지 않는 부분은 빼고 짧게 쓴다.
- 참고 자료로 원래 문장의 핵심이 전혀 뒷받침되지 않으면 supported=false, text는 빈 문자열.
- refs에는 실제로 쓴 참고 자료 번호(R 뒤 숫자)만 넣는다.
- 개조식, 명사형 종결("~함", "~임"), 한 문장. 한국어로만.
- 우리 회사(고객사)는 WOLED가 주력인 디스플레이 제조사다. QD-OLED는 경쟁사 기술이므로 우리 회사 기술로 쓰지 않는다.
- 출력은 JSON만.`,
    },
    { role: 'user', content: `원래 문장: ${bullet}\n\n참고 자료\n${list}` },
  ]
}

// text: AI 해설 글머리 · inputs: 보고서 근거 기사(번호 순) · existing: 보고서의 근거 목록(번호 순, 보충 자료 포함)
export async function reinforceBullet({ text, inputs = [], existing = [] }) {
  const bullet = stripInlineRefs(String(text ?? '')).trim()
  if (!bullet) throw Object.assign(new Error('문장이 비어 있어요.'), { status: 400 })
  const terms = termsOf(bullet)
  const searched = { terms, data: 0, wiki: 0 }

  // 1) 우리 자료: 보고서 기사(원문 우선) → DB 전체
  const pool = [...(await inputCandidates(inputs)), ...(await dbCandidates(terms).catch(() => []))]
  const scored = pool
    .map((c) => ({ c, p: bestPassage(c.text, terms) }))
    .filter((x) => x.p && x.p.hit >= Math.min(2, terms.length))
    .sort((a, b) => b.p.hit - a.p.hit || Number(b.c.kind === 'input') - Number(a.c.kind === 'input'))
  const seenUrl = new Set()
  const passages = []
  for (const { c, p } of scored) {
    const key = c.url || c.id
    if (seenUrl.has(key)) continue
    seenUrl.add(key)
    passages.push({
      label: c.kind === 'input' ? `이 보고서 근거 [${c.n}]` : c.material ? '직접 추가한 자료' : '모은 기사',
      title: c.title,
      text: p.text,
      ref: { id: c.id, title: c.title, source: c.source ?? '', url: c.url ?? '', publishedAt: c.published_at ? new Date(c.published_at).toISOString() : c.publishedAt, n: c.n },
      kind: 'data',
    })
    if (passages.length >= MAX_PASSAGES - 1) break
  }
  searched.data = passages.length

  // 2) 백과: 낱말 앞쪽 2개로 위키백과 (딱 맞는 문서만)
  for (const t of terms.slice(0, 2)) {
    if (passages.length >= MAX_PASSAGES) break
    try {
      const { result } = await lookupWiki(t)
      if (result && !result.near) {
        passages.push({
          label: '백과(위키백과)',
          title: result.title,
          text: result.extract.slice(0, PASSAGE_MAX),
          ref: { title: `${result.title} — 위키백과`, source: '위키백과', url: result.url, wiki: true },
          kind: 'wiki',
        })
        searched.wiki += 1
      }
    } catch {
      // 위키백과가 막혀도 우리 자료만으로 계속
    }
  }

  if (passages.length === 0) return { found: false, searched }
  return { ...(await rewriteWithPassages(bullet, passages, existing)), searched }
}

// 찾은 근거 조각(passages)으로 한 줄을 고쳐 쓴다. 근거와 다시 대조해 맞을 때만 받아들인다
// passages: [{ label, title, text, ref: { id?, n?, title, source, url, publishedAt?, wiki? }, kind: 'data' | 'wiki' }]
export async function rewriteWithPassages(bulletText, passages, existing = []) {
  const bullet = stripInlineRefs(String(bulletText ?? '')).trim()
  const { data, model } = await chatJson({
    messages: messages(bullet, passages),
    schema: SCHEMA,
    schemaName: 'reinforce_bullet',
    priority: PRIORITY.USER,
    kind: 'reinforce',
  })
  const used = [...new Set((data.refs ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= passages.length))]
  const newText = stripInlineRefs(data.text ?? '').trim()
  const evidence = used.map((n) => `${passages[n - 1].title} ${passages[n - 1].text}`).join(' ')
  if (!data.supported || !newText || used.length === 0 || !isSupported(newText, evidence)) {
    return { found: false, model, tried: passages.map((p) => p.title) }
  }
  // 근거 번호: 이 보고서 기사면 그 번호, 이미 보충한 자료면 그 번호, 새 자료면 뒤에 붙인다
  const list = [...existing]
  const added = []
  const refs = used.map((n) => {
    const r = passages[n - 1].ref
    if (r.n) return r.n
    const at = list.findIndex((x) => (x.url && x.url === r.url) || (x.title === r.title && x.source === r.source))
    if (at >= 0) return at + 1
    const entry = { title: r.title, source: r.source, url: r.url, publishedAt: r.publishedAt, supplement: r.wiki ? 'wiki' : 'data' }
    list.push(entry)
    added.push(entry)
    return list.length
  })
  const kinds = new Set(used.map((n) => passages[n - 1].kind))
  return {
    found: true,
    model,
    bullet: {
      text: newText,
      refs: [...new Set(refs)].sort((a, b) => a - b),
      kind: 'fact',
      supplement: kinds.has('data') ? (kinds.has('wiki') ? 'data+wiki' : 'data') : 'wiki',
      original: bullet,
    },
    added,
  }
}
