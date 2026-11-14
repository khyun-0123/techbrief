// 디스플레이 특허 DB + 전 세계 특허 제목 파일 (11/12, 33 문서 7장 D3 · 6장 W6 · W7 · W18)
// 왜: 기술 시계열이 특허를 셀 때마다 BigQuery로 전 세계 특허 영문 제목을 다 읽었다 (한 번 약 26GB, 하루 할당량 50GiB).
//   BigQuery는 조건(WHERE)을 달아도 칸 전체를 읽어 키워드마다 비용이 같다 (CPC로 좁혀도 21.9GB, dry run).
//   → 한 번만 훑어(42.3GB) ① 디스플레이 특허는 우리 DB(display_patents)에, ② 전 세계 특허 제목은 서버 디스크 파일에 두고 여기서 센다
//   (같은 칸을 읽으므로 ①만 받을 때와 ①+② 받을 때 읽는 양이 같다, 11/12 dry run 42.3GB)
// ① 디스플레이 특허: 2010년 이후 공개 특허 중 디스플레이 관련 CPC가 하나라도 붙었거나 영문 제목에 디스플레이 말이 든 것 (번호 · 날짜 · 출원인 · CPC · 나라 · 제목)
// ② 제목 파일: 2010년 이후 영문 제목이 있는 모든 특허 (제목 · 첫 공개 연월 · 같은 발명 번호 · 출원인 5곳까지). 디스플레이 밖 키워드용
//   PostgreSQL에 넣지 않는 이유: 수천만 줄 + 색인이면 15GB 안팎인데 DB 디스크는 공용 서버라 여유가 적다 (11/12 53GB). 파일은 /home(여유 700GB 이상)
//   위치는 프로젝트 폴더 밖 (PATENT_TITLES_DIR, 기본 ~/techbrief-data) — 폴더 안이면 개발 서버(Vite)가 그대로 내려 줄 수 있다
//   찾기는 grep -P (1,000만 줄 0.72GB에 0.66초, 11/12 실측) → 키워드 하나 약 5초, BigQuery 0GB
// 세는 단위: 같은 발명(패밀리)은 한 줄 — 나라마다 따로 공개된 것 · 공개 · 등록 공보를 한 번만 (OECD Patent Statistics Manual 2009의 패밀리 단위 집계)
//   연도는 패밀리의 첫 공개일. OECD 매뉴얼은 발명 시점으로 우선일을 권하지만, 우선일은 공개까지 18개월이 걸려 최근 2년이 크게 모자라
//   「최근 3년 대 그 앞 3년」 비교가 늘 감소로 나온다 → 첫 공개일을 쓰고, 우선일은 DB에 저장만 해 둔다 (33 문서 [응용])
// 다시 받기: 공개 표가 분기마다 갱신되므로(IFI 안내) 분기에 한 번 전부 다시 (일부만 받아도 읽는 양이 같아 늘 전부)
// 출처: Google Patents Public Datasets (IFI CLAIMS, CC BY 4.0) — 화면에 출처 표시 (23 문서)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dbEnabled, query } from './db/index.js'
import { getSetting, setSetting } from './db/store.js'
import { accessToken, readKey } from './patents.js'
import { checkSource, reportBytes, reportSource } from './sourceGuard.js'

const META = 'patent_db'
export const SINCE = 20100101

// 디스플레이 CPC (33 문서 3장 표에 같은 목록과 근거). 코드 뜻은 CPC 분류표 정의
// H10K(유기 소자, 유기 태양전지 H10K30 · 39 제외) · H05B33 · H01L27/32 · H01L51/5(예전 OLED 코드) · H01L33 · H10H(LED) · H01L25/075 · H01L27/15(LED 배열)
// G09G(표시 제어) · G09F9(가변 정보 표시 장치) · G02F1/13(액정) · G02F1/16(전기 영동 · 전자종이) · H01L27/12 · H01L29/786 · H10D86 · H10D30/67(TFT)
// G02B27/01(HUD · 머리 착용 표시) · G02B30(3D) · G03H1(홀로그래피) · C09K11(발광 재료 · 양자점) · G06F3/0412(표시 일체형 터치)
// G06F1/1652 · H04M1/0268(접는 · 휘는 화면 기기) · H01J11 · H01J17/49(PDP)
export const DISPLAY_CPC =
  '^(H10K(1|[5-9])|H05B33|H01L27/32|H01L51/5|H01L33|H10H|H01L25/075|H01L27/15|G09G|G09F9|G02F1/1[36]|H01L27/12|H01L29/786|H10D86|H10D30/67|G02B27/01|G02B30|G03H1|C09K11|G06F3/0412|G06F1/1652|H04M1/0268|H01J11|H01J17/49)'
