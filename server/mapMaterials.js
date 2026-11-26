// 마인드맵 재료 (11/12 조장: 「맵에 들어갈 재료는 미리 최대한 준비해 두고, 맵 팀 결과가 오면 우리 재료로 채워 보완」)
// 지금 맵(related.js)은 뉴스에서 함께 나온 말뿐이라 「가격 · 스마트워치」 같은 일반 말이 섞인다. 우리 DB의 재료를 더한다 — 외부 호출 없음
// - 특허 출원인: 그 기술 특허를 실제로 낸 회사 (디스플레이 특허 DB 또는 전 세계 제목 파일, 최근 6년, 같은 발명 한 번) — 개발 · 소부장 회사가 보인다 (교수님 R10)
// - 논문 핵심어: 우리 논문 DB에서 그 기술 논문의 OpenAlex 핵심어 (2021년~) — 세부 기술이 보인다 (교수님 R8)
// - 논문 낸 기업: 논문 저자 소속 기업
// - 세부 카테고리: 그 기술 특허가 걸친 CPC 카테고리 (displayCategories.js)
// fillMap(뉴스 노드, 재료)은 어떤 맵(지금 임시 맵 · 워드클라우드팀 맵)에도 같은 모양으로 재료를 덧붙인다: 노드 { word, kind, score, src: ['뉴스' | '특허' | '논문'] }
import { dbEnabled, query } from './db/index.js'
import { DISPLAY_CATEGORIES, ownerName } from './displayCategories.js'
import { cacheGet, cachePut } from './papers/index.js'
import { localPatentHistory, patentDbReady, titlePatentHistory, titlesReady } from './patentDb.js'
import { serverFlag } from './features.js'
import { titleExclude } from './techCpc.js'
import { patternFromTerms } from './patents.js'
import { englishTerms, queryKey } from './queryTerms.js'
import { corpusFacts, THIN_MIN } from './timeline.js'

const TTL = 24 * 3600_000
const squash = (s) => String(s ?? '').toLowerCase().replace(/[\s-]+/g, '')
// 약어를 풀어 쓴 말을 같은 말로 본다 (11/12 실측: 「탠덤 OLED」 맵에 organic light-emitting diodes · tandem organic light-emitting diodes가 붙음)
const canon = (s) =>
  squash(s)
    .replace(/organiclightemittingdiodes?|organiclightemitting/g, 'oled')
    .replace(/lightemittingdiodes?/g, 'led')
    .replace(/quantumdots?/g, 'qd')
    .replace(/s$/, '')
// 논문 핵심어 중 너무 넓은 말 (거의 모든 디스플레이 논문에 붙음)
const BROAD_KW = /^(materials? science|optoelectronics|optics|physics|engineering|chemistry|computer science|display|displays?|light|electronics?|nanotechnology|thin film|semiconductor)$/i

