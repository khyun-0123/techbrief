// 논문 원문 가져오기 (11/10 조장: 논문 전문을 여러 방법으로 받아 요약) — 「요약하기」 · 선별 때 쓴다
// 순서 (무료로 열린 원문만, 유료벽 · 접속 차단은 넘지 않는다):
//   1. OpenAlex가 알려 준 오픈 액세스 주소(oa_url) — 디스플레이 논문 DB 기준 약 44% (11/10 실측 23,086 / 51,946)
//      .pdf 주소가 웹 페이지를 주면(Nature, 11/10 실측) 같은 주소의 웹 페이지 본문으로
//   2. 같은 논문의 다른 열린 사본 (OpenAlex 논문 1건 조회는 무료): PubMed Central · 대학 저장소 · 프리프린트 등
//      Wiley pdfdirect는 이 서버를 403으로 막는다 (11/10 실측) → 다른 사본이 있을 때만 읽힌다
//      PubMed Central 사본이 있으면 Europe PMC 공식 원문 API(fullTextXML)로 읽는다 (PMC 페이지는 그대로 읽히지 않음, 11/10 실측)
//   3. arXiv PDF (DOI가 10.48550/arXiv.… 이거나 주소가 arxiv.org)
//   4. Semantic Scholar의 openAccessPdf (키가 있으면 1초 1회)
// PDF면 unpdf로 글자를 뽑고, 웹 페이지면 기사 원문과 같은 방식(Readability)으로 읽는다
// 요약에는 전부가 아니라 앞부분(초록) · 서론 · 결론 · 그림 설명만 골라 넣는다 (맥미니 입력 16k 안, 1편 수십 초)
// 원문 저장은 지금처럼 「선별 추가」한 논문만 (11/06 결정, summarize.js select). 받은 곳 · 라이선스를 함께 남긴다
import { fetchBody } from '../collector/fulltext.js'
import { safeFetch } from '../safeFetch.js'
import { openAlexGet } from './providers.js'

const MAX_PDF = 25 * 1024 * 1024
const TIMEOUT_MS = 45_000 // Europe PMC는 30초 넘게 걸리기도 함 (11/10 실측)
const UA = 'Mozilla/5.0 (techbrief paper reader)'
export const PAPER_BODY_MAX = 10_000

const cache = (globalThis.__paperText ??= new Map()) // 6시간
const CACHE_MS = 6 * 3600_000

function tidy(t) {
  return String(t ?? '')
    .replace(/-\n(?=[a-z])/g, '') // 줄 끝 하이픈으로 끊긴 낱말
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function pdfText(buf) {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buf))
  const { text } = await extractText(pdf, { mergePages: true })
  return tidy(text)
}

// 앞부분 · 서론 · 결론 · 그림 설명만 (제목 낱말은 학술지마다 달라 넉넉히)
export function pickSections(text) {
  const t = String(text ?? '')
  if (t.length <= PAPER_BODY_MAX) return t
  const at = (re) => {
    const m = re.exec(t)
    return m ? m.index : -1
  }
  // PDF는 줄바꿈이 없이 이어지는 경우가 많아 문장 끝(. ) 뒤의 제목도 본다. 결론이 없으면 Discussion (Nature 계열 형식)
  const heading = (words) => new RegExp(`(?:^|\\n|[.!?]\\s)\\s*(?:\\d+\\.?\\d*\\.?|[IVX]+\\.)?\\s*(?:${words})\\b`, 'gi')
  const refs = [...t.matchAll(/(?:\n|[.!?]\s)\s*(?:References|Bibliography|Acknowledg(?:e)?ments?)\b/gi)].map((m) => m.index).pop() ?? -1 // 마지막 것 (본문 속 「references」 낱말 피함)
  const before = (idx) => idx > 0 && (refs < 0 || idx < refs)
  const last = (re) => [...t.matchAll(re)].map((m) => m.index).filter(before).pop() ?? -1
  const intro = at(/(?:^|\n|[.!?]\s)\s*(?:\d+\.?|I\.)?\s*Introduction\b/i)
  const concl = [last(heading('Conclusions?|Summary and outlook|Outlook')), last(heading('Discussion'))].find((i) => i > intro) ?? -1
  const parts = []
  parts.push(t.slice(0, intro > 0 ? Math.min(intro, 2_500) : 2_500)) // 제목 · 초록
  if (intro > 0) parts.push(t.slice(intro, intro + 3_000))
  if (concl > 0) parts.push(t.slice(concl, refs > concl ? Math.min(refs, concl + 3_000) : concl + 3_000))
  const captions = [...t.matchAll(/(?:\n|[.!?]\s)\s*((?:Fig(?:ure)?\.?)\s*\d+[.:|]\s[^\n]{20,250}?(?:[.!?](?=\s)|$))/gim)].map((m) => m[1].trim()).slice(0, 8)
  if (captions.length) parts.push(`[그림 설명]\n${captions.join('\n')}`)
  return parts.join('\n\n…\n\n').slice(0, PAPER_BODY_MAX)
}

