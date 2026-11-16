// 수집 흐름: 키워드별 검색 → 정리 → 원문 주소로 중복 제외 → 저장 → 같은 이슈 묶기 → 중요도 점수
// 저장: DATABASE_URL이 있으면 PostgreSQL, 없으면 서버 메모리 (서버를 끄면 비워짐)
import { dbEnabled, query } from '../db/index.js'
import { getSetting, setSetting } from '../db/store.js'
import { findReruns, groupArticles, sameIssue, titleGrams } from './dedupe.js'
import { collectFeeds, FEEDS, PAPER_KEYWORD_DAYS, tierOf } from './feeds.js'
import { searchNews } from './naver.js'
import { findMention, getLists } from './lists.js'
import { EXPERT_SOURCES, toArticle } from './normalize.js'
import { BROAD_KEYWORD, relevanceInfo } from './relevance.js'
import { mentions, rescore, scoreArticle } from './score.js'
import { titleSentiment } from './sentiment.js'
import { restoreTitles } from './titles.js'
import crypto from 'node:crypto'
import { importanceRule, loadImportanceRule } from '../importanceRule.js'

const MAX_KEYWORDS = 10 // API 호출 수를 지키기 위한 한도
const MAX_PAGES = 10 // 키워드마다 100건씩 최대 10번(1,000건, 네이버 한도)까지 넘겨 받는다
// 처음 거슬러 모으기 (11/08 조장 결정): 키워드마다 한 번, 최근 21일치까지 받는다. 그 뒤로는 새 기사를 이어 붙인다 (지우지 않음)
// 네이버 검색 API는 최신순 1,000건까지만 넘겨 주므로, 기사가 많은 키워드는 21일까지 닿지 못할 수 있다 → 닿은 날짜를 기록
const BACKFILL_DAYS = 21
const BACKFILL_KEY = 'collect_backfill' // { [키워드]: { at, oldest, reached, capped } }
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

// body: 선별해서 저장해 둔 원문 앞부분 (있으면 관련도를 원문으로 계산, 화면에는 보내지 않음)
async function loadRecentFromDb(days) {
  const { rows } = await query(
    `SELECT a.id, a.url, a.title, a.description, a.source, a.keyword, a.published_at, a.section, a.group_id, a.full_title,
            left(t.body, $2) AS body
       FROM articles a LEFT JOIN article_texts t ON t.article_id = a.id
      WHERE a.published_at > now() - make_interval(days => $1)
         OR (a.section = 'feed:crossref' AND a.published_at > now() - make_interval(days => $3))
      ORDER BY a.published_at, a.id`,
    [days, BODY_FOR_RELEVANCE, PAPER_KEYWORD_DAYS], // 논문은 키워드 논문 기간(30일)까지 목록에 (11/09)
  )
  return rows.map(({ published_at, group_id, full_title, body, ...r }) => ({
    ...r,
    publishedAt: published_at.toISOString(),
    groupId: group_id,
    ...(full_title ? { fullTitle: full_title } : {}),
    ...(body ? { body } : {}),
  }))
}
const BODY_FOR_RELEVANCE = 4_000

