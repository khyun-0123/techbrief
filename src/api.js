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

// 논문 검색어(영문)가 늦게 만들어졌을 때 논문 · 1·2차 출처만 다시 받는다 (11/10)
export function searchPapersApi(query, period = 'all') {
  return postJson('/api/search/papers', { query, period })
}

// 검색어 (11/09): 추천 검색어(공용, 관리자가 고름) · 즐겨찾기 ☆ · 최근 검색어(IP별). 자동 수집과 별개
// 결과: { favorites, recent } (recent가 null이면 서버에 아직 없음). 11/16: 추천 검색어는 자동 수집 키워드로 합침
export async function fetchFavorites() {
  const res = await fetch('/api/favorites')
  if (!res.ok) throw new Error('즐겨찾기를 불러오지 못했어요')
  return res.json()
}

// data: { favorites?, recent? } 바꾼 것만
export async function saveFavoritesApi(data) {
  const res = await fetch('/api/favorites', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error ?? `서버 오류 (${res.status})`)
  return out
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
// select: 「선별 추가」로 요청 → 서버가 원문을 저장한다 (선별한 기사만, 11/06 결정)
export function requestSummary(article, { refresh = false, select = false } = {}) {
  return postJson('/api/summaries', {
    select,
    article: {
      id: article.id,
      url: article.url,
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
    // 논문: 유료 여부 · 저자 · 초록 (11/14, 보고서팀 작업 이식 — 유료면 초록까지만 쓴다)
    ...(article.paper ? { paper: true, access: article.access, authors: article.authors, abstract: article.abstract, oaUrl: article.oaUrl, doi: article.doi } : {}),
  }
}

// mode: 'all'이면 10건이 넘어도 전부 넣는다 (서버가 나눠 쓰고 합침, 오래 걸림)
// direction: 보고서 방향 한 줄 (11/08) — AI가 무엇을 앞에 두고 강조할지
export function requestReport({ articles, aiSummaries, title, direction, periodLabel, mode }) {
  return postJson('/api/reports', {
    title,
    direction,
    periodLabel,
    mode,
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

// 관리 페이지 보고서 관리: 전체 목록(만든 IP 포함) · 자동 삭제 주기 (11/08)
export async function fetchAdminReports() {
  const res = await fetch('/api/admin/reports')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? '보고서 목록을 불러오지 못했어요')
  return data
}

export async function saveReportRetentionApi(days) {
  const res = await fetch('/api/admin/reports/retention', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? '자동 삭제 설정을 저장하지 못했어요')
  return data
}

// 휴지통 보관 기간 (11/13, 관리 페이지): 휴지통에 N일 있으면 영구 삭제. 0 = 자동으로 지우지 않음
export async function saveReportTrashDaysApi(days) {
  const res = await fetch('/api/admin/reports/trash', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days }) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? '휴지통 보관 기간을 저장하지 못했어요')
  return data
}

// 11/13: 일반 화면에서 지우면 휴지통으로. permanent: 휴지통에 있는 내 보고서를 영구 삭제
export async function deleteReportApi(id, clientId, { permanent = false } = {}) {
  const res = await fetch(`/api/reports/${encodeURIComponent(id)}?client=${encodeURIComponent(clientId ?? '')}${permanent ? '&permanent=1' : ''}`, { method: 'DELETE' })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '보고서를 지우지 못했어요')
  return res.json().catch(() => ({}))
}
export async function restoreReportApi(id) {
  const res = await fetch(`/api/reports/${encodeURIComponent(id)}/restore`, { method: 'POST' })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '보고서를 되살리지 못했어요')
}
export async function starReportApi(id, on) {
  const res = await fetch(`/api/reports/${encodeURIComponent(id)}/star`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '중요 표시를 바꾸지 못했어요')
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

// 수집 출처 (관리자): 네이버 밖 출처 목록 · 끈 출처 · 지난 수집 결과 (14 문서 4-B)
export async function fetchSources() {
  const res = await fetch('/api/admin/sources')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? '수집 출처를 불러오지 못했어요')
  return data
}

export async function saveSourcesApi(disabled) {
  const res = await fetch('/api/admin/sources', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disabled }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}

// 키워드 추이 (뉴스 기사량 · 네이버 검색량 · Wikipedia 관심도 · GDELT 해외 보도량) — 22 문서 6-4
// 11/17 전 보고서: 저장된 분석 묶음에 기술 시계열 칸이 없으면 기억해 둔 묶음을 받아 채운다
export async function fetchReportAnalysis(saved) {
  const old = (saved?.report?.analysis ?? []).filter((a) => a?.keyword && !a.papers).map((a) => a.keyword)
  if (!old.length) return null
  return postJson('/api/report-analysis', { keywords: old })
}

// 보고서 주제어가 든 모은 기사의 날짜별 수 (11/17): 미리보기 · PPT 「기사 수 추이」 — 담당자 양식 PPT와 같은 값
export async function fetchTopicTrend(saved) {
  const terms = [...(saved?.report?.sources?.topics ?? []), ...(saved?.report?.analysis ?? []).map((a) => a?.keyword)].filter(Boolean)
  if (!terms.length) return null
  return postJson('/api/topic-trend', { terms, createdAt: saved.createdAt })
}

export async function fetchTrends() {
  const res = await fetch('/api/trends')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? '키워드 추이를 불러오지 못했어요')
  return data
}

