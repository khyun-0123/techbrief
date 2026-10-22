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

// 등록한 키워드로 네이버 뉴스를 모은다
export function collectNews(keywords) {
  return postJson('/api/collect', { keywords })
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
  if (!res.ok) throw new Error('보고서를 지우지 못했어요')
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
  if (!res.ok) throw new Error('키워드를 저장하지 못했어요')
  return res.json()
}
