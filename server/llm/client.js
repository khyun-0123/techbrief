// AI 모델 호출은 이 파일에서만 한다. 모델을 바꿀 때는 .env.local 값만 바꾼다.
// OpenAI 호환 /chat/completions 주소를 쓰므로 Ollama(맥미니)와 상용 API 모두 같은 코드로 부른다.
// AI 서버는 두 곳(맥미니·OpenRouter)이고 화면 상단에서 고른다. 고른 값은 이 서버 메모리에만 둔다 (팀원 서버와 별개)

import { recordAiCall } from '../usage.js'

const TIMEOUT_MS = 120_000 // 요약 기본값. 보고서처럼 긴 출력은 호출할 때 늘린다

const PROVIDER_IDS = ['local', 'openrouter']

function providerConfig(id) {
  if (id === 'openrouter') {
    return {
      id,
      label: 'OpenRouter',
      baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL,
      reportModel: process.env.OPENROUTER_REPORT_MODEL,
      numCtx: 0,
      reasoningEffort: '',
      pingPath: '/key', // OpenRouter의 /models는 키 없이도 열려 있어 키 확인용 주소를 쓴다
      envHint: 'OPENROUTER_API_KEY, OPENROUTER_MODEL',
    }
  }
  return {
    id: 'local',
    label: '맥미니',
    baseUrl: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_SUMMARY_MODEL,
    reportModel: process.env.LLM_REPORT_MODEL,
    numCtx: Number(process.env.LLM_NUM_CTX) || 0,
    reasoningEffort: process.env.LLM_REASONING_EFFORT || '',
    pingPath: '/models',
    envHint: 'LLM_BASE_URL, LLM_API_KEY, LLM_SUMMARY_MODEL',
  }
}

const isReady = (c) => Boolean(c.baseUrl && c.apiKey && c.model)

// 처음 값: LLM_PROVIDER(local|openrouter) → 없으면 설정이 채워진 첫 번째
let selected = null
function currentId() {
  if (selected) return selected
  const wanted = process.env.LLM_PROVIDER
  if (PROVIDER_IDS.includes(wanted)) return wanted
  return PROVIDER_IDS.find((id) => isReady(providerConfig(id))) ?? 'local'
}

// id를 주면 그 AI 서버로 (관리자 테스트 페이지의 서버 비교용), 없으면 지금 고른 서버
function config(id = currentId()) {
  if (!PROVIDER_IDS.includes(id)) throw Object.assign(new Error('없는 AI 서버예요.'), { status: 400 })
  const c = providerConfig(id)
  if (!isReady(c)) {
    throw new Error(`${c.label} AI 설정이 없어요. .env.local에 ${c.envHint}를 넣어 주세요.`)
  }
  return { ...c, baseUrl: c.baseUrl.replace(/\/$/, '') }
}

// 화면 상단 선택 상자용 목록 (키는 보내지 않는다)
export function llmProviders() {
  return {
    current: currentId(),
    providers: PROVIDER_IDS.map((id) => {
      const c = providerConfig(id)
      return { id, label: c.label, model: c.model ?? '', ready: isReady(c) }
    }),
  }
}

export function selectProvider(id) {
  if (!PROVIDER_IDS.includes(id)) throw Object.assign(new Error('없는 AI 서버예요.'), { status: 400 })
  const c = providerConfig(id)
  if (!isReady(c)) throw Object.assign(new Error(`${c.label} AI 설정이 없어요. .env.local에 ${c.envHint}를 넣어 주세요.`), { status: 400 })
  selected = id
  console.log(`[llm] AI 서버 변경: ${c.label} (${c.model})`)
  return llmProviders()
}

// 맥미니 메모리가 넉넉하지 않아 요청을 한 번에 하나씩 보낸다.
// 기다리는 요청은 우선순위가 높은 것(숫자가 작은 것)부터, 같으면 먼저 온 순서로 꺼낸다.
// 돌고 있는 것이 자동 요약(BACKGROUND)이고 사람 요청이 오면 자동 요약을 끊는다 (22 문서 3-3, 11/06 조장 결정)
// - 끊긴 요약은 저장되지 않는다 (요약은 AI 응답이 끝까지 와야만 저장) → 「요약 안 됨」 그대로
// - 끊긴 요청은 PreemptedError로 끝나고, 자동 요약 쪽(refresh.js)이 대기열 맨 앞에 다시 넣는다
// 사람 요청 · 승인 요약끼리는 끊지 않는다 (13 문서 F1)
export const PRIORITY = {
  USER: 1, // 사람이 누른 요약·보고서
  APPROVED: 2, // AI 추천을 위해 사람이 승인한 요약
  BACKGROUND: 3, // 자동 최신화의 미리 요약
}

// 사람 요청에 자리를 내주느라 끊긴 자동 요약. 실패가 아니다 (다시 요약해야 함)
export class PreemptedError extends Error {
  constructor() {
    super('사람 요청을 먼저 처리하려고 자동 요약을 멈췄어요. 대기열에 다시 넣어요.')
    this.name = 'PreemptedError'
    this.preempted = true
  }
}

