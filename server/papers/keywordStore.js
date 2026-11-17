// 키워드로 받은 논문 저장 (11/17, 39 문서 3-1 D2 · 41 문서 D2)
// 디스플레이 논문 DB(papers)에 15편 미만인 말(ai 안경 · HBM 등)은 찾을 때마다 OpenAlex에서 받고 6시간 기억 뒤 버렸다
// → 받은 논문을 키워드마다 저장해 다음에 바로 쓰고, 새로 받은 것과 합친다 (지우지 않음 · 쌓임)
// - papers 표에 섞지 않는다: papers는 「디스플레이 주제 논문」이라 기업 저자 비율 · 시계열 · 논문 찾기 범위가 바뀌지 않게 (39 문서 3-1 「문제」)
//   39 문서 제안은 papers.origin 칸이었지만, 기존 질의 6곳을 모두 고치지 않도록 표를 따로 둠
// - 저장하는 것은 OpenAlex · Semantic Scholar · arXiv가 공개하는 서지 · 초록(CC0 · 출처 표시, 23 문서)이라 보관 제한 없음
// - OpenAlex가 막히거나 예산이 떨어지면 저장해 둔 것만으로 답한다
import { createHash } from 'node:crypto'
import { dbEnabled, query } from '../db/index.js'
import { queryKey } from '../queryTerms.js'

const MAX_KEEP = 300 // 한 말에 남기는 논문 수 (최근 것 우선)
const keyOf = (w) => (w.doi ? `doi:${String(w.doi).toLowerCase()}` : `t:${createHash('sha1').update(String(w.title ?? '').toLowerCase()).digest('hex').slice(0, 16)}`)

export async function saveKeywordPapers(rawQuery, works, provider) {
  const q = queryKey(rawQuery)
  const list = (works ?? []).filter((w) => w?.title && !w.retracted && w.provider !== 'kci')
  if (!q || !list.length || !dbEnabled()) return 0
  const params = [q, provider ?? null]
  const tuples = list.map((w) => {
    params.push(keyOf(w), JSON.stringify(w), w.date ? String(w.date).slice(0, 10) : null)
    const n = params.length
    return `($1, $${n - 2}, $${n - 1}::jsonb, $2, $${n}::date)`
  })
  await query(
    `INSERT INTO keyword_papers (query, key, work, provider, published) VALUES ${tuples.join(',')}
     ON CONFLICT (query, key) DO UPDATE SET work = EXCLUDED.work, provider = EXCLUDED.provider, published = EXCLUDED.published, fetched_at = now()`,
    params,
  )
  // 너무 쌓이면 오래된 논문부터 정리 (발행일 기준)
  await query(
    `DELETE FROM keyword_papers WHERE query = $1 AND key IN (
       SELECT key FROM keyword_papers WHERE query = $1 ORDER BY published DESC NULLS LAST OFFSET $2)`,
    [q, MAX_KEEP],
  )
  return list.length
}

// 저장해 둔 논문 (기간 안). 돌려주는 값: works 배열 (keywordPapers와 같은 모양)
export async function storedKeywordPapers(rawQuery, { from, to } = {}) {
  const q = queryKey(rawQuery)
  if (!q || !dbEnabled()) return []
  const { rows } = await query(
    `SELECT work FROM keyword_papers WHERE query = $1 AND ($2::date IS NULL OR published >= $2::date) AND ($3::date IS NULL OR published <= $3::date)
      ORDER BY published DESC NULLS LAST LIMIT $4`,
    [q, from ?? null, to ?? null, MAX_KEEP],
  )
  return rows.map((r) => r.work)
}

// 관리 · 문서용: 키워드마다 저장된 수
export async function keywordPaperStats() {
  if (!dbEnabled()) return []
  const { rows } = await query(`SELECT query, count(*)::int AS n, max(fetched_at) AS at FROM keyword_papers GROUP BY query ORDER BY n DESC`)
  return rows
}
