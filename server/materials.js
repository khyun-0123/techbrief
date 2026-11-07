// 직접 추가한 자료 (11/07 결정, 27 문서 3장): 링크 · DOI · 텍스트 · 파일(PDF·텍스트·HTML)
// - 수집 기사와 달리 21일 정리 대상이 아니다. 지울 때까지 남아 자료 현황에서 다시 찾을 수 있다
// - 본문은 materials.body에 둔다. 요약·보고서는 getArticleText()로 이 본문을 읽는다 (db/store.js)
// - aiAllowed=false면 AI 요약·보고서에 넣지 않는다 (유료 보고서 등 계약상 AI 입력이 안 되는 자료)
import { randomUUID } from 'node:crypto'
import { Readability } from '@mozilla/readability'
import { JSDOM, VirtualConsole } from 'jsdom'
import { dbEnabled, query } from './db/index.js'

const MAX_TEXT = 200_000 // 저장하는 본문 길이(글자)
const MAX_FILE = 10 * 1024 * 1024 // 올릴 수 있는 파일 크기
const TIMEOUT_MS = 15_000
const UA = 'Mozilla/5.0 (techbrief material import)'
const memory = new Map() // DB가 없을 때 (서버를 끄면 비워짐)

const KIND_LABEL = { link: '링크', doi: '논문(DOI)', text: '텍스트', file: '파일' }

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

function tidy(text) {
  return String(text ?? '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((l) => l.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_TEXT)
}

function excerptOf(body) {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat
}

function parseHtml(html, url) {
  const dom = new JSDOM(html, { url: url || 'https://example.invalid/', virtualConsole: new VirtualConsole() })
  const doc = dom.window.document
  const meta = (name) => doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content')?.trim()
  const ogTitle = meta('og:title')
  const site = meta('og:site_name')
  const published = meta('article:published_time') || meta('pubdate') || meta('date')
  const parsed = new Readability(doc).parse()
  dom.window.close()
  return {
    title: ogTitle || parsed?.title || '',
    source: site || parsed?.siteName || '',
    body: tidy(parsed?.textContent ?? ''),
    publishedAt: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : null,
  }
}

async function fromLink(url) {
  if (!/^https?:\/\//i.test(url ?? '')) throw fail('http:// 또는 https://로 시작하는 주소를 넣어 주세요.')
  let res
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/pdf' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw fail('주소를 열지 못했어요. 주소가 맞는지, 로그인이 필요한 페이지인지 확인해 주세요.', 502)
  }
  if (!res.ok) throw fail(`페이지를 가져오지 못했어요 (응답 ${res.status}).`, 502)
  const type = res.headers.get('content-type') ?? ''
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_FILE) throw fail('페이지가 너무 커요.', 413)
  const host = new URL(res.url || url).hostname.replace(/^www\./, '')
  if (type.includes('pdf')) {
    const pdf = await pdfText(buf)
    return { title: pdf.title || decodeURIComponent(url.split('/').pop() || 'PDF'), source: host, body: pdf.body, url }
  }
  const html = new TextDecoder(type.match(/charset=([\w-]+)/i)?.[1] || 'utf-8').decode(buf)
  const page = parseHtml(html, url)
  return { ...page, source: page.source || host, url }
}

