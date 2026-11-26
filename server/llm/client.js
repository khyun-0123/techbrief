// AI 모델 호출은 이 파일에서만 한다. 모델을 바꿀 때는 .env.local 값만 바꾼다.
// OpenAI 호환 /chat/completions 주소를 쓰므로 Ollama(맥미니)와 상용 API 모두 같은 코드로 부른다.
// AI 서버는 세 곳(맥미니·OpenRouter·EXAONE API)이고 관리 화면에서 고른다. 고른 값은 이 서버 메모리에만 둔다 (팀원 서버와 별개)
// EXAONE API(11/11, K-EXAONE 2.5 무료 API)는 외부 서버 + 비상업 약관 → 공개 기사로 시험할 때만 (23 문서 3-2)

import { AsyncLocalStorage } from 'node:async_hooks'
import { recordAiCall } from '../usage.js'
import { BUILTIN_IDS, builtinOverride, customConnections } from './connections.js'
import { accessToken, readKey } from '../patents.js'

const TIMEOUT_MS = 120_000 // 요약 기본값. 보고서처럼 긴 출력은 호출할 때 늘린다

const PROVIDER_IDS = BUILTIN_IDS
// 11/25: 관리 페이지에서 더한 연결(connections.js)까지 — 기본 세 곳 뒤에
const allIds = () => [...PROVIDER_IDS, ...customConnections().map((c) => c.id)]
// 11/20 관리자 인수인계: 모델 이름 · 예비 AI를 관리 페이지에서 (DB llm_models, index.js가 켤 때 · 저장할 때 setModelOverrides)
// 비어 있는 칸은 설정 파일(.env.local) 값을 쓴다. 주소 · 열쇠(API 키)는 여기서 바꾸지 않는다 (설정 파일에만)
const OV = (globalThis.__techbriefLlmOverrides ??= { models: {}, fallback: undefined })
const MODEL_RE = /^[\w.:/@+-]{2,120}$/
export function checkModelOverrides(input) {
  const models = {}
  for (const id of PROVIDER_IDS) {
    const m = input?.models?.[id] ?? {}
    const out = {}
    for (const k of ['model', 'reportModel']) {
      const v = String(m[k] ?? '').trim()
      if (!v) continue
      if (!MODEL_RE.test(v)) throw Object.assign(new Error(`모델 이름 「${v}」에 쓸 수 없는 글자가 있어요.`), { status: 400 })
      out[k] = v
    }
    if (Object.keys(out).length) models[id] = out
  }
  const fb = input?.fallback
  const fallback = fb === undefined || fb === null || fb === '' ? undefined : fb === 'none' || allIds().includes(fb) ? fb : undefined
  return { models, fallback }
}
export function setModelOverrides(v) {
  const c = checkModelOverrides(v)
  OV.models = c.models
  OV.fallback = c.fallback
  return c
}
export const modelOverrides = () => ({ models: OV.models, fallback: OV.fallback ?? null })
const ov = (id, k) => OV.models[id]?.[k] || undefined

// 11/25: 관리 페이지에서 넣은 주소 · 키(connections.js)를 설정 파일 값보다 먼저. 끈 연결은 ready가 아님
function providerConfig(id) {
  const custom = customConnections().find((c) => c.id === id)
  if (custom) {
    return { ...custom, numCtx: 0, reasoningEffort: '', pingPath: '/models', envHint: custom.vertex ? '관리 페이지의 주소 · 모델 (키 대신 서버의 Google 서비스 계정)' : '관리 페이지의 주소 · API 키 · 모델', custom: true }
  }
  const o = builtinOverride(PROVIDER_IDS.includes(id) ? id : 'local')
  return { ...builtinConfig(id, o), disabled: o.disabled, parallel: o.parallel || 1 }
}
function builtinConfig(id, o) {
  // K-EXAONE 2.5 (docs.exaone.ai): OpenAI 호환 /v1/chat/completions, 모델 k-exaone_v2.5. 늘 먼저 추론하고(끌 수 없음)
  // 추론은 message.reasoning_content로 따로 오므로 content만 쓰면 된다. reasoning_effort 기본값 max는 느려 low로
  // API 키는 30일마다 만료 (약관 3조 4항) → 401이 나면 Showroom에서 새로 받아 .env.local을 바꾸고 「서버 다시 켜기」
  if (id === 'exaone') {
    return {
      id,
      label: 'EXAONE API',
      baseUrl: o.baseUrl || process.env.EXAONE_BASE_URL || 'https://api.exaone.ai/v1',
      apiKey: o.apiKey || process.env.EXAONE_API_KEY,
      model: ov('exaone', 'model') || process.env.EXAONE_MODEL || 'k-exaone_v2.5',
      reportModel: ov('exaone', 'reportModel') || process.env.EXAONE_REPORT_MODEL,
      numCtx: 0,
      reasoningEffort: process.env.EXAONE_REASONING_EFFORT || 'low',
      pingPath: '/models',
      envHint: 'EXAONE_API_KEY',
    }
  }
  if (id === 'openrouter') {
    return {
      id,
      label: 'OpenRouter',
      baseUrl: o.baseUrl || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: o.apiKey || process.env.OPENROUTER_API_KEY,
      model: ov('openrouter', 'model') || process.env.OPENROUTER_MODEL,
      reportModel: ov('openrouter', 'reportModel') || process.env.OPENROUTER_REPORT_MODEL,
      numCtx: 0,
      reasoningEffort: '',
      pingPath: '/key', // OpenRouter의 /models는 키 없이도 열려 있어 키 확인용 주소를 쓴다
      envHint: 'OPENROUTER_API_KEY, OPENROUTER_MODEL',
    }
  }
  return {
    id: 'local',
    label: '맥미니',
    baseUrl: o.baseUrl || process.env.LLM_BASE_URL,
    apiKey: o.apiKey || process.env.LLM_API_KEY,
    model: ov('local', 'model') || process.env.LLM_SUMMARY_MODEL,
    reportModel: ov('local', 'reportModel') || process.env.LLM_REPORT_MODEL,
    numCtx: Number(process.env.LLM_NUM_CTX) || 0,
    reasoningEffort: process.env.LLM_REASONING_EFFORT || '',
    pingPath: '/models',
    envHint: 'LLM_BASE_URL, LLM_API_KEY, LLM_SUMMARY_MODEL',
  }
}

