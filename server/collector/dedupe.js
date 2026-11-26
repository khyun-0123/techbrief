// 같은 이슈 기사 묶기 — AI 없이 규칙으로 처리한다 (08 개발 계획안 5-2)
// 제목을 글자 2개 단위로 쪼개 겹치는 정도(자카드 유사도)를 본다

import { tune } from '../tunables.js'

// 이 값 이상이면 같은 이슈. 실제 기사(OLED·마이크로LED 200건)로 비교해 0.35로 정함. .env.local(DEDUPE_SIMILARITY)이 처음 값
// 묶는 기간: 이 시간 안에 나온 기사끼리만 묶는다 (48시간)
// → 11/26: 둘 다 관리 페이지 「세부 설정 › 같은 소식 묶기」(server/tunables.js dedupeSimilarity · dedupeHours)
const SIMILARITY = () => tune('dedupeSimilarity')
const WINDOW_MS = () => tune('dedupeHours') * 3600_000

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
  return Math.abs(a.time - b.time) <= WINDOW_MS() && jaccard(a.grams, b.grams) >= SIMILARITY()
}

// 재탕 (11/09 중요도 재설계 · 신규성): 이 이슈보다 묶는 기간(48시간) 넘게 앞서 나온 비슷한 제목이 있으면 「처음 나온 소식」이 아니다
// (48시간 안이면 같은 이슈로 이미 묶였으므로, 그보다 오래된 것만 본다). earlier: [{ time, grams }]
// (재탕 간격 = 묶는 기간)
export function isRerun(item, earlier) {
  const gap = WINDOW_MS()
  const min = SIMILARITY()
  return earlier.some((e) => item.time - e.time > gap && jaccard(item.grams, e.grams) >= min)
}

// 재탕인 것들의 id를 한 번에 찾는다 (11/16). isRerun을 이슈마다 부르면 이슈 2,700개 × 제목 4,100개를 모두 견줘 3.9초가 걸렸다
// (자료 현황 목록이 3초 걸리던 원인). 제목 조각 → 그 조각이 든 제목 목록(색인)을 만들어, 조각을 하나라도 같이 가진 제목만 센다.
// 겹친 조각 수로 자카드 유사도를 그대로 계산하므로 결과는 isRerun과 같다.
// items: [{ id, time, grams }] · earlier: [{ time, grams }]
export function findReruns(items, earlier) {
  const index = new Map() // 조각 → earlier 안 위치들
  earlier.forEach((e, i) => {
    for (const g of e.grams) {
      const list = index.get(g)
      if (list) list.push(i)
      else index.set(g, [i])
    }
  })
  const gap = WINDOW_MS()
  const min = SIMILARITY()
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
      if (item.time - e.time > gap && c / (item.grams.size + e.grams.size - c) >= min) out.add(item.id)
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
  const win = WINDOW_MS()
  const min = SIMILARITY()

  for (const a of sorted) {
    const time = Date.parse(a.publishedAt)
    // 제목 조각은 기사마다 한 번만 만든다 (비교할 때마다 다시 만들면 2천여 건에 9초 걸림)
    const grams = bigrams(normalizeTitle(a.title))
    const rep = reps.find(
      (r) => Math.abs(time - r.time) <= win && jaccard(grams, r.grams) >= min,
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