// 같은 이슈 묶기를 다시 해서 바뀐 것만 저장한다. 수집이 끝날 때 한 번 (접속할 때마다 묶으면 느려서)
// days: 다시 불러올 기간 (11/17: 예전엔 늘 7일만 돌려줘, 21일 자동 요약 대상 · 400일 점수 채우기가 다시 묶은 날엔 7일치만 받았음)
async function regroupDb(stored, days = LIST_DAYS) {
  const changed = groupArticles(stored).filter((a, i) => a.groupId !== stored[i].groupId)
  if (changed.length === 0) return stored
  await query(
    `UPDATE articles a SET group_id = c.group_id
       FROM unnest($1::text[], $2::text[]) AS c(id, group_id) WHERE a.id = c.id`,
    [changed.map((a) => a.id), changed.map((a) => a.groupId)],
  )
  return loadRecentFromDb(days)
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

// 네이버 밖 출처 (feeds.js). 관리자가 끈 출처와 지난 수집 결과는 app_settings에 둔다
const SOURCES_KEY = 'feed_sources' // { disabled: [id] }
const SOURCES_STATUS_KEY = 'feed_sources_status' // { at, results: [{ id, ok, items, matched, added, error }] }

export async function getSources({ counts = false } = {}) {
  const saved = await getSetting(SOURCES_KEY, { disabled: [] })
  const disabled = (saved.disabled ?? []).filter((id) => FEEDS.some((f) => f.id === id))
  return { disabled, status: await getSetting(SOURCES_STATUS_KEY, null), ...(counts ? { stored: await storedByFeed() } : {}) }
}

// 출처마다 최근 14일 · 전체 저장 건수 (11/17, 관리 페이지): 「정상 · 받은 글 580」인데 한 번도 저장되지 않은 출처가 5곳 있었음 (36 문서 4-1)
// 받기는 되지만 날짜 기준(14일)이나 키워드에 걸려 모두 버려지는 경우가 화면에 보이지 않았다
export const STORED_DAYS = 14
async function storedByFeed() {
  if (!dbEnabled()) return null
  const { rows } = await query(
    `SELECT substr(section, 6) AS id, count(*) FILTER (WHERE published_at > now() - make_interval(days => $1))::int AS recent, count(*)::int AS total, max(published_at) AS last
       FROM articles WHERE section LIKE 'feed:%' GROUP BY 1`,
    [STORED_DAYS],
  )
  return Object.fromEntries(rows.map((r) => [r.id, { recent: r.recent, total: r.total, last: r.last?.toISOString() ?? null }]))
}

export async function saveSources(input = {}) {
  const disabled = [...new Set((input.disabled ?? []).map(String))].filter((id) => FEEDS.some((f) => f.id === id))
  await setSetting(SOURCES_KEY, { disabled })
  return getSources()
}

// 피드 기사 저장 (네이버와 같은 표). 출처마다 새로 넣은 수를 센다
async function collectFromFeeds(words) {
  const { disabled } = await getSources()
  const { articles, results } = await collectFeeds(words, { disabled })
  for (const r of results) {
    const mine = articles.filter((a) => a.section === `feed:${r.id}`)
    if (dbEnabled()) r.added = await saveToDb(mine)
    else {
      r.added = mine.filter((a) => !memory.has(a.id)).length
      for (const a of mine) memory.set(a.id, { ...memory.get(a.id), ...a })
    }
  }
  await setSetting(SOURCES_STATUS_KEY, { at: new Date().toISOString(), results }) // DB가 없으면 서버 메모리에
  return results
}

export async function collect(keywords) {
  const words = [...new Set(keywords.map((k) => String(k).trim()).filter(Boolean))].slice(0, MAX_KEYWORDS)
  if (words.length === 0) throw Object.assign(new Error('수집할 키워드가 없어요.'), { status: 400 })

  let fetched = 0
  let added = 0
  const failed = []
  const backfill = dbEnabled() ? await getSetting(BACKFILL_KEY, {}).catch(() => ({})) : null
  const cutoff = Date.now() - BACKFILL_DAYS * 86_400_000
  for (const word of words) {
    try {
      // 최신순 100건씩 넘겨 받는다. 지난번에 받은 기사가 나오면 그 뒤는 이미 있으므로 멈춘다
      // (100건만 받으면 기사가 많은 낮 시간에는 2시간 중 앞부분을 놓친다)
      // 거슬러 모으기가 아직이면 이미 받은 기사가 나와도 멈추지 않고 21일 전 기사까지 (또는 1,000건 한도까지)
      const filling = backfill && !backfill[word]
      let oldest = null
      let capped = false
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const items = await searchNews(word, { start: page * 100 + 1, background: true })
        for (const it of items) {
          const t = Date.parse(it.pubDate)
          if (Number.isFinite(t) && (oldest === null || t < oldest)) oldest = t
        }
        if (filling && page === MAX_PAGES - 1 && items.length === 100) capped = true
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
        if (filling ? (oldest !== null && oldest < cutoff) || items.length < 100 : reachedKnown || items.length < 100) break
      }
      if (filling) {
        backfill[word] = { at: new Date().toISOString(), oldest: oldest ? new Date(oldest).toISOString() : null, reached: oldest !== null && oldest < cutoff, capped }
        await setSetting(BACKFILL_KEY, backfill).catch(() => {})
        console.log(`[collect] 「${word}」 거슬러 모으기: ${oldest ? new Date(oldest).toISOString().slice(0, 10) : '?'}까지${capped ? ' (네이버 1,000건 한도)' : ''}`)
      }
    } catch (err) {
      failed.push({ keyword: word, error: err.message })
    }
  }
  // 네이버 밖 출처: 실패해도 네이버 수집은 그대로 (출처별 결과는 관리 화면 「수집 대상」에)
  let sources = []
  try {
    sources = await collectFromFeeds(words)
    fetched += sources.reduce((n, r) => n + (r.items ?? 0), 0)
    added += sources.reduce((n, r) => n + (r.added ?? 0), 0)
  } catch (err) {
    console.warn(`[collect] 네이버 밖 출처 수집 실패: ${err.message}`)
  }
  if (failed.length === words.length && !sources.some((r) => r.added)) {
    throw Object.assign(new Error(failed[0].error), { status: 502 })
  }

  if (dbEnabled()) {
    await cleanupDb()
  } else {
    memoryCollectedAt = new Date().toISOString()
    const cutoff = Date.now() - LIST_DAYS * 24 * 3600_000
    const paperCutoff = Date.now() - PAPER_KEYWORD_DAYS * 24 * 3600_000
    for (const [id, a] of memory) if (Date.parse(a.publishedAt) < (a.section === 'feed:crossref' ? paperCutoff : cutoff)) memory.delete(id)
  }

  const list = await listArticles({ regroup: true })
  // 추이 집계는 최근 LIST_DAYS일만 (목록에 같이 오는 30일치 논문이 지난 날짜 집계를 덮어쓰지 않게)
  const listCutoff = Date.now() - LIST_DAYS * 24 * 3600_000
  // 「1·2차 출처」(키워드에 안 맞은 RSS 글)는 키워드 추이에 넣지 않는다
  if (dbEnabled()) await updateDaily(list.articles.filter((a) => Date.parse(a.publishedAt) >= listCutoff && a.keyword !== BROAD_KEYWORD))
  // 잘린 제목은 원문 제목으로 채운다 (뒤에서 조금씩, 다음 목록부터 보임). 같은 이슈 기사까지 본다
  restoreTitles(dbEnabled() ? await loadRecentFromDb(LIST_DAYS) : [...memory.values()], { memory })
  return { fetched, added, failed, sources, ...list }
}

