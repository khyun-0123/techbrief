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
const memoryReportIps = new Map() // DB 없을 때 보고서 id → 만든 IP

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
    ...(r.deleted_at ? { deletedAt: r.deleted_at.toISOString() } : {}),
  }
}

// ip: 요청한 사람의 IP → 각 보고서에 mine(내가 만든 것) · starred(내가 중요 표시)를 붙인다. withIp: 관리 페이지에서만 만든 IP까지
// 휴지통: 일반 화면에는 자기 휴지통만 보인다 (다른 사람이 휴지통에 넣은 보고서는 목록에서 빠짐). 관리 페이지(withIp)는 모두
export async function listReports(limit = 30, { ip = null, withIp = false } = {}) {
  // 만든 브라우저 번호(createdBy)는 내보내지 않는다. 내 것인지는 mine으로 (11/09)
  const mark = (entry, createdIp) => ({
    ...entry,
    report: (({ createdBy: _c, ...rest }) => rest)(entry.report ?? {}),
    mine: Boolean(ip && createdIp && createdIp === ip),
    ...(withIp ? { createdIp: createdIp ?? null } : {}),
  })
  if (!dbEnabled()) return memoryReports.filter((e) => withIp || !e.deletedAt || memoryReportIps.get(e.id) === ip).slice(0, limit).map((e) => mark(e, memoryReportIps.get(e.id)))
  const { rows } = await query(
    `SELECT * FROM reports WHERE $2::boolean OR deleted_at IS NULL OR created_ip = $3 ORDER BY created_at DESC LIMIT $1`,
    [limit, withIp, ip],
  )
  const stars = ip ? new Set((await query('SELECT report_id FROM report_stars WHERE owner = $1', [ip])).rows.map((x) => x.report_id)) : new Set()
  return rows.map((r) => ({ ...mark(rowToEntry(r), r.created_ip), starred: stars.has(r.id) }))
}

