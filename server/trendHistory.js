// 추이 값 기록 (11/08 조장): 요즘 뜨는 기술(techtrends) · 추적 키워드 추이(trends)가 같이 쓴다
// - 받은 값을 tech_trend_values 표에 출처 · 용어 · 종류 · 구간별로 쌓는다 (상태 JSON과 따로)
// - API가 실패하거나 한도에 막혀 값이 없으면 가장 최근 기록을 꺼내 「지난 값 · 언제 받음」으로 쓴다
import { dbEnabled, query } from './db/index.js'

const KEEP_DAYS = 400
const pending = []

// 기록할 값 넣어 두기 (flush 때 한 번에 쓴다)
export function keepValue(source, term, kind, win, value) {
  if (dbEnabled() && value != null) pending.push([source, String(term), kind, win ?? '', value])
}

export async function flushValues() {
  if (!dbEnabled()) return
  while (pending.length) {
    const batch = pending.splice(0, 200)
    const params = []
    const rows = batch.map((v, i) => {
      params.push(v[0], v[1], v[2], v[3], JSON.stringify(v[4]))
      const b = i * 5
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, now())`
    })
    await query(
      `INSERT INTO tech_trend_values (source, term, kind, win, value, fetched_at) VALUES ${rows.join(',')}
       ON CONFLICT (source, term, kind, win) DO UPDATE SET value = EXCLUDED.value, fetched_at = now()`,
      params,
    ).catch((err) => console.warn(`[trend-history] 기록 실패: ${err.message}`))
  }
  await query(`DELETE FROM tech_trend_values WHERE fetched_at < now() - make_interval(days => $1)`, [KEEP_DAYS]).catch(() => {})
}

// 출처 · 용어 · 종류마다 가장 최근 기록 (10분 캐시). prefix로 출처 이름 앞부분을 거른다 (예: 'kw:')
const cache = new Map() // prefix -> { at, rows }
export async function latestValues(prefix = '') {
  if (!dbEnabled()) return []
  const hit = cache.get(prefix)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.rows
  const { rows } = await query(
    `SELECT DISTINCT ON (source, term, kind) source, term, kind, win, value, fetched_at
       FROM tech_trend_values WHERE source LIKE $1 ORDER BY source, term, kind, fetched_at DESC`,
    [`${prefix}%`],
  ).catch(() => ({ rows: [] }))
  cache.set(prefix, { at: Date.now(), rows })
  return rows
}
