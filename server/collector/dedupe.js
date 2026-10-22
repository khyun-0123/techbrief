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

export function similarity(a, b) {
  const A = bigrams(normalizeTitle(a))
  const B = bigrams(normalizeTitle(b))
  if (A.size === 0 || B.size === 0) return 0
  let common = 0
  for (const g of A) if (B.has(g)) common += 1
  return common / (A.size + B.size - common)
}

// articles에 groupId를 붙여 돌려준다. 대표 기사는 그룹에서 가장 먼저 나온 기사
export function groupArticles(articles) {
  const sorted = [...articles].sort((x, y) => x.publishedAt.localeCompare(y.publishedAt))
  const reps = [] // { article, time }
  const groupOf = new Map()

  for (const a of sorted) {
    const time = Date.parse(a.publishedAt)
    const rep = reps.find(
      (r) => Math.abs(time - r.time) <= WINDOW_HOURS * 3600_000 && similarity(a.title, r.article.title) >= SIMILARITY,
    )
    if (rep) {
      groupOf.set(a.id, rep.article.id)
    } else {
      reps.push({ article: a, time })
      groupOf.set(a.id, a.id)
    }
  }
  return articles.map((a) => ({ ...a, groupId: groupOf.get(a.id) }))
}
