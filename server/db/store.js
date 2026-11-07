// 요약·보고서 저장. DB가 없으면 서버 메모리에 둔다 (서버를 끄면 비워짐)
import { dbEnabled, query } from './index.js'

// ── 요약 ──
// 같은 이슈로 묶인 기사들은 대표 기사의 요약을 함께 쓴다 (alias_of). '요약한 것을 또 요약'하지 않게
const memorySummaries = new Map() // id → { summary, model, createdAt } 또는 { aliasOf }

function resolveMemory(id) {
  const hit = memorySummaries.get(id)
  return hit?.aliasOf ? memorySummaries.get(hit.aliasOf) : hit
}

export async function getSummary(id) {
  if (!dbEnabled()) return resolveMemory(id) ?? null
  const { rows } = await query(
    `SELECT coalesce(t.content, s.content) AS content, coalesce(t.model, s.model) AS model,
            coalesce(t.created_at, s.created_at) AS created_at, s.alias_of
       FROM summaries s LEFT JOIN summaries t ON t.article_id = s.alias_of
      WHERE s.article_id = $1`,
    [id],
  )
  const r = rows[0]
  if (!r?.content) return null
  return { summary: r.content, model: r.model, createdAt: r.created_at.toISOString(), sharedFrom: r.alias_of ?? undefined }
}

// 여러 기사의 요약을 한 번에 (다른 브라우저에서 열어도 요약 상태를 맞추려고)
export async function getSummaries(ids) {
  const out = {}
  if (!dbEnabled()) {
    for (const id of ids) {
      const hit = resolveMemory(id)
      if (hit?.summary) out[id] = hit
    }
    return out
  }
  if (ids.length === 0) return out
  const { rows } = await query(
    `SELECT s.article_id, coalesce(t.content, s.content) AS content, coalesce(t.model, s.model) AS model,
            coalesce(t.created_at, s.created_at) AS created_at, s.alias_of
       FROM summaries s LEFT JOIN summaries t ON t.article_id = s.alias_of
      WHERE s.article_id = ANY($1::text[])`,
    [ids],
  )
  for (const r of rows) {
    if (!r.content) continue
    out[r.article_id] = { summary: r.content, model: r.model, createdAt: r.created_at.toISOString(), sharedFrom: r.alias_of ?? undefined }
  }
  return out
}

// 대표 기사에 요약을 저장하고, 같은 이슈 기사들은 그 요약을 가리키게 한다
export async function saveSummary(id, result, aliasIds = []) {
  const aliases = aliasIds.filter((a) => a && a !== id)
  if (!dbEnabled()) {
    memorySummaries.set(id, result)
    for (const a of aliases) if (!memorySummaries.get(a)?.summary) memorySummaries.set(a, { aliasOf: id })
    return
  }
  await query(
    `INSERT INTO summaries (article_id, alias_of, content, model, created_at) VALUES ($1, NULL, $2, $3, $4)
     ON CONFLICT (article_id) DO UPDATE SET alias_of = NULL, content = EXCLUDED.content, model = EXCLUDED.model, created_at = EXCLUDED.created_at`,
    [id, result.summary, result.model, result.createdAt],
  )
  if (aliases.length) {
    // 이미 자기 요약이 있는 기사는 건드리지 않는다
    await query(
      `INSERT INTO summaries (article_id, alias_of) SELECT unnest($1::text[]), $2
       ON CONFLICT (article_id) DO UPDATE SET alias_of = EXCLUDED.alias_of WHERE summaries.content IS NULL`,
      [aliases, id],
    )
  }
}

// ── 보고서 ──
const memoryReports = []

function rowToEntry(r) {
  return {
    id: r.id,
    articleKey: r.article_key,
    report: r.report,
    model: r.model,
    createdAt: r.created_at.toISOString(),
    periodLabel: r.period_label,
    articles: r.articles,
    inputs: r.inputs,
  }
}

export async function listReports(limit = 30) {
  if (!dbEnabled()) return memoryReports.slice(0, limit)
  const { rows } = await query('SELECT * FROM reports ORDER BY created_at DESC LIMIT $1', [limit])
  return rows.map(rowToEntry)
}

