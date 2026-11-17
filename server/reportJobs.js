// 보고서 작업 대기열 (11/08 조장)
// - 「보고서 만들기」를 누르면 바로 만들지 않고 대기열에 넣는다. 다른 탭에 가도 오른쪽 아래 진행 창에서 본다
// - 한 번에 한 건씩 (맥미니 한 대라 동시에 돌리면 둘 다 느려짐)
// - 자료 조사 수준 (level)
//   selected: 체크한 기사만으로 쓴다
//   owned:    초안에서 'AI 해설'로 나온 줄(근거 없음)을 우리 자료(모은 기사 · 저장 원문 · 직접 추가 자료 · 위키백과)로 보충
//   research: owned + 바깥에서 새로 찾기(네이버 뉴스 · 논문)
// - 보충에 '아직 요약 안 된 기사'가 필요하면 시간이 걸리므로 사용자에게 묻는다 (need_confirm → 답 → 계속)
// - 작업은 서버 메모리에만 둔다 (서버를 다시 켜면 진행 중인 작업은 사라짐, 만든 보고서는 보고서함에 남음)
import { randomUUID } from 'node:crypto'
import { searchArticles } from './collector/index.js'
import { DISPLAY_TOPICS } from './papers/journals.js'
import { searchPapers } from './papers/index.js'
import { bestPassage, dbCandidates, inputCandidates, rewriteWithPassages, termsOf } from './reinforce.js'
import { dbEnabled } from './db/index.js'
import { saveReport } from './db/store.js'
import { cancelAi, PRIORITY, withQueueContext } from './llm/client.js'
import { summarizeArticle } from './summarize.js'
import { lookupWiki } from './wiki.js'
import { kindOfBullet } from './reportShared.js'
import { isProposal } from './llm/evidence.js'

export const LEVELS = {
  selected: '선택한 자료만',
  owned: '보유 자료까지',
  research: '추가 자료 조사까지',
}
const SUMMARY_MS = 40_000 // 요약 1건 예상 (맥미니, 원문 포함)
const MAX_GAPS = 8 // 보충할 줄 최대
const MAX_NEW_SUMMARIES = 6 // 새로 요약할 기사 최대
const KEEP_MS = 6 * 3600_000 // 끝난 작업을 목록에 두는 시간
const PASSAGE_MAX = 600

// 서버 코드를 고치면 Vite가 같은 프로세스에서 모듈을 다시 불러온다 → 작업 목록이 비지 않게 globalThis에 둔다
const G = (globalThis.__reportJobs ??= { jobs: new Map(), running: null, buildDraft: null })
const jobs = G.jobs

export function setDraftBuilder(fn) {
  G.buildDraft = fn
}

function pub(job) {
  const { body: _b, entry: _e, waiter: _w, cancel: _c, ip: _ip, clientId: _id, ...rest } = job // IP · 브라우저 번호는 화면에 보내지 않음
  const queued = [...jobs.values()].filter((j) => j.status === 'queued')
  return { ...rest, queuePos: job.status === 'queued' ? queued.findIndex((j) => j.id === job.id) + 1 : 0 }
}

export function listJobs(clientId) {
  const now = Date.now()
  for (const [id, j] of jobs) if (j.finishedAt && now - Date.parse(j.finishedAt) > KEEP_MS) jobs.delete(id)
  return [...jobs.values()].filter((j) => !clientId || j.clientId === clientId).map(pub)
}

// 대기열 보기 (11/15): 아직 끝나지 않은 보고서 작업 전체. 남의 브라우저 번호 대신 mine만 보낸다
export function activeJobs(viewer) {
  return [...jobs.values()]
    .filter((j) => ['queued', 'running', 'need_confirm'].includes(j.status))
    .map((j) => ({ title: j.title, status: j.status, step: j.step, progress: j.progress, count: j.count, levelLabel: j.levelLabel, who: viewer && j.clientId === viewer ? 'mine' : 'other', createdAt: j.createdAt }))
}

function step(job, label, progress) {
  job.step = label
  if (progress !== undefined) job.progress = progress
  job.updatedAt = new Date().toISOString()
}