// 같은 이슈를 묶고 대표 기사에 중요도 점수를 매긴다. 같은 이슈 기사는 related로 붙인다
// 관련도 (13 문서 F4)는 relevance.js: 키워드가 있느냐가 아니라 글에서 키워드 이야기가 차지하는 비중으로 정한다
const RANK = { low: 0, mid: 1, high: 2 }

// lists: 자사·경쟁사 목록 → 중요도의 경쟁사 언급, 자사 기사 표시(own)
// stored에 groupId가 모두 있으면(DB에 저장된 묶음) 그대로 쓰고, 아니면 여기서 묶는다
// ── 신규성 재료 (11/09 중요도 재설계) ──
// rising: 「요즘 뜨는 기술」 종합 순위 상위 RISING_TOP개 용어 (techtrends.js, 최근 7일)
// older: 목록 기간(7일)보다 앞선 RERUN_DAYS일까지의 기사 제목 조각 → 재탕(이미 나왔던 소식) 찾기
// 10분 캐시 (목록을 열 때마다 다시 읽지 않게)
const RISING_TOP = 20
const RERUN_DAYS = 21
const CTX_TTL = 10 * 60_000
let ctxCache = (globalThis.__scoreCtx ??= { at: 0, value: null })
export async function scoreContext() {
  await loadImportanceRule() // 관리 페이지 「중요도 기준」 (1분 기억, 11/15)
  ctxCache = globalThis.__scoreCtx
  if (ctxCache.value && Date.now() - ctxCache.at < CTX_TTL) return ctxCache.value
  let rising = []
  try {
    const { getTechTrends } = await import('../techtrends.js')
    const t = await getTechTrends({ period: 'week' })
    // 평소보다 뚜렷하게 오른 용어(「관심」 60점 이상)만 (11/11 종합 점수 교체: 그대로인 주에는 아무도 +10을 받지 않는다)
    rising = (t.composite ?? []).filter((e) => e.score >= 60).slice(0, RISING_TOP).map((e) => ({ name: e.name, en: e.en, firstSeen: e.firstSeen }))
  } catch (err) {
    console.warn(`[score] 요즘 뜨는 기술 용어를 못 읽음: ${err.message}`)
  }
  let older = []
  if (dbEnabled()) {
    try {
      const { rows } = await query(
        `SELECT title, published_at FROM articles
          WHERE published_at <= now() - make_interval(days => $1) AND published_at > now() - make_interval(days => $2)
            AND (group_id IS NULL OR group_id = id)`,
        [LIST_DAYS, RERUN_DAYS],
      )
      older = rows.map((r) => ({ time: r.published_at.getTime(), grams: titleGrams(r.title) }))
    } catch (err) {
      console.warn(`[score] 지난 기사 제목을 못 읽음: ${err.message}`)
    }
  }
  const value = { rising, older }
  globalThis.__scoreCtx = { at: Date.now(), value }
  return value
}