const isReady = (c) => Boolean(c.baseUrl && (c.apiKey || c.vertex) && c.model && !c.disabled)

// ── Vertex AI (11/26): 키 대신 서버의 Google 서비스 계정(GCP_KEY_JSON)으로 1시간짜리 토큰. 만료 5분 전에 새로 받는다
// 주소는 https://aiplatform.googleapis.com 만 넣어도 된다 → …/v1/projects/<서비스 계정 프로젝트>/locations/global/endpoints/openapi
// {project}를 쓰면 그 자리에 프로젝트를 넣는다
const VTX = (globalThis.__vertexToken ??= { token: null, until: 0, pending: null })
function vertexBase(url) {
  const key = readKey()
  const proj = key?.project_id
  let u = String(url ?? '').replace(/\/$/, '')
  if (!proj) return u
  if (u.includes('{project}')) return u.replaceAll('{project}', proj)
  if (!/\/projects\//.test(u)) u = `${u.replace(/\/v1(beta1)?$/, '')}/v1/projects/${proj}/locations/global/endpoints/openapi`
  return u
}
// 토큰은 서비스 계정마다 따로 기억한다 — 관리 페이지 「수집 API 키 › Google Cloud」에서 다른 계정 키로 바꾸면 바로 새 계정 토큰으로 (11/26)
async function vertexToken() {
  const key = readKey()
  if (!key) throw new Error('Vertex AI: 서버에 Google 서비스 계정 키(GCP_KEY_JSON)가 없어요. 관리 페이지 「수집 API 키 › Google Cloud」에 넣어 주세요.')
  const who = `${key.client_email}|${key.project_id}`
  if (VTX.token && VTX.who === who && Date.now() < VTX.until) return VTX.token
  if (VTX.pending && VTX.pendingWho === who) return VTX.pending
  VTX.pendingWho = who
  VTX.pending = (async () => {
    const t = await accessToken(key, 'https://www.googleapis.com/auth/cloud-platform')
    Object.assign(VTX, { token: t, who, until: Date.now() + 55 * 60_000 })
    return t
  })().finally(() => {
    VTX.pending = null
    VTX.pendingWho = null
  })
  return VTX.pending
}
// 요청 머리글의 인증: Vertex면 Google 토큰, 아니면 API 키
async function authOf(cfg) {
  return `Bearer ${cfg.vertex ? await vertexToken() : cfg.apiKey}`
}
const notReady = (c) => (c.disabled ? `${c.label} 연결은 꺼져 있어요. 관리 페이지 「AI 연결」에서 켜 주세요.` : `${c.label} AI 설정이 없어요. 관리 페이지 「AI 연결」에서 주소 · API 키를 넣거나 서버 설정에 ${c.envHint}를 넣어 주세요.`)

// 처음 값: LLM_PROVIDER(local|openrouter|exaone) → 없으면 설정이 채워진 첫 번째
let selected = null
function currentId() {
  // 고른 연결이 지워졌으면(11/25 새 연결 지우기) 처음 값으로
  if (selected && allIds().includes(selected)) return selected
  const wanted = process.env.LLM_PROVIDER
  if (PROVIDER_IDS.includes(wanted)) return wanted
  return allIds().find((id) => isReady(providerConfig(id))) ?? 'local'
}
export const currentProviderId = () => currentId()

// id를 주면 그 AI 서버로 (관리자 테스트 페이지의 서버 비교용), 없으면 지금 고른 서버
function config(id = currentId()) {
  if (!allIds().includes(id)) throw Object.assign(new Error('없는 AI 서버예요.'), { status: 400 })
  const c = providerConfig(id)
  if (!isReady(c)) {
    throw new Error(notReady(c))
  }
  return { ...c, baseUrl: c.vertex ? vertexBase(c.baseUrl) : c.baseUrl.replace(/\/$/, '') }
}

// 대체 AI 서버 (11/12, 33 문서 6장 W19): 지금 서버가 연결 실패 · 시간 초과 · 5xx · 429면 「사람이 누른 요청만」 한 번 다시 보낸다
// LLM_FALLBACK(local|openrouter|exaone)이 있을 때만. 자동 요약 같은 뒤에서 도는 일은 넘기지 않는다 (유료 모델 비용이 쌓이지 않게)
function fallbackId(primary) {
  const id = OV.fallback !== undefined ? OV.fallback : process.env.LLM_FALLBACK // 관리 페이지 값 먼저 ('none' = 쓰지 않음)
  if (!allIds().includes(id) || id === primary) return null
  return isReady(providerConfig(id)) ? id : null
}
const reachable = (err) => err?.name === 'TimeoutError' || /fetch failed|ECONN|ENOTFOUND|AI 서버 응답 오류 (5\d\d|429)/.test(String(err?.message ?? ''))
let lastFallback = null // { at, from, to, reason }

// 화면 상단 선택 상자용 목록 (키는 보내지 않는다)
export function llmProviders() {
  return {
    current: currentId(),
    parallel: limitOf(currentId()), // 11/26: 화면 요약 대기열도 이만큼 함께 보낸다 (src/summaryQueue.js)
    fallback: fallbackId(currentId()),
    fallbackSetting: OV.fallback ?? null,
    envFallback: process.env.LLM_FALLBACK || null,
    lastFallback,
    providers: allIds().map((id) => {
      const c = providerConfig(id)
      return { id, label: c.label, model: c.model ?? '', reportModel: c.reportModel ?? '', ready: isReady(c), parallel: Math.max(1, Number(c.parallel) || 1), vertex: Boolean(c.vertex), disabled: Boolean(c.disabled), custom: Boolean(c.custom), envModel: { local: process.env.LLM_SUMMARY_MODEL, openrouter: process.env.OPENROUTER_MODEL, exaone: process.env.EXAONE_MODEL || 'k-exaone_v2.5' }[id] ?? '', envReportModel: { local: process.env.LLM_REPORT_MODEL, openrouter: process.env.OPENROUTER_REPORT_MODEL, exaone: process.env.EXAONE_REPORT_MODEL }[id] ?? '' }
    }),
  }
}

export function selectProvider(id) {
  if (!allIds().includes(id)) throw Object.assign(new Error('없는 AI 서버예요.'), { status: 400 })
  const c = providerConfig(id)
  if (!isReady(c)) throw Object.assign(new Error(notReady(c)), { status: 400 })
  selected = id
  console.log(`[llm] AI 서버 변경: ${c.label} (${c.model})`)
  return llmProviders()
}

// 맥미니 메모리가 넉넉하지 않아 요청을 한 번에 하나씩 보낸다.
// 기다리는 요청은 우선순위가 높은 것(숫자가 작은 것)부터 꺼낸다.
// 같은 단계 안에서는 사람(브라우저)마다 번갈아 (11/17): 한 사람이 요약 10건을 걸어도 다른 사람 일이 10건 뒤로 밀리지 않게. 같은 사람 것은 먼저 온 순서
// 예전(11/06 조장 결정, 22 문서 3-3): 사람 요청이 오면 돌고 있는 자동 요약을 끊었다 → 11/17 바뀜: 끊지 않음 (끊으면 하던 일이 버려짐)
// PreemptedError는 예전 기록 · 다른 코드 호환용으로 남김
// AI 순서 (11/17 정함, 41 문서 S5). 기준: ① 사람이 화면에서 기다리는가 ② 짧은 일 먼저 (최근 7일 실측 중앙값)
// 1~4는 사람 일, 5~7은 자동 일. 11/17: 돌고 있는 일은 끊지 않는다 (자동 요약 한 건 약 20초만 기다리면 됨). 보고서 작업만 사람이 「취소」로 바로 멈출 수 있다 (cancelAi)
// 기다리는 일의 순서는 대기열 창에서 바꿀 수 있다 (moveJob): 일반 화면은 내 작업끼리, 관리 페이지는 모든 작업의 단계
export const PRIORITY = {
  WAIT: 1, // 사람이 화면에서 바로 기다리는 짧은 일: 검색어 영문 표기 · 보고서 근거 보충(4.7초) · 섹션 다시 쓰기
  SUMMARY: 2, // 사람이 누르거나 선별한 요약 (19.8초)
  REPORT: 3, // 보고서 쓰기 · 보고서에 쓸 자료 요약 (58초, 진행 칸으로 기다림)
  STORY: 4, // 사람이 연 키워드의 AI 흐름 정리 (37초, 분석을 열면 저절로 시작 — 누른 일보다 뒤)
  AUTO_IMPORTANT: 5, // 자동 요약 중 「중요」
  AUTO: 6, // 자동 요약 나머지
  PRECOMPUTE: 7, // 미리 분석 흐름 정리 · 요즘 뜨는 기술 용어
}
// 예전 이름 (다른 코드가 아직 쓰면): USER = 사람 요약, BACKGROUND = 자동 요약
PRIORITY.USER = PRIORITY.SUMMARY
PRIORITY.BACKGROUND = PRIORITY.AUTO
export const isHuman = (p) => p < PRIORITY.AUTO_IMPORTANT

// 사람 요청에 자리를 내주느라 끊긴 자동 요약. 실패가 아니다 (다시 요약해야 함)
export class PreemptedError extends Error {
  constructor() {
    super('사람 요청을 먼저 처리하려고 자동 요약을 멈췄어요. 대기열에 다시 넣어요.')
    this.name = 'PreemptedError'
    this.preempted = true
  }
}

// 11/20: 대기열을 globalThis에 둔다 — 서버 코드를 고치면 Vite가 같은 프로세스에서 이 파일을 다시 읽는데,
// 예전에는 대기열이 새로 비어 「AI 대기열이 다 날아간」 것처럼 보이고, 예전 대기열은 뒤에서 따로 돌아 두 줄이 동시에 AI를 불렀다
const Q = (globalThis.__aiQueue ??= {
  waiting: [],
  running: null, // 지금 처리 중인 요청의 우선순위
  runningAbort: null, // 지금 처리 중인 요청을 끊는 스위치 (AbortController)
  runningMeta: null, // 지금 처리 중인 요청의 보이는 정보 { kind, label, client, priority, enqueuedAt, startedAt }
  seq: 0,
  lastServed: new Map(), // 브라우저 번호 → 마지막으로 AI를 쓴 때 (같은 단계 안 번갈아 주기)
})
// 11/26 동시 요청: 지금 도는 일 목록 [{ priority, meta, abort, provider }]. 연결마다 「동시 요청 수」(parallel)까지 함께 돈다
Q.active ??= []
const waiting = Q.waiting
const active = Q.active
// 그 연결에 동시에 보낼 수 있는 수 (관리 페이지 「AI 연결」, 처음 값 1 = 예전처럼 하나씩)
function limitOf(providerId) {
  try {
    return Math.max(1, Number(providerConfig(providerId ?? currentId()).parallel) || 1)
  } catch {
    return 1
  }
}
const busyOn = (providerId) => active.filter((a) => a.provider === providerId).length
const providerOfJob = (j) => j.meta.provider ?? currentId()
// 예전 이름 호환: 지금 도는 일 중 가장 높은 단계 (없으면 null)
const runningTop = () => (active.length ? Math.min(...active.map((a) => a.priority)) : null)
const lastServed = Q.lastServed

// ── 대기열 보기 (11/15): 누가 · 무엇을 기다리는지 ──
// 요청마다 { client(브라우저 번호), label(무슨 작업) }을 함께 들고 다닌다. API 요청 하나가 시작될 때 server/index.js가 넣고,
// 보고서 작업 · 자동 요약처럼 요청과 떨어져 도는 일은 그 일을 시작할 때 withQueueContext로 다시 넣는다
const queueContext = new AsyncLocalStorage()
export function withQueueContext(ctx, fn) {
  return queueContext.run({ ...(queueContext.getStore() ?? {}), ...ctx }, fn)
}
const KIND_LABEL = { summary: '기사 요약', report: '보고서 쓰기', translate: '검색어 영문 표기', timeline: '기술 흐름 정리', reinforce: '보고서 근거 보충', section: '보고서 섹션 다시 쓰기', terms: '요즘 뜨는 기술 용어', test: '모델 시험' }

// 순서 규칙 시험용 (AI를 부르지 않고 가짜 일로 대기열만 돌려 봄)
export const enqueueForTest = (task, priority, meta) => enqueue(task, priority, meta)

// task(signal): signal이 끊기면 AI 서버 요청도 끊는다
function enqueue(task, priority = PRIORITY.SUMMARY, meta = {}) {
  return new Promise((resolve, reject) => {
    // 키워드를 연달아 열 때 (11/17): 같은 사람이 새 키워드의 흐름 정리를 걸면, 그 사람의 아직 시작 안 한 흐름 정리는 맨 뒤 단계로 내린다
    // 취소하지 않음 — 한가할 때 정리해 기억해 두므로 다시 열면 바로 보임. 지금 보는 키워드가 먼저
    if (priority === PRIORITY.STORY && meta.client) {
      for (const j of waiting) {
        if (j.priority === PRIORITY.STORY && j.meta.client === meta.client && !j.meta.manual) Object.assign(j, { priority: PRIORITY.PRECOMPUTE, meta: { ...j.meta, priority: PRIORITY.PRECOMPUTE, demoted: true } })
      }
    }
    // id는 바뀌지 않는 번호(순서 바꾸기 · 화면이 가리킴), order는 같은 단계 안 순번(순서 바꾸기로 바뀜)
    const n = Q.seq++
    waiting.push({ id: n, priority, order: n, task, resolve, reject, meta: { ...meta, priority, enqueuedAt: Date.now() } })
    pump()
  })
}

// 다음에 처리할 일: 가장 높은 단계 → 그 안에서 가장 오래 못 받은 사람 → 먼저 온 것 (order가 작은 것)
function pickNext(list, served) {
  const top = Math.min(...list.map((j) => j.priority))
  const servedAt = (j) => served.get(j.meta.client ?? '') ?? 0
  let next = -1
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i]
    if (a.priority !== top) continue
    const b = list[next]
    if (!b || servedAt(a) < servedAt(b) || (servedAt(a) === servedAt(b) && a.order < b.order)) next = i
  }
  return next
}
// 지금 상태로 처리될 순서 (화면의 「대기 n번째」가 실제 순서와 같게)
function plannedOrder() {
  const list = [...waiting]
  const served = new Map(lastServed)
  const out = []
  let t = Date.now()
  while (list.length) {
    const j = list.splice(pickNext(list, served), 1)[0]
    served.set(j.meta.client ?? '', (t += 1))
    out.push(j)
  }
  return out
}