// ip: 요청한 사람의 IP → 만든 보고서에 기록 (일반 화면에서 그 IP만 지울 수 있음)
export function addJob(body, clientId, ip = null) {
  const level = LEVELS[body.level] ? body.level : 'selected'
  const job = {
    id: `rj-${randomUUID().slice(0, 8)}`,
    clientId: String(clientId ?? '').slice(0, 64) || null,
    ip,
    title: String(body.title ?? '').trim() || `${String(body.topics?.[0] ?? '').trim() || '테크'} 동향 브리핑`, // 11/14: 주제 키워드를 제목에
    level,
    levelLabel: LEVELS[level],
    count: (body.articles ?? []).length,
    status: 'queued',
    step: '대기 중',
    progress: 0,
    createdAt: new Date().toISOString(),
    body,
  }
  jobs.set(job.id, job)
  pump()
  return pub(job)
}

function checkOwner(job, { clientId, ip } = {}) {
  const sameClient = job.clientId && job.clientId === String(clientId ?? '')
  const sameIp = !job.ip || job.ip === ip
  if (!sameClient || !sameIp) throw Object.assign(new Error('이 작업을 만든 브라우저에서만 답하거나 취소할 수 있어요.'), { status: 403 })
}

export function answerJob(id, use, who) {
  const job = jobs.get(id)
  if (job) checkOwner(job, who)
  if (!job || job.status !== 'need_confirm') throw Object.assign(new Error('답할 수 있는 작업이 아니에요.'), { status: 400 })
  job.waiter?.(Boolean(use))
  return pub(job)
}

export function cancelJob(id, who) {
  const job = jobs.get(id)
  if (!job) throw Object.assign(new Error('없는 작업이에요.'), { status: 404 })
  checkOwner(job, who)
  if (job.status === 'queued' || job.status === 'need_confirm') {
    job.status = 'cancelled'
    job.step = '취소됨'
    job.finishedAt = new Date().toISOString()
    job.waiter?.(null)
  } else if (job.status === 'running') {
    job.cancel = true
    cancelAi(job.id) // 11/17: AI가 쓰는 중이어도 바로 멈춤 (예전엔 그 단계가 끝날 때까지 돎)
  }
  return pub(job)
}

async function pump() {
  if (G.running) return
  const next = [...jobs.values()].find((j) => j.status === 'queued')
  if (!next) return
  G.running = next
  try {
    // 대기열 보기: 이 보고서 작업의 AI 호출은 만든 브라우저 · 보고서 제목으로 보인다 (pump를 부른 다른 요청의 브라우저가 아니라)
    await withQueueContext({ client: next.clientId, label: next.title, jobId: next.id }, () => run(next))
  } catch (err) {
    next.status = err.cancelled ? 'cancelled' : 'error'
    next.error = err.cancelled ? null : err.message
    next.step = err.cancelled ? '취소됨' : '오류'
    next.finishedAt = new Date().toISOString()
    if (!err.cancelled) console.warn(`[report-job] ${next.id} 실패: ${err.message}`)
  } finally {
    G.running = null
    pump()
  }
}

function checkCancel(job) {
  if (job.cancel) throw Object.assign(new Error('취소했어요'), { cancelled: true })
}

// ── 보충할 줄 찾기 ──
function gapsOf(entry) {
  const out = []
  for (const [key, sec] of Object.entries(entry.report.sections)) {
    ;(sec.bullets ?? []).forEach((b, i) => {
      // 제안 · 전망(~할 수 있음, 필요함 …)은 원래 AI 몫이라 보충하지 않는다 (사실로 바꾸면 제안이 사라짐)
      if (kindOfBullet(b) === 'ai' && !isProposal(b.text)) out.push({ key, index: i, text: b.text })
    })
  }
  return out.slice(0, MAX_GAPS)
}