function toIssues(stored, lists, ctx = { rising: [], older: [] }) {
  const grouped = stored.every((a) => a.groupId) ? stored : groupArticles(stored)
  const members = new Map()
  for (const a of grouped) {
    if (!members.has(a.groupId)) members.set(a.groupId, [])
    members.get(a.groupId).push(a)
  }
  // 대표 기사가 목록 기간(7일)을 지나 빠졌으면 남은 기사 중 가장 먼저 나온 기사가 대표
  const earliest = (group) => group.reduce((x, y) => (y.publishedAt < x.publishedAt ? y : x))
  const pairs = [...members.entries()].map(([groupId, group]) => [group.find((a) => a.id === groupId) ?? earliest(group), group])
  // 재탕: 이 이슈보다 48시간 넘게 앞서 나온 비슷한 제목(목록 안 다른 이슈 + 그 전 21일) (dedupe.js isRerun)
  const keyed = pairs.map(([rep]) => ({ id: rep.id, time: Date.parse(rep.publishedAt), grams: titleGrams(rep.fullTitle ?? rep.title) }))
  const earlierPool = [...ctx.older, ...keyed]
  const reruns = findReruns(keyed, earlierPool) // 11/16: 색인으로 (예전 isRerun 이슈마다 → 3.9초, 결과는 같음)
  return pairs
    .map(([groupRep, group]) => {
      // 출처 단계 (14 문서 4-B): 1차 기업·학회·논문 / 2차 전문매체 / 3차 일반 뉴스
      const rep = { ...groupRep, tier: tierOf(groupRep, EXPERT_SOURCES) }
      // 같은 이슈 기사 중 가장 관련 높은 것을 이슈의 관련도로 (중요도 점수의 배수로도 쓴다)
      const infos = group.map((a) => relevanceInfo(a, lists))
      const relevance = infos.map((i) => i.level).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'low')
      const info = infos[group.indexOf(groupRep)]
      const { score, level, parts } = scoreArticle(rep, group.length, lists.competitors, {
        relevance,
        interests: lists.interests,
        own: lists.own,
        rising: ctx.rising,
        rerun: reruns.has(groupRep.id),
        outlets: new Set(group.map((a) => a.source)).size,
      })
      const own = findMention(`${rep.title} ${rep.description ?? ''}`, lists.own)
      const related = group
        .filter((a) => a.id !== rep.id)
        .slice(0, 4)
        .map((a) => ({ id: a.id, title: a.fullTitle ?? a.title, source: a.source, description: a.description, url: a.url, tier: tierOf(a, EXPERT_SOURCES) }))
      // eslint-disable-next-line no-unused-vars
      const { body, fullTitle, ...shown } = rep // 원문은 화면에 보내지 않는다
      return {
        ...shown,
        title: fullTitle ?? rep.title,
        ...(fullTitle ? { titleRestored: true } : {}),
        // 모음 기사 · 주제 밖 기사 속 기술 정보 · 키워드 이야기 문장 (relevance.js)
        ...(info.roundup ? { roundup: true } : {}),
        ...(info.topic ? { topicTag: info.topic } : {}),
        ...(info.focus ? { focus: info.focus } : {}),
        mentionWeight: info.weight,
        ...(rep.section === 'feed:crossref' ? { paper: true } : {}),
        sameIssue: group.length - 1,
        importance: score,
        importanceLevel: level,
        scoreParts: parts,
        related,
        own,
        relevance,
        titleSentiment: titleSentiment(fullTitle ?? rep.title),
      }
    })
    .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt))
}