const waiting = []
let running = null // 지금 처리 중인 요청의 우선순위
let runningAbort = null // 지금 처리 중인 요청을 끊는 스위치 (AbortController)
let seq = 0

// task(signal): signal이 끊기면 AI 서버 요청도 끊는다
function enqueue(task, priority = PRIORITY.USER) {
  return new Promise((resolve, reject) => {
    waiting.push({ priority, order: seq++, task, resolve, reject })
    if (running === PRIORITY.BACKGROUND && priority < PRIORITY.BACKGROUND && runningAbort) {
      console.log('[llm] 사람 요청이 와서 자동 요약을 멈추고 뒤로 보냄')
      runningAbort.abort(new PreemptedError())
    }
    pump()
  })
}

async function pump() {
  if (running !== null || waiting.length === 0) return
  let next = 0
  for (let i = 1; i < waiting.length; i += 1) {
    const a = waiting[i]
    const b = waiting[next]
    if (a.priority < b.priority || (a.priority === b.priority && a.order < b.order)) next = i
  }
  const job = waiting.splice(next, 1)[0]
  running = job.priority
  const controller = new AbortController()
  runningAbort = controller
  try {
    const value = await job.task(controller.signal)
    // 끊겼는데 응답이 이미 와 있었던 경우도 끊긴 것으로 본다 (저장 여부를 한 가지 기준으로)
    if (controller.signal.aborted) throw controller.signal.reason
    job.resolve(value)
  } catch (err) {
    job.reject(controller.signal.aborted ? controller.signal.reason : err)
  } finally {
    running = null
    runningAbort = null
    pump()
  }
}

// 대기 상황 (자동 최신화 화면에 "사용자 요청 먼저 처리 중"을 보여 줄 때 쓴다)
export function queueStatus() {
  const ahead = waiting.filter((j) => j.priority < PRIORITY.BACKGROUND).length
  return { running, waiting: waiting.length, userFirst: ahead + (running !== null && running < PRIORITY.BACKGROUND ? 1 : 0) }
}

// Ollama는 OpenAI 호환 주소(/v1)로 부르면 입력을 약 2,000토큰까지만 읽는다 (실측: 더 긴 입력은 앞부분이 잘림).
// LLM_NUM_CTX(예: 16384)가 있으면 Ollama 원래 API(/api/chat)로 불러 문맥 크기를 넘긴다. 상용 API는 비워 둔다
async function callOllama({ baseUrl, apiKey, model, messages, schema, timeoutMs, numCtx, signal }) {
  const root = baseUrl.replace(/\/v1$/, '')
  const body = { model, messages, stream: false, think: false, options: { num_ctx: numCtx, temperature: 0.2 } }
  if (schema) body.format = schema
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

  const send = () =>
    fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
    throw new Error(`AI 서버 응답 오류 ${res.status} ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  const usage = { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 }
  return { content: data.choices?.[0]?.message?.content ?? '', model, usage }
}

// 질문 하나를 보내고 JSON으로 받는다
// report·timeoutMs는 선택 (보고서는 *_REPORT_MODEL과 더 긴 시간), priority는 PRIORITY 중 하나 (기본: 사람 요청)
// AI 서버는 요청한 순간에 고른 곳을 쓴다 (기다리는 동안 상단에서 바꿔도 그대로)
export async function chatJson({ messages, schema, schemaName = 'result', report, timeoutMs, priority = PRIORITY.USER, provider, kind: callKind }) {
  const cfg = config(provider)
  return enqueue(async (signal) => {
    // 사용 현황(17 문서 4장)에 AI 호출 수·실패·걸린 시간을 남긴다. 대기열에서 기다린 시간은 빼고 잰다
    const startedAt = Date.now()
    // callKind: 요약 · 보고서가 아닌 짧은 호출의 이름 (예: 'translate' 검색어 영문 표기, 11/10)
    const kind = provider ? 'test' : callKind ?? (report ? 'report' : 'summary')
    try {
      const { content, model: used, usage } = await callChat(cfg, { messages, schema, schemaName, report, timeoutMs, signal })
      let data
      try {
        // 일부 모델은 JSON을 ```json … ``` 으로 감싸 보낸다
        data = JSON.parse(content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''))
      } catch {
        throw new Error('AI 응답이 JSON 형식이 아니에요.')
      }
      recordAiCall(kind, true, Date.now() - startedAt)
      return { data, model: used, usage }
    } catch (err) {
      // 사람 요청에 자리를 내준 것은 실패로 세지 않는다 (다시 요약됨)
      if (!signal.aborted) recordAiCall(kind, false, Date.now() - startedAt)
      throw err
    }
  }, priority)
}

export function modelName() {
  return providerConfig(currentId()).model ?? ''
}

// 지금 고른 AI 서버에 닿는지 짧게 확인한다
export async function pingModel() {
  try {
    const { baseUrl, apiKey, pingPath } = config()
    const res = await fetch(`${baseUrl}${pingPath}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(6000),
    })
    return res.ok
  } catch {
    return false
  }
}

export function providerLabel() {
  return providerConfig(currentId()).label
}
