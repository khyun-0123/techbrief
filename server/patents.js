// 특허 추이 (Google Patents Public Datasets, BigQuery) — 키워드 추이의 다섯 번째 신호 (23 문서 2-3)
// - 키: 서비스 계정 JSON 파일 (GCP_KEY_FILE, 기본 ./gcp-key.json — git 제외, 권한 600)
// - 한 번 집계에 약 18GB를 읽는다. BigQuery 샌드박스 무료 한도는 월 1TiB → 30일에 한 번만 받아 app_settings에 둔다
// - 영문 제목·공개일 기준 월별 건수. 최근 몇 달은 아직 공개 안 된 출원이 있어 적게 잡힌다
// - 특허는 07 R7상 수집·분석 대상이 아니라 "관련 특허 증가" 신호로만 쓴다
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getSetting, setSetting } from './db/store.js'

const KEY = 'patent_trends'
const REFRESH_MS = 30 * 86_400_000
const SINCE = 20240101 // 2년치

// 키워드 → 영문 제목 정규식 (BigQuery RE2, 소문자 기준). 없는 키워드는 특허 그래프가 빠진다
const PATTERNS = {
  마이크로led: 'micro[ -]?led|μled',
  무기발광: 'micro[ -]?led|μled|quantum[ -]dot electroluminescen',
  '마이크로 디스플레이': 'micro[ -]?display|oledos|oled on silicon|ledos',
  oled: '\\boled\\b|organic light[ -]emitting',
  'qd-oled': 'qd[ -]?oled|quantum[ -]dot organic light',
  폴더블: 'foldable',
  롤러블: 'rollable',
}
export const patentPatternOf = (k) => PATTERNS[String(k).trim().toLowerCase()] ?? null

function readKey() {
  const file = path.resolve(process.env.GCP_KEY_FILE || 'gcp-key.json')
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

async function accessToken(key) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const claim = { iss: key.client_email, scope: 'https://www.googleapis.com/auth/bigquery', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claim)}`
  const jwt = `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), key.private_key).toString('base64url')}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Google 인증 실패: ${data.error_description ?? data.error ?? res.status}`)
  return data.access_token
}

// keywords 중 정규식이 있는 것만 한 번의 쿼리로 월별로 센다
async function queryCounts(key, keywords) {
  return countByPattern(key, keywords.map((k) => ({ keyword: k, pattern: patentPatternOf(k) })).filter((c) => c.pattern))
}

// 기술 트렌드(techtrends.js)용: 아무 용어나 [{ keyword, pattern }]로 받아 한 번의 쿼리로 센다 (약 18GB 읽음)
export async function countPatentsFor(cols) {
  const key = readKey()
  if (!key) throw new Error('Google Cloud 키(gcp-key.json)가 없어요')
  return countByPattern(key, cols)
}

async function countByPattern(key, cols) {
  if (cols.length === 0) return {}
  const select = cols.map((c, i) => `COUNTIF(REGEXP_CONTAINS(LOWER(t.text), r'${c.pattern.replace(/'/g, '')}')) AS k${i}`).join(', ')
  const sql = `SELECT CAST(FLOOR(publication_date / 100) AS INT64) AS ym, ${select}
    FROM \`patents-public-data.patents.publications\`, UNNEST(title_localized) t
    WHERE publication_date >= ${SINCE} AND t.language = 'en' GROUP BY ym ORDER BY ym`
  const token = await accessToken(key)
  const res = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${key.project_id}/queries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 120_000 }),
    signal: AbortSignal.timeout(150_000),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  if (!data.jobComplete) throw new Error('BigQuery 집계가 시간 안에 끝나지 않았어요')
  const series = {}
  cols.forEach((c, i) => {
    series[c.keyword] = (data.rows ?? []).map((r) => {
      const ym = String(r.f[0].v)
      return { t: `${ym.slice(0, 4)}-${ym.slice(4, 6)}-01`, v: Number(r.f[i + 1].v) }
    })
  })
  return series
}

let running = null

// 저장해 둔 값을 바로 준다. 30일이 지났거나 새 키워드가 생겼으면 뒤에서 다시 받는다
export async function getPatentTrends(keywords) {
  const key = readKey()
  if (!key) return { status: 'no_key' }
  const saved = await getSetting(KEY, null)
  const wanted = keywords.filter(patentPatternOf)
  const covers = saved?.series && wanted.every((k) => k in saved.series)
  const stale = !covers || Date.now() - Date.parse(saved.at) > REFRESH_MS
  // 실패한 직후 1시간은 다시 시도하지 않는다 (무료 한도 보호)
  const coolingDown = saved?.errorAt && Date.now() - Date.parse(saved.errorAt) < 3600_000
  if (stale && !running && !coolingDown && wanted.length) {
    running = queryCounts(key, wanted)
      .then((series) => setSetting(KEY, { series, at: new Date().toISOString(), keywords: wanted }))
      .catch((err) => {
        console.warn(`[patents] 특허 추이 받기 실패: ${err.message}`)
        return setSetting(KEY, { ...(saved ?? {}), error: err.message, errorAt: new Date().toISOString() })
      })
      .finally(() => (running = null))
  }
  if (!saved?.series) return { status: running ? 'loading' : 'error', error: saved?.error ?? null, wait: running }
  // 데이터셋의 마지막 달은 일부만 들어 있어(갱신 도중) 크게 줄어 보이므로 뺀다
  const series = Object.fromEntries(Object.entries(saved.series).map(([k, s]) => [k, s.slice(0, -1)]))
  return { status: 'ok', series, at: saved.at }
}
