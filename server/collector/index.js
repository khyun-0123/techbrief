// 수집 흐름: 키워드별 검색 → 정리 → 원문 주소로 중복 제외 → 저장 → 같은 이슈 묶기 → 중요도 점수
// 저장: DATABASE_URL이 있으면 PostgreSQL, 없으면 서버 메모리 (서버를 끄면 비워짐)
import { dbEnabled, query } from '../db/index.js'
import { groupArticles, sameIssue, titleGrams } from './dedupe.js'
import { searchNews } from './naver.js'
import { findMention, getLists } from './lists.js'
import { toArticle } from './normalize.js'
import { scoreArticle } from './score.js'
import { titleSentiment } from './sentiment.js'

const MAX_KEYWORDS = 10 // API 호출 수를 지키기 위한 한도
const MAX_PAGES = 10 // 키워드마다 100건씩 최대 10번(1,000건, 네이버 한도)까지 넘겨 받는다
const LIST_DAYS = 7 // 화면 목록에 보여 주는 기간
const KEEP_DAYS = 365 // DB 보관 기간. 요약된 기사·일자별 집계는 계속 보관 (08 13-2)

// ── 저장소: 메모리 (DB가 없을 때) ──
const memory = new Map()
let memoryCollectedAt = null

// ── 저장소: PostgreSQL ──
// 이미 받아 둔 원문 주소 (넘겨 받다가 지난번에 받은 기사가 나오면 멈춘다)
async function knownUrls(urls) {
  if (!dbEnabled()) return new Set(urls.filter((u) => [...memory.values()].some((a) => a.url === u)))
  const { rows } = await query('SELECT url FROM articles WHERE url = ANY($1)', [urls])
  return new Set(rows.map((r) => r.url))
}

// 여러 건을 한 번에 넣는다. 이미 있는 기사는 마지막으로 본 시각만 갱신 (inserted로 새 기사 수를 센다)
async function saveToDb(articles) {
  if (articles.length === 0) return 0
  const cols = ['id', 'url', 'title', 'description', 'source', 'keyword', 'published_at', 'section']
  const values = cols.map((c) => articles.map((a) => (c === 'published_at' ? a.publishedAt : a[c] ?? null)))
  const { rows } = await query(
    `INSERT INTO articles (id, url, title, description, source, keyword, published_at, section)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::timestamptz[], $8::text[])
     ON CONFLICT (url) DO UPDATE SET last_seen_at = now(), title = EXCLUDED.title, description = EXCLUDED.description,
       section = coalesce(EXCLUDED.section, articles.section)
     RETURNING (xmax = 0) AS inserted`,
    values,
  )
  return rows.filter((r) => r.inserted).length
}

async function loadRecentFromDb(days) {
  const { rows } = await query(
    `SELECT id, url, title, description, source, keyword, published_at, section, group_id
       FROM articles WHERE published_at > now() - make_interval(days => $1) ORDER BY published_at, id`,
    [days],
  )
  return rows.map(({ published_at, group_id, ...r }) => ({ ...r, publishedAt: published_at.toISOString(), groupId: group_id }))
}

// 같은 이슈 묶기를 다시 해서 바뀐 것만 저장한다. 수집이 끝날 때 한 번 (접속할 때마다 묶으면 느려서)
async function regroupDb(stored) {
  const changed = groupArticles(stored).filter((a, i) => a.groupId !== stored[i].groupId)
  if (changed.length === 0) return stored
  await query(
    `UPDATE articles a SET group_id = c.group_id
       FROM unnest($1::text[], $2::text[]) AS c(id, group_id) WHERE a.id = c.id`,
    [changed.map((a) => a.id), changed.map((a) => a.groupId)],
  )
  return loadRecentFromDb(LIST_DAYS)
}

async function lastCollectedFromDb() {
  const { rows } = await query('SELECT max(last_seen_at) AS at FROM articles')
  return rows[0].at ? rows[0].at.toISOString() : null
}

