// KCI(한국학술지인용색인, 한국연구재단) 국내 논문 찾기 (11/17, 39 문서 D1) — 키는 .env.local KCI_API_KEY
// - 요청: https://open.kci.go.kr/po/openapi/openApiSearch.kci?apiCode=articleSearch&key=…&title=…&displayCount(최대 100)&sortNm=pubiYr&sortDir=desc
//   (공식 「KCI Open API Service 활용가이드」 11/17 조장 공유: title 필수 · dateFrom/dateTo YYYYMM · sortNm title|author|pubiYr · 오류 「등록되지 않은 key 입니다.」 「사용기간이 종료되었습니다.」)
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
  u.searchParams.set('sortNm', 'pubiYr') // 제목에 검색어가 든 논문 중 최근 것부터 (관련도 정렬은 없음)
  u.searchParams.set('sortDir', 'desc')
  if (from) u.searchParams.set('dateFrom', from.slice(0, 7).replace('-', ''))
  if (to) u.searchParams.set('dateTo', to.slice(0, 7).replace('-', ''))
  const res = await guardedFetch('kci', u, { signal: AbortSignal.timeout(TIMEOUT_MS) }, { background })
  if (!res.ok) throw new Error(`KCI 응답 ${res.status}`)
  return parseKci(await res.text()).slice(0, limit) // KCI는 10건보다 적게 달라고 해도 10건을 줌 (11/17 실측)
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

// ── OAI-PMH (11/17 조사, 아직 쓰지 않음) ──
// https://open.kci.go.kr/oai/request — 키 없이 전체 논문 메타데이터(oai_kci: 학술지 · 제목 · 저자 · 초록 · 연구분야 · 피인용)를 받는 통로
// - 기본 접속 이름(curl)은 KCI 웹 방화벽이 막음(400), 이름을 밝히면 열림 (11/17 실측)
// - from/until은 「KCI가 기록을 고친 날」(datestamp)이라 한 주(11/9~16)에 184,001건 · 분야 순서로 나옴 → 키워드로 고를 수 없어 전부 훑어야 함 (한 쪽 100건 약 4초)
// - 그래서 키워드별 미리 모으기는 위 Open API(키)로 하고, OAI-PMH는 데모 뒤 「연구분야(공학 > 전자 · 재료 · 물리) 한 번 채우기」 후보 (39 문서 3-1)