function pump() {
  // 자리가 남은 연결의 일만 골라 꺼낸다 (같은 규칙: 높은 단계 → 오래 못 받은 사람 → 먼저 온 것)
  for (;;) {
    const ready = waiting.filter((j) => busyOn(providerOfJob(j)) < limitOf(providerOfJob(j)))
    if (!ready.length) return
    const pick = ready[pickNext(ready, lastServed)]
    waiting.splice(waiting.indexOf(pick), 1)
    run(pick)
  }
}

// 동시 요청 수를 늘렸을 때 기다리던 일을 바로 시작 (index.js)
export const kickQueue = () => pump()

async function run(job) {
  lastServed.set(job.meta.client ?? '', Date.now())
  const controller = new AbortController()
  const slot = { priority: job.priority, meta: { ...job.meta, startedAt: Date.now() }, abort: controller, provider: providerOfJob(job) }
  active.push(slot)
  try {
    const value = await job.task(controller.signal)
    // 끊겼는데 응답이 이미 와 있었던 경우도 끊긴 것으로 본다 (저장 여부를 한 가지 기준으로)
    if (controller.signal.aborted) throw controller.signal.reason
    job.resolve(value)
  } catch (err) {
    job.reject(controller.signal.aborted ? controller.signal.reason : err)
  } finally {
    active.splice(active.indexOf(slot), 1)
    pump()
  }
}