// JATS 태그(<jats:p> 등)를 지운 초록
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function stripTags(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, ''), /^#x/i.test(e) ? 16 : 10)) : (ENTITIES[e.toLowerCase()] ?? m)))
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeDoi(raw) {
  const doi = String(raw ?? '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '')
  if (!/^10\.\d{4,9}\/\S+$/.test(doi)) throw fail('DOI 형식이 아니에요. 예: 10.1002/jsid.1234')
  return doi
}

// DOI → 제목 · 학술지 · 날짜 · 초록. Crossref(키 없음) → 막히면 doi.org(CSL JSON, DataCite 등도 됨)
async function fromDoi(raw) {
  const doi = normalizeDoi(raw)
  const pick = (m) => {
    const parts = (m.published ?? m['published-online'] ?? m['published-print'] ?? m.issued)?.['date-parts']?.[0]
    const date = parts?.length ? new Date(Date.UTC(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1)).toISOString() : null
    const title = Array.isArray(m.title) ? m.title[0] : m.title
    const journal = Array.isArray(m['container-title']) ? m['container-title'][0] : m['container-title']
    const authors = (m.author ?? []).slice(0, 3).map((a) => [a.given, a.family].filter(Boolean).join(' ') || a.name).filter(Boolean)
    const abstract = stripTags(m.abstract)
    const head = [stripTags(journal), authors.length ? `저자 ${authors.join(', ')}${(m.author ?? []).length > 3 ? ' 외' : ''}` : ''].filter(Boolean).join(' · ')
    return { title: stripTags(title), source: stripTags(journal || m.publisher) || 'DOI', publishedAt: date, body: tidy([head, abstract].filter(Boolean).join('\n')), url: `https://doi.org/${doi}`, abstract }
  }
  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { 'User-Agent': 'techbrief/0.1 (student project)' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.ok) return { ...pick((await res.json()).message), doi }
  } catch {
    // 다음 방법으로
  }
  try {
    const res = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, { headers: { Accept: 'application/vnd.citationstyles.csl+json' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.ok) return { ...pick(await res.json()), doi }
  } catch {
    // 아래에서 알림
  }
  throw fail('DOI 정보를 찾지 못했어요. DOI가 맞는지 확인하거나 「링크」로 넣어 보세요.', 404)
}

async function pdfText(buf) {
  const { extractText, getDocumentProxy } = await import('unpdf')
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    const { text } = await extractText(pdf, { mergePages: true })
    const info = await pdf.getMetadata().catch(() => null)
    return { body: tidy(text), title: String(info?.info?.Title ?? '').trim() }
  } catch {
    throw fail('PDF에서 글자를 읽지 못했어요. 암호가 걸린 PDF인지 확인해 주세요.')
  }
}

async function fromFile({ fileName = '', fileBase64 = '' }) {
  const buf = Buffer.from(String(fileBase64), 'base64')
  if (!buf.length) throw fail('파일이 비어 있어요.')
  if (buf.length > MAX_FILE) throw fail('파일은 10MB까지 올릴 수 있어요.', 413)
  const ext = (fileName.match(/\.(\w+)$/)?.[1] ?? '').toLowerCase()
  const base = fileName.replace(/\.\w+$/, '')
  if (ext === 'pdf') {
    const pdf = await pdfText(buf)
    return { title: pdf.title || base, body: pdf.body }
  }
  if (['txt', 'md', 'csv'].includes(ext)) return { title: base, body: tidy(buf.toString('utf8')) }
  if (['html', 'htm'].includes(ext)) {
    const page = parseHtml(buf.toString('utf8'))
    return { ...page, title: page.title || base }
  }
  if (ext === 'eml') {
    // 메일을 파일로 저장한 것: 제목(Subject)과 본문(첫 text/plain 부분만, 간단 처리)
    const raw = buf.toString('utf8')
    const subject = raw.match(/^Subject:\s*(.+)$/im)?.[1]?.trim()
    const body = raw.split(/\r?\n\r?\n/).slice(1).join('\n\n')
    return { title: subject || base, body: tidy(body.replace(/<[^>]+>/g, ' ')) }
  }
  throw fail('PDF · TXT · MD · HTML · EML 파일만 올릴 수 있어요. Word·PPT는 PDF로 저장해 올려 주세요.')
}

function toArticle(row) {
  return {
    id: row.id,
    material: true,
    kind: row.kind,
    kindLabel: KIND_LABEL[row.kind] ?? row.kind,
    title: row.title,
    url: row.url || '',
    source: row.source || KIND_LABEL[row.kind],
    description: row.description || '',
    keyword: '직접 추가',
    tier: row.tier ?? 1,
    aiAllowed: row.ai_allowed !== false,
    publishedAt: new Date(row.published_at ?? row.added_at).toISOString(),
    addedAt: new Date(row.added_at).toISOString(),
    addedBy: row.added_by || null,
    fileName: row.file_name || undefined,
    importance: 0,
    relevance: 'high',
  }
}

