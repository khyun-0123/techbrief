// 서버(/api) 호출 모음. 접속 키는 서버에만 있고 여기에는 없다.

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error ?? `서버 오류 (${res.status}). npm run dev가 켜져 있는지 확인해 주세요.`)
  }
  return data
}

// 서버에 쌓인 기사 목록 (DB가 있으면 서버를 다시 켜도 남아 있음)
export async function fetchArticles() {
  const res = await fetch('/api/articles')
  if (!res.ok) throw new Error('기사 목록을 불러오지 못했어요')
  return res.json()
}

// 기사 찾기: 등록 키워드와 상관없이 네이버에서 바로 찾는다 (DB에 쌓지 않음)
// period: 'today' | 'week' | 'all' (18 문서)
export function searchNewsApi(query, period = 'all') {
  return postJson('/api/search', { query, period })
}

// 즐겨찾는 검색어 (팀 공용, 자동 수집과 별개)
export async function fetchFavorites() {
  const res = await fetch('/api/favorites')
  if (!res.ok) throw new Error('즐겨찾기를 불러오지 못했어요')
  return (await res.json()).favorites
}

export async function saveFavoritesApi(favorites) {
  const res = await fetch('/api/favorites', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorites }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data.favorites
}

// 자사·자회사, 경쟁사, 관심 기술 목록 (팀 공용)
export async function fetchLists() {
  const res = await fetch('/api/lists')
  if (!res.ok) throw new Error('목록을 불러오지 못했어요')
  return res.json()
}

export async function saveListsApi(lists) {
  const res = await fetch('/api/lists', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lists),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}

// 자동 최신화 상태 (설정·마지막/다음 실행·진행 상황)
export async function fetchRefresh() {
  const res = await fetch('/api/refresh')
  if (!res.ok) throw new Error('최신화 상태를 불러오지 못했어요')
  return res.json()
}

// 「지금 최신화」: 키워드로 기사를 모으고 중요한 기사 몇 건을 미리 요약한다 (끝날 때까지 기다리지 않음)
export function runRefresh(keywords) {
  return postJson('/api/refresh/run', { keywords })
}