// 대기열 목록 (오른쪽 아래 「AI 대기열」 · 관리 페이지). viewer: 보는 브라우저 번호 → 「내 작업」 표시. 남의 브라우저 번호는 보내지 않는다
// who: mine(내가 시킨 것) · auto(자동 — 자동 요약 · 미리 분석 등 우선순위가 가장 낮은 일, 또는 브라우저 번호가 없는 일) · other(다른 사람)
function publicMeta(m, viewer) {
  if (!m) return null
  const auto = !isHuman(m.priority) || !m.client
  return {
    kind: m.kind,
    kindLabel: KIND_LABEL[m.kind] ?? 'AI 작업',
    label: m.label ?? null,
    who: auto ? 'auto' : viewer && m.client === viewer ? 'mine' : 'other',
    priority: m.priority,
    mine: Boolean(viewer && m.client === viewer), // 순서 바꾸기는 내 작업만 (일반 화면)
    manual: Boolean(m.manual),
    demoted: Boolean(m.demoted),
    waitedMs: (m.startedAt ?? Date.now()) - m.enqueuedAt,
    runningMs: m.startedAt ? Date.now() - m.startedAt : null,
  }
}
export function queueList(viewer) {
  const runningAll = [...active].sort((a, b) => a.meta.startedAt - b.meta.startedAt).map((a) => publicMeta(a.meta, viewer))
  // running: 예전 화면 호환(가장 먼저 시작한 일 하나), runningAll: 동시에 도는 일 모두 (11/26)
  return { running: runningAll[0] ?? null, runningAll, parallel: limitOf(currentId()), waiting: plannedOrder().map((j) => ({ ...publicMeta(j.meta, viewer), id: j.id })) }
}

