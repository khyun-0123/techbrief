// AI 모델 호출은 이 파일에서만 한다. 모델을 바꿀 때는 .env.local 값만 바꾼다.
// OpenAI 호환 /chat/completions 주소를 쓰므로 Ollama(맥미니)와 상용 API 모두 같은 코드로 부른다.

const TIMEOUT_MS = 120_000

function config() {
  const baseUrl = process.env.LLM_BASE_URL
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_SUMMARY_MODEL
  if (!baseUrl || !apiKey || !model) {
    throw new Error('LLM 설정이 없어요. .env.local에 LLM_BASE_URL, LLM_API_KEY, LLM_SUMMARY_MODEL을 넣어 주세요.')
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model }
}

// 맥미니 메모리가 넉넉하지 않아 요청을 한 번에 하나씩 보낸다
let queue = Promise.resolve()

function enqueue(task) {
  const run = queue.then(task, task)
  queue = run.catch(() => {})
  return run
}

async function callChat({ messages, schema, schemaName }) {
  const { baseUrl, apiKey, model } = config()
  const body = { model, messages, temperature: 0.2 }
  if (schema) {
    body.response_format = { type: 'json_schema', json_schema: { name: schemaName, schema } }
  }
  // Qwen3 생각 모드 끄기. Ollama에서는 'none'으로 꺼진다. 상용 API에서는 값을 비워 둔다
  if (process.env.LLM_REASONING_EFFORT) {
    body.reasoning_effort = process.env.LLM_REASONING_EFFORT
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI 서버 응답 오류 ${res.status} ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  return { content: data.choices?.[0]?.message?.content ?? '', model }
}

// 질문 하나를 보내고 JSON으로 받는다
export function chatJson({ messages, schema, schemaName = 'result' }) {
  return enqueue(async () => {
    const { content, model } = await callChat({ messages, schema, schemaName })
    try {
      return { data: JSON.parse(content), model }
    } catch {
      throw new Error('AI 응답이 JSON 형식이 아니에요.')
    }
  })
}

export function modelName() {
  return process.env.LLM_SUMMARY_MODEL ?? ''
}