// CPC가 안 붙었어도 제목으로 넣는 말 (CPC가 놓친 것을 재기 위해 표시: cpc가 빈 줄)
const TITLE_HINT =
  'display|\\boled|organic light[\\s-]?emitting|liquid crystal|micro[\\s-]?led|quantum[\\s-]?dot|electroluminescen|thin[\\s-]?film transistor|electrophoretic|e-paper|electronic paper'

const TABLE = `
CREATE TABLE IF NOT EXISTS display_patents (
  family    text PRIMARY KEY,            -- 패밀리 번호 (없으면 공보 번호)
  pub       integer NOT NULL,            -- 첫 공개일 YYYYMMDD
  pd        integer,                     -- 가장 이른 우선일 YYYYMMDD (저장만)
  title     text,                        -- 영문 제목 (패밀리에서 가장 먼저 공개된 것)
  owners    text[] NOT NULL DEFAULT '{}',-- 출원인 (Google 정리 이름)
  cpc       text[] NOT NULL DEFAULT '{}',-- 위 디스플레이 CPC 중 붙은 것 (빈 배열 = 제목으로만 들어옴)
  countries text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS display_patents_pub_idx ON display_patents (pub);
`

let tableReady = null
async function ensureTable() {
  tableReady ??= (async () => {
    await query(TABLE)
    // 제목 정규식 찾기를 빠르게 (pg_trgm은 DB 주인이 켤 수 있는 확장). 못 켜도 순서대로 읽어 찾는다
    try {
      await query('CREATE EXTENSION IF NOT EXISTS pg_trgm')
      await query('CREATE INDEX IF NOT EXISTS display_patents_title_trgm ON display_patents USING gin (lower(title) gin_trgm_ops)')
    } catch (err) {
      console.warn(`[patent-db] 제목 색인 없이 씀: ${err.message}`)
    }
  })().catch((err) => {
    tableReady = null
    throw err
  })
  return tableReady
}

// 한 번 훑어 같은 발명으로 묶고, 디스플레이 표시(disp)를 붙여 둘 다 돌려준다. 디스플레이가 아닌 줄은 나라 · 우선일 · CPC를 빼서 받는 양을 줄인다
export function extractSql() {
  return `WITH p AS (
  SELECT IF(family_id IS NULL OR family_id = '-1', publication_number, family_id) AS fam,
         publication_date AS pub, NULLIF(priority_date, 0) AS pd, country_code AS cc,
         (SELECT t.text FROM UNNEST(title_localized) t WHERE t.language = 'en' LIMIT 1) AS title,
         ARRAY(SELECT a.name FROM UNNEST(assignee_harmonized) a WHERE a.name IS NOT NULL) AS who,
         ARRAY(SELECT DISTINCT REGEXP_EXTRACT(c.code, r'^[A-H]\\d\\d[A-Z]\\d+/\\d+') FROM UNNEST(cpc) c
                WHERE REGEXP_CONTAINS(c.code, r'${DISPLAY_CPC}')) AS dcpc
    FROM \`patents-public-data.patents.publications\`
   WHERE publication_date >= ${SINCE}),
f AS (
  SELECT fam, MIN(pub) pub, MIN(pd) pd, ARRAY_AGG(DISTINCT cc) cc,
         ARRAY_AGG(title IGNORE NULLS ORDER BY pub LIMIT 1)[SAFE_OFFSET(0)] title,
         ARRAY_CONCAT_AGG(who) who, ARRAY_CONCAT_AGG(dcpc) cpc
    FROM p GROUP BY fam),
g AS (SELECT *, ARRAY_LENGTH(cpc) > 0 OR REGEXP_CONTAINS(LOWER(title), r'${TITLE_HINT}') AS disp FROM f)
SELECT fam, pub, IF(disp, pd, NULL) pd, IF(disp, cc, []) cc, title,
       ARRAY(SELECT DISTINCT w FROM UNNEST(who) w LIMIT 5) who, IF(disp, cpc, []) cpc, disp
  FROM g WHERE disp OR title IS NOT NULL`
}

