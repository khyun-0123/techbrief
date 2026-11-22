// 특허를 「자료」로 (11/22 조장: 「수치보다 특허 정보를 자료로 쓰고 싶다」)
// - 찾기 · 범위 찾기에서 기사 · 논문과 함께 특허도 목록에 나온다 → 선별 → AI 요약(초록 기준) → 보고서 근거 [n]
// - 무엇을: 디스플레이 특허 DB(display_patents, 127만 발명) 중 영어 초록이 있는 120만 건 (display_abstracts, patentAbstracts.js)
// - 찾는 법: 영문 검색어가 초록(전문 검색, 영어 어간) 또는 제목에 있는 발명 (CPC 연결표를 켠 기술은 그 CPC도)
//   초록 · 제목에 태양전지 · 광검출기 말이 있으면 뺀다 (techCpc.js NON_DISPLAY_TITLE — 페로브스카이트 · 탠덤은 태양전지가 많음)
// - 고르는 순서 [우리 판단]: 최근 공개 + 여러 나라에 낸 발명(국제 특허군 — 11/15 팀 회의 「해외 특허가 더 중요」) + 비교 회사(자사 · 경쟁사)
//   + 제목에 검색어 + 초록 일치 정도. 한 출원인은 3건까지 (한 회사 특허로 목록이 차지 않게)
// - 원문: Google Patents (대표 공보 번호, PATENT_PUBS=fetch로 받음). 아직 없으면 제목으로 찾는 Google Patents 주소
// - 출처: Google Patents Public Data (CC BY 4.0, 23 문서)
import { cacheGet, cachePut } from './papers/index.js'
import { dbEnabled, query } from './db/index.js'
import { patentDbReady, toPg } from './patentDb.js'
import { patternFromTerms } from './patents.js'
import { NON_DISPLAY_TITLE, techCpcVersion, techRuleFor, techWhere } from './techCpc.js'
import { compareCompanies } from './keywordBundle.js'
import { SEARCH_DOC, abstractsStatus, ensureTable } from './patentAbstracts.js'
import { createHash } from 'node:crypto'

const LIMIT = 8 // 목록에 넣는 특허 수 (논문 · 기사와 섞여 너무 많지 않게)
const CANDIDATES = 400 // 고르기 전에 읽는 최근 후보
const PER_OWNER = 3
const YEARS = { today: 3, week: 3, all: 5 } // 특허는 하루 · 일주일 안에 거의 없어 넓게 (논문과 같은 생각)
const ABSTRACT_MAX = 2_000
const HIGH = 45 // 「중요」 표시 기준 (기사 · 논문 점수와 같은 눈금)

const likeRe = (like) => new RegExp(`^${like.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i')

export const patentUrl = (pubnum, title) =>
  pubnum ? `https://patents.google.com/patent/${pubnum.replace(/-/g, '')}/en` : `https://patents.google.com/?q=${encodeURIComponent(`"${title}"`)}`

// 출원인 이름: Google이 정리한 대문자 이름을 읽기 쉽게 (예: LG DISPLAY CO LTD → LG Display Co Ltd)
const ownerLabel = (o) =>
  String(o ?? '')
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Lg|Boe|Tcl|Csot|Ltd|Co|Llc|Inc)\b/g, (m) => ({ Lg: 'LG', Boe: 'BOE', Tcl: 'TCL', Csot: 'CSOT' })[m] ?? m)

export async function patentsReady() {
  if (!dbEnabled()) return false
  const st = await abstractsStatus().catch(() => null)
  if (!st?.ready || !(await patentDbReady().catch(() => null))) return false
  await ensureTable()
  return true
}