export async function saveReport(entry) {
  if (!dbEnabled()) {
    memoryReports.unshift(entry)
    return
  }
  await query(
    `INSERT INTO reports (id, title, period_label, article_key, report, articles, inputs, model, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
    [
      entry.id,
      entry.report.title,
      entry.periodLabel,
      entry.articleKey,
      entry.report,
      JSON.stringify(entry.articles),
      JSON.stringify(entry.inputs ?? null),
      entry.model,
      entry.createdAt,
    ],
  )
}

export async function updateReportSection(id, key, bullets) {
  if (!dbEnabled()) {
    const r = memoryReports.find((x) => x.id === id)
    if (r) r.report = { ...r.report, sections: { ...r.report.sections, [key]: { bullets } } }
    return
  }
  await query(
    `UPDATE reports SET report = jsonb_set(report, ARRAY['sections', $2::text], jsonb_build_object('bullets', $3::jsonb)),
            updated_at = now() WHERE id = $1`,
    [id, key, JSON.stringify(bullets)],
  )
}

// 보고서 고치기 (줄 빼기 · AI 보충 근거 찾기): 본문(report)과 근거 목록(articles)을 통째로 바꾼다
export async function updateReport(id, report, articles) {
  if (!dbEnabled()) {
    const r = memoryReports.find((x) => x.id === id)
    if (r) Object.assign(r, { report, articles })
    return
  }
  await query('UPDATE reports SET report = $2, articles = $3, title = $4, updated_at = now() WHERE id = $1', [
    id,
    report,
    JSON.stringify(articles),
    report.title,
  ])
}

export async function deleteReport(id) {
  if (!dbEnabled()) {
    const i = memoryReports.findIndex((x) => x.id === id)
    if (i >= 0) memoryReports.splice(i, 1)
    return
  }
  await query('DELETE FROM reports WHERE id = $1', [id])
}

// ── 정기 수집 키워드 ──
export async function getKeywords() {
  const { rows } = await query('SELECT word FROM keywords ORDER BY position, created_at')
  return rows.map((r) => r.word)
}

// 화면의 키워드 목록 전체를 저장한다 (추가·삭제·순서)
export async function setKeywords(words) {
  const list = [...new Set(words.map((w) => String(w).trim()).filter(Boolean))].slice(0, 20)
  await query('DELETE FROM keywords WHERE NOT (word = ANY($1::text[]))', [list])
  if (list.length) {
    await query(
      `INSERT INTO keywords (word, position) SELECT w, i FROM unnest($1::text[]) WITH ORDINALITY AS t(w, i)
       ON CONFLICT (word) DO UPDATE SET position = EXCLUDED.position`,
      [list],
    )
  }
  return list
}

// ── 앱 설정 (자동 최신화 등) ──
const memorySettings = new Map()

export async function getSetting(key, fallback) {
  if (!dbEnabled()) return memorySettings.get(key) ?? fallback
  const { rows } = await query('SELECT value FROM app_settings WHERE key = $1', [key])
  return rows[0]?.value ?? fallback
}

export async function setSetting(key, value) {
  if (!dbEnabled()) {
    memorySettings.set(key, value)
    return
  }
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  )
}

// ── 선별한 기사의 원문 본문 (article_texts) ──
// 「선별 추가」로 요약을 요청한 기사만 저장한다. DB가 없으면 서버 메모리에 (서버를 끄면 비워짐)
const TEXT_KEEP_DAYS = 90
const memoryTexts = new Map() // id → { url, body, fetchedAt }

export async function getArticleText(id) {
  if (!id) return null
  if (!dbEnabled()) {
    if (memoryTexts.get(id)?.body) return memoryTexts.get(id).body
    if (!String(id).startsWith('m-')) return null
    const { getMaterial } = await import('../materials.js')
    return (await getMaterial(id))?.body ?? null
  }
  const { rows } = await query('SELECT body FROM article_texts WHERE article_id = $1', [id])
  if (rows[0]?.body) return rows[0].body
  // 직접 추가한 자료(m-…)는 materials에 본문이 있다
  if (String(id).startsWith('m-')) {
    const m = await query('SELECT body FROM materials WHERE id = $1', [id])
    return m.rows[0]?.body ?? null
  }
  return null
}

export async function saveArticleText(id, url, body) {
  if (!id || !body) return
  if (!dbEnabled()) {
    memoryTexts.set(id, { url, body, fetchedAt: Date.now() })
    return
  }
  await query(
    `INSERT INTO article_texts (article_id, url, body, fetched_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (article_id) DO UPDATE SET url = EXCLUDED.url, body = EXCLUDED.body, fetched_at = now()`,
    [id, url ?? null, body],
  )
}

// 수집 기사 id로 원문 주소 찾기 (화면이 url을 안 보낸 예전 요청용)
export async function articleUrlOf(id) {
  if (!id || !dbEnabled()) return null
  const { rows } = await query('SELECT url FROM articles WHERE id = $1', [id])
  return rows[0]?.url ?? null
}

export async function pruneArticleTexts() {
  if (!dbEnabled()) return
  await query(`DELETE FROM article_texts WHERE fetched_at < now() - interval '${TEXT_KEEP_DAYS} days'`)
}

// ── 브라우저별 선별 폴더 (selections) ──
const memorySelections = new Map()

export async function getSelection(clientId) {
  if (!clientId) return null
  if (!dbEnabled()) return memorySelections.get(clientId) ?? null
  const { rows } = await query('SELECT data, updated_at FROM selections WHERE client_id = $1', [clientId])
  return rows[0] ? { ...rows[0].data, updatedAt: rows[0].updated_at.toISOString() } : null
}

export async function saveSelection(clientId, data) {
  if (!clientId) return
  if (!dbEnabled()) {
    memorySelections.set(clientId, { ...data, updatedAt: new Date().toISOString() })
    return
  }
  await query(
    `INSERT INTO selections (client_id, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (client_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [clientId, JSON.stringify(data)],
  )
}