// 자동 최신화 설정: 관리자만 (17 문서). 로그인 쿠키가 같이 간다
export async function saveRefreshSettings(settings) {
  const res = await fetch('/api/refresh/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}

// 기사 요약문과 같은 이슈 기사를 함께 보내면 '기사 근거' 항목이 늘어난다
export function requestSummary(article, { refresh = false } = {}) {
  return postJson('/api/summaries', {
    article: {
      id: article.id,
      title: article.title,
      source: article.source,
      keyword: article.keyword,
      description: article.description,
    },
    // id·url을 함께 보내면 서버가 같은 이슈 기사들에 이 요약을 함께 저장한다 (다시 요약하지 않음)
    related: (article.related ?? []).map(({ id, url, title, source, description }) => ({ id, url, title, source, description })),
    refresh,
  })
}

// 보고서에 넣는 기사: 6항목 요약 + 근거 검증용 원문 텍스트(요약문·같은 이슈 기사)
function reportArticle(article, aiSummary) {
  return {
    id: article.id,
    title: article.title,
    source: article.source,
    publishedAt: article.publishedAt,
    url: article.url,
    description: article.description,
    related: (article.related ?? []).map(({ title, source, description }) => ({ title, source, description })),
    summary: aiSummary?.summary,
  }
}

export function requestReport({ articles, aiSummaries, title, periodLabel }) {
  return postJson('/api/reports', {
    title,
    periodLabel,
    articles: articles.map((a) => reportArticle(a, aiSummaries[a.id])),
  })
}

export function requestReportSection({ articles, aiSummaries, key, report, reportId }) {
  return postJson('/api/reports/section', {
    key,
    report,
    reportId,
    articles: articles.map((a) => reportArticle(a, aiSummaries[a.id])),
  })
}

// 상단 메뉴의 AI 연결 상태
export async function fetchHealth() {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error('서버 응답 없음')
  return res.json()
}

// 상단에서 AI 서버(맥미니 / OpenRouter)를 바꾼다
export async function selectLlmProvider(provider) {
  const res = await fetch('/api/llm', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}

// 보고서함 (DB). stored가 false면 DB가 없는 환경 → 화면이 브라우저에 저장한다
export async function fetchReports() {
  const res = await fetch('/api/reports')
  if (!res.ok) throw new Error('보고서함을 불러오지 못했어요')
  return res.json()
}

export function importReports(reports) {
  return postJson('/api/reports/import', { reports })
}

export async function deleteReportApi(id) {
  const res = await fetch(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '보고서를 지우지 못했어요')
}

// DB에 저장된 요약 (다른 브라우저에서 만든 요약도 보이게)
export function lookupSummaries(ids) {
  return postJson('/api/summaries/lookup', { ids })
}

// 정기 수집 키워드 (DB). stored가 false면 브라우저에만 저장
export async function fetchKeywords() {
  const res = await fetch('/api/keywords')
  if (!res.ok) throw new Error('키워드를 불러오지 못했어요')
  return res.json()
}

export async function saveKeywordsApi(keywords) {
  const res = await fetch('/api/keywords', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '키워드를 저장하지 못했어요')
  return res.json()
}

// ── 관리자 (17 문서) ──
// { configured: 관리자 비밀번호가 서버에 있는지, admin: { name } | null }
export async function fetchAdminMe() {
  const res = await fetch('/api/admin/me')
  if (!res.ok) throw new Error('관리자 상태를 불러오지 못했어요')
  return res.json()
}

// 성공하면 { admin }, 잠금 리셋 조합이면 { reset: true }. 실패하면 Error (잠겼으면 err.locked)
export async function adminLogin(id, password) {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error ?? `서버 오류 (${res.status})`), { locked: Boolean(data.locked) })
  return data
}

export function adminLogout() {
  return postJson('/api/admin/logout', {})
}

export async function fetchAdminLog() {
  const res = await fetch('/api/admin/log')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? '변경 기록을 불러오지 못했어요')
  return data.log
}

// 실험 기능 상태 { features: { key: 'off'|'test'|'all' }, list: [{ key, label, desc }] }
export async function fetchFeatures() {
  const res = await fetch('/api/features')
  if (!res.ok) throw new Error('실험 기능 설정을 불러오지 못했어요')
  return res.json()
}

export async function saveFeaturesApi(features) {
  const res = await fetch('/api/features', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(features),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}

// 테스트 페이지 「요약 시험」: 저장하지 않고 고른 AI 서버로 요약 (관리자만)
export function testSummaryApi(article, related, provider) {
  return postJson('/api/admin/test/summary', {
    article: { id: article.id, title: article.title, source: article.source, keyword: article.keyword, description: article.description },
    related: (related ?? []).map(({ id, title, source, description }) => ({ id, title, source, description })),
    provider,
  })
}

// 사용 현황 (관리자만, 17 문서 4장). days: 1(오늘) · 7 · 30
export async function fetchUsage(days) {
  const res = await fetch(`/api/admin/usage?days=${days}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? '사용 현황을 불러오지 못했어요')
  return data
}

// 운영 상태 { mode: normal|notice|ai_off|maintenance, message, until } — 누구나 읽음 (19 문서 6장)
export async function fetchOps() {
  const res = await fetch('/api/ops')
  if (!res.ok) throw new Error('운영 상태를 불러오지 못했어요')
  return res.json()
}

export async function saveOpsApi(ops) {
  const res = await fetch('/api/admin/ops', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ops),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}

// 서버 다시 켜기 (npm run serve로 켰을 때만)
export async function restartServerApi() {
  const res = await fetch('/api/admin/restart', { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}
