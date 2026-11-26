// 같은 이슈 기사 묶기 — AI 없이 규칙으로 처리한다 (08 개발 계획안 5-2)
// 제목을 글자 2개 단위로 쪼개 겹치는 정도(자카드 유사도)를 본다

// 이 값 이상이면 같은 이슈. 실제 기사(OLED·마이크로LED 200건)로 비교해 0.35로 정함. .env.local에서 바꿀 수 있다
const SIMILARITY = Number(process.env.DEDUPE_SIMILARITY ?? 0.35)
const WINDOW_HOURS = 48 // 이 시간 안에 나온 기사끼리만 묶는다

export function normalizeTitle(title) {
  return title
    .replace(/\[[^\]]*\]|【[^】]*】/g, ' ') // [단독], [포토] 같은 말머리
    .replace(/[^\p{L}\p{N}]+/gu, '') // 문장부호·공백 제거
    .toLowerCase()
}

function bigrams(text) {
  const set = new Set()
  for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2))
  return set
}

function jaccard(A, B) {
  if (A.size === 0 || B.size === 0) return 0
  let common = 0
  for (const g of A) if (B.has(g)) common += 1
  return common / (A.size + B.size - common)
}

// 제목 조각 (같은 제목을 여러 번 비교할 때 한 번만 만들어 둔다)
export function titleGrams(title) {
  return bigrams(normalizeTitle(title))
}

// 같은 이슈인지: 48시간 안 + 제목 조각이 기준 이상 겹침 (groupArticles와 같은 규칙)
export function sameIssue(a, b) {
  return Math.abs(a.time - b.time) <= WINDOW_HOURS * 3600_000 && jaccard(a.grams, b.grams) >= SIMILARITY
}

// 재탕 (11/09 중요도 재설계 · 신규성): 이 이슈보다 MIN_GAP_HOURS 이상 앞서 나온 비슷한 제목이 있으면 「처음 나온 소식」이 아니다
// (48시간 안이면 같은 이슈로 이미 묶였으므로, 그보다 오래된 것만 본다). earlier: [{ time, grams }]
const MIN_GAP_HOURS = WINDOW_HOURS
export function isRerun(item, earlier) {
  return earlier.some((e) => item.time - e.time > MIN_GAP_HOURS * 3600_000 && jaccard(item.grams, e.grams) >= SIMILARITY)
}

// ── 재탕 판정 보강 (11/26, 33 문서 W2: 「첫 소식」이 이슈의 96~98%에 붙어 신규성 10점이 변별력이 없었음) ──
// 글자 두 개 조각 자카드(0.35)는 같은 날 같은 보도를 묶는 데 맞춘 값이라, 며칠 뒤 다른 말로 다시 쓴 기사
// (「우아한청년들, 라이더 방한용품 지원」 ↔ 「우아한청년들, 배민 라이더 500명에 … 안전용품 지원」)를 놓친다.
// 그래서 「드문 낱말이 얼마나 겹치나」를 하나 더 본다: 영문 · 숫자는 낱말, 한글은 낱말 안 두 글자 조각,
// 비교 대상(21일치 제목)에서 드물수록 무게(IDF)를 크게 해 무게 자카드를 잰다. 「삼성」 · 「OLED」처럼 흔한 말만 겹치면 낮다.
// 기준 0.4: 11/26 로컬 DB 21일치(대표 이슈 3,783개)에서 0.4 이상 표본은 대부분 같은 소식의 재보도, 0.25~0.35는 다른 소식이 섞였다.
const RERUN_WEIGHTED = Number(process.env.RERUN_WEIGHTED ?? 0.4)
const STOP = new Set('the a an of to in for and on with at by from is are as its it new how why what after over into vs news says said will more than up out be has have this that'.split(' '))
export function titleTokens(title) {
  const t = String(title ?? '')
    .replace(/\[[^\]]*\]|【[^】]*】|\([^)]*\)/g, ' ')
    .toLowerCase()
  const out = new Set()
  for (const w of t.split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue
    if (/^[a-z0-9]+$/.test(w)) {
      if (w.length >= 2 && !STOP.has(w)) out.add(w)
      continue
    }
    for (let i = 0; i < w.length - 1; i += 1) out.add(w.slice(i, i + 2))
  }
  return out
}