// ── 목록 미리 계산 (11/17 조장: 「통째로 다시 계산하지 말고 미리 점수를 매겨 두고 그걸 보여 주자. 주기적으로 다시 매기고,
//    새로 매기는 동안에는 기존 점수를 보여 주다가 끝나면 새 값으로 바꾼다」) ──
// - 화면 목록(7일)은 계산해 둔 값(스냅숏)을 바로 돌려준다. 열 때마다 다시 계산하지 않는다
// - 다시 계산하는 때: 수집이 끝났을 때(새 기사 · 묶음), 관리 페이지에서 중요도 기준 · 회사 목록을 바꿨을 때(markListStale),
//   만든 지 SNAP_TTL이 지났을 때(최신성 점수 · 요즘 뜨는 기술 반영). 다시 계산하는 동안에는 기존 값을 그대로 주고, 끝나면 바꾼다
// - 동시에 여러 요청이 와도 계산은 하나만 돈다 (예전: 화면을 열면 같은 계산이 2번 겹쳐 「요즘 뜨는 기술」까지 8초 늦게 떴음)
// - 앱마다 메모리에 둔다. 다른 앱이 수집한 것은 SNAP_TTL 안에 반영된다 (3038이 수집 담당)
// - DB에 점수를 저장하는 일(맵 「중요도순」 등에 쓸 값)은 37 문서 P2-1~P2-3에서 따로 한다
const SNAP_TTL = 10 * 60_000 // 점수 재료(scoreContext)의 기억 시간과 같게
const snap = (globalThis.__listSnapshot ??= { value: null, at: 0, gen: 0, running: null })

// 대표 기사 목록 (최근 LIST_DAYS일)
// regroup: 수집 직후처럼 기사가 바뀌었을 때 묶음을 다시 저장. 묶음이 없는 기사가 있어도 (처음 켰을 때) 다시 묶는다
// days: 기본은 화면 목록 기간(7일). 자동 요약은 관리자가 정한 기간으로 부른다 (11/08) — 이때는 미리 계산한 값을 쓰지 않는다
// fresh: 미리 계산한 값을 쓰지 않고 지금 다시 계산 (계산이 끝나면 미리 계산한 값도 바꾼다)
export async function listArticles({ regroup = false, days = LIST_DAYS, fresh = false } = {}) {
  if (days !== LIST_DAYS) return computeList({ regroup, days })
  if (regroup || fresh) {
    snap.gen += 1
    return rebuildList({ regroup })
  }
  if (!snap.value) return rebuildList()
  if (snap.dirty || Date.now() - snap.at > SNAP_TTL) rebuildList().catch((err) => console.warn(`[list] 목록 다시 계산 실패: ${err.message}`))
  return snap.value
}

// 기준이 바뀌었을 때 (관리 페이지): 다음 요청부터 뒤에서 다시 계산. 그동안은 기존 값
export function markListStale() {
  snap.gen += 1
  snap.dirty = true
  rebuildList().catch((err) => console.warn(`[list] 목록 다시 계산 실패: ${err.message}`))
}

// 하나만 돌린다. 도는 중에 기준이 바뀌었으면(gen) 끝난 뒤 한 번 더
function rebuildList({ regroup = false } = {}) {
  if (snap.running && !regroup) return snap.running
  const gen = snap.gen
  const run = (snap.running ?? Promise.resolve())
    .catch(() => {})
    .then(() => computeList({ regroup }))
    .then((value) => {
      snap.value = value
      snap.at = Date.now()
      snap.dirty = snap.gen !== gen
      saveScores(value.articles).catch((err) => console.warn(`[scores] 저장 실패: ${err.message}`))
      return value
    })
    .finally(() => {
      if (snap.running === run) snap.running = null
      if (snap.dirty) rebuildList().catch(() => {})
    })
  snap.running = run
  return run
}