async function fromUrl(url) {
  if (!url || !/^https?:\/\//.test(url)) return null
  const res = await safeFetch(url, { headers: { 'User-Agent': UA, Accept: 'application/pdf,application/xml,text/html' }, signal: AbortSignal.timeout(TIMEOUT_MS) }, { maxBytes: MAX_PDF })
  if (!res.ok) return null
  const type = res.headers.get('content-type') ?? ''
  if (/europepmc\/webservices\/rest\/PMC\d+\/fullTextXML/.test(url) && type.includes('xml')) {
    const text = jatsText(res.buffer.toString('utf8'))
    return text.length > 3_000 ? { text, kind: 'xml' } : null
  }
  if (type.includes('pdf')) {
    const text = await pdfText(res.buffer)
    return text.length > 1_000 ? { text, kind: 'pdf' } : null
  }
  if (type.includes('html')) {
    const text = await fetchBody(url) // Readability. 유료벽 페이지는 대개 초록만 → 길이로 거른다
    return text && text.length > 3_000 ? { text, kind: 'html' } : null
  }
  return null
}

const arxivPdf = (paper) => {
  const id = String(paper.doi ?? '').match(/10\.48550\/arxiv\.(.+)$/i)?.[1] ?? String(paper.url ?? '').match(/arxiv\.org\/(?:abs|pdf)\/([^?#]+)/i)?.[1]
  return id ? `https://arxiv.org/pdf/${id.replace(/\.pdf$/i, '')}` : null
}

// 같은 논문의 열린 사본들 (OpenAlex 논문 1건 조회 · 무료). PMC 번호가 있으면 Europe PMC 원문 API 주소를 맨 앞에
async function oaLocations(paper) {
  const id = paper.openalexId || (paper.doi ? `doi:${paper.doi}` : null)
  if (!id) return []
  try {
    const w = await openAlexGet(`/works/${encodeURIComponent(id)}?select=locations,ids`)
    // OpenAlex는 PMC 번호를 「…/pmc/articles/11829008」처럼 숫자만 준다 (11/10 실측)
    const pmcNo = String(w.ids?.pmcid ?? '').match(/(?:PMC)?(\d+)\/?$/)?.[1]
    const pmcid = pmcNo ? `PMC${pmcNo}` : null
    const urls = (w.locations ?? []).filter((l) => l.is_oa).flatMap((l) => [l.pdf_url, l.landing_page_url]).filter(Boolean)
    return [...(pmcid ? [`https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`] : []), ...urls.filter((u) => !/ncbi\.nlm\.nih\.gov/.test(u))]
  } catch {
    return []
  }
}

// Europe PMC JATS XML → 글 (절 제목은 줄을 바꿔 남겨 서론 · 결론을 찾을 수 있게, 그림 설명은 「Figure n.」으로)
function jatsText(xml) {
  return tidy(
    String(xml)
      .replace(/<ref-list[\s\S]*?<\/ref-list>/g, ' ')
      .replace(/<fig\b[^>]*>[\s\S]*?<label>([^<]*)<\/label>[\s\S]*?<caption>([\s\S]*?)<\/caption>[\s\S]*?<\/fig>/g, '\n$1. $2\n')
      .replace(/<title>/g, '\n\n')
      .replace(/<\/(title|p|abstract)>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/ *\n */g, '\n'),
  )
}

async function s2Pdf(doi) {
  if (!doi) return null
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY
  try {
    const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=openAccessPdf`, {
      headers: { 'User-Agent': UA, ...(key ? { 'x-api-key': key } : {}) },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    return (await res.json()).openAccessPdf?.url || null
  } catch {
    return null
  }
}

// paper: { doi, oaUrl, url } → { body, from, url } 또는 null (열린 원문 없음)
export async function paperFullText(paper) {
  const key = paper.doi || paper.url
  const hit = key && cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const tries = [
    ['오픈 액세스', async () => [paper.oaUrl, paper.oaUrl?.replace(/\.pdf$/i, '')]],
    ['다른 열린 사본', () => oaLocations(paper)],
    ['arXiv', async () => [arxivPdf(paper)]],
    ['Semantic Scholar', async () => [await s2Pdf(paper.doi)]],
  ]
  let value = null
  const seen = new Set()
  const hostOf = (u) => new URL(u).hostname.replace(/^www\./, '')
  const candidates = []
  for (const [from, get] of tries) for (const url of (await get()) ?? []) if (url && /^https?:\/\//.test(url)) candidates.push([from, url])
  for (const [from, url] of candidates) {
    if (seen.has(url)) continue
    seen.add(url)
    // 외부 사본 이름: 저장소 주소를 붙여 어디서 읽었는지 보이게 (예: 다른 열린 사본 · pmc.ncbi.nlm.nih.gov)
    const label = from === '다른 열린 사본' ? `${from} · ${hostOf(url)}` : from
    try {
      const got = await fromUrl(url)
      if (process.env.PAPER_TEXT_DEBUG) console.log(`[paper-text] ${label} ${url} → ${got ? `${got.kind} ${got.text.length}자` : '못 읽음'}`)
      if (got) {
        value = { body: pickSections(got.text), from: `${label} ${{ pdf: 'PDF', xml: '원문 XML', html: '웹 페이지' }[got.kind]}`, url, length: got.text.length }
        break
      }
    } catch (err) {
      console.warn(`[paper-text] ${label} 실패 (${url}): ${err.message}`)
    }
  }
  if (key) cache.set(key, { value, at: Date.now() })
  if (cache.size > 300) cache.delete(cache.keys().next().value)
  return value
}
