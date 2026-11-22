// 디스플레이 특허 초록 (11/21): 특허를 제목만이 아니라 초록으로도 찾고, 대표 특허가 무엇을 다루는지 읽을 수 있게
// - 왜: 특허 제목은 「Display device」처럼 넓게 쓰는 일이 많다 (33 문서 W33). 초록에는 그 기술 말이 들어 있다
// - 무엇을: 디스플레이 특허 DB(display_patents)와 같은 기준(디스플레이 CPC 또는 제목)의 발명마다 영어 초록 하나 (가장 먼저 공개된 것)
//   한국 · 일본 공보는 영어 초록이 적지만(11/21 1% 표본: 한국 38% · 일본 28%) 같은 발명의 미국 · 중국 · 국제 출원 초록을 쓴다
// - 받는 법: BigQuery를 한 번 약 260GB 읽는다(초록 칸이 215GB — 칸 전체를 읽어 조건을 달아도 같다, 11/21 dry run).
//   월 무료 1TiB 안이지만 하루 할당량(콘솔 「Query usage per day」, 평소 51.2GiB)을 그날만 0.3TiB로 올려야 한다
//   → 환경변수 PATENT_ABSTRACTS=fetch 가 있을 때만, 서버가 켜지고 2분 뒤 한 번 받는다. 다 받으면 변수를 지운다
// - 받는 도중 끊기면: 다음에 켜질 때 같은 BigQuery 작업 결과를 다시 받는다 (결과는 24시간 남고 읽기는 무료)
// - 저장: Google Patents Public Data는 CC BY 4.0 (23 문서) — 저장 · 가공 가능, 출처 표시
// - 11/22: 세는 방식은 안 바꾸고(12개 기술 비교, 33 문서 W35), 특허를 기사 · 논문처럼 「자료」로 쓴다 (patentMaterials.js)
//   그래서 원문 링크용 대표 공보 번호(pubnum)도 받는다 — PATENT_PUBS=fetch, 약 37GB(하루 한도 51.2GiB 안)
//   찾기 빠르게: 초록 · 제목 전문 검색 색인 (ensureSearchIndex)
import { dbEnabled, query } from './db/index.js'
import { getSetting, setSetting } from './db/store.js'
import { DISPLAY_CPC, SINCE, TITLE_HINT } from './patentDb.js'
import { accessToken, readKey } from './patents.js'
import { checkSource, reportBytes, reportSource } from './sourceGuard.js'

const META = 'patent_abstracts'
const PUBS_META = 'patent_pubs'
const MAX_LEN = 4000 // 아주 긴 초록은 잘라 둔다 (평균 약 850자)
const JOB_KEEP_MS = 23 * 3600_000 // BigQuery 결과는 24시간 남는다

const TABLE = `
CREATE TABLE IF NOT EXISTS display_abstracts (
  family   text PRIMARY KEY,   -- display_patents.family 와 같은 번호
  abstract text NOT NULL       -- 영어 초록 (가장 먼저 공개된 것)
)`

let tableReady = null
async function ensureTable() {
  tableReady ??= query(TABLE + ';\nALTER TABLE display_abstracts ADD COLUMN IF NOT EXISTS pubnum text').catch((err) => {
    tableReady = null
    throw err
  })
  return tableReady
}

// display_patents 와 같은 발명 번호 · 같은 디스플레이 기준. 초록 · 제목 · CPC · 번호 · 날짜 칸만 읽는다
export function abstractsSql() {
  return `WITH p AS (
  SELECT IF(family_id IS NULL OR family_id = '-1', publication_number, family_id) AS fam,
         publication_date AS pub,
         (SELECT a.text FROM UNNEST(abstract_localized) a WHERE a.language = 'en' LIMIT 1) AS ab,
         (SELECT t.text FROM UNNEST(title_localized) t WHERE t.language = 'en' LIMIT 1) AS title,
         EXISTS(SELECT 1 FROM UNNEST(cpc) c WHERE REGEXP_CONTAINS(c.code, r'${DISPLAY_CPC}')) AS dc
    FROM \`patents-public-data.patents.publications\`
   WHERE publication_date >= ${SINCE}),
f AS (
  SELECT fam, LOGICAL_OR(dc) AS dc,
         ARRAY_AGG(title IGNORE NULLS ORDER BY pub LIMIT 1)[SAFE_OFFSET(0)] AS title,
         ARRAY_AGG(ab IGNORE NULLS ORDER BY pub LIMIT 1)[SAFE_OFFSET(0)] AS ab
    FROM p GROUP BY fam)
SELECT fam, ab FROM f
 WHERE ab IS NOT NULL AND (dc OR REGEXP_CONTAINS(LOWER(title), r'${TITLE_HINT}'))`
}