// ── 중요도 저장 (11/17 조장 · 37 문서 P2-1 · P2-2 · P2-5) ──
// 목록을 계산할 때마다 이슈 점수를 article_scores에 저장한다. 최신성을 뺀 재료 · 기준이 바뀐 것만 다시 쓴다
// (관리 페이지에서 중요도 기준 · 회사 목록을 바꾸면 markListStale → 다시 계산 → 바뀐 것이 모두 다시 저장됨)
// 목록(7일)을 지난 이슈도 마지막 점수가 남는다 → 맵 「중요도순」 · 검색처럼 7일 밖 기사를 보는 곳이 쓴다 (storedScores)
// 수집 담당 앱만 쓴다 (refresh.js backgroundAllowed). 처음 한 번은 DB 기사 전체(400일)로 채운다
const scoreStore = (globalThis.__scoreStore ??= { loaded: false, sigs: new Map() })
const BACKFILL_SCORES_KEY = 'article_scores_backfill_v2'
const ruleKey = () => crypto.createHash('sha1').update(JSON.stringify(importanceRule())).digest('hex').slice(0, 10)
const sigOf = (a, key) => {
  const { recency, ...rest } = a.scoreParts?.raw ?? {} // eslint-disable-line no-unused-vars
  return JSON.stringify([rest, a.scoreParts?.weight ?? 1, a.scoreParts?.noise ?? 1, a.relevance, key])
}
async function saveScores(articles) {
  if (!dbEnabled()) return 0
  const { backgroundAllowed } = await import('../refresh.js') // 정적으로 가져오면 서로 가져오기가 돌아서 실행할 때 가져옴
  if (!(await backgroundAllowed().catch(() => false))) return 0
  if (!scoreStore.loaded) {
    const { rows } = await query('SELECT issue_id, sig FROM article_scores')
    for (const r of rows) scoreStore.sigs.set(r.issue_id, r.sig)
    scoreStore.loaded = true
  }
  // 처음 채우기는 한 번만 (설정에 기록). 11/17 첫 시도는 regroupDb 버그로 7일치만 채워져 v2로 다시
  if (scoreStore.backfillDone !== BACKFILL_SCORES_KEY) {
    scoreStore.backfillDone = BACKFILL_SCORES_KEY
    if (!(await getSetting(BACKFILL_SCORES_KEY, null))) {
      await setSetting(BACKFILL_SCORES_KEY, { at: new Date().toISOString() })
      // 처음 켰을 때: 지난 기사 전체 점수를 뒤에서 한 번 채운다 (재탕 판단은 지금 기준 21일 제목이라 오래된 기사는 조금 덜 정확)
      computeList({ days: 400 })
        .then((all) => saveScores(all.articles))
        .then((n) => console.log(`[scores] 처음 채우기 ${n}건`))
        .catch((err) => console.warn(`[scores] 처음 채우기 실패: ${err.message}`))
    }
  }
  const key = ruleKey()
  const changed = []
  for (const a of articles) {
    if (!a.scoreParts?.raw || a.material) continue
    const sig = sigOf(a, key)
    if (scoreStore.sigs.get(a.id) !== sig) changed.push([a, sig])
  }
  for (let i = 0; i < changed.length; i += 500) {
    const part = changed.slice(i, i + 500)
    await query(
      `INSERT INTO article_scores (issue_id, sig, score, level, parts, relevance, published_at, computed_at)
       SELECT id, sig, score, level, parts, relevance, published_at, now()
         FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::jsonb[], $6::text[], $7::timestamptz[])
           AS t(id, sig, score, level, parts, relevance, published_at)
       ON CONFLICT (issue_id) DO UPDATE SET sig = EXCLUDED.sig, score = EXCLUDED.score, level = EXCLUDED.level, parts = EXCLUDED.parts,
         relevance = EXCLUDED.relevance, published_at = EXCLUDED.published_at, computed_at = now()`,
      [
        part.map(([a]) => a.id),
        part.map(([, s]) => s),
        part.map(([a]) => a.importance ?? 0),
        part.map(([a]) => a.importanceLevel ?? 'normal'),
        part.map(([a]) => JSON.stringify(a.scoreParts)),
        part.map(([a]) => a.relevance ?? null),
        part.map(([a]) => a.publishedAt),
      ],
    )
    for (const [a, sig] of part) scoreStore.sigs.set(a.id, sig)
  }
  return changed.length
}