// 기다리는 일 순서 바꾸기 (11/17). id = 대기열 번호(queueList의 id)
// - 일반 화면: 내 작업끼리만 자리를 바꾼다 (up · down) — 다른 사람 일을 건너뛰지 않게, 내 일들의 자리(단계 · 순번) 묶음은 그대로
// - 관리 페이지(admin): 모든 일의 단계를 하나 올리기 · 내리기(up · down), 맨 앞(first: 1단계 · 가장 먼저)
let frontSeq = 0
export function moveJob(id, action, { viewer = null, admin = false } = {}) {
  const job = waiting.find((j) => j.id === Number(id))
  if (!job) throw Object.assign(new Error('이미 시작했거나 끝난 작업이에요.'), { status: 404 })
  const setStep = (j, p) => Object.assign(j, { priority: p, meta: { ...j.meta, priority: p, manual: true } })
  if (admin) {
    if (action === 'first') {
      setStep(job, PRIORITY.WAIT)
      job.order = -(++frontSeq)
    } else if (action === 'up') setStep(job, Math.max(PRIORITY.WAIT, job.priority - 1))
    else if (action === 'down') setStep(job, Math.min(PRIORITY.PRECOMPUTE, job.priority + 1))
    else throw Object.assign(new Error('알 수 없는 동작이에요.'), { status: 400 })
    return queueList(viewer)
  }
  if (!viewer || job.meta.client !== viewer) throw Object.assign(new Error('내 작업만 순서를 바꿀 수 있어요.'), { status: 403 })
  const mine = plannedOrder().filter((j) => j.meta.client === viewer)
  const i = mine.indexOf(job)
  const other = action === 'up' ? mine[i - 1] : action === 'down' ? mine[i + 1] : null
  if (!other) return queueList(viewer)
  // 두 일의 단계 · 순번을 맞바꾼다
  const a = { priority: job.priority, order: job.order }
  setStep(job, other.priority)
  job.order = other.order
  setStep(other, a.priority)
  other.order = a.order
  return queueList(viewer)
}

