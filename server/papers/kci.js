// KCI(한국학술지인용색인, 한국연구재단) 국내 논문 찾기 (11/17, 39 문서 D1) — 키는 .env.local KCI_API_KEY
// - 요청: https://open.kci.go.kr/po/openapi/openApiSearch.kci?apiCode=articleSearch&key=…&title=…&displayCount(최대 100)
//   (11/17 키 없이 불러 「필수 요청 파라미터가 없음 => key」로 주소 확인. 받는 값은 KCI 포털 openDataView dtstSeqNo=1)
// - 응답은 XML: outputData/record → journalInfo(journal-name · pub-year · pub-mon) · articleInfo(article-id, article-title · author-group · abstract-group · doi · url · citation-count)
// - 한도 · 저장 · AI 입력 조건은 공식 페이지에 안 적힘 (23 문서 「조사 · 미확인」) → 제목 · 저자 · 초록 · 링크만 쓰고 원문은 받지 않는다
// - 키가 없으면 조용히 빠진다 (kciReady)
import { JSDOM } from 'jsdom'
import { guardedFetch } from '../sourceGuard.js'

const URL_BASE = 'https://open.kci.go.kr/po/openapi/openApiSearch.kci'
const TIMEOUT_MS = 15_000

export const kciReady = () => Boolean(process.env.KCI_API_KEY)

const txt = (el, sel) => el?.querySelector(sel)?.textContent?.trim() ?? ''

// query: 찾을 말 (한글 그대로 — 국내 학술지라 한글 제목이 많다). from · to: YYYY-MM-DD (발행년월로 거름)
// → [{ title, titleEn, authors, journal, date, abstract, doi, url, cited, provider: 'kci', access: 'unknown' }]
export async function searchKci(query, { from = null, to = null, limit = 20, background = false } = {}) {
  if (!kciReady()) return []
  const u = new URL(URL_BASE)
  u.searchParams.set('apiCode', 'articleSearch')
  u.searchParams.set('key', process.env.KCI_API_KEY)
  u.searchParams.set('title', String(query).trim().slice(0, 100))
  u.searchParams.set('displayCount', String(Math.min(100, Math.max(1, limit))))
  if (from) u.searchParams.set('dateFrom', from.slice(0, 7).replace('-', ''))
  if (to) u.searchParams.set('dateTo', to.slice(0, 7).replace('-', ''))
  const res = await guardedFetch('kci', u, { signal: AbortSignal.timeout(TIMEOUT_MS) }, { background })
  if (!res.ok) throw new Error(`KCI 응답 ${res.status}`)
  return parseKci(await res.text())
}

// KCI 응답 XML → 논문 목록 (따로 시험할 수 있게 떼어 둠)
export function parseKci(xml) {
  const doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document
  const msg = txt(doc, 'outputData > result > resultMsg')
  const records = [...doc.querySelectorAll('outputData > record')]
  if (!records.length && msg && !/정상|success/i.test(msg)) throw new Error(`KCI: ${msg}`)
  return records.map((r) => {
    const titles = [...r.querySelectorAll('article-title')]
    const pick = (lang) => titles.find((t) => t.getAttribute('lang') === lang)?.textContent?.trim() ?? ''
    const abstracts = [...r.querySelectorAll('abstract-group abstract, abstract')]
    const abs = (lang) => abstracts.find((a) => a.getAttribute('lang') === lang)?.textContent?.trim() ?? ''
    const year = txt(r, 'journalInfo pub-year')
    const mon = txt(r, 'journalInfo pub-mon').padStart(2, '0')
    const cited = Number(r.querySelector('citation-count')?.getAttribute('kci') ?? r.querySelector('citation-count')?.textContent) || 0
    return {
      title: pick('original') || pick('foreign') || pick('english') || titles[0]?.textContent?.trim() || '',
      titleEn: pick('english'),
      authors: [...r.querySelectorAll('author-group author')].map((a) => a.textContent.trim().replace(/\s*\(.*\)$/, '')).filter(Boolean).slice(0, 6),
      journal: txt(r, 'journalInfo journal-name'),
      date: year ? `${year}-${/^\d{2}$/.test(mon) && mon !== '00' ? mon : '01'}-01` : null,
      abstract: abs('original') || abs('english') || abstracts[0]?.textContent?.trim() || '',
      doi: txt(r, 'doi') || null,
      url: txt(r, 'url') || null,
      cited,
      provider: 'kci',
      access: 'unknown',
    }
  }).filter((w) => w.title)
}