export async function mapMaterials(raw, { refresh = false } = {}) {
  const keyword = String(raw ?? '').trim().slice(0, 50)
  if (!keyword) throw Object.assign(new Error('키워드를 입력해 주세요.'), { status: 400 })
  const key = `map-materials:v1:${(await serverFlag('patentSolarExclude').catch(() => false)) ? 'ns:' : ''}${queryKey(keyword)}` // 11/26 W34 스위치마다 따로 기억
  if (!refresh) {
    const hit = await cacheGet(key).catch(() => null)
    if (hit) return { ...hit, cached: true }
  }
  const t = await englishTerms(keyword, { waitMs: 8_000 })
  const empty = { keyword, terms: t.terms, patents: [], papers: [], companies: [], categories: [] }
  if (!t.terms.length) return { ...empty, pending: Boolean(t.pending) } // 영문 검색어를 아직 못 만듦 → 기억하지 않음
  const corpus = await corpusFacts(t.terms).catch(() => null)
  const display = (corpus?.total ?? 0) >= THIN_MIN
  const pattern = patternFromTerms(t.terms)
  const since = (new Date().getFullYear() - 6) * 10000 + 101

  // 특허 출원인 (디스플레이 기술은 디스플레이 특허 DB, 그 밖은 전 세계 제목 파일)
  let pat = null
  let basis = null
  if (pattern) {
    if (display && (await patentDbReady())) [pat, basis] = [await localPatentHistory(pattern, since).catch(() => null), '디스플레이 특허']
    else if (await titlesReady()) [pat, basis] = [await titlePatentHistory(pattern, since).catch(() => null), '전 세계 특허']
    else if (await patentDbReady()) [pat, basis] = [await localPatentHistory(pattern, since).catch(() => null), '디스플레이 특허 안에서만']
  }
  const owners = new Map()
  for (const o of pat?.status === 'ok' ? pat.owners : []) {
    const name = ownerName(o.name)
    if (name) owners.set(name, (owners.get(name) ?? 0) + o.n)
  }
  const patents = [...owners].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word, count]) => ({ word, kind: 'company', count, src: ['특허'] }))

  // 논문 핵심어 · 기업 (2021년~ 두 시기)
  const recent = (corpus?.periods ?? []).filter((p) => p.id !== 'p1')
  const sum = (field) => {
    const m = new Map()
    for (const p of recent) for (const x of p[field] ?? []) m.set(x.name, (m.get(x.name) ?? 0) + x.count)
    return m
  }
  // 디스플레이 근거가 적은 말(전고체 배터리 등)은 디스플레이 논문 DB의 재료가 엉뚱하다 → 논문 재료를 쓰지 않는다 (11/12 실측)
  const own = [...t.terms, keyword].map(canon)
  const isSelf = (w) => own.some((o) => canon(w).includes(o) || o.includes(canon(w))) || /^(oled|led|qd|lcd)(display)?$/.test(canon(w))
  const papers = [...(display ? sum('keywords') : [])]
    .filter(([w, n]) => n >= 3 && !isSelf(w) && !BROAD_KW.test(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word, count]) => ({ word, kind: 'tech', count, src: ['논문'] }))
  const companies = [...(display ? sum('companies') : [])].filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word, count]) => ({ word: ownerName(word), kind: 'company', count, src: ['논문'] }))

  // 세부 카테고리: 그 기술 특허(디스플레이 특허 DB, 최근 6년)가 걸친 CPC 카테고리
  let categories = []
  const ex = pattern ? await titleExclude(pattern) : null // 11/26 W34: 태양전지 · 광검출기 제목 빼기 (스위치)
  if (pattern && dbEnabled() && (await patentDbReady())) {
    const cols = DISPLAY_CATEGORIES.map((c, i) => `count(*) FILTER (WHERE EXISTS (SELECT 1 FROM unnest(cpc) x WHERE x ~ $${i + 3}))::int AS c${i}`).join(', ')
    const { rows } = await query(
      `SELECT count(*)::int AS total, ${cols} FROM display_patents WHERE pub >= $2 AND lower(title) ~ $1${ex ? ` AND NOT lower(title) ~ $${DISPLAY_CATEGORIES.length + 3}` : ''}`,
      [pattern.toLowerCase().replace(/\\b/g, '\\y'), since, ...DISPLAY_CATEGORIES.map((c) => c.cpc), ...(ex ? [ex] : [])],
    ).catch(() => ({ rows: [] }))
    const r = rows[0]
    if (r?.total) categories = DISPLAY_CATEGORIES.map((c, i) => ({ id: c.id, name: c.name, count: r[`c${i}`] })).filter((c) => c.count > 0).sort((a, b) => b.count - a.count)
  }

  const out = { ...empty, display, basis, patentTotal: pat?.status === 'ok' ? pat.years.reduce((a, y) => a + y.n, 0) : null, patents, papers, companies, categories, at: new Date().toISOString() }
  await cachePut(key, out, TTL).catch(() => {})
  return { ...out, cached: false }
}

// 맵 노드에 재료를 덧붙인다. 같은 말이면 출처만 더하고, 새 말은 출처마다 위에서 몇 개씩 넣는다 (뉴스 상위 8개 다음에 특허 3 · 논문 3 → 나머지)
// score: 선 굵기용. 재료 노드는 뉴스 노드 최댓값 기준으로 순위에 따라 줄여 준다 (출처마다 단위가 달라 직접 비교하지 않음)
export function fillMap(baseNodes = [], m = null, { max = 24 } = {}) {
  const base = baseNodes.map((n) => ({ ...n, src: n.src ?? ['뉴스'] }))
  if (!m) return base
  const index = new Map(base.map((n) => [squash(n.word), n]))
  const top = Math.max(...base.map((n) => n.score ?? 0), 6)
  const fresh = { 특허: [], 논문: [] }
  const add = (list, srcName) =>
    list.forEach((x, rank) => {
      const hit = index.get(squash(x.word))
      if (hit) {
        if (!hit.src.includes(srcName)) hit.src = [...hit.src, srcName]
        hit[srcName === '특허' ? 'patents' : 'papers'] = x.count
        return
      }
      const node = { word: x.word, kind: x.kind, score: Math.max(1, Math.round(top * (0.8 - 0.08 * rank))), src: [srcName], [srcName === '특허' ? 'patents' : 'papers']: x.count, broad: false, auto: false } // 11/15: 재료 점은 레버 자동 고르기에서 뺌(점수가 순위로 흉내 낸 값) — 직접 누르면 들어감
      index.set(squash(x.word), node)
      fresh[srcName].push(node)
    })
  add(m.patents ?? [], '특허')
  add([...(m.papers ?? []), ...(m.companies ?? [])], '논문')
  const head = base.slice(0, 8)
  const mixed = [...head, ...fresh.특허.slice(0, 3), ...fresh.논문.slice(0, 3), ...base.slice(8), ...fresh.특허.slice(3), ...fresh.논문.slice(3)]
  return mixed.slice(0, max)
}