// 키워드별 일자별 이슈 수·기사 수를 다시 센다 (최근 LIST_DAYS일). 추이 그래프의 바탕
async function updateDaily(reps) {
  const counts = new Map()
  for (const rep of reps) {
    const day = rep.publishedAt.slice(0, 10)
    const key = `${rep.keyword}|${day}`
    const c = counts.get(key) ?? { keyword: rep.keyword, day, issues: 0, articles: 0 }
    c.issues += 1
    c.articles += 1 + rep.sameIssue
    counts.set(key, c)
  }
  const list = [...counts.values()]
  if (list.length === 0) return
  await query(
    `INSERT INTO keyword_daily (keyword, day, issues, articles)
     SELECT * FROM unnest($1::text[], $2::date[], $3::int[], $4::int[])
     ON CONFLICT (keyword, day) DO UPDATE SET issues = EXCLUDED.issues, articles = EXCLUDED.articles`,
    [list.map((c) => c.keyword), list.map((c) => c.day), list.map((c) => c.issues), list.map((c) => c.articles)],
  )
}

// 1년이 지난 기사 정리. 요약한 기사는 보고서 근거라 남긴다
async function cleanupDb() {
  await query(
    `DELETE FROM articles a
      WHERE a.published_at < now() - make_interval(days => $1)
        AND NOT EXISTS (SELECT 1 FROM summaries s WHERE s.article_id = a.id)`,
    [KEEP_DAYS],
  )
}

export async function collect(keywords) {
  const words = [...new Set(keywords.map((k) => String(k).trim()).filter(Boolean))].slice(0, MAX_KEYWORDS)
  if (words.length === 0) throw Object.assign(new Error('수집할 키워드가 없어요.'), { status: 400 })

  let fetched = 0
  let added = 0
  const failed = []
  for (const word of words) {
    try {
      // 최신순 100건씩 넘겨 받는다. 지난번에 받은 기사가 나오면 그 뒤는 이미 있으므로 멈춘다
      // (100건만 받으면 기사가 많은 낮 시간에는 2시간 중 앞부분을 놓친다)
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const items = await searchNews(word, { start: page * 100 + 1 })
        fetched += items.length
        const articles = items.map((item) => toArticle(item, word)).filter((a) => a.url && a.title)
        // 한 번 받은 결과 안에서도 같은 원문이 겹칠 수 있다
        const unique = [...new Map(articles.map((a) => [a.url, a])).values()]
        const reachedKnown = (await knownUrls(unique.map((a) => a.url))).size > 0
        if (dbEnabled()) {
          added += await saveToDb(unique)
        } else {
          for (const a of unique) {
            if (!memory.has(a.id)) added += 1
            memory.set(a.id, { ...memory.get(a.id), ...a })
          }
        }
        if (reachedKnown || items.length < 100) break
      }
    } catch (err) {
      failed.push({ keyword: word, error: err.message })
    }
  }
  if (failed.length === words.length) {
    throw Object.assign(new Error(failed[0].error), { status: 502 })
  }

  if (dbEnabled()) {
    await cleanupDb()
  } else {
    memoryCollectedAt = new Date().toISOString()
    const cutoff = Date.now() - LIST_DAYS * 24 * 3600_000
    for (const [id, a] of memory) if (Date.parse(a.publishedAt) < cutoff) memory.delete(id)
  }

  const list = await listArticles({ regroup: true })
  if (dbEnabled()) await updateDaily(list.articles)
  return { fetched, added, failed, ...list }
}

// 같은 이슈를 묶고 대표 기사에 중요도 점수를 매긴다. 같은 이슈 기사는 related로 붙인다
// 관련도 (13 문서 F4). 네이버 검색은 본문 어딘가에 단어가 한 번만 나와도 결과로 준다
// high: 제목에 키워드 / mid: 발췌에만 / low: 발췌에도 없거나, 발췌에만 있고 네이버 섹션이 정치·사회·생활·세계
const OFF_TOPIC_SECTIONS = new Set(['100', '102', '103', '104'])
const squash = (t) => String(t ?? '').toLowerCase().replace(/\s+/g, '')

export function relevanceOf(article) {
  const words = String(article.keyword).split(/\s+/).filter(Boolean).map(squash)
  const has = (text) => words.every((w) => squash(text).includes(w))
  if (has(article.title)) return 'high'
  if (has(`${article.title} ${article.description ?? ''}`)) return OFF_TOPIC_SECTIONS.has(article.section) ? 'low' : 'mid'
  return 'low'
}
const RANK = { low: 0, mid: 1, high: 2 }