// 발명마다 원문 링크용 공보 번호 하나: 미국 → 국제(WO) → 유럽 → 중국 → 한국 → 일본 → 나머지, 같은 나라면 먼저 공개된 것
// (Google Patents 영어 페이지가 있는 공보를 앞에). 초록 칸을 읽지 않아 약 37GB (11/22 dry run)
export function pubsSql() {
  return `WITH p AS (
  SELECT IF(family_id IS NULL OR family_id = '-1', publication_number, family_id) AS fam,
         publication_number AS pn, country_code AS cc, publication_date AS pub,
         (SELECT t.text FROM UNNEST(title_localized) t WHERE t.language = 'en' LIMIT 1) AS title,
         EXISTS(SELECT 1 FROM UNNEST(cpc) c WHERE REGEXP_CONTAINS(c.code, r'${DISPLAY_CPC}')) AS dc
    FROM \`patents-public-data.patents.publications\`
   WHERE publication_date >= ${SINCE}),
f AS (
  SELECT fam, LOGICAL_OR(dc) AS dc,
         ARRAY_AGG(title IGNORE NULLS ORDER BY pub LIMIT 1)[SAFE_OFFSET(0)] AS title,
         ARRAY_AGG(pn ORDER BY CASE cc WHEN 'US' THEN 0 WHEN 'WO' THEN 1 WHEN 'EP' THEN 2 WHEN 'CN' THEN 3 WHEN 'KR' THEN 4 WHEN 'JP' THEN 5 ELSE 6 END, pub LIMIT 1)[OFFSET(0)] AS pn
    FROM p GROUP BY fam)
SELECT fam, pn FROM f
 WHERE dc OR REGEXP_CONTAINS(LOWER(title), r'${TITLE_HINT}')`
}

// 받는 종류: 초록(새 줄) · 공보 번호(있는 초록 줄에 채움)
const KINDS = {
  abstracts: { meta: META, sql: abstractsSql, label: '디스플레이 특허 초록, 약 260GB', row: (r) => ({ family: r.f[0].v, abstract: String(r.f[1].v ?? '').slice(0, MAX_LEN) }), ok: (r) => r.family && r.abstract, save: upsert },
  pubs: { meta: PUBS_META, sql: pubsSql, label: '대표 공보 번호, 약 37GB', row: (r) => ({ family: r.f[0].v, pubnum: String(r.f[1].v ?? '') }), ok: (r) => r.family && r.pubnum, save: setPubs },
}

const G = (globalThis.__techbriefAbstracts ??= { running: false, got: 0, total: null, error: null })

export async function abstractsStatus() {
  const meta = await getSetting(META, null).catch(() => null)
  const pubs = await getSetting(PUBS_META, null).catch(() => null)
  return {
    pubs: { ready: Boolean(pubs?.at), at: pubs?.at ?? null, rows: pubs?.rows ?? 0, lastError: pubs?.lastError ?? null },
    searchIndex: G.indexing ? 'building' : G.indexed ? 'ready' : G.indexError ? `error: ${G.indexError}` : 'none',
    ready: Boolean(meta?.at),
    at: meta?.at ?? null,
    rows: meta?.rows ?? 0,
    lastBytes: meta?.lastBytes ?? null,
    running: G.running,
    progress: G.running ? { got: G.got, total: G.total } : null,
    lastError: G.error ?? meta?.lastError ?? null,
  }
}

async function upsert(rows) {
  if (!rows.length) return
  await query(
    `INSERT INTO display_abstracts AS d (family, abstract)
     SELECT family, abstract FROM jsonb_to_recordset($1::jsonb) AS x(family text, abstract text)
     ON CONFLICT (family) DO UPDATE SET abstract = EXCLUDED.abstract`,
    [JSON.stringify(rows)],
  )
}