const bq = (key) => `https://bigquery.googleapis.com/bigquery/v2/projects/${key.project_id}`

// BigQuery 결과 한 줄 → DB 한 줄 (배열은 { v: [{ v }] } 꼴)
const arr = (cell) => [...new Set((cell?.v ?? []).map((x) => x.v).filter(Boolean))]
const toRow = (r) => ({
  family: r.f[0].v,
  pub: Number(r.f[1].v),
  pd: r.f[2].v == null ? null : Number(r.f[2].v),
  countries: arr(r.f[3]),
  title: r.f[4].v ?? null,
  owners: arr(r.f[5]),
  cpc: arr(r.f[6]),
  disp: r.f[7] ? r.f[7].v === true || r.f[7].v === 'true' : true, // 예전 꼴(칸 7개)은 모두 디스플레이
})

async function upsert(rows) {
  if (!rows.length) return
  await query(
    `INSERT INTO display_patents AS p (family, pub, pd, title, owners, cpc, countries)
     SELECT family, pub, pd, title, owners, cpc, countries
       FROM jsonb_to_recordset($1::jsonb) AS x(family text, pub int, pd int, title text, owners text[], cpc text[], countries text[])
     ON CONFLICT (family) DO UPDATE SET
       pub = LEAST(p.pub, EXCLUDED.pub),
       pd = LEAST(p.pd, EXCLUDED.pd),
       title = CASE WHEN EXCLUDED.pub < p.pub AND EXCLUDED.title IS NOT NULL THEN EXCLUDED.title ELSE COALESCE(p.title, EXCLUDED.title) END,
       owners = ARRAY(SELECT DISTINCT unnest(p.owners || EXCLUDED.owners)),
       cpc = ARRAY(SELECT DISTINCT unnest(p.cpc || EXCLUDED.cpc)),
       countries = ARRAY(SELECT DISTINCT unnest(p.countries || EXCLUDED.countries))`,
    [JSON.stringify(rows)],
  )
}

export const titlesDir = () => process.env.PATENT_TITLES_DIR || path.join(os.homedir(), 'techbrief-data')
export const titlesFile = () => path.join(titlesDir(), 'patent_titles.tsv')
// 제목 파일 한 줄: 소문자 제목 \t 첫 공개 연월(YYYYMM) \t 같은 발명 번호 \t 출원인(대문자, | 로 이음)
// 제목만 소문자라 소문자 정규식은 다른 칸(숫자 · 대문자)에 걸리지 않는다
const titleLine = (r) =>
  `${String(r.title).toLowerCase().replace(/[\t\r\n]+/g, ' ')}\t${String(r.pub).slice(0, 6)}\t${r.family}\t${r.owners.map((o) => o.toUpperCase().replace(/[\t|]/g, ' ')).join('|')}\n`