// 바깥에서 새로 찾기: 네이버 뉴스(정확도순 몇 건) · 논문(디스플레이 주제 최근 2년)
async function externalCandidates(terms) {
  const q = terms.slice(0, 3).join(' ')
  const out = []
  try {
    const { articles } = await searchArticles(q, { period: 'all' })
    // 제목에 찾는 말이 하나도 없는 기사(종목 소개 · 인물 기사 등)는 뺀다
    const onTopic = articles.filter((a) => terms.some((t) => a.title.toLowerCase().includes(t.toLowerCase())))
    for (const a of onTopic.slice(0, 5)) out.push({ ...a, kind: 'data', text: `${a.title}. ${a.description ?? ''}`, summarized: false, external: 'news' })
  } catch (err) {
    console.warn(`[report-job] 뉴스 찾기 실패: ${err.message}`)
  }
  try {
    const to = new Date().toISOString().slice(0, 10)
    const from = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10)
    const { works } = await searchPapers({ query: terms.filter((t) => /[A-Za-z]/.test(t)).slice(0, 3).join(' ') || q, from, to, sort: 'cited', limit: 5, topics: DISPLAY_TOPICS })
    for (const w of works.filter((x) => x.abstract).slice(0, 3)) {
      out.push({ id: `doi:${w.doi || w.url}`, title: w.title, source: w.journal || '논문', url: w.url, published_at: w.date || null, text: `${w.title}. ${w.abstract}`, kind: 'data', summarized: true, external: 'paper' })
    }
  } catch (err) {
    console.warn(`[report-job] 논문 찾기 실패: ${err.message}`)
  }
  return out
}

function ask(job, question) {
  job.status = 'need_confirm'
  job.question = question
  step(job, '확인 기다리는 중')
  return new Promise((resolve) => {
    job.waiter = (ans) => {
      job.waiter = null
      job.question = null
      if (ans !== null) job.status = 'running'
      resolve(ans)
    }
  })
}

async function run(job) {
  job.status = 'running'
  job.startedAt = new Date().toISOString()
  step(job, '초안 쓰는 중', 10)
  if (!G.buildDraft) throw new Error('보고서 작성기가 준비되지 않았어요')
  const entry = await G.buildDraft(job.body)
  checkCancel(job)

  let research = { level: job.level, levelLabel: job.levelLabel, gaps: 0, filled: 0, notFound: 0, summarized: 0, skipped: 0 }
  if (job.level !== 'selected') {
    const gaps = gapsOf(entry)
    research.gaps = gaps.length
    if (gaps.length) research = await supplement(job, entry, gaps, research)
  }
  checkCancel(job)

  entry.research = research
  entry.report.createdBy = job.clientId // 「내가 만든 보고서」 (브라우저 무작위 번호, 이름 · IP 없음)
  if (research.filled) {
    entry.report.warnings = [
      `자료 조사(${job.levelLabel}): AI 해설 ${research.gaps}줄 중 ${research.filled}줄을 우리 자료${job.level === 'research' ? ' · 새로 찾은 자료' : ''}로 보충했어요`,
      ...(entry.report.warnings ?? []).filter((w) => !/^AI 해설·제안 \d+개/.test(w)),
    ]
    const left = Object.values(entry.report.sections).flatMap((s) => s.bullets).filter((b) => kindOfBullet(b) === 'ai').length
    if (left) entry.report.warnings.splice(1, 0, `AI 해설·제안 ${left}개는 근거를 찾지 못했어요 — 확인 후 쓰세요`)
  }
  step(job, '저장하는 중', 95)
  if (dbEnabled()) await saveReport(entry, job.ip, { unique: true })
  job.title = entry.report.title // 날짜 · 번호가 붙은 저장 제목으로 (AI 대기열 카드)
  entry.mine = true // 만든 사람 화면에서 바로 지울 수 있게
  job.entry = entry
  job.entryId = entry.id
  job.result = entry // 화면이 바로 보고서함에 넣는다 (DB가 없을 때도)
  job.status = 'done'
  step(job, '완성', 100)
  job.finishedAt = new Date().toISOString()
}