// 무게 자카드로 재탕 찾기. items · earlier에 toks(titleTokens)가 있어야 한다. 낱말 무게는 earlier + items 전체에서 센다
function weightedReruns(items, earlier, gap, out) {
  const all = [...earlier, ...items]
  const df = new Map()
  for (const e of all) for (const g of e.toks ?? []) df.set(g, (df.get(g) ?? 0) + 1)
  const N = all.length
  const idf = (g) => Math.log(N / (df.get(g) ?? 1))
  const weight = (e) => {
    if (e.w == null) {
      let s = 0
      for (const g of e.toks) s += idf(g)
      e.w = s
    }
    return e.w
  }
  const index = new Map()
  earlier.forEach((e, i) => {
    for (const g of e.toks ?? []) {
      const list = index.get(g)
      if (list) list.push(i)
      else index.set(g, [i])
    }
  })
  const shared = new Float64Array(earlier.length)
  for (const item of items) {
    if (out.has(item.id) || !item.toks?.size) continue
    const touched = []
    for (const g of item.toks) {
      const list = index.get(g)
      if (!list || list.length > N * 0.05) continue // 흔한 말(5% 넘는 제목에 있음)은 무게가 작아 건너뜀 — 빠르게
      const w = idf(g)
      for (const i of list) {
        if (shared[i] === 0) touched.push(i)
        shared[i] += w
      }
    }
    const wi = weight(item)
    for (const i of touched) {
      const e = earlier[i]
      const s = shared[i]
      shared[i] = 0
      if (out.has(item.id)) continue
      if (item.time - e.time > gap && s / (wi + weight(e) - s) >= RERUN_WEIGHTED) out.add(item.id)
    }
  }
  for (const e of all) delete e.w
}

// 재탕인 것들의 id를 한 번에 찾는다 (11/16). isRerun을 이슈마다 부르면 이슈 2,700개 × 제목 4,100개를 모두 견줘 3.9초가 걸렸다
// (자료 현황 목록이 3초 걸리던 원인). 제목 조각 → 그 조각이 든 제목 목록(색인)을 만들어, 조각을 하나라도 같이 가진 제목만 센다.
// 겹친 조각 수로 자카드 유사도를 그대로 계산하므로 결과는 isRerun과 같다.
// 11/26: toks(titleTokens)가 있으면 드문 낱말 무게 자카드(RERUN_WEIGHTED)로도 재탕을 찾는다 (W2)
// items: [{ id, time, grams, toks? }] · earlier: [{ time, grams, toks? }]
export function findReruns(items, earlier) {
  const out = findRerunsGrams(items, earlier)
  if (RERUN_WEIGHTED > 0 && RERUN_WEIGHTED <= 1 && items.some((i) => i.toks)) weightedReruns(items, earlier, MIN_GAP_HOURS * 3600_000, out)
  return out
}

function findRerunsGrams(items, earlier) {
  const index = new Map() // 조각 → earlier 안 위치들
  earlier.forEach((e, i) => {
    for (const g of e.grams) {
      const list = index.get(g)
      if (list) list.push(i)
      else index.set(g, [i])
    }
  })
  const gap = MIN_GAP_HOURS * 3600_000
  const common = new Uint16Array(earlier.length)
  const out = new Set()
  for (const item of items) {
    if (item.grams.size === 0) continue
    const touched = []
    for (const g of item.grams) {
      const list = index.get(g)
      if (!list) continue
      for (const i of list) {
        if (common[i] === 0) touched.push(i)
        common[i] += 1
      }
    }
    for (const i of touched) {
      const e = earlier[i]
      const c = common[i]
      common[i] = 0
      if (out.has(item.id)) continue
      if (item.time - e.time > gap && c / (item.grams.size + e.grams.size - c) >= SIMILARITY) out.add(item.id)
    }
  }
  return out
}

export function similarity(a, b) {
  return jaccard(bigrams(normalizeTitle(a)), bigrams(normalizeTitle(b)))
}

// articles에 groupId를 붙여 돌려준다. 대표 기사는 그룹에서 가장 먼저 나온 기사
export function groupArticles(articles) {
  const sorted = [...articles].sort((x, y) => x.publishedAt.localeCompare(y.publishedAt))
  const reps = [] // { article, time, grams }
  const groupOf = new Map()

  for (const a of sorted) {
    const time = Date.parse(a.publishedAt)
    // 제목 조각은 기사마다 한 번만 만든다 (비교할 때마다 다시 만들면 2천여 건에 9초 걸림)
    const grams = bigrams(normalizeTitle(a.title))
    const rep = reps.find(
      (r) => Math.abs(time - r.time) <= WINDOW_HOURS * 3600_000 && jaccard(grams, r.grams) >= SIMILARITY,
    )
    if (rep) {
      groupOf.set(a.id, rep.article.id)
    } else {
      reps.push({ article: a, time, grams })
      groupOf.set(a.id, a.id)
    }
  }
  return articles.map((a) => ({ ...a, groupId: groupOf.get(a.id) }))
}