// query: 사람이 넣은 말(한글일 수 있음) · terms: 영문 검색어 (englishTerms 결과)
export async function searchPatentArticles(queryText, period = 'all', terms = []) {
  const en = (terms ?? []).map((t) => String(t).trim()).filter((t) => t.length >= 3 && /[a-z]/i.test(t)).slice(0, 6)
  if (!en.length || !(await patentsReady())) return { articles: [], note: null }
  const pattern = patternFromTerms(en)
  if (!pattern) return { articles: [], note: null }
  const rule = await techRuleFor([queryText, ...en])
  const last = new Date().getFullYear()
  const from = (last - (YEARS[period] ?? YEARS.all)) * 10000
  const key = `patent-materials:v1:${createHash('sha1').update(JSON.stringify([en, from, rule?.id ?? '', techCpcVersion()])).digest('hex').slice(0, 16)}`
  let rows = await cacheGet(key).catch(() => null)
  if (!rows) {
    const params = [toPg(pattern.toLowerCase()), NON_DISPLAY_TITLE, from, ...en]
    const tsq = en.map((_, i) => `phraseto_tsquery('english', $${4 + i})`).join(' || ')
    const tech = rule ? techWhere(rule, params.length + 1) : null
    if (tech) params.push(...tech.params)
    const t0 = Date.now()
    ;({ rows } = await query(
      `WITH hits AS (
         SELECT family FROM display_abstracts WHERE ${SEARCH_DOC} @@ (${tsq})
         UNION SELECT family FROM display_patents WHERE lower(title) ~ $1 AND pub >= $3
         ${tech ? `UNION SELECT family FROM display_patents WHERE pub >= $3 AND ${tech.sql}` : ''})
       SELECT p.family, p.title, p.pub, p.owners, p.countries, a.abstract, a.pubnum,
              lower(p.title) ~ $1 AS in_title,
              ts_rank_cd(${SEARCH_DOC.replace('abstract', 'a.abstract')}, ${tsq}) AS rank
         FROM hits JOIN display_patents p USING (family) JOIN display_abstracts a USING (family)
        WHERE p.pub >= $3 AND NOT lower(p.title) ~ $2 AND NOT lower(a.abstract) ~ $2
        ORDER BY p.pub DESC LIMIT ${CANDIDATES}`,
      params,
    ))
    if (Date.now() - t0 > 5000) console.warn(`[patents] 특허 자료 찾기 ${Math.round((Date.now() - t0) / 1000)}초 (${en.join(', ')}) — 전문 검색 색인 확인`)
    await cachePut(key, rows, 86_400_000).catch(() => {})
  }
  if (!rows.length) return { articles: [], note: null }

  const { companies } = await compareCompanies().catch(() => ({ companies: [] }))
  const comp = companies.map((c) => ({ ...c, re: (c.like ?? []).map(likeRe) }))
  const companyOf = (owners) => comp.find((c) => owners.some((o) => c.re.some((r) => r.test(o))))
  const maxRank = Math.max(...rows.map((r) => Number(r.rank) || 0), 0.0001)
  const scored = rows.map((r) => {
    const year = Math.floor(r.pub / 10000)
    const c = companyOf(r.owners ?? [])
    const parts = {
      recent: Math.max(0, 20 - (last - year) * 4), // 올해 20 · 해마다 4씩
      intl: (r.countries?.length ?? 0) >= 2 ? 15 : 0,
      company: c ? (c.own ? 15 : 12) : 0,
      title: r.in_title ? 10 : 0,
      match: Math.round(((Number(r.rank) || 0) / maxRank) * 10),
    }
    return { r, c, year, score: Object.values(parts).reduce((a, b) => a + b, 0), parts }
  })
  scored.sort((a, b) => b.score - a.score || b.r.pub - a.r.pub)
  const perOwner = new Map()
  const picked = []
  for (const s of scored) {
    const o = s.r.owners?.[0] ?? ''
    if ((perOwner.get(o) ?? 0) >= PER_OWNER) continue
    perOwner.set(o, (perOwner.get(o) ?? 0) + 1)
    picked.push(s)
    if (picked.length >= LIMIT) break
  }
  const articles = picked.map(({ r, c, year, score, parts }) => {
    const owner = ownerLabel(r.owners?.[0]) || '출원인 미상'
    const date = `${year}-${String(Math.floor(r.pub / 100) % 100).padStart(2, '0')}-${String(r.pub % 100).padStart(2, '0')}`
    const abstract = String(r.abstract ?? '').slice(0, ABSTRACT_MAX)
    return {
      id: `pt-${r.family}`,
      url: patentUrl(r.pubnum, r.title),
      title: r.title,
      description: abstract.slice(0, 300),
      abstract,
      abstractFrom: 'Google Patents',
      access: 'open',
      authors: (r.owners ?? []).slice(0, 4).map(ownerLabel), // 특허는 출원인
      source: `특허 · ${owner}`,
      keyword: String(queryText).trim(),
      publishedAt: new Date(`${date}T00:00:00Z`).toISOString(),
      tier: 1,
      paper: true, // 논문과 같은 길(초록 기준 요약 · 보고서 근거)로 다룬다
      patent: true,
      ...(r.pubnum ? { patentNo: r.pubnum } : {}),
      countries: r.countries ?? [],
      ...(c ? { patentCompany: c.own ? '자사' : c.name } : {}),
      cited: 0,
      relevance: 'high',
      importance: score,
      importanceLevel: score >= HIGH ? 'high' : 'normal',
      patentParts: parts,
      sameIssue: 0,
    }
  })
  const span = `${Math.floor(from / 10000)}년~`
  return { articles, note: `특허 ${articles.length}건 (디스플레이 특허 중 ${span} 「${en.slice(0, 3).join(' · ')}」 ${rows.length >= CANDIDATES ? `${CANDIDATES}건 이상` : `${rows.length}건`}에서 최근 · 여러 나라 출원 · 비교 회사 순, 출처 Google Patents)` }
}