// 요즘 뜨는 기술 (25 문서): 기간별 출처마다 순위 + 종합. period: week | lastweek | month | custom(from, to)
export async function fetchTechTrends({ period = 'week', from, to } = {}) {
  const q = new URLSearchParams({ period, ...(from && { from }), ...(to && { to }) })
  const res = await fetch(`/api/tech-trends?${q}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? '기술 트렌드를 불러오지 못했어요')
  return data
}

// ── 직접 추가한 자료 (27 문서 3장) ──
export async function fetchMaterials(clientId) {
  const res = await fetch(`/api/materials?client=${encodeURIComponent(clientId ?? '')}`)
  if (!res.ok) throw new Error('추가한 자료를 불러오지 못했어요')
  return (await res.json()).materials
}

// input: { kind: 'link'|'doi'|'text'|'file', url?, doi?, title?, text?, source?, fileName?, fileBase64?, tier?, aiAllowed? }
export async function addMaterialApi(input, clientId) {
  return (await postJson('/api/materials', { ...input, clientId })).material
}

export async function deleteMaterialApi(id, clientId) {
  const res = await fetch(`/api/materials/${encodeURIComponent(id)}?client=${encodeURIComponent(clientId ?? '')}`, { method: 'DELETE' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
}

// ── 선별 폴더 (브라우저별, 이름 없음) ──
export async function fetchSelection(clientId) {
  const res = await fetch(`/api/selections?client=${encodeURIComponent(clientId)}`)
  if (!res.ok) throw new Error('선별 폴더를 불러오지 못했어요')
  return (await res.json()).selection
}

export async function saveSelectionApi(clientId, data) {
  const res = await fetch('/api/selections', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, ...data }),
  })
  if (!res.ok) throw new Error('선별 폴더를 서버에 저장하지 못했어요')
}


// 보고서 고치기 (줄 빼기 · 근거 보충) — DB가 있으면 서버에 저장
export async function updateReportApi(entry) {
  const res = await fetch(`/api/reports/${encodeURIComponent(entry.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report: entry.report, articles: entry.articles }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
}


// ── 보고서 작업 대기열 (11/08) ──
// level: 'selected' | 'owned' | 'research' (자료 조사 수준)
// topics: 주제 키워드 (11/12 #109) — 11/14까지 여기서 빠져 서버에 가지 않았음 → 분석 묶음 자동 포함 · 자동 제목이 동작하지 않던 원인
export async function createReportJob({ articles, aiSummaries, title, direction, topics = [], periodLabel, mode, level, clientId }) {
  return (
    await postJson('/api/report-jobs', {
      title,
      direction,
      topics,
      periodLabel,
      mode,
      level,
      clientId,
      articles: articles.map((a) => reportArticle(a, aiSummaries[a.id])),
    })
  ).job
}

export async function fetchReportJobs(clientId) {
  const res = await fetch(`/api/report-jobs?client=${encodeURIComponent(clientId ?? '')}`)
  if (!res.ok) throw new Error('보고서 작업 상태를 불러오지 못했어요')
  return (await res.json()).jobs
}

export async function answerReportJob(id, use, clientId) {
  return (await postJson(`/api/report-jobs/${encodeURIComponent(id)}/answer`, { use, clientId })).job
}

export async function cancelReportJob(id, clientId) {
  return (await postJson(`/api/report-jobs/${encodeURIComponent(id)}/cancel`, { clientId })).job
}

// 관리 페이지: 자주 찾은 새 키워드 · 검색어 영문 표기 (11/10)
export async function fetchSearchTerms(days = 14) {
  const res = await fetch(`/api/admin/search-terms?days=${days}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}

export async function saveQueryTermsApi(query, terms) {
  const res = await fetch('/api/admin/query-terms', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, terms }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}

// 기술 시계열 (11/10): 숫자 · 단계(규칙) / AI 흐름 정리
export function fetchTimeline(query, refresh = false) {
  return postJson('/api/timeline', { query, refresh })
}
export function fetchTimelineStory(query, refresh = false) {
  return postJson('/api/timeline/story', { query, refresh })
}

// 미리 분석된 키워드 (대시보드 검색 전)
export async function fetchReadyTimelines() {
  const res = await fetch('/api/timeline/ready')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}

// 연관 키워드 (대시보드 맵 재료) · 범위 찾기 (11/10)
// 기술 시계열 「최근 소식」 (11/17 P8): 모은 기사 중 최근 30일 그 말이 든 이슈 (자료 현황과 같은 점수)
export async function fetchTimelineNews(q) {
  const res = await fetch(`/api/timeline/news?q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
  return res.json()
}
export async function fetchRelated(q) {
  const res = await fetch(`/api/related?q=${encodeURIComponent(q)}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}
export function searchScopeApi(scope, period = 'all') {
  return postJson('/api/search/scope', { ...scope, period })
}

// 세부 카테고리 × 경쟁사 특허 (11/12, 대시보드 「이번 주 한눈에」)
export async function fetchCategoryCompetitors() {
  const res = await fetch('/api/category-competitors')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}

// 키워드 분석 묶음 (11/12): 상용화 시점 문장 · 경쟁사 특허 등 (보고서에 자동으로 들어가는 것과 같음)
export async function fetchBundle(q) {
  const res = await fetch(`/api/bundle?q=${encodeURIComponent(q)}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}

// 요즘 뜨는 기술 옆 자사 위협 · 기회 (11/14): { verdicts: { [기술]: { category, verdict, competitors } | null } }
export async function fetchTrendVerdicts(terms) {
  const res = await fetch(`/api/trend-verdicts?terms=${encodeURIComponent(terms.join('|'))}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}

// ── 중요도 기준 (11/15 팀 회의, 관리 페이지 「중요도 기준」 · server/importanceRule.js) ──
export async function fetchImportanceRule() {
  const res = await fetch('/api/admin/importance-rule')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}
export const previewImportanceRule = (rule) => postJson('/api/admin/importance-rule/preview', rule)
export async function saveImportanceRuleApi(rule) {
  const res = await fetch('/api/admin/importance-rule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rule) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}

// 맵 점의 관련 기사 3건 (11/15, server/related.js wordArticles)
export async function fetchWordArticles(center, word) {
  const res = await fetch(`/api/related/articles?q=${encodeURIComponent(center)}&w=${encodeURIComponent(word)}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
  return data
}
