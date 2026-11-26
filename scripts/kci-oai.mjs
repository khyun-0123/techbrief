// KCI 국내 논문 한 번 채우기 (server/papers/kciOai.js, 29 문서 M12)
// npm run kci-oai -- --from 2026-11-01 [--until 2026-11-26] [--delay 3000] [--min-year 2015] [--fresh]
// npm run kci-oai -- --from 2026-11-20 --dry-run --max 200   → DB를 건드리지 않고 읽기 · 거르기 · 세기만
// 끊기면 같은 --from/--until로 다시 돌리면 이어 받는다 (--fresh면 처음부터). 진행은 관리 페이지 「수집 대상 › 수집 출처」에도 보인다
import { harvestKci } from '../server/papers/kciOai.js'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const has = (name) => process.argv.includes(`--${name}`)

try {
  const r = await harvestKci({
    from: arg('from'),
    until: arg('until') ?? undefined,
    dryRun: has('dry-run'),
    delayMs: Number(arg('delay', 3000)),
    minYear: Number(arg('min-year', 0)),
    maxRecords: Number(arg('max', Infinity)),
    fresh: has('fresh'),
  })
  const top = Object.entries(r.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 15)
  console.log(`[kci-oai] ${r.done ? '끝' : '멈춤'}${has('dry-run') ? ' (시험 · DB 안 씀)' : ''}: ${r.pages}쪽 · 읽음 ${r.scanned} · 남김 ${r.kept} · ${Math.round(r.seconds)}초 (이번 ${r.readNow}건, 건당 ${(r.seconds / Math.max(1, r.readNow)).toFixed(2)}초)`)
  console.log(`[kci-oai] 연구분야 상위: ${top.map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  if (r.lastKept?.length) console.log(`[kci-oai] 남긴 예: ${r.lastKept.join(' / ')}`)
  process.exit(0)
} catch (err) {
  console.error(`[kci-oai] 실패: ${err.message}`)
  process.exit(1)
}