// 보고서 작업 취소 (11/17): 그 작업의 AI 일을 기다리는 중이면 빼고, 돌고 있으면 바로 멈춘다. 다른 일은 끊지 않는다
export function cancelAi(jobId) {
  if (!jobId) return
  const reason = Object.assign(new Error('취소했어요'), { cancelled: true })
  for (let i = waiting.length - 1; i >= 0; i -= 1) {
    if (waiting[i].meta.jobId === jobId) waiting.splice(i, 1)[0].reject(reason)
  }
  for (const a of active) if (a.meta.jobId === jobId && !a.abort.signal.aborted) a.abort.abort(reason)
}

// 대기 상황 (자동 최신화 화면에 "사용자 요청 먼저 처리 중"을 보여 줄 때 쓴다)
export function queueStatus() {
  const ahead = waiting.filter((j) => isHuman(j.priority)).length
  return { running: runningTop(), runningCount: active.length, waiting: waiting.length, userFirst: ahead + active.filter((a) => isHuman(a.priority)).length }
}

// Ollama는 OpenAI 호환 주소(/v1)로 부르면 입력을 약 2,000토큰까지만 읽는다 (실측: 더 긴 입력은 앞부분이 잘림).
// LLM_NUM_CTX(예: 16384)가 있으면 Ollama 원래 API(/api/chat)로 불러 문맥 크기를 넘긴다. 상용 API는 비워 둔다
// 맥미니 모델을 메모리에 얼마나 올려 둘지 (11/16). 요청에 넣으면 맥미니 설정(OLLAMA_KEEP_ALIVE)보다 우선한다.
// 맥미니를 재부팅하면 launchctl 설정이 사라져 5분 뒤 모델이 내려가던 문제를 서버 쪽에서 막는다.
// 처음 값 -1(계속 올려 둠). LLM_KEEP_ALIVE에 "30m" 같은 값을 주면 그 값, 빈 값이면 맥미니 설정을 따른다
function keepAliveValue() {
  const raw = process.env.LLM_KEEP_ALIVE ?? '-1'
  if (raw.trim() === '') return null
  return /^-?\d+$/.test(raw.trim()) ? Number(raw) : raw.trim()
}

