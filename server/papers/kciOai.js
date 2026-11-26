// KCI 국내 논문 한 번 채우기 — OAI-PMH (11/26, 29 문서 M12 · 39 문서 3-1)
// - https://open.kci.go.kr/oai/request, 키 없음. 접속 이름(User-Agent)을 밝혀야 웹 방화벽이 열린다 (11/17 실측)
// - from/until은 「KCI가 기록을 고친 날」(datestamp)이라 키워드 · 분야로 고를 수 없다 → 날짜 창을 하루씩 전부 훑고
//   연구분야(전자 · 전기 · 재료 · 물리 등) 또는 디스플레이 말이 든 논문만 남긴다
// - 다음 쪽(resumptionToken)에는 metadataPrefix를 다시 붙여야 한다 — 빼면 KCI가 oai_dc(연도 · 분야가 거친 형식)로 바꿔 준다 (11/26 실측)
// - 이어 받기: 상태(지금 날짜 · 토큰 · 센 수)를 app_settings 'kci_oai'에 쪽마다 저장. 끊겼다가 다시 돌리면 그 쪽부터
// - KCI 서버에 부담을 주지 않게 쪽마다 쉬고(기본 3초), 오류면 늘려 가며 다시 (최대 5번)
// - 남기는 것: 제목 · 저자 · 소속 · 학술지 · 연도 · 초록 · DOI · 링크 · 피인용 (원문은 받지 않음). 표는 kci_papers (papers와 따로)
import { JSDOM } from 'jsdom'
import { dbEnabled, query } from '../db/index.js'
import { getSetting, setSetting } from '../db/store.js'

const BASE = 'https://open.kci.go.kr/oai/request'
const UA = 'TechBrief-KCI-OAI/1.0 (research metadata harvester)'
const PREFIX = 'oai_kci'
const SET = 'ARTI'
const STATE_KEY = 'kci_oai'
export const SOURCE = 'kci-oai' // 행마다 남김 → 되돌리기 한 줄: DELETE FROM kci_papers WHERE source = 'kci-oai'; DELETE FROM app_settings WHERE key = 'kci_oai';
const TIMEOUT_MS = 60_000
const ABSTRACT_MAX = 3_000

// 연구분야(KCI 중분류)로 남기는 곳 — 이름에 이 말이 들면 모두 남김
export const FIELD_RE = /전자|정보통신|전기|재료|금속|세라믹|고분자|물리|반도체|광학|나노|디스플레이|화학공학|에너지공학/
// 그 밖의 분야(공학일반 · 화학 · 과학기술학 등)는 제목 · 초록에 디스플레이 말이 있을 때만
export const TERM_RE =
  /디스플레이|유기\s?발광|발광\s?다이오드|액정\s?(?:표시|소자|패널)|양자점|퀀텀\s?닷|박막\s?트랜지스터|마이크로\s?LED|미니\s?LED|페로브스카이트\s?발광|플렉서블\s?(?:기판|소자|디스플레이)|\b(?:OLED|AMOLED|QD-?OLED|WOLED|LCD|micro-?LED|mini-?LED|quantum[- ]dots?|thin[- ]film transistors?|TFTs?|perovskite light|electroluminescen\w*|LTPO|IGZO|(?:flexible|foldable|rollable|stretchable|transparent|LED|LCD|OLED|head[- ]mounted|holographic|near[- ]eye|AR|VR|XR)\s+displays?|display\s+(?:panels?|devices?|backplanes?|pixels?|technolog\w*))\b/i
// 「display」 하나만으로는 거르지 않는다 — 경영 · 심리 논문의 display rules · 매장 진열이 걸림 (11/26 시험)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ymd = (d) => new Date(d).toISOString().slice(0, 10)
const addDay = (day, n = 1) => ymd(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000)

// ── 받기 ──
export async function fetchPage({ day, token = null }, { retries = 5, delayMs = 3000 } = {}) {
  const u = new URL(BASE)
  u.searchParams.set('verb', 'ListRecords')
  u.searchParams.set('metadataPrefix', PREFIX) // 토큰과 함께도 꼭 (위 설명)
  if (token) u.searchParams.set('resumptionToken', token)
  else {
    u.searchParams.set('set', SET)
    u.searchParams.set('from', day)
    u.searchParams.set('until', day)
  }
  let wait = delayMs
  for (let i = 1; ; i += 1) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) throw new Error(`KCI OAI 응답 ${res.status}`)
      return parsePage(await res.text())
    } catch (err) {
      if (i >= retries) throw err
      console.warn(`[kci-oai] ${day} ${token ? '다음 쪽' : '첫 쪽'} 실패(${err.message}) → ${Math.round(wait / 1000)}초 뒤 다시 (${i}/${retries})`)
      await sleep(wait)
      wait = Math.min(wait * 2, 120_000)
    }
  }
}

