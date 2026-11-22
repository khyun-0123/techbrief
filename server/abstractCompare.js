// 특허 「제목만 / 제목 + 초록」 비교 (11/22, 관리 페이지 「판정 기준 › 초록으로도 세면?」)
// - 왜: 11/21에 디스플레이 특허 초록 120만 건을 받았다 (patentAbstracts.js). 특허 수를 초록으로도 셀지는
//   12개 기술에서 건수 · 위협/기회가 어떻게 바뀌는지, 초록으로만 잡힌 특허가 그 기술이 맞는지 보고 정한다 (33 문서)
// - 읽기만 한다: 판정 · 화면 값은 바꾸지 않는다. DB를 밖에 열지 않고 관리 페이지에서 본다
// - 비교 방식: 두 쪽 모두 「그 특허 안에서」 회사별 비교 (CPC 연결표를 켠 기술과 같은 방식, keywordBundle.js competitorsWhere)
//   ① 지금 세는 법 — 제목 (켠 기술은 제목 OR 기술 CPC)  ② ① OR 초록에 같은 영문 검색어
// - 초록으로만 잡힌 특허는 초록에 태양전지 · 광검출기 등(NON_DISPLAY_TITLE)이 있으면 뺀다 — 페로브스카이트 · 탠덤은 태양전지가 많다 (W34)
import { cacheGet } from './papers/index.js'
import { dbEnabled, query } from './db/index.js'
import { patentDbReady, toPg } from './patentDb.js'
import { patternFromTerms } from './patents.js'
import { NON_DISPLAY_TITLE, techRuleFor, techWhere } from './techCpc.js'
import { competitorsWhere } from './keywordBundle.js'
import { abstractsStatus } from './patentAbstracts.js'
import { createHash } from 'node:crypto'

// 12개 기술 (33 문서 검증 세트, 11/21 CPC 연결표 비교와 같은 목록). en: 기술 시계열 기억 값에 영문 검색어가 없을 때 쓰는 말
export const COMPARE_SET = [
  { label: 'PDP', keyword: 'pdp', en: ['plasma display panel'] },
  { label: 'LCD', keyword: 'lcd', en: ['liquid crystal display'] },
  { label: 'OLED', keyword: 'oled', en: ['OLED', 'organic light-emitting diode'] },
  { label: 'QD-OLED', keyword: 'qd-oled', en: ['QD-OLED', 'quantum dot OLED'] },
  { label: '탠덤 OLED', keyword: '탠덤 oled', en: ['tandem OLED'] },
  { label: '마이크로 LED', keyword: '마이크로 led', en: ['micro LED', 'microLED'] },
  { label: '미니 LED', keyword: '미니 led', en: ['mini LED', 'miniLED'] },
  { label: 'LTPO', keyword: 'ltpo', en: ['LTPO', 'low-temperature polycrystalline oxide'] },
  { label: '페로브스카이트 LED', keyword: '페로브스카이트 led', en: ['perovskite light-emitting diode', 'PeLED'] },
  { label: 'QLED', keyword: 'qled', en: ['QLED', 'quantum dot light-emitting diode'] },
  { label: '홀로그래픽', keyword: '홀로그램 디스플레이', en: ['holographic display'] },
  { label: '전자종이', keyword: '전자종이', en: ['electronic paper', 'e-paper', 'electrophoretic display'] },
]

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 8)
const own = (c) => c?.companies?.find((x) => x.own)
const brief = (c) =>
  c && {
    before: c.field.before,
    now: c.field.now,
    ratio: c.field.ratio,
    verdict: c.verdict,
    own: own(c) ? { name: own(c).name, before: own(c).before, now: own(c).now, ratio: own(c).ratio } : null,
    companies: c.companies.filter((x) => x.before + x.now > 0).map((x) => ({ name: x.name, own: x.own, unsure: x.unsure, before: x.before, now: x.now, ratio: x.ratio })),
  }

// 초록 한 줄에서 검색어 둘레만 (표본 확인용)
function snippet(text, re) {
  const m = re.exec(text)
  if (!m) return text.slice(0, 160)
  const from = Math.max(0, m.index - 70)
  return `${from ? '…' : ''}${text.slice(from, m.index + m[0].length + 90)}…`
}