async function callOllama({ baseUrl, apiKey, model, messages, schema, timeoutMs, numCtx, signal }) {
  const root = baseUrl.replace(/\/v1$/, '')
  const body = { model, messages, stream: false, think: false, options: { num_ctx: numCtx, temperature: 0.2 } }
  if (schema) body.format = schema
  const keepAlive = keepAliveValue()
  if (keepAlive !== null) body.keep_alive = keepAlive
  const send = () =>
    fetch(`${root}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: withAbort(timeoutMs, signal),
    })
  let res
  try {
    res = await send()
  } catch (err) {
    if (err.name === 'TimeoutError' || signal?.aborted) throw err
    console.warn(`[llm] 연결 실패, 다시 시도: ${err.message}`)
    await new Promise((r) => setTimeout(r, 2000))
    res = await send()
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI 서버 응답 오류 ${res.status} ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  const usage = { input: data.prompt_eval_count ?? 0, output: data.eval_count ?? 0 }
  if (usage.input >= numCtx - 8) console.warn(`[llm] 입력이 문맥 크기(${numCtx})를 넘어 앞부분이 잘렸을 수 있어요`)
  return { content: data.message?.content ?? '', model, usage }
}

// 시간 초과 + 사람 요청에 자리 내주기(끊기). 둘 중 먼저 오는 쪽으로 요청을 끊는다
function withAbort(timeoutMs, signal) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([timeout, signal]) : timeout
}

async function callChat(cfg, { messages, schema, schemaName, report = false, timeoutMs = TIMEOUT_MS, signal }) {
  const { id, baseUrl, apiKey, numCtx, reasoningEffort } = cfg
  const model = (report && cfg.reportModel) || cfg.model
  if (numCtx) return callOllama({ baseUrl, apiKey, model, messages, schema, timeoutMs, numCtx, signal })
  const body = { model, messages, temperature: 0.2 }
  if (schema) {
    body.response_format = { type: 'json_schema', json_schema: { name: schemaName, schema } }
    // OpenRouter: JSON 형식 지정을 지원하는 곳으로만 보낸다 (무료 모델 중 일부는 지원하지 않음)
    if (id === 'openrouter') body.provider = { require_parameters: true }
  }
  // Qwen3 생각 모드 끄기. Ollama에서는 'none'으로 꺼진다. 상용 API에서는 값을 비워 둔다
  if (reasoningEffort) {
    body.reasoning_effort = reasoningEffort
  }

  const auth = await authOf(cfg)
  const send = () =>
    fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(body),
      signal: withAbort(timeoutMs, signal),
    })
  let res
  try {
    res = await send()
  } catch (err) {
    // 맥미니까지 가는 연결이 순간 끊긴 경우(fetch failed)만 2초 뒤 한 번 더. 시간 초과·끊기는 다시 보내지 않는다
    if (err.name === 'TimeoutError' || signal?.aborted) throw err
    console.warn(`[llm] 연결 실패, 다시 시도: ${err.message}`)
    await new Promise((r) => setTimeout(r, 2000))
    res = await send()
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    // 11/27: OpenRouter의 새 OpenAI · Anthropic 모델(gpt-5 · gpt-6 · claude-haiku-5.5 등)은 temperature를 받지 않아
    // require_parameters와 함께면 「No endpoints found that can handle the requested parameters」(404) → temperature를 빼고 한 번 더
    if (res.status === 404 && /requested parameters/i.test(detail) && body.temperature !== undefined && !signal?.aborted) {
      delete body.temperature
      res = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(body), signal: withAbort(timeoutMs, signal) })
    }
    if (!res.ok) {
      const d2 = res.bodyUsed ? detail : await res.text().catch(() => '')
      throw new Error(`AI 서버 응답 오류 ${res.status} ${d2.slice(0, 200)}`)
    }
  }
  const data = await res.json()
  const usage = { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 }
  return { content: data.choices?.[0]?.message?.content ?? '', model, usage }
}

// 질문 하나를 보내고 JSON으로 받는다
// report·timeoutMs는 선택 (보고서는 *_REPORT_MODEL과 더 긴 시간), priority는 PRIORITY 중 하나 (기본: 사람 요청)
// AI 서버는 요청한 순간에 고른 곳을 쓴다 (기다리는 동안 상단에서 바꿔도 그대로)
// label: 대기열에 보일 작업 이름 (기사 제목 · 키워드 등, 선택). 없으면 요청 맥락(withQueueContext)의 label
export async function chatJson({ messages, schema, schemaName = 'result', report, timeoutMs, priority = PRIORITY.SUMMARY, provider, kind: callKind, label }) {
  let cfg = config(provider)
  // callKind: 요약 · 보고서가 아닌 호출의 이름 (translate 검색어 영문 표기 · timeline 흐름 정리 · reinforce 근거 보충 · section 섹션 다시 쓰기 · terms 뜨는 기술, 11/11)
  const kind = provider ? 'test' : callKind ?? (report ? 'report' : 'summary')
  const ctx = queueContext.getStore() ?? {}
  const meta = { kind, label: String(label ?? ctx.label ?? '').slice(0, 120) || null, client: ctx.client ?? null, jobId: ctx.jobId ?? null, provider: cfg.id }
  return enqueue(async (signal) => {
    // 사용 현황(17 문서 4장)에 AI 호출 수·실패·걸린 시간을 남긴다. 대기열에서 기다린 시간은 빼고 잰다
    const startedAt = Date.now()
    try {
      let result
      try {
        result = await callChat(cfg, { messages, schema, schemaName, report, timeoutMs, signal })
      } catch (err) {
        const alt = !provider && isHuman(priority) && !signal.aborted && reachable(err) ? fallbackId(cfg.id) : null
        if (!alt) throw err
        recordAiCall(kind, false, Date.now() - startedAt, { provider: cfg.id, model: (report && cfg.reportModel) || cfg.model })
        console.warn(`[llm] ${cfg.label} 실패(${err.message.slice(0, 80)}) → ${alt}로 한 번 다시`)
        lastFallback = { at: new Date().toISOString(), from: cfg.id, to: alt, reason: err.message.slice(0, 120) }
        cfg = config(alt)
        result = await callChat(cfg, { messages, schema, schemaName, report, timeoutMs, signal })
      }
      let { content, model: used, usage } = result
      // 일부 모델은 JSON을 ```json … ``` 으로 감싸 보낸다
      const parse = (t) => JSON.parse(String(t ?? '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''))
      let data
      try {
        data = parse(content)
      } catch {
        // 11/26: 형식이 깨진 응답은 같은 곳에 한 번 더 (실측: OpenRouter Gemma 4 26B 요약 약 170건 중 1건, 보고서 초안 4건 중 1건 — 한 번 깨지면 보고서 전체가 실패했음)
        if (signal.aborted) throw signal.reason
        recordAiCall(kind, false, Date.now() - startedAt, { provider: cfg.id, model: used })
        console.warn(`[llm] ${cfg.label} 응답이 JSON이 아니어서 한 번 더`)
        ;({ content, model: used, usage } = await callChat(cfg, { messages, schema, schemaName, report, timeoutMs, signal }))
        try {
          data = parse(content)
        } catch {
          throw new Error('AI 응답이 JSON 형식이 아니에요.')
        }
      }
      recordAiCall(kind, true, Date.now() - startedAt, { provider: cfg.id, model: used, ...usage })
      return { data, model: used, usage }
    } catch (err) {
      // 사람 요청에 자리를 내준 것은 실패로 세지 않는다 (다시 요약됨)
      if (!signal.aborted) recordAiCall(kind, false, Date.now() - startedAt, { provider: cfg.id, model: (report && cfg.reportModel) || cfg.model })
      throw err
    }
  }, priority, meta)
}

export function modelName() {
  return providerConfig(currentId()).model ?? ''
}

// 지금 고른 AI 서버에 닿는지 짧게 확인한다
export async function pingModel() {
  try {
    const cfg = config()
    const { baseUrl, apiKey, pingPath } = cfg
    // Vertex AI는 모델 목록 주소가 없어 토큰을 받을 수 있으면 닿는 것으로 본다
    if (cfg.vertex) return Boolean(await vertexToken())
    const res = await fetch(`${baseUrl}${pingPath}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      // 11/17: 6초 → 15초. 맥미니 /models 첫 응답이 3.7~6.3초로 느려지자 「연결 안 됨」으로 나와 자동 요약이 멈췄음 (refresh.js runWorker)
      signal: AbortSignal.timeout(15_000),
    })
    return res.ok
  } catch {
    return false
  }
}