// ── 읽기 ── (따로 시험할 수 있게 떼어 둠)
const kid = (el, name) => [...(el?.children ?? [])].find((c) => c.localName === name)
const desc = (el, name) => el?.getElementsByTagNameNS('*', name)?.[0]
const text = (el) => el?.textContent?.trim() ?? ''

export function parsePage(xml) {
  const doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document
  const err = doc.getElementsByTagNameNS('*', 'error')[0]
  if (err) {
    const code = err.getAttribute('code')
    if (code === 'noRecordsMatch') return { records: [], token: null, raw: 0 }
    throw new Error(`KCI OAI 오류 ${code}: ${text(err)}`)
  }
  const recs = [...doc.getElementsByTagNameNS('*', 'record')]
  const token = text(doc.getElementsByTagNameNS('*', 'resumptionToken')[0]) || null
  return { records: recs.map(parseRecord).filter(Boolean), token, raw: recs.length }
}

function parseRecord(r) {
  const header = desc(r, 'header')
  const meta = desc(r, 'oai_kci')
  if (!meta) return null // oai_dc 등 다른 형식은 연도 · 분야가 없어 건너뜀
  const j = desc(meta, 'journalInfo')
  const a = desc(meta, 'articleInfo')
  if (!a) return null
  const titles = [...a.getElementsByTagNameNS('*', 'article-title')]
  const t = (lang) => text(titles.find((x) => x.getAttribute('lang') === lang))
  const abstracts = [...a.getElementsByTagNameNS('*', 'abstract')]
  const ab = (lang) => text(abstracts.find((x) => x.getAttribute('lang') === lang)).slice(0, ABSTRACT_MAX)
  const names = desc(a, 'author-name')
  const authors = names
    ? [...names.children].filter((c) => c.localName === 'author').map((c) => ({ name: text(kid(c, 'name')), affiliation: text(kid(c, 'affiliation')) || null }))
    : [...(desc(a, 'author-group')?.children ?? [])].map((c) => ({ name: text(c).replace(/\s*\(.*\)$/, ''), affiliation: text(c).match(/\(([^)]*)\)$/)?.[1] ?? null }))
  const year = Number(text(kid(j, 'pub-year'))) || null
  const mon = text(kid(j, 'pub-mon')).padStart(2, '0')
  return {
    id: a.getAttribute('article-id') || null,
    oai_id: text(desc(header, 'identifier')) || null,
    datestamp: text(desc(header, 'datestamp')) || null,
    title: t('original') || t('foreign') || t('english') || text(titles[0]),
    title_en: t('english') || null,
    authors: authors.filter((x) => x.name).slice(0, 20),
    journal: text(kid(j, 'journal-name')) || null,
    publisher: text(kid(j, 'publisher-name')) || null,
    category: text(desc(a, 'article-categories')) || null,
    year,
    published: year ? `${year}-${/^(0[1-9]|1[0-2])$/.test(mon) ? mon : '01'}-01` : null,
    abstract: ab('original') || ab('foreign') || null,
    abstract_en: ab('english') || null,
    language: text(desc(a, 'language')) || null,
    doi: text(desc(a, 'doi')).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') || null,
    url: text(desc(a, 'url')) || null,
    cited: Number(text(desc(a, 'citation-count'))) || 0,
  }
}

// 남길지: 연구분야가 맞으면 field, 아니면 제목 · 초록에 디스플레이 말이 있으면 term
export function keepReason(p, { minYear = 0 } = {}) {
  if (!p?.id || !p.title) return null
  if (minYear && (!p.year || p.year < minYear)) return null
  if (p.category && FIELD_RE.test(p.category)) return 'field'
  if (TERM_RE.test(`${p.title} ${p.title_en ?? ''} ${p.abstract ?? ''} ${p.abstract_en ?? ''}`)) return 'term'
  return null
}

