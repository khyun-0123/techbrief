// AI 모델 호출은 이 파일에서만 한다. 모델을 바꿀 때는 .env.local 값만 바꾼다.
// OpenAI 호환 /chat/completions 주소를 쓰므로 Ollama(맥미니)와 상용 API 모두 같은 코드로 부른다.

const TIMEOUT_MS = 120_000 // 요약 기본값. 보고서처럼 긴 출력은 호출할 때 늘린다

function config() {
  const baseUrl = process.env.LLM_BASE_URL
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_SUMMARY_MODEL
  if (!baseUrl || !apiKey || !model) {
    throw new Error('LLM 설정이 없어요. .env.local에 LLM_BASE_URL, LLM_API_KEY, LLM_SUMMARY_MODEL을 넣어 주세요.')
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model }
}

// 맥미니 메모리가 넉넉하지 않아 요청을 한 번에 하나씩 보낸다.
// 기다리는 요청은 우선순위가 높은 것(숫자가 작은 것)부터, 같으면 먼저 온 순서로 꺼낸다.
// 이미 돌고 있는 1건은 끝까지 둔다 (13 문서 F1)
export const PRIORITY = {
  USER: 1, // 사람이 누른 요약·보고서
  APPROVED: 2, // AI 추천을 위해 사람이 승인한 요약
  BACKGROUND: 3, // 자동 최신화의 미리 요약
}

const waiting = []
let running = null // 지금 처리 중인 요청의 우선순위
let seq = 0

function enqueue(task, priority = PRIORITY.USER) {
  return new Promise((resolve, reject) => {
    waiting.push({ priority, order: seq++, task, resolve, reject })
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
  try {
    job.resolve(await job.task())
  } catch (err) {
    job.reject(err)
  } finally {
    running = null
    pump()
  }
}

// 대기 상황 (자동 최신화 화면에 "사용자 요청 먼저 처리 중"을 보여 줄 때 쓴다)
export function queueStatus() {
  const ahead = waiting.filter((j) => j.priority < PRIORITY.BACKGROUND).length
  return { running, waiting: waiting.length, userFirst: ahead + (running !== null && running < PRIORITY.BACKGROUND ? 1 : 0) }
}

async function callChat({ messages, schema, schemaName, model: modelOverride, timeoutMs = TIMEOUT_MS }) {
  const { baseUrl, apiKey, model: defaultModel } = config()
  const model = modelOverride || defaultModel
  const body = { model, messages, temperature: 0.2 }
  if (schema) {
    body.response_format = { type: 'json_schema', json_schema: { name: schemaName, schema } }
  }
  // Qwen3 생각 모드 끄기. Ollama에서는 'none'으로 꺼진다. 상용 API에서는 값을 비워 둔다
  if (process.env.LLM_REASONING_EFFORT) {
    body.reasoning_effort = process.env.LLM_REASONING_EFFORT
  }

  const send = () =>
    fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  let res
  try {
    res = await send()
  } catch (err) {
    // 맥미니까지 가는 연결이 순간 끊긴 경우(fetch failed)만 2초 뒤 한 번 더. 시간 초과는 다시 보내지 않는다
    if (err.name === 'TimeoutError') throw err
    console.warn(`[llm] 연결 실패, 다시 시도: ${err.message}`)
    await new Promise((r) => setTimeout(r, 2000))
    res = await send()
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI 서버 응답 오류 ${res.status} ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  return { content: data.choices?.[0]?.message?.content ?? '', model }
}

// 질문 하나를 보내고 JSON으로 받는다
// model·timeoutMs는 선택 (보고서는 LLM_REPORT_MODEL과 더 긴 시간), priority는 PRIORITY 중 하나 (기본: 사람 요청)
export function chatJson({ messages, schema, schemaName = 'result', model, timeoutMs, priority = PRIORITY.USER }) {
  return enqueue(async () => {
    const { content, model: used } = await callChat({ messages, schema, schemaName, model, timeoutMs })
    try {
      return { data: JSON.parse(content), model: used }
    } catch {
      throw new Error('AI 응답이 JSON 형식이 아니에요.')
    }
  }, priority)
}

export function modelName() {
  return process.env.LLM_SUMMARY_MODEL ?? ''
}

// AI 서버(맥미니)에 닿는지 짧게 확인한다
export async function pingModel() {
  try {
    const { baseUrl, apiKey } = config()
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(6000),
    })
    return res.ok
  } catch {
    return false
  }
}

export function reportModelName() {
  return process.env.LLM_REPORT_MODEL || process.env.LLM_SUMMARY_MODEL || ''
}