// 저장해 둔 점수 읽기: ids(이슈 대표 기사 id) → Map(id → { score, level, parts, relevance }). 최신성 · 배점은 지금 기준으로 다시 맞춘다
export async function storedScores(ids) {
  const out = new Map()
  if (!dbEnabled() || !ids?.length) return out
  await loadImportanceRule()
  const { rows } = await query('SELECT issue_id, parts, relevance, published_at FROM article_scores WHERE issue_id = ANY($1::text[])', [ids])
  for (const r of rows) {
    const now = rescore(r.parts, r.published_at?.toISOString())
    if (now) out.set(r.issue_id, { ...now, parts: r.parts, relevance: r.relevance })
  }
  return out
}

async function computeList({ regroup = false, days = LIST_DAYS } = {}) {
  let stored = dbEnabled() ? await loadRecentFromDb(days) : [...memory.values()]
  if (dbEnabled() && (regroup || stored.some((a) => !a.groupId))) stored = await regroupDb(stored, days)
  const articles = toIssues(stored, await getLists(), await scoreContext())
  const lastCollectedAt = dbEnabled() ? await lastCollectedFromDb() : memoryCollectedAt
  return { articles, total: stored.length, lastCollectedAt, storage: dbEnabled() ? 'db' : 'memory' }
}

// 「기사 찾기」: 등록 키워드와 상관없이 네이버에서 바로 찾는다
// 수집이 아니라 찾아보기라서 DB에 쌓지 않는다 (추이 집계에도 넣지 않음). 요약하면 요약만 저장된다
// period (18 문서): 네이버 검색 API에는 기간 조건이 없다
// - 'all': 정확도순 100건 (기간 제한 없음)
// - 'today'·'week': 최신순으로 100건씩 넘겨 받다가 기간을 벗어나면 멈춘다. 호출 한도를 생각해 최대 SEARCH_PAGES쪽까지
export const SEARCH_PERIODS = { today: 24, week: 24 * 7, all: null }
const SEARCH_PAGES = { today: 3, week: 5 }

export async function searchArticles(query, { period = 'all' } = {}) {
  const q = String(query ?? '').trim().slice(0, 50)
  if (!q) throw Object.assign(new Error('찾을 말을 입력해 주세요.'), { status: 400 })
  if (!(period in SEARCH_PERIODS)) period = 'all'
  const hours = SEARCH_PERIODS[period]
  let items = []
  let truncated = false
  // 네이버가 한도 · 장애로 막히면 뉴스는 비우고 이유를 돌려준다 → 찾기는 이미 모은 1·2차 출처 · 논문으로 계속 (11/12, sourceGuard.js)
  let newsError = null
  try {
  if (hours === null) {
    items = await searchNews(q, { sort: 'sim' })
  } else {
    const since = Date.now() - hours * 3600_000
    const inPeriod = (item) => Date.parse(item.pubDate) >= since
    for (let page = 0; page < SEARCH_PAGES[period]; page++) {
      const batch = await searchNews(q, { sort: 'date', start: page * 100 + 1 })
      items.push(...batch.filter(inPeriod))
      const reachedEnd = batch.length < 100 || !batch.every(inPeriod)
      if (reachedEnd) break
      if (page === SEARCH_PAGES[period] - 1) truncated = true // 기간 안 기사가 더 있지만 여기까지만
    }
  }
  } catch (err) {
    if (/설정이 없어요/.test(err.message)) throw err
    console.warn(`[search] 네이버 뉴스 없이 찾음: ${err.message}`)
    newsError = err.unavailable ? err.message : `네이버 뉴스 검색 오류 (${err.message.slice(0, 80)})`
  }
  const articles = items.map((item, i) => ({ ...toArticle(item, q), rank: i + 1 })).filter((a) => a.url && a.title)
  const unique = [...new Map(articles.map((a) => [a.url, a])).values()]
  const issues = toIssues(unique, await getLists(), await scoreContext())
  if (dbEnabled()) await linkToCollected(issues)
  // truncated일 때 실제로 어디까지 가져왔는지 (예: '반도체' 7일 → 최신 500건이 약 7시간치)
  const oldestAt = truncated ? items.map((i) => new Date(i.pubDate).toISOString()).sort()[0] : null
  return { query: q, period, fetched: items.length, truncated, oldestAt, articles: issues, newsError }
}

