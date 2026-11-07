// 잘린 제목 채우기 (11 문서 「관련도 규칙」). 네이버는 긴 제목을 「...」로 자른다 (11/07 표본의 24%)
// - 원문 페이지의 제목(og:title)으로 채운다. 원문 앞부분이 잘린 제목과 같을 때만 쓴다 (사이트 이름만 있는 제목 방지)
// - 사이트를 괴롭히지 않게: 수집이 끝난 뒤 한 번에 최대 MAX_PER_RUN건, 동시에 2건, 한 번 실패한 주소는 하루 동안 다시 안 함
// - 본문을 이미 가져온 기사(요약·보고서)는 그때 적어 둔 제목을 먼저 쓴다 (fulltext.js)
import { dbEnabled, query } from '../db/index.js'
import { fetchOgTitle, knownOgTitle } from './fulltext.js'

const MAX_PER_RUN = 30
const CONCURRENCY = 2
const RETRY_MS = 24 * 3600_000
const tried = new Map() // url → 마지막 시도 시각
let running = false

export function isTruncated(title) {
  return /(\.\.\.|…)\s*$/.test(String(title ?? ''))
}

const squash = (t) => String(t ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

// 원문 제목이 잘린 제목으로 시작하면 원문 제목 (끝의 ' - 매체명', ' | 매체명'은 뺀다)
export function restoredTitle(cut, og) {
  if (!og) return null
  const head = squash(String(cut).replace(/(\.\.\.|…)\s*$/, ''))
  if (head.length < 8) return null
  const candidates = [og, og.replace(/\s*[|\-–—:]\s*[^|\-–—:]{1,30}$/, '')]
  const best = candidates.filter((c) => squash(c).startsWith(head) && squash(c).length > head.length).at(-1)
  return best ? best.trim() : null
}

async function save(id, fullTitle, memory) {
  if (dbEnabled()) await query('UPDATE articles SET full_title = $2 WHERE id = $1', [id, fullTitle])
  else if (memory?.has(id)) memory.get(id).fullTitle = fullTitle
}

// articles: [{ id, url, title, fullTitle }]. 끝나기를 기다리지 않고 뒤에서 돈다
export function restoreTitles(articles, { memory } = {}) {
  if (running) return
  const now = Date.now()
  const todo = articles
    .filter((a) => !a.fullTitle && isTruncated(a.title) && a.url && now - (tried.get(a.url) ?? 0) > RETRY_MS)
    .slice(0, MAX_PER_RUN)
  if (todo.length === 0) return
  running = true
  let next = 0
  async function worker() {
    while (next < todo.length) {
      const a = todo[next++]
      tried.set(a.url, Date.now())
      const og = knownOgTitle(a.url) ?? (await fetchOgTitle(a.url))
      const full = restoredTitle(a.title, og)
      if (full) await save(a.id, full, memory).catch((err) => console.warn(`[titles] 저장 실패: ${err.message}`))
    }
  }
  Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker)).finally(() => {
    running = false
  })
}