async function supplement(job, entry, gaps, research) {
  const inputs = entry.inputs ?? []
  // 1) 줄마다 후보 모으기
  step(job, `보충할 자료 찾는 중 (AI 해설 ${gaps.length}줄)`, 40)
  const inputPool = await inputCandidates(inputs)
  for (const g of gaps) {
    g.terms = termsOf(g.text)
    const owned = await dbCandidates(g.terms).catch(() => [])
    const ext = job.level === 'research' ? await externalCandidates(g.terms) : []
    const pool = [...inputPool, ...owned, ...ext]
    g.cands = pool
      .map((c) => ({ c, p: bestPassage(c.text, g.terms) }))
      .filter((x) => x.p && x.p.hit >= Math.min(2, g.terms.length))
      .sort((a, b) => b.p.hit - a.p.hit)
      .slice(0, 6)
    checkCancel(job)
  }

  // 2) 요약 안 된 기사가 필요하면 묻기
  // 이미 요약이 있는 기사(보고서 근거 · 요약된 모은 기사)와 같은 주소면 묻지 않고 그 요약을 쓴다
  const have = new Map()
  for (const g of gaps) for (const { c } of g.cands) if (c.summarized && c.url) have.set(c.url, c)
  for (const g of gaps) g.cands = g.cands.map((x) => (!x.c.summarized && have.has(x.c.url) ? { ...x, c: have.get(x.c.url) } : x))
  const need = new Map()
  for (const g of gaps) for (const { c } of g.cands) if (!c.summarized && c.url && !need.has(c.url)) need.set(c.url, c)
  const list = [...need.values()].slice(0, MAX_NEW_SUMMARIES)
  let useNew = false
  if (list.length) {
    const ans = await ask(job, {
      kind: 'summarize',
      count: list.length,
      minutes: Math.max(1, Math.round((list.length * SUMMARY_MS) / 60_000)),
      items: list.map((c) => ({ title: c.title, source: c.source, external: c.external ?? null })),
    })
    if (ans === null) throw Object.assign(new Error('취소했어요'), { cancelled: true })
    useNew = ans
    if (useNew) {
      for (const [i, c] of list.entries()) {
        checkCancel(job)
        step(job, `요약 안 된 기사 요약 중 ${i + 1}/${list.length}`, 45 + Math.round((i / list.length) * 20))
        try {
          const { summary } = await summarizeArticle({ id: c.id, url: c.url, title: c.title, source: c.source, description: c.description ?? '' }, [], { priority: PRIORITY.REPORT })
          const items = Object.values(summary?.items ?? {})
            .filter((it) => it.basis === 'article')
            .map((it) => it.text)
            .join(' ')
          c.text = `${c.title}. ${summary?.headline ?? ''} ${items} ${c.description ?? ''}`
          c.summarized = true
          research.summarized += 1
        } catch (err) {
          console.warn(`[report-job] 요약 실패: ${err.message}`)
        }
      }
    } else {
      research.skipped = list.length
    }
  }

  // 3) 줄마다 고쳐 쓰기 (요약된 것 · 원문 · 위키백과만)
  const n = gaps.length
  for (const [i, g] of gaps.entries()) {
    checkCancel(job)
    step(job, `AI 해설 보충 중 ${i + 1}/${n}`, 65 + Math.round((i / n) * 28))
    const passages = []
    const seen = new Set()
    for (const { c } of g.cands) {
      if (!c.summarized || seen.has(c.url || c.id)) continue
      seen.add(c.url || c.id)
      const p = bestPassage(c.text, g.terms)
      if (!p) continue
      passages.push({
        label: c.kind === 'input' ? `이 보고서 근거 [${c.n}]` : c.external === 'paper' ? '논문' : c.external === 'news' ? '새로 찾은 기사' : c.material ? '직접 추가한 자료' : '모은 기사',
        title: c.title,
        text: p.text.slice(0, PASSAGE_MAX),
        ref: { id: c.id, n: c.n, title: c.title, source: c.source ?? '', url: c.url ?? '', publishedAt: c.published_at ? new Date(c.published_at).toISOString() : c.publishedAt },
        kind: 'data',
      })
      if (passages.length >= 4) break
    }
    for (const t of g.terms.slice(0, 1)) {
      try {
        const { result } = await lookupWiki(t)
        if (result && !result.near) passages.push({ label: '백과(위키백과)', title: result.title, text: result.extract.slice(0, PASSAGE_MAX), ref: { title: `${result.title} — 위키백과`, source: '위키백과', url: result.url, wiki: true }, kind: 'wiki' })
      } catch {
        // 위키백과가 막혀도 계속
      }
    }
    if (!passages.length) {
      research.notFound += 1
      continue
    }
    const r = await rewriteWithPassages(g.text, passages, entry.articles)
    if (!r.found) {
      research.notFound += 1
      continue
    }
    entry.articles.push(...r.added)
    const bullets = entry.report.sections[g.key].bullets
    bullets[g.index] = { ...bullets[g.index], ...r.bullet }
    research.filled += 1
  }
  return research
}