// input: { keyword, terms? } — terms(영문 검색어)를 안 주면 기술 시계열 기억 값 → COMPARE_SET → 키워드 그대로
export async function compareAbstracts(input) {
  if (!dbEnabled()) throw Object.assign(new Error('DB가 없어요.'), { status: 503 })
  const keyword = String(input?.keyword ?? '').trim().toLowerCase().slice(0, 60)
  if (!keyword) throw Object.assign(new Error('키워드를 넣어 주세요.'), { status: 400 })
  const st = await abstractsStatus()
  if (!st.ready) throw Object.assign(new Error('특허 초록을 아직 받지 않았어요 (PATENT_ABSTRACTS=fetch).'), { status: 409 })
  if (!(await patentDbReady())) throw Object.assign(new Error('디스플레이 특허 DB가 없어요.'), { status: 409 })

  let terms = (Array.isArray(input?.terms) ? input.terms : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
  let from = 'admin'
  if (!terms.length) {
    const tl = await cacheGet(`timeline:v5:${keyword}`).catch(() => null)
    if (tl?.terms?.length) [terms, from] = [tl.terms, 'timeline']
    else {
      const known = COMPARE_SET.find((t) => t.keyword === keyword)
      ;[terms, from] = known ? [known.en, 'set'] : [[keyword], 'keyword']
    }
  }
  const pattern = patternFromTerms(terms)
  if (!pattern) throw Object.assign(new Error('영문 검색어가 너무 짧아요 (3자 이상).'), { status: 400 })
  const pg = toPg(pattern.toLowerCase())
  const rule = await techRuleFor([keyword, ...terms])

  // ① 지금 세는 법
  const base = (at) => {
    if (!rule) return { sql: `lower(title) ~ $${at}`, params: [pg] }
    const w = techWhere(rule, at + 1, `lower(title) ~ $${at}`)
    return { sql: w.sql, params: [pg, ...w.params] }
  }
  // ② ① OR 초록 (초록에 디스플레이 밖 말이 있으면 초록만으로는 안 셈)
  const withAbs = (at) => {
    const b = base(at)
    const i = at + b.params.length
    return {
      sql: `(${b.sql} OR EXISTS (SELECT 1 FROM display_abstracts a WHERE a.family = display_patents.family AND lower(a.abstract) ~ $${i} AND NOT lower(a.abstract) ~ $${i + 1}))`,
      params: [...b.params, pg, NON_DISPLAY_TITLE],
    }
  }
  const tag = `${hash(pg)}:${rule ? rule.id + hash(JSON.stringify(rule)) : '-'}:${st.at}`
  const [now, abs] = await Promise.all([
    competitorsWhere({ id: `abs-cmp:${keyword}`, name: keyword, cacheId: `abs-cmp:title:${tag}`, where: base, tech: true }),
    competitorsWhere({ id: `abs-cmp:${keyword}`, name: keyword, cacheId: `abs-cmp:abs:${tag}`, where: withAbs, tech: true }),
  ])

  // 초록으로만 잡힌 특허 표본 (최근 3년, 8건) — 그 기술이 맞는지 사람이 본다
  const last = new Date().getFullYear() - 1
  const b = base(3)
  const i = 3 + b.params.length
  const { rows } = await query(
    `SELECT p.title, p.pub, p.owners[1] AS owner, a.abstract
       FROM display_patents p JOIN display_abstracts a ON a.family = p.family
      WHERE p.pub >= $1 AND p.pub < $2 AND NOT ${b.sql.replaceAll('display_patents.', 'p.')}
        AND lower(a.abstract) ~ $${i} AND NOT lower(a.abstract) ~ $${i + 1}
      ORDER BY md5(p.family) LIMIT 8`,
    [(last - 2) * 10000, (last + 1) * 10000, ...b.params, pg, NON_DISPLAY_TITLE],
  )
  const re = new RegExp(pattern, 'i')
  return {
    keyword,
    terms,
    termsFrom: from,
    tech: rule ? { id: rule.id, name: rule.name } : null,
    years: now?.years ?? abs?.years ?? `${last - 5}~${last - 3} → ${last - 2}~${last}`,
    title: brief(now),
    withAbstract: brief(abs),
    sample: rows.map((r) => ({ title: r.title, year: Math.floor(r.pub / 10000), owner: r.owner ?? '', text: snippet(r.abstract, re) })),
  }
}