// 뽑기: 2010년부터 전부 (분기에 한 번). 사람이 스크립트로만 돌린다 (scripts/patent-db.mjs) — 한 번 42GB라 하루 할당량 대부분을 쓰기 때문
// jobId: 이미 끝난 BigQuery 작업의 결과만 다시 받는다 (결과는 24시간 남고 읽기는 무료). 받는 도중 끊겼을 때 다시 집계하지 않으려고
//   예전 꼴(디스플레이 특허만, disp 칸 없음)이면 DB만 채우고 제목 파일은 그대로 둔다
export async function extractDisplayPatents({ log = console.log, jobId: resumeJob = null } = {}) {
  if (!dbEnabled()) throw new Error('DB가 설정되지 않았어요 (DATABASE_URL)')
  const key = readKey()
  if (!key) throw new Error('Google Cloud 키(gcp-key.json)가 없어요')
  await ensureTable()
  const prev = await getSetting(META, null)
  let token = { value: await accessToken(key), at: Date.now() }
  const auth = async () => {
    if (Date.now() - token.at > 45 * 60_000) token = { value: await accessToken(key), at: Date.now() }
    return { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json' }
  }
  let jobId = resumeJob
  let loc = 'US'
  if (!jobId) {
    await checkSource('bigquery')
    log(`[patent-db] BigQuery 작업 시작 (공개일 ${SINCE}부터, 디스플레이 특허 DB + 전체 제목 파일)`)
    const ins = await fetch(`${bq(key)}/jobs`, {
      method: 'POST',
      headers: await auth(),
      body: JSON.stringify({ configuration: { query: { query: extractSql(), useLegacySql: false } } }),
    })
    const job = await ins.json()
    if (job.error) {
      reportSource('bigquery', { ok: false, status: ins.status, error: job.error.message })
      throw new Error(job.error.message)
    }
    jobId = job.jobReference.jobId
    loc = job.jobReference.location
  } else log(`[patent-db] 끝난 작업 ${jobId}의 결과만 받기 (BigQuery 비용 없음)`)
  // 끝날 때까지 기다린다
  let status
  for (let waited = 0; ; waited += 10) {
    if (waited > 1800) throw new Error(`BigQuery 작업이 30분 안에 안 끝났어요 (${jobId})`)
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
  let displayOnly = null // 첫 쪽의 칸 이름으로 정함
  if (!resumeJob) reportSource('bigquery', { ok: true })
  const bytes = Number(status.statistics?.totalBytesProcessed ?? 0)
  if (!resumeJob) reportBytes('bigquery', bytes) // 결과만 다시 받을 때는 이미 셈
  log(`[patent-db] 집계 끝 (${(bytes / 1e9).toFixed(1)}GB 읽음, 작업 ${jobId}). 받는 중…`)
  await setSetting(META, { ...(prev ?? {}), loading: true, loadingSince: new Date().toISOString(), jobId })
  // 제목 파일은 임시 이름으로 쓰고 다 받은 뒤 바꾼다 (도중에 실패해도 예전 파일이 남음)
  fs.mkdirSync(titlesDir(), { recursive: true })
  const part = `${titlesFile()}.part`
  const out = fs.createWriteStream(part)
  const write = (text) => (out.write(text) ? null : new Promise((res) => out.once('drain', res)))
  let pageToken = null
  let got = 0
  let titled = 0
  const titleYears = {} // 제목 파일 해마다 건수 (분야 전체 = 전 세계 특허, 분야 대비 증가용)
  let maxPub = 0
  try {
    do {
      // 결과 읽기는 요금이 없다 (요금은 처음 집계에서 읽은 양만)
      const url = `${bq(key)}/queries/${jobId}?location=${loc}&maxResults=50000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
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
      if (displayOnly === null) {
        displayOnly = !(page.schema?.fields ?? []).some((f) => f.name === 'disp')
        if (displayOnly) log('[patent-db] 디스플레이 특허만 든 결과 → DB만 채우고 제목 파일은 그대로 둔다')
      }
      const rows = (page.rows ?? []).map(toRow)
      if (displayOnly) for (const r of rows) r.disp = true
      const disp = rows.filter((r) => r.disp)
      for (let i = 0; i < disp.length; i += 2000) await upsert(disp.slice(i, i + 2000))
      let chunk = ''
      for (const r of rows) {
        if (r.pub > maxPub) maxPub = r.pub
        if (!r.title || displayOnly) continue
        chunk += titleLine(r)
        titled += 1
        const y = Math.floor(r.pub / 10000)
        titleYears[y] = (titleYears[y] ?? 0) + 1
      }
      await write(chunk)
      got += rows.length
      if (got % 1_000_000 < rows.length || !page.pageToken) log(`[patent-db] ${got.toLocaleString()} / ${Number(page.totalRows).toLocaleString()}`)
      pageToken = page.pageToken ?? null
    } while (pageToken)
    await new Promise((res, rej) => out.end((err) => (err ? rej(err) : res())))
    if (displayOnly) fs.rmSync(part, { force: true })
    else fs.renameSync(part, titlesFile())
  } catch (err) {
    out.destroy()
    fs.rmSync(part, { force: true })
    await setSetting(META, { ...(prev ?? {}), loading: false, lastError: err.message, lastErrorAt: new Date().toISOString() })
    throw err
  }
  const { rows: cnt } = await query('SELECT count(*)::int AS n, count(*) FILTER (WHERE cardinality(cpc) = 0)::int AS title_only FROM display_patents')
  const titles = displayOnly
    ? { titles: prev?.titles ?? 0, titlesBytes: prev?.titlesBytes ?? null, titleYears: prev?.titleYears ?? null }
    : { titles: titled, titlesBytes: fs.statSync(titlesFile()).size, titleYears }
  const meta = { at: new Date().toISOString(), since: SINCE, maxPub, rows: cnt[0].n, titleOnly: cnt[0].title_only, ...titles, families: got, lastBytes: bytes, jobId, loading: false }
  const size = titles.titlesBytes ?? 0
  await setSetting(META, meta)
  ready = null
  log(`[patent-db] 끝: 디스플레이 패밀리 ${meta.rows.toLocaleString()}건 (제목으로만 들어온 것 ${meta.titleOnly.toLocaleString()}), 제목 파일 ${meta.titles.toLocaleString()}줄 (${(size / 1e9).toFixed(2)}GB), 마지막 공개일 ${maxPub}`)
  return meta
}

let ready = null
// 다 받은 적이 있으면 그 정보, 없으면 null (기술 시계열은 그때 예전처럼 BigQuery로)
export async function patentDbReady() {
  if (!dbEnabled()) return null
  if (ready && Date.now() - ready.checked < 10 * 60_000) return ready.meta
  const meta = await getSetting(META, null).catch(() => null)
  const ok = meta?.at && meta.rows > 0 ? meta : null
  ready = { meta: ok, checked: Date.now() }
  return ok
}

// BigQuery(RE2) 정규식 → PostgreSQL 정규식: 단어 경계 \b → \y (나머지 (?:) · \s · [] 는 같음)
const toPg = (pattern) => pattern.replace(/\\b/g, '\\y')

// 기술 시계열용: patents.js patentHistory와 같은 꼴 { status, years: [{ y, n }], owners: [{ y, name, n }] }
// 차이: 공보가 아니라 패밀리(같은 발명 한 번) · 첫 공개 연도 · 디스플레이 특허 안에서만
export async function localPatentHistory(pattern, since = SINCE) {
  const meta = await patentDbReady()
  if (!meta) return { status: 'no_db' }
  await ensureTable()
  const { rows } = await query(
    // intl (11/15 팀 회의 「해외 특허가 더 중요할 수 있다」): 같은 발명을 2개 나라(관청) 이상에 낸 특허 수 — 국제 특허군 지표
    `WITH m AS (SELECT family, pub / 10000 AS y, owners, countries FROM display_patents WHERE pub >= $2 AND lower(title) ~ $1)
     SELECT y, NULL::text AS name, count(*)::int AS n, 1 AS total, count(*) FILTER (WHERE cardinality(countries) >= 2)::int AS intl FROM m GROUP BY y
     UNION ALL
     SELECT y, o, count(*)::int, 0, 0 FROM m, unnest(m.owners) o GROUP BY y, o HAVING count(*) >= 2`,
    [toPg(pattern.toLowerCase()), Number(since)],
  )
  const years = rows.filter((r) => r.total === 1).map((r) => ({ y: Number(r.y), n: r.n, intl: r.intl })).sort((a, b) => a.y - b.y)
  const owners = rows.filter((r) => r.total === 0).map((r) => ({ y: Number(r.y), name: r.name, n: r.n }))
  return { status: 'ok', years, owners, fieldYears: await displayFieldYears(meta), db: { at: meta.at, maxPub: meta.maxPub } }
}

// 특허 분야 전체(디스플레이 특허 DB 전부)의 해마다 건수 — 분야 대비 증가용 (받은 날이 같으면 기억)
let fieldCache = null
async function displayFieldYears(meta) {
  if (fieldCache?.at === meta.at) return fieldCache.years
  const { rows } = await query('SELECT pub / 10000 AS y, count(*)::int AS n FROM display_patents GROUP BY 1 ORDER BY 1')
  fieldCache = { at: meta.at, years: rows.map((r) => ({ y: Number(r.y), n: r.n })) }
  return fieldCache.years
}

// ── 제목 파일 찾기 (디스플레이 밖 키워드) ──
// 있으면 그 정보, 없으면 null
export async function titlesReady() {
  const meta = await patentDbReady()
  if (!meta?.titles) return null
  try {
    fs.accessSync(titlesFile(), fs.constants.R_OK)
    return meta
  } catch {
    return null
  }
}

// 공용 서버라 한 번에 하나씩, 낮은 우선순위(nice)로 찾는다
let titleQueue = Promise.resolve()
export function titlePatentHistory(pattern, since = SINCE) {
  const run = titleQueue.then(() => grepTitles(pattern, since))
  titleQueue = run.catch(() => {})
  return run
}

async function grepTitles(pattern, since) {
  const meta = await titlesReady()
  if (!meta) return { status: 'no_titles' }
  const fromYm = Math.floor(Number(since) / 100)
  const years = new Map()
  const owners = new Map()
  let buf = ''
  // 정규식은 RE2(BigQuery)와 PCRE가 같은 꼴만 쓴다 ((?:) · \s · \b · []). 제목만 소문자라 소문자 정규식은 제목에만 걸린다
  const child = spawn('nice', ['-n', '10', 'grep', '-P', pattern.toLowerCase(), titlesFile()], { env: { ...process.env, LC_ALL: 'C' } })
  const take = (line) => {
    const [, ym, , who] = line.split('\t')
    const n = Number(ym)
    if (!n || n < fromYm) return
    const y = Math.floor(n / 100)
    years.set(y, (years.get(y) ?? 0) + 1)
    for (const o of (who ?? '').split('|')) if (o) owners.set(`${y}\t${o}`, (owners.get(`${y}\t${o}`) ?? 0) + 1)
  }
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8')
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const l of lines) take(l)
  })
  let stderr = ''
  child.stderr.on('data', (d) => (stderr += d))
  const timer = setTimeout(() => child.kill(), 90_000)
  const code = await new Promise((res) => child.on('close', res))
  clearTimeout(timer)
  if (buf) take(buf)
  // grep: 0 = 찾음, 1 = 없음, 그 밖 = 오류 (정규식 잘못 · 시간 초과)
  if (code !== 0 && code !== 1) throw new Error(`특허 제목 찾기 실패: ${stderr.trim().slice(0, 160) || `종료 ${code}`}`)
  return {
    status: 'ok',
    years: [...years].map(([y, n]) => ({ y, n })).sort((a, b) => a.y - b.y),
    fieldYears: meta.titleYears ? Object.entries(meta.titleYears).map(([y, n]) => ({ y: Number(y), n })) : null,
    owners: [...owners].filter(([, n]) => n >= 2).map(([k, n]) => ({ y: Number(k.split('\t')[0]), name: k.split('\t')[1], n })),
    db: { at: meta.at, maxPub: meta.maxPub },
  }
}

// 관리 페이지 「운영」 · /api/health
export async function patentDbStatus() {
  const meta = await getSetting(META, null).catch(() => null)
  if (!meta) return { ready: false }
  return {
    ready: Boolean(meta.at && meta.rows),
    at: meta.at ?? null,
    rows: meta.rows ?? 0,
    titleOnly: meta.titleOnly ?? 0,
    titles: meta.titles ?? 0,
    titlesBytes: meta.titlesBytes ?? null,
    maxPub: meta.maxPub ?? null,
    loading: Boolean(meta.loading),
    lastBytes: meta.lastBytes ?? null,
    lastError: meta.lastError ?? null,
  }
}