// 연결 시험 (11/25 관리 페이지 「AI 연결」의 시험 버튼): ① 주소 · 키 확인(pingPath) ② 짧은 응답 한 번 (대기열을 거침)
// 꺼 둔 연결도 시험할 수 있다 (켜기 전에 확인). 맥미니는 모델을 하나만 올려 두므로, 지금 쓰는 맥미니 모델과 다르면 응답 시험은 건너뛴다
export async function testConnection(id) {
  if (!allIds().includes(id)) throw Object.assign(new Error('없는 AI 연결이에요.'), { status: 400 })
  const c = providerConfig(id)
  const cfg = { ...c, baseUrl: c.vertex ? vertexBase(c.baseUrl) : String(c.baseUrl ?? '').replace(/\/$/, '') }
  const out = { id, label: c.label, ping: null, chat: null }
  if (!cfg.baseUrl || !(cfg.apiKey || cfg.vertex)) return { ...out, ping: { ok: false, error: !cfg.baseUrl ? '주소가 없어요' : 'API 키가 없어요' } }
  const t0 = Date.now()
  if (cfg.vertex) {
    // Vertex AI: 모델 목록 주소가 없어 Google 토큰을 받는 것까지만 확인하고 응답 시험으로
    try {
      await vertexToken()
      out.ping = { ok: true, ms: Date.now() - t0 }
    } catch (err) {
      out.ping = { ok: false, ms: Date.now() - t0, error: String(err?.message ?? err).slice(0, 120) }
    }
  } else {
    try {
      const res = await fetch(`${cfg.baseUrl}${cfg.pingPath}`, { headers: { Authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(15_000) })
      out.ping = { ok: res.ok, status: res.status, ms: Date.now() - t0, ...(res.ok ? {} : { error: res.status === 401 || res.status === 403 ? 'API 키가 맞지 않아요' : `응답 ${res.status}` }) }
    } catch (err) {
      out.ping = { ok: false, ms: Date.now() - t0, error: err?.name === 'TimeoutError' ? '15초 안에 응답이 없어요' : '주소에 닿지 않아요' }
    }
  }
  if (!out.ping.ok) return out
  if (!cfg.model) return { ...out, chat: { skipped: '모델 이름이 없어요' } }
  const local = (x) => x.id === 'local' || (x.baseUrl && x.baseUrl === builtinConfig('local', builtinOverride('local')).baseUrl)
  const cur = providerConfig(currentId())
  if (local(cfg) && !(local(cur) && cur.model === cfg.model)) return { ...out, chat: { skipped: '맥미니는 모델을 하나만 올려 두어, 지금 쓰는 모델과 다르면 응답 시험을 하지 않아요 (주소 · 키는 확인됨)' } }
  const ctx = queueContext.getStore() ?? {}
  try {
    const r = await enqueue(
      async (signal) => {
        const t1 = Date.now()
        const { content, model } = await callChat(cfg, { messages: [{ role: 'user', content: '연결 시험이에요. JSON으로 {"ok":"네"}만 답해 주세요.' }], schema: { type: 'object', properties: { ok: { type: 'string' } }, required: ['ok'] }, schemaName: 'ping', timeoutMs: 60_000, signal })
        return { ok: Boolean(String(content ?? '').trim()), ms: Date.now() - t1, model }
      },
      PRIORITY.WAIT,
      { kind: 'test', label: `연결 시험 · ${c.label}`, client: ctx.client ?? null, provider: id },
    )
    out.chat = r
  } catch (err) {
    out.chat = { ok: false, error: String(err?.message ?? err).replace(/Bearer\s+\S+/g, 'Bearer ***').slice(0, 160) }
  }
  return out
}

export function providerLabel() {
  return providerConfig(currentId()).label
}
