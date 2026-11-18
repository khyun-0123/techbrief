// ScienceON(KISTI) 국내 논문 찾기 (11/18) — 키는 .env.local SCIENCEON_CLIENT_ID · SCIENCEON_API_KEY · SCIENCEON_MAC
// - 공식 「ScienceON API Gateway 매뉴얼 v2.6」 · 공식 Node 예제 기준 (공용 서버 ~/scienceon-sample)
// - 토큰: accounts = AES-256-CBC(키 = API key, IV 고정값 — 공식 예제) 로 {datetime, mac_address}를 암호화 → URL용 base64
//   MAC은 신청 때 등록한 값 그대로 「42-01-0A-B2-00-02」 꼴(대시 · 대문자). 다르면 E4006 · E4107 (11/18 실측)
//   접속 토큰 2시간 · 갱신 토큰 2주 → 메모리에만 두고 만료 5분 전에 갱신 토큰으로 다시 받는다
// - 신청한 IP에서만 된다 (GCP 고정 IP <GCP 고정 IP>). 나가는 IP가 고정되지 않는 곳(Railway)에서는 SCIENCEON_MAC을 넣지 않아 조용히 빠진다
// - 이용 조건 (매뉴얼 「이용범위 · 서비스 이용제한」, 23 문서 11/18):
//   · 화면이 동작할 때 그때그때 부르는 방식(매시업)만 — 사람이 「찾기」를 누를 때만 부르고, 자동 수집 · 미리 받기를 하지 않는다
//   · 받은 자료를 모아 별도 DB를 만들지 않는다 → 저장하지 않는다 (keywordStore에서도 뺀다)
//   · 게재할 때 출처 KISTI 표시 필수 → 결과마다 「초록 출처: KISTI ScienceON」
//   · 원문(FulltextURL)은 받지 않고 제목 · 저자 · 초록 · 링크만
import crypto from 'node:crypto'
import { JSDOM } from 'jsdom'
import { guardedFetch } from '../sourceGuard.js'

const BASE = 'https://apigateway.kisti.re.kr'
const IV = 'jvHJ1EFA0IXBrxxz' // 공식 예제의 고정값 (비밀 아님, 「iv의 값은 변하지 않습니다」)
const TIMEOUT_MS = 15_000
const MARGIN_MS = 5 * 60_000
export const SCIENCEON_SOURCE = 'KISTI ScienceON'

export const scienceonReady = () => Boolean(process.env.SCIENCEON_CLIENT_ID && process.env.SCIENCEON_API_KEY && process.env.SCIENCEON_MAC)

const DB_LABEL = { JAKO: '국내 학술지', JAFO: '해외 학술지', CFKO: '국내 학술대회', CFFO: '해외 학술대회', DIKO: '학위논문' }

const tok = (globalThis.__scienceonToken ??= { access: null, accessExp: 0, refresh: null, refreshExp: 0, pending: null })

// "2026-11-18 21:42:17.502" (한국 시각) → ms
const kstTime = (s) => Date.parse(`${String(s ?? '').trim().replace(' ', 'T')}+09:00`) || 0

function accounts() {
  const d = new Date(Date.now() + 9 * 3600_000)
  const datetime = d.toISOString().slice(0, 19).replace(/\D/g, '') // yyyyMMddHHmmss (한국 시각)
  const plain = JSON.stringify({ datetime, mac_address: process.env.SCIENCEON_MAC.trim() })
  const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(process.env.SCIENCEON_API_KEY, 'utf8'), Buffer.from(IV, 'utf8'))
  return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

async function requestToken(background) {
  const u = new URL(`${BASE}/tokenrequest.do`)
  const useRefresh = tok.refresh && tok.refreshExp - MARGIN_MS > Date.now()
  if (useRefresh) u.searchParams.set('refresh_token', tok.refresh)
  else u.searchParams.set('accounts', accounts())
  u.searchParams.set('client_id', process.env.SCIENCEON_CLIENT_ID)
  const res = await guardedFetch('scienceon', u, { signal: AbortSignal.timeout(TIMEOUT_MS) }, { background })
  const j = await res.json().catch(() => ({}))
  if (!j.access_token) {
    if (useRefresh) {
      // 갱신 토큰이 거절되면 한 번은 처음부터 다시 받는다
      tok.refresh = null
      return requestToken(background)
    }
    throw new Error(`ScienceON 토큰: ${j.errorCode ?? res.status} ${j.errorMessage ?? ''}`.trim())
  }
  tok.access = j.access_token
  tok.accessExp = kstTime(j.access_token_expire)
  if (j.refresh_token) {
    tok.refresh = j.refresh_token
    tok.refreshExp = kstTime(j.refresh_token_expire)
  }
  return tok.access
}