// ── 휴지통 (11/13) ──
export async function trashReport(id) {
  if (!dbEnabled()) {
    const e = memoryReports.find((x) => x.id === id)
    if (e) e.deletedAt = new Date().toISOString()
    return
  }
  await query('UPDATE reports SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [id])
}
export async function restoreReport(id) {
  if (!dbEnabled()) {
    const e = memoryReports.find((x) => x.id === id)
    if (e) delete e.deletedAt
    return
  }
  await query('UPDATE reports SET deleted_at = NULL WHERE id = $1', [id])
}
export async function reportTrashedAt(id) {
  if (!dbEnabled()) return memoryReports.find((x) => x.id === id)?.deletedAt ?? null
  const { rows } = await query('SELECT deleted_at FROM reports WHERE id = $1', [id])
  return rows[0]?.deleted_at ?? null
}
// 휴지통에 days일 넘게 있던 보고서를 영구 삭제 (0이면 자동으로 지우지 않음)
export async function purgeTrash(days) {
  if (!(days > 0) || !dbEnabled()) return 0
  const { rowCount } = await query(`DELETE FROM reports WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => $1)`, [days])
  return rowCount
}

// ── 중요 표시 (11/13, owner = IP) ──
export async function setReportStar(owner, id, on) {
  if (!dbEnabled() || !owner) return
  if (on) await query('INSERT INTO report_stars (owner, report_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [owner, id])
  else await query('DELETE FROM report_stars WHERE owner = $1 AND report_id = $2', [owner, id])
}

// 같은 제목이 이미 있으면 끝에 번호 (11/17 조장): 「11.17 OLED 동향 브리핑」 → 「… 2」 → 「… 3」. 휴지통에 있는 것도 센다(번호가 겹치지 않게)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export async function uniqueReportTitle(title) {
  const base = String(title ?? '').trim() || '보고서'
  const titles = dbEnabled()
    ? (await query(`SELECT title FROM reports WHERE title = $1 OR title ~ $2`, [base, `^${escapeRe(base)} [0-9]+$`])).rows.map((r) => r.title)
    : memoryReports.map((e) => e.report?.title).filter((t) => t === base || new RegExp(`^${escapeRe(base)} \\d+$`).test(t ?? ''))
  if (!titles.length) return base
  const nums = titles.map((t) => (t === base ? 1 : Number(t.slice(base.length + 1)) || 1))
  return `${base} ${Math.max(...nums) + 1}`
}

// ip: 만든 사람의 IP (일반 화면에서 지울 수 있는 사람). 화면에는 보내지 않는다
// unique: 새로 만든 보고서 — 같은 제목이 있으면 번호를 붙여 저장 (entry.report.title도 바뀜)
export async function saveReport(entry, ip = null, { unique = false } = {}) {
  if (unique) entry.report.title = await uniqueReportTitle(entry.report.title)
  if (!dbEnabled()) {
    memoryReports.unshift(entry)
    if (ip) memoryReportIps.set(entry.id, ip)
    return
  }
  await query(
    `INSERT INTO reports (id, title, period_label, article_key, report, articles, inputs, model, created_at, created_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
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
      ip,
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
// 만든 브라우저 번호(createdBy)는 보낸 값을 무시하고 원래 값을 지킨다. 누구나 고칠 수는 있지만,
// 번호를 바꿔 삭제 권한(만든 브라우저 · 관리자)을 가져가지 못하게 (11/08)
export async function updateReport(id, report, articles) {
  const { createdBy: _ignored, ...body } = report
  if (!dbEnabled()) {
    const r = memoryReports.find((x) => x.id === id)
    if (r) {
      const owner = r.report?.createdBy
      Object.assign(r, { report: owner ? { ...body, createdBy: owner } : body, articles })
    }
    return
  }
  await query(
    `UPDATE reports
        SET report = CASE WHEN report ? 'createdBy' THEN $2::jsonb || jsonb_build_object('createdBy', report->'createdBy') ELSE $2::jsonb END,
            articles = $3, title = $4, updated_at = now()
      WHERE id = $1`,
    [id, body, JSON.stringify(articles), body.title],
  )
}

// 보고서를 만든 IP (11/08부터 기록, 그 전 보고서는 null → 관리 페이지에서만 지움)
export async function reportOwnerIp(id) {
  if (!dbEnabled()) return memoryReportIps.get(id) ?? null
  const { rows } = await query('SELECT created_ip FROM reports WHERE id = $1', [id])
  return rows[0]?.created_ip ?? null
}

// 보고서 자동 정리: 만든 지 days일이 지난 보고서를 휴지통으로 보낸다 (11/13부터: 바로 지우지 않음 → 휴지통 보관 기간 뒤 영구 삭제)
export async function trashReportsOlderThan(days) {
  if (!(days > 0)) return 0
  if (!dbEnabled()) return deleteReportsOlderThan(days)
  const { rowCount } = await query(`UPDATE reports SET deleted_at = now() WHERE deleted_at IS NULL AND created_at < now() - make_interval(days => $1)`, [days])
  return rowCount
}

// 영구 삭제 (DB 없을 때 · 관리자). 지운 개수를 돌려준다
export async function deleteReportsOlderThan(days) {
  if (!(days > 0)) return 0
  const cutoff = Date.now() - days * 86_400_000
  if (!dbEnabled()) {
    let n = 0
    for (let i = memoryReports.length - 1; i >= 0; i--) {
      if (Date.parse(memoryReports[i].createdAt) < cutoff) {
        memoryReportIps.delete(memoryReports[i].id)
        memoryReports.splice(i, 1)
        n++
      }
    }
    return n
  }
  const { rowCount } = await query(`DELETE FROM reports WHERE created_at < now() - make_interval(days => $1)`, [days])
  return rowCount
}

export async function deleteReport(id) {
  if (!dbEnabled()) {
    const i = memoryReports.findIndex((x) => x.id === id)
    if (i >= 0) memoryReports.splice(i, 1)
    memoryReportIps.delete(id)
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