// ── 넣기 ──
const COLS = ['id', 'oai_id', 'title', 'title_en', 'authors', 'journal', 'publisher', 'category', 'year', 'published', 'abstract', 'abstract_en', 'language', 'doi', 'url', 'cited', 'matched', 'datestamp', 'source']
async function upsert(rows) {
  if (!rows.length) return 0
  const uniq = [...new Map(rows.map((r) => [r.id, r])).values()]
  const params = []
  const tuples = uniq.map((r) => `(${COLS.map((c) => (params.push(c === 'authors' ? JSON.stringify(r[c]) : r[c]), `$${params.length}`)).join(',')})`)
  await query(
    `INSERT INTO kci_papers (${COLS.join(',')}) VALUES ${tuples.join(',')}
     ON CONFLICT (id) DO UPDATE SET ${COLS.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, fetched_at = now()`,
    params,
  )
  return uniq.length
}

// ── 돌리기 ──
// from ~ until(포함) datestamp를 하루씩. dryRun이면 DB를 건드리지 않고 세기만 (상태도 메모리에만)
// maxRecords: 이만큼 읽으면 멈춤 (시험용). 끝나거나 멈추면 요약을 돌려준다
export async function harvestKci({ from, until = ymd(Date.now()), dryRun = false, delayMs = 3000, minYear = 0, maxRecords = Infinity, fresh = false, log = console.log } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '')) throw new Error('--from YYYY-MM-DD 가 필요해요')
  if (!dryRun && !dbEnabled()) throw new Error('DATABASE_URL이 없어요 (시험만 하려면 --dry-run)')
  const same = (s) => s && s.from === from && s.until === until
  const saved = dryRun || fresh ? null : await getSetting(STATE_KEY, null)
  const st = same(saved) && !saved.done
    ? saved
    : { from, until, day: from, token: null, scanned: 0, kept: 0, pages: 0, byCategory: {}, startedAt: new Date().toISOString(), done: false, error: null }
  if (same(saved) && !saved.done) log(`[kci-oai] 이어 받기: ${st.day}${st.token ? ' (쪽 중간부터)' : ''}, 지금까지 ${st.scanned}건 중 ${st.kept}건`)
  const save = async (patch) => {
    Object.assign(st, patch, { updatedAt: new Date().toISOString() })
    if (!dryRun) await setSetting(STATE_KEY, st)
  }
  const t0 = Date.now()
  let readNow = 0
  try {
    while (st.day <= until) {
      const page = await fetchPage({ day: st.day, token: st.token }, { delayMs })
      const keep = []
      for (const p of page.records) {
        if (p.category) st.byCategory[p.category] = (st.byCategory[p.category] ?? 0) + 1
        const why = keepReason(p, { minYear })
        if (why) keep.push({ ...p, matched: why, source: SOURCE })
      }
      if (!dryRun) await upsert(keep)
      readNow += page.raw
      const next = page.token ? { token: page.token } : { day: addDay(st.day), token: null }
      await save({ ...next, scanned: st.scanned + page.raw, kept: st.kept + keep.length, pages: st.pages + 1, lastKept: keep.slice(0, 3).map((k) => `${k.category ?? '-'} · ${k.title.slice(0, 40)}`) })
      if (st.pages % 20 === 0 || !page.token) log(`[kci-oai] ${page.token ? st.day : addDay(st.day, -1)} · ${st.pages}쪽 · 읽음 ${st.scanned} · 남김 ${st.kept} · ${Math.round((Date.now() - t0) / 1000)}초`)
      if (readNow >= maxRecords) {
        await save({})
        return { ...st, stoppedAt: 'maxRecords', seconds: (Date.now() - t0) / 1000, readNow }
      }
      await sleep(delayMs)
    }
    await save({ done: true, finishedAt: new Date().toISOString() })
    return { ...st, seconds: (Date.now() - t0) / 1000, readNow }
  } catch (err) {
    await save({ error: err.message }).catch(() => {})
    throw err
  }
}

// 관리 페이지 「수집 출처」 한 줄
export async function kciOaiStatus() {
  if (!dbEnabled()) return null
  const st = await getSetting(STATE_KEY, null)
  const { rows } = await query(`SELECT count(*)::int AS n, min(year) AS first, max(year) AS last FROM kci_papers`)
  if (!st && !rows[0].n) return null
  const { byCategory: _c, lastKept: _k, ...rest } = st ?? {}
  return { ...rest, papers: rows[0].n, first: rows[0].first, last: rows[0].last }
}
