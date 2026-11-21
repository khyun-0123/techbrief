// 「예상 밖 급증」 (11/16 조장): 구글 TimesFM이 예상한 1달 앞 범위(10~90%)를 실제 값이 넘은 달을 찾는다.
// - 방식은 구글 BigQuery AI.DETECT_ANOMALIES와 같다 (그 전 달까지만 보고 예상 → 실제가 상한을 넘으면 표시)
// - 6개월 앞 「전망」은 하지 않는다: 우리 데이터 백테스트에서 단순 방법보다 낫지 않았다 (33 문서 「11/16 TimesFM 시험」)
// - 단계 판정에는 넣지 않고 그래프 옆 참고 표시만 (CLAUDE.md 원칙 2)
// - 네이버 데이터랩 숫자를 넣는다: 서버 안에서만 도는 숫자 예측이라 외부로 보내지 않는다. 약관 문제가 되면 TIMESFM=off (23 문서 2-2, 11/16 조장 결정)
// - 실행: 파이썬(~/techbrief-data/timesfm, CPU torch). 한 번에 약 4초 · 메모리 약 3GB라 한 번에 하나씩만 돌리고 결과를 기억한다
// - 파이썬이 없는 곳(다른 배포 환경)에서는 조용히 빠진다 (status: off)
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cacheGet, cachePut } from './papers/index.js'

const PY = () => process.env.TIMESFM_PYTHON || path.join(os.homedir(), 'techbrief-data/timesfm/venv/bin/python')
const SCRIPT = path.resolve('scripts/timesfm_surge.py')
const WINDOW = 24 // 최근 24달을 살핀다
const MIN_MONTHS = 36 // 3년보다 짧으면 하지 않음 (짧은 시계열은 예측이 크게 나빠짐)
const TTL = 30 * 24 * 3600_000
const KEY = 'timesfm-surge1:'

let chain = Promise.resolve()

export function timesfmReady() {
  return process.env.TIMESFM !== 'off' && fs.existsSync(PY())
}

function run(series) {
  return new Promise((resolve, reject) => {
    const child = spawn(PY(), [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000)
    child.stdout.on('data', (b) => (out += b))
    child.stderr.on('data', (b) => (err += b))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`TimesFM 실행 실패 (${code}): ${err.trim().split('\n').at(-1) ?? ''}`))
      try {
        resolve(JSON.parse(out))
      } catch {
        reject(new Error('TimesFM 결과를 읽지 못했어요'))
      }
    })
    child.stdin.end(JSON.stringify({ series, window: WINDOW }))
  })
}

// 한 번에 하나씩 (메모리 약 3GB)
function queued(series) {
  const p = chain.then(() => run(series))
  chain = p.catch(() => {})
  return p
}

// months: [{ t: 'YYYY-MM', v }] (오래된 것부터, 이번 달 제외)
// → { status: 'ok', model, range: [{ t, lo, hi }] 최근 24달 예상 범위, surges: [{ t, v, hi }] 상한을 넘은 달 }
// wait = false: 기억해 둔 값만 바로 돌려주고, 없으면 뒤에서 계산을 걸어 둔다 (status: 'pending' → 다음에 열 때 보임)
const running = new Map()
// 11/21: 기억해 둔 결과는 파이썬이 없어도 보여 준다 (Railway — 파이썬 없이 띄움). 새 계산만 못 한다
//   같은 숫자 묶음일 때만 맞으므로 시계열을 다시 만들면(3~7일) 그 키워드는 다시 「off」가 된다
export async function surgeMonths(months, { wait = true } = {}) {
  if (!Array.isArray(months) || months.length < MIN_MONTHS) return timesfmReady() ? { status: 'short' } : { status: 'off' }
  const key = KEY + crypto.createHash('sha1').update(JSON.stringify(months)).digest('hex')
  const hit = await cacheGet(key).catch(() => null)
  if (hit) return hit
  if (!timesfmReady()) return { status: 'off' }
  if (!running.has(key)) running.set(key, compute(months, key).finally(() => running.delete(key)))
  if (!wait) {
    running.get(key).catch((err) => console.warn(`[timesfm] ${err.message}`))
    return { status: 'pending' }
  }
  return running.get(key)
}

async function compute(months, key) {
  const values = months.map((m) => Number(m.v) || 0)
  const res = await queued([{ id: 'x', values }])
  const points = res.results?.[0]?.points ?? []
  const round = (n) => Math.round(n * 10) / 10
  const range = points.map((p) => ({ t: months[p.i].t, lo: round(p.lo), hi: round(p.hi) }))
  // 상한을 넘은 달. 아주 작은 값의 흔들림(0.3 → 0.6 등)은 빼려고 0.5 이상 차이 날 때만
  const surges = points.filter((p) => values[p.i] > p.hi && values[p.i] - p.hi >= 0.5).map((p) => ({ t: months[p.i].t, v: values[p.i], hi: round(p.hi) }))
  const out = { status: 'ok', model: res.model, range, surges, at: new Date().toISOString() }
  await cachePut(key, out, TTL).catch(() => {})
  return out
}