async function setPubs(rows) {
  if (!rows.length) return
  await query(
    `UPDATE display_abstracts d SET pubnum = x.pubnum FROM jsonb_to_recordset($1::jsonb) AS x(family text, pubnum text) WHERE d.family = x.family`,
    [JSON.stringify(rows)],
  )
}

const bq = (key) => `https://bigquery.googleapis.com/bigquery/v2/projects/${key.project_id}`

// 한 번 받기. jobId가 있으면 그 작업 결과만 다시 받는다 (BigQuery 비용 없음)
export const extractAbstracts = (opts = {}) => extractKind('abstracts', opts)
export const extractPubs = (opts = {}) => extractKind('pubs', opts)

async function extractKind(kind, { log = console.log, jobId: resumeJob = null } = {}) {
  const K = KINDS[kind]
  if (!dbEnabled()) throw new Error('DB가 설정되지 않았어요 (DATABASE_URL)')
  const key = readKey()
  if (!key) throw new Error('Google Cloud 키가 없어요 (GCP_KEY_JSON 또는 gcp-key.json)')
  if (G.running) throw new Error('이미 받는 중이에요')
  G.running = true
  G.got = 0
  G.total = null
  G.error = null
  await ensureTable()
  const prev = await getSetting(K.meta, null)
  let token = { value: await accessToken(key), at: Date.now() }
  const auth = async () => {
    if (Date.now() - token.at > 45 * 60_000) token = { value: await accessToken(key), at: Date.now() }
    return { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json' }
  }
  let jobId = resumeJob
  let loc = prev?.jobLoc ?? 'US'
  try {
    if (!jobId) {
      await checkSource('bigquery')
      log(`[abstracts] BigQuery 작업 시작 (${K.label})`)
      const ins = await fetch(`${bq(key)}/jobs`, {
        method: 'POST',
        headers: await auth(),
        body: JSON.stringify({ configuration: { query: { query: K.sql(), useLegacySql: false } } }),
      })
      const job = await ins.json()
      if (job.error) {
        reportSource('bigquery', { ok: false, status: ins.status, error: job.error.message })
        throw new Error(job.error.message)
      }
      jobId = job.jobReference.jobId
      loc = job.jobReference.location
      await setSetting(K.meta, { ...(prev ?? {}), jobId, jobLoc: loc, jobAt: new Date().toISOString(), loading: true, lastError: null })
    } else log(`[abstracts] 끝난 작업 ${jobId}의 결과만 다시 받기 (BigQuery 비용 없음)`)
    let status
    for (let waited = 0; ; waited += 10) {
      if (waited > 2400) throw new Error(`BigQuery 작업이 40분 안에 안 끝났어요 (${jobId})`)
      const r = await fetch(`${bq(key)}/jobs/${jobId}?location=${loc}`, { headers: await auth() })
      status = await r.json()
      if (status.error) throw new Error(status.error.message)
      if (status.status?.state === 'DONE') break
      await new Promise((res) => setTimeout(res, 10_000))
    }
    if (status.status.errorResult) {
      reportSource('bigquery', { ok: false, status: 400, error: status.status.errorResult.message })
      throw new Error(status.status.errorResult.message)
    }
    const bytes = Number(status.statistics?.totalBytesProcessed ?? 0)
    if (!resumeJob) {
      reportSource('bigquery', { ok: true })
      reportBytes('bigquery', bytes)
    }
    log(`[abstracts] 집계 끝 (${(bytes / 1e9).toFixed(1)}GB 읽음, 작업 ${jobId}). 받는 중…`)
    let pageToken = null
    do {
      // 결과 읽기는 요금이 없다
      const url = `${bq(key)}/queries/${jobId}?location=${loc}&maxResults=20000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
      let page
      for (let attempt = 0; ; attempt++) {
        const r = await fetch(url, { headers: await auth(), signal: AbortSignal.timeout(180_000) }).catch((err) => ({ ok: false, err }))
        if (r.ok) {
          page = await r.json()
          break
        }
        if (attempt >= 5) throw new Error(`결과 받기 실패: ${r.err?.message ?? r.status}`)
        await new Promise((res) => setTimeout(res, 5000 * (attempt + 1)))
      }
      G.total = Number(page.totalRows ?? 0) || G.total
      const rows = (page.rows ?? []).map(K.row).filter(K.ok)
      for (let i = 0; i < rows.length; i += 2000) await K.save(rows.slice(i, i + 2000))
      G.got += rows.length
      if (G.got % 200_000 < rows.length || !page.pageToken) log(`[abstracts] ${G.got.toLocaleString()} / ${Number(G.total ?? 0).toLocaleString()}`)
      pageToken = page.pageToken ?? null
    } while (pageToken)
    const { rows: cnt } = await query(kind === 'pubs' ? 'SELECT count(pubnum)::int AS n FROM display_abstracts' : 'SELECT count(*)::int AS n FROM display_abstracts')
    const meta = { at: new Date().toISOString(), rows: cnt[0].n, lastBytes: bytes || prev?.lastBytes || null, jobId, jobLoc: loc, loading: false, lastError: null }
    await setSetting(K.meta, meta)
    log(`[abstracts] 끝: ${kind === 'pubs' ? '공보 번호' : '초록'} ${meta.rows.toLocaleString()}건`)
    return meta
  } catch (err) {
    G.error = err.message
    await setSetting(K.meta, { ...(prev ?? {}), ...(jobId ? { jobId, jobLoc: loc } : {}), loading: false, lastError: err.message, lastErrorAt: new Date().toISOString() }).catch(() => {})
    throw err
  } finally {
    G.running = false
  }
}

// 서버가 켜질 때: PATENT_ABSTRACTS=fetch / PATENT_PUBS=fetch 이고 아직 다 받지 않았으면 한 번 (끊긴 작업이 24시간 안이면 결과만 다시)
// 초록이 있으면 전문 검색 색인도 (없을 때만 한 번 만든다)
export async function fetchAbstractsIfWanted() {
  if (G.running) return null
  for (const [kind, env] of [['abstracts', 'PATENT_ABSTRACTS'], ['pubs', 'PATENT_PUBS']]) {
    if (String(process.env[env] ?? '').trim() !== 'fetch') continue
    const meta = await getSetting(KINDS[kind].meta, null).catch(() => null)
    if (meta?.at) continue // 이미 받음 — 변수를 지우면 됨
    if (kind === 'pubs' && !(await getSetting(META, null).catch(() => null))?.at) continue // 초록 줄에 채우므로 초록 먼저
    const resume = meta?.jobId && meta?.jobAt && Date.now() - Date.parse(meta.jobAt) < JOB_KEEP_MS ? meta.jobId : null
    await extractKind(kind, { jobId: resume }).catch((err) => console.warn(`[abstracts] ${kind} 받기 실패: ${err.message}`))
  }
  await ensureSearchIndex().catch(() => {})
  return null
}

// 전문 검색 색인 (11/22): 특허 자료 찾기(patentMaterials.js)를 1초 안팎으로. 영어 어간(english) 기준, 초록 + 제목
// 처음 한 번 몇 분 걸리고 볼륨을 수백 MB 더 쓴다. 만드는 동안에도 찾기는 된다(느릴 뿐)
export const SEARCH_DOC = "to_tsvector('english', coalesce(abstract, ''))"
export async function ensureSearchIndex() {
  if (G.indexed || G.indexing || !dbEnabled()) return
  const meta = await getSetting(META, null).catch(() => null)
  if (!meta?.at) return
  G.indexing = true
  G.indexError = null
  try {
    const t0 = Date.now()
    await query(`CREATE INDEX IF NOT EXISTS display_abstracts_fts ON display_abstracts USING gin (${SEARCH_DOC})`)
    G.indexed = true
    console.log(`[abstracts] 전문 검색 색인 준비 (${Math.round((Date.now() - t0) / 1000)}초)`)
  } catch (err) {
    G.indexError = err.message
    console.warn(`[abstracts] 전문 검색 색인 실패: ${err.message}`)
  } finally {
    G.indexing = false
  }
}