// kind: link | doi | text | file
export async function addMaterial(input, clientId) {
  const kind = String(input.kind ?? '')
  let got
  if (kind === 'link') got = await fromLink(String(input.url ?? '').trim())
  else if (kind === 'doi') got = await fromDoi(input.doi)
  else if (kind === 'text') got = { title: '', body: tidy(input.text) }
  else if (kind === 'file') got = await fromFile(input)
  else throw fail('자료 종류를 골라 주세요.')

  const title = String(input.title ?? '').trim().slice(0, 300) || got.title?.trim().slice(0, 300)
  if (!title) throw fail('제목을 넣어 주세요.')
  const body = got.body ?? ''
  if (kind !== 'doi' && body.length < 30) {
    throw fail(kind === 'file' ? '파일에서 글자를 거의 찾지 못했어요. 스캔한 그림 PDF는 글자를 읽을 수 없어요.' : '본문을 가져오지 못했어요. 「텍스트」로 내용을 붙여 넣어 주세요.')
  }
  const tierRaw = Number(input.tier)
  const row = {
    id: `m-${randomUUID()}`,
    kind,
    title,
    url: got.url || null,
    source: String(input.source ?? '').trim().slice(0, 100) || got.source || null,
    description: got.abstract ? excerptOf(got.abstract) : body ? excerptOf(body) : '',
    body: body || null,
    tier: [1, 2, 3].includes(tierRaw) ? tierRaw : kind === 'doi' ? 1 : 2,
    ai_allowed: input.aiAllowed !== false,
    published_at: (input.publishedAt && !Number.isNaN(Date.parse(input.publishedAt)) ? new Date(input.publishedAt).toISOString() : got.publishedAt) || new Date().toISOString(),
    added_at: new Date().toISOString(),
    added_by: clientId ? String(clientId).slice(0, 64) : null,
    file_name: kind === 'file' ? String(input.fileName ?? '').slice(0, 200) : null,
    doi: got.doi ?? null,
  }
  if (!dbEnabled()) {
    memory.set(row.id, row)
    return toArticle(row)
  }
  await query(
    `INSERT INTO materials (id, kind, title, url, source, description, body, tier, ai_allowed, published_at, added_at, added_by, file_name, doi)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [row.id, row.kind, row.title, row.url, row.source, row.description, row.body, row.tier, row.ai_allowed, row.published_at, row.added_at, row.added_by, row.file_name, row.doi],
  )
  return toArticle(row)
}

export async function listMaterials(limit = 300) {
  if (!dbEnabled()) return [...memory.values()].sort((a, b) => b.added_at.localeCompare(a.added_at)).slice(0, limit).map(toArticle)
  const { rows } = await query(
    `SELECT id, kind, title, url, source, description, tier, ai_allowed, published_at, added_at, added_by, file_name
       FROM materials ORDER BY added_at DESC LIMIT $1`,
    [limit],
  )
  return rows.map(toArticle)
}

export async function getMaterial(id) {
  if (!String(id).startsWith('m-')) return null
  if (!dbEnabled()) return memory.get(id) ?? null
  const { rows } = await query('SELECT * FROM materials WHERE id = $1', [id])
  return rows[0] ?? null
}

// 올린 브라우저 또는 관리자만 지운다
export async function deleteMaterial(id, { clientId, admin }) {
  const row = await getMaterial(id)
  if (!row) throw fail('없는 자료예요.', 404)
  if (!admin && (!clientId || row.added_by !== clientId)) throw fail('자료는 올린 브라우저나 관리자만 지울 수 있어요.', 403)
  if (!dbEnabled()) memory.delete(id)
  else await query('DELETE FROM materials WHERE id = $1', [id])
}

// AI 요약을 허용하지 않은 자료인지 (요약·보고서 요청을 막을 때)
export async function materialBlocksAi(id) {
  const row = await getMaterial(id)
  return Boolean(row) && row.ai_allowed === false
}