async function accessToken(background) {
  if (tok.access && tok.accessExp - MARGIN_MS > Date.now()) return tok.access
  tok.pending ??= requestToken(background).finally(() => (tok.pending = null))
  return tok.pending
}

// query: 찾을 말 (한글 그대로). from · to: YYYY-MM-DD (발행일로 거름)
// → [{ title, titleEn, authors, journal, date, abstract, doi, url, provider: 'scienceon', access: 'unknown', abstractFrom }]
export async function searchScienceon(query, { from = null, to = null, limit = 20, background = false } = {}) {
  if (!scienceonReady()) return []
  const q = String(query).trim().slice(0, 100)
  if (!q) return []
  const call = async () => {
    const u = new URL(`${BASE}/openapicall.do`)
    u.searchParams.set('client_id', process.env.SCIENCEON_CLIENT_ID)
    u.searchParams.set('token', await accessToken(background))
    u.searchParams.set('version', '1.0')
    u.searchParams.set('action', 'search')
    u.searchParams.set('target', 'ARTI')
    // 전체 칸(BI) · 정확도순으로 한 번에 최대 100건을 받아 기간으로 거른다 (11/18 실측으로 고름):
    // - 논문명(TI)은 「OLED 수명」처럼 두 말이 제목에 붙어 있지 않으면 0편
    // - 발행일순(sortField=pubyear)은 본문 어딘가에만 말이 있는 관련 없는 논문이 앞에 옴
    u.searchParams.set('searchQuery', JSON.stringify({ BI: q }))
    u.searchParams.set('curPage', '1')
    u.searchParams.set('rowCount', '100')
    u.searchParams.set('exclude', 'FulltextURL,MobileURL')
    const res = await guardedFetch('scienceon', u, { signal: AbortSignal.timeout(TIMEOUT_MS) }, { background })
    if (!res.ok) throw new Error(`ScienceON 응답 ${res.status}`)
    return res.text()
  }
  let xml = await call()
  if (/E4\d{3}/.test(xml) && /token|토큰/i.test(xml)) {
    // 토큰이 서버 쪽에서 먼저 끝난 경우 한 번만 새로 받아 다시
    tok.access = null
    xml = await call()
  }
  const fromMs = from ? Date.parse(from) : -Infinity
  const toMs = to ? Date.parse(to) + 86_400_000 : Infinity
  // 같은 논문이 학회지 · 학술대회 등 여러 DB에 있어 제목이 같으면 한 번만 (11/18 실측)
  const seen = new Set()
  return parseScienceon(xml)
    .filter((w) => !w.date || (Date.parse(w.date) >= fromMs && Date.parse(w.date) < toMs))
    .filter((w) => {
      const k = w.title.toLowerCase().replace(/\s+/g, ' ')
      return seen.has(k) ? false : (seen.add(k), true)
    })
    .slice(0, limit)
}

// ScienceON 응답 XML → 논문 목록 (따로 시험할 수 있게 떼어 둠)
export function parseScienceon(xml) {
  const doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document
  const records = [...doc.querySelectorAll('recordList > record')]
  if (!records.length) {
    const code = doc.querySelector('errorCode, statusCode')?.textContent?.trim()
    const msg = doc.querySelector('errorMessage, statusMessage')?.textContent?.trim()
    if (code && !/^(200|0+)$/.test(code)) throw new Error(`ScienceON: ${code} ${msg ?? ''}`.trim())
    return []
  }
  return records.map((r) => {
    const get = (code) => r.querySelector(`item[metaCode="${code}"]`)?.textContent?.trim() ?? ''
    const pd = get('Pubdate').replace(/\D/g, '')
    const year = get('Pubyear') || pd.slice(0, 4)
    const mon = pd.slice(4, 6)
    const day = pd.slice(6, 8)
    const date = /^\d{4}$/.test(year) ? `${year}-${/^(0[1-9]|1[0-2])$/.test(mon) ? mon : '01'}-${/^(0[1-9]|[12]\d|3[01])$/.test(day) ? day : '01'}` : null
    const doi = get('DOI').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') || null
    return {
      title: get('Title') || get('Title2'),
      titleEn: get('Title2'),
      authors: get('Author').split(/[;,]/).map((a) => a.trim()).filter(Boolean).slice(0, 6),
      journal: get('JournalName').split(' = ')[0] || get('Publisher') || DB_LABEL[get('DBCode')] || '',
      date,
      abstract: get('Abstract'),
      doi,
      url: get('ContentURL') || (doi ? `https://doi.org/${doi}` : null),
      cited: 0,
      provider: 'scienceon',
      access: 'unknown',
      abstractFrom: SCIENCEON_SOURCE,
    }
  }).filter((w) => w.title)
}