// 「뉴스·논문에서 찾기」에서 이미 모아 둔 1·2차 출처 RSS 글도 같이 찾는다 (11/10)
// 1·2차 출처는 키워드와 상관없이 모두 모으므로(11/09) 새 검색어에 맞는 글이 DB에 이미 있을 수 있다. 네이버 · OpenAlex를 부르지 않아 비용 없음
// - 제목 · 요약에서 공백을 뺀 채 검색어(한글)와 영문 검색어(terms)를 찾는다 (예: 「게이밍 모니터」 = 「게이밍모니터」, gaming monitor)
// - 논문(feed:crossref)은 논문 찾기 쪽에서 따로 보여 주므로 뺀다
// - 기간: 오늘 · 일주일은 뉴스와 같이, 전체는 1년
const COLLECTED_DAYS = { today: 1, week: 7, all: 365 }
const COLLECTED_MAX = 200
export async function searchCollected(searchText, terms = [], { period = 'all' } = {}) {
  if (!dbEnabled()) return { articles: [] }
  const words = [String(searchText ?? '').trim(), ...terms].map((w) => w.toLowerCase().replace(/\s+/g, '')).filter((w) => w.length >= 2)
  if (!words.length) return { articles: [] }
  const { rows } = await query(
    `SELECT id, url, title, description, source, keyword, published_at, section, group_id, full_title
       FROM articles
      WHERE section LIKE 'feed:%' AND section <> 'feed:crossref'
        AND published_at > now() - make_interval(days => $1)
        AND lower(regexp_replace(coalesce(full_title, title) || ' ' || coalesce(description, ''), '\\s+', '', 'g')) LIKE ANY($2)
      ORDER BY published_at DESC LIMIT $3`,
    [COLLECTED_DAYS[period] ?? 365, words.map((w) => `%${w.replace(/[%_\\]/g, '\\$&')}%`), COLLECTED_MAX],
  )
  // 관련도 · 중요도는 검색어 기준으로 다시 본다: 글에 실제로 들어 있는 말(한글 검색어 또는 영문 표기)을 그 글의 키워드로
  const raw = [String(searchText).trim(), ...terms]
  // 짧은 영문 · 숫자 말(SEM · TFT 등)은 다른 영어 낱말 속에서 찾지 않는다 (11/11: 「SEM」이 semiconductor에 걸려 29건)
  const shortAscii = (w) => /^[a-z0-9\s-]{2,5}$/i.test(w.trim())
  const hits = (r) => {
    const original = `${r.full_title ?? r.title} ${r.description ?? ''}`
    const squashed = original.toLowerCase().replace(/\s+/g, '')
    return raw.some((w) => (shortAscii(w) ? mentions(original, w) : squashed.includes(w.toLowerCase().replace(/\s+/g, ''))))
  }
  const stored = rows.filter(hits).map(({ published_at, group_id: _groupId, full_title, ...r }) => {
    const text = `${full_title ?? r.title} ${r.description ?? ''}`.toLowerCase().replace(/\s+/g, '')
    const hit = raw.find((w) => text.includes(w.toLowerCase().replace(/\s+/g, ''))) ?? raw[0]
    return { ...r, keyword: hit, publishedAt: published_at.toISOString(), groupId: null, collected: true, ...(full_title ? { fullTitle: full_title } : {}) }
  })
  return { articles: toIssues(stored, await getLists(), await scoreContext()) }
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