// lists: 자사·경쟁사 목록 → 중요도의 경쟁사 언급, 자사 기사 표시(own)
// stored에 groupId가 모두 있으면(DB에 저장된 묶음) 그대로 쓰고, 아니면 여기서 묶는다
function toIssues(stored, lists) {
  const grouped = stored.every((a) => a.groupId) ? stored : groupArticles(stored)
  const members = new Map()
  for (const a of grouped) {
    if (!members.has(a.groupId)) members.set(a.groupId, [])
    members.get(a.groupId).push(a)
  }
  // 대표 기사가 목록 기간(7일)을 지나 빠졌으면 남은 기사 중 가장 먼저 나온 기사가 대표
  const earliest = (group) => group.reduce((x, y) => (y.publishedAt < x.publishedAt ? y : x))
  return [...members.entries()]
    .map(([groupId, group]) => [group.find((a) => a.id === groupId) ?? earliest(group), group])
    .map(([rep, group]) => {
      // 같은 이슈 기사 중 가장 관련 높은 것을 이슈의 관련도로 (중요도 점수의 배수로도 쓴다)
      const relevance = group.map(relevanceOf).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'low')
      const { score, level, parts } = scoreArticle(rep, group.length, lists.competitors, { relevance, interests: lists.interests })
      const own = findMention(`${rep.title} ${rep.description ?? ''}`, lists.own)
      const related = group
        .filter((a) => a.id !== rep.id)
        .slice(0, 4)
        .map(({ id, title, source, description, url }) => ({ id, title, source, description, url }))
      return {
        ...rep,
        sameIssue: group.length - 1,
        importance: score,
        importanceLevel: level,
        scoreParts: parts,
        related,
        own,
        relevance,
        titleSentiment: titleSentiment(rep.title),
      }
    })
    .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt))
}

// 대표 기사 목록 (최근 LIST_DAYS일)
// regroup: 수집 직후처럼 기사가 바뀌었을 때 묶음을 다시 저장. 묶음이 없는 기사가 있어도 (처음 켰을 때) 다시 묶는다
export async function listArticles({ regroup = false } = {}) {
  let stored = dbEnabled() ? await loadRecentFromDb(LIST_DAYS) : [...memory.values()]
  if (dbEnabled() && (regroup || stored.some((a) => !a.groupId))) stored = await regroupDb(stored)
  const articles = toIssues(stored, await getLists())
  const lastCollectedAt = dbEnabled() ? await lastCollectedFromDb() : memoryCollectedAt
  return { articles, total: stored.length, lastCollectedAt, storage: dbEnabled() ? 'db' : 'memory' }
}

// 「기사 찾기」: 등록 키워드와 상관없이 네이버에서 바로 찾는다. 정확도순 100건
// 수집이 아니라 찾아보기라서 DB에 쌓지 않는다 (추이 집계에도 넣지 않음). 요약하면 요약만 저장된다
export async function searchArticles(query) {
  const q = String(query ?? '').trim().slice(0, 50)
  if (!q) throw Object.assign(new Error('찾을 말을 입력해 주세요.'), { status: 400 })
  const items = await searchNews(q, { sort: 'sim' })
  const articles = items.map((item, i) => ({ ...toArticle(item, q), rank: i + 1 })).filter((a) => a.url && a.title)
  const unique = [...new Map(articles.map((a) => [a.url, a])).values()]
  const issues = toIssues(unique, await getLists())
  if (dbEnabled()) await linkToCollected(issues)
  return { query: q, fetched: items.length, articles: issues }
}

// 찾기 결과 중 이미 모은 기사와 같은 이슈인 것은 그 이슈의 요약(summaryId)과 점수를 함께 쓴다
// (같은 소식이라도 다른 언론사 기사면 주소가 달라 요약이 연결되지 않고, 점수도 찾기 결과 100건 안에서만 계산된다)
async function linkToCollected(issues) {
  const { articles: collected } = await listArticles()
  const byId = new Map(collected.map((a) => [a.id, a]))
  const keyOf = (a) => ({ time: Date.parse(a.publishedAt), grams: titleGrams(a.title) })
  const reps = collected.map((a) => ({ rep: a, ...keyOf(a) }))
  for (const issue of issues) {
    const key = keyOf(issue)
    const rep = byId.get(issue.id) ?? reps.find((r) => sameIssue(key, r))?.rep
    if (!rep) continue
    issue.summaryId = rep.id
    if ((rep.importance ?? 0) > (issue.importance ?? 0)) {
      Object.assign(issue, { importance: rep.importance, importanceLevel: rep.importanceLevel, scoreParts: rep.scoreParts })
    }
  }
}
