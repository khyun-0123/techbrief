import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  deleteReportApi,
  fetchArticles,
  fetchFavorites,
  fetchHealth,
  fetchKeywords,
  fetchLists,
  fetchRefresh,
  fetchReports,
  importReports,
  lookupSummaries,
  runRefresh,
  saveFavoritesApi,
  saveKeywordsApi,
  saveListsApi,
  saveRefreshSettings,
  searchNewsApi,
  selectLlmProvider,
  unlockRefresh,
} from './api.js'
import FavoritesRail from './FavoritesRail.jsx'
import ListsPanel from './ListsPanel.jsx'
import Pager from './Pager.jsx'
import ProgressPanel from './ProgressPanel.jsx'
import RefreshPanel from './RefreshPanel.jsx'
import ReportArchive from './ReportArchive.jsx'
import ReportDraft from './ReportDraft.jsx'
import { loadReports, saveReports } from './reportStore.js'
import { useSummaryQueue } from './summaryQueue.js'
import { DEFAULT_KEYWORDS, SAMPLE_ARTICLES } from './sampleArticles.js'
import SelectSummary from './SelectSummary.jsx'
import SentimentBadge, { sentimentLabel, sentimentOf as pickSentiment } from './SentimentBadge.jsx'
import SummaryItems from './SummaryItems.jsx'
import { formatPublished, load } from './utils.js'

const KEYWORDS_KEY = 'techbrief-keywords'
const SELECTED_KEY = 'techbrief-selected'
const INCLUDED_KEY = 'techbrief-included'
const ARTICLES_KEY = 'techbrief-articles' // 마지막으로 수집한 기사 (서버를 꺼도 화면에 남게)
const COLLECTED_AT_KEY = 'techbrief-collected-at'
const AI_SUMMARIES_KEY = 'techbrief-ai-summaries'
const PAGE_SIZE_KEY = 'techbrief-page-size'
const EXCLUDE_OWN_KEY = 'techbrief-exclude-own'
const SHOW_LOW_KEY = 'techbrief-show-low'
const RECENT_KEY = 'techbrief-recent-searches' // 최근 검색어 (이 브라우저에만)
const RECENT_MAX = 10
const EXTRA_KEY = 'techbrief-extra-articles' // 「기사 찾기」 결과에서 선별한 기사 (수집 목록에 없는 것)
const MAX_SAVED = 400

// 서버 기사(publishedAt)를 화면에서 쓰는 모양(hoursAgo)으로 바꾼다
function toView(a) {
  if (a.hoursAgo !== undefined) return a
  return { ...a, hoursAgo: Math.max(0, (Date.now() - Date.parse(a.publishedAt)) / 3600_000) }
}

// 원문 링크 표시(↗)가 혼자 다음 줄로 넘어가지 않게 마지막 단어와 붙여 둔다
function TitleWithIcon({ title }) {
  const cut = title.lastIndexOf(' ') + 1
  return (
    <>
      {title.slice(0, cut)}
      <span className="nowrap">
        {title.slice(cut)}
        <svg className="external-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7 9" />
        </svg>
      </span>
    </>
  )
}

// 왜 중요한지 (13 문서 F7). 보도량(같은 이슈 N건)과 최신성(발행 칸)은 이미 줄에 보이므로
// 선별에 도움이 되는 전문 매체·경쟁사 언급만 글로 보여 준다. 점수 전체는 마우스를 올리면
function importanceReasons(a) {
  const p = a.scoreParts ?? {}
  const out = []
  if (p.expert) out.push('전문 매체')
  if (p.competitorName) out.push(`경쟁사 ${p.competitorName} 언급`)
  return out
}

function scoreTitle(a) {
  const p = a.scoreParts ?? {}
  return `중요도 ${a.importance ?? 0}점 = 보도량 ${p.coverage ?? 0} + 전문 매체 ${p.expert ?? 0} + 경쟁사 ${p.competitor ?? 0} + 최신성 ${p.recency ?? 0} (60점 이상 중요)`
}

const PERIODS = [
  { value: 'today', label: '오늘', hours: 24 },
  { value: 'week', label: '최근 7일', hours: 24 * 7 },
  { value: 'all', label: '전체', hours: Infinity },
]

function App() {
  const [keywords, setKeywords] = useState(() => load(KEYWORDS_KEY, DEFAULT_KEYWORDS))
  const [selectedIds, setSelectedIds] = useState(() => load(SELECTED_KEY, []))
  const [includedIds, setIncludedIds] = useState(() => load(INCLUDED_KEY, []))
  const [screen, setScreen] = useState('collect')
  const [keywordInput, setKeywordInput] = useState('')
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState('today')
  const [source, setSource] = useState('all')
  const [fetched, setFetched] = useState(() => load(ARTICLES_KEY, []))
  const [collectedAt, setCollectedAt] = useState(() => load(COLLECTED_AT_KEY, null))
  const [refresh, setRefresh] = useState(null) // 자동 최신화 상태 (서버)
  const [refreshError, setRefreshError] = useState('')
  const [starting, setStarting] = useState(false)
  const [openSummaryId, setOpenSummaryId] = useState(null) // 목록에서 요약을 펼친 기사
  const [openGroupId, setOpenGroupId] = useState(null) // 같은 이슈 기사를 펼친 기사
  const [search, setSearch] = useState(null) // 네이버 기사 찾기 { query, articles?, loading?, error? }
  const [extraArticles, setExtraArticles] = useState(() => load(EXTRA_KEY, []))
  const [page, setPage] = useState(1)
  const [lists, setLists] = useState(null) // 자사·경쟁사·관심 기술 (팀 공용)
  const [listsError, setListsError] = useState('')
  const [excludeOwn, setExcludeOwn] = useState(() => load(EXCLUDE_OWN_KEY, false))
  const [showLow, setShowLow] = useState(() => load(SHOW_LOW_KEY, false)) // 관련도 낮은 기사도 보기 (F4)
  const [sentimentFilter, setSentimentFilter] = useState('all') // 긍정·중립·부정 거르기 (F5)
  const [favorites, setFavorites] = useState([]) // 즐겨찾는 검색어 (F3, 팀 공용)
  const [recent, setRecent] = useState(() => load(RECENT_KEY, [])) // 최근 검색어 (이 브라우저에만)
  const [pageSize, setPageSize] = useState(() => load(PAGE_SIZE_KEY, 20))
  const [sort, setSort] = useState('latest')
  const [aiSummaries, setAiSummaries] = useState(() => load(AI_SUMMARIES_KEY, {}))
  const [reports, setReports] = useState(() => loadReports())
  const [reportsInDb, setReportsInDb] = useState(false) // true면 보고서함을 서버 DB에 저장

  // 서버에 쌓인 기사를 불러온다. 앱을 열 때, 최신화가 끝났을 때
  const reloadArticles = useCallback(async () => {
    const result = await fetchArticles()
    if (result.articles.length === 0) return
    const articles = result.articles.slice(0, MAX_SAVED)
    setFetched(articles)
    setCollectedAt(result.lastCollectedAt)
    localStorage.setItem(ARTICLES_KEY, JSON.stringify(articles))
    localStorage.setItem(COLLECTED_AT_KEY, JSON.stringify(result.lastCollectedAt))
  }, [])

  useEffect(() => {
    reloadArticles().catch(() => {})
    fetchLists()
      .then(setLists)
      .catch(() => {})
    fetchFavorites()
      .then(setFavorites)
      .catch(() => {})
  }, [reloadArticles])

  // 목록을 바꾸면 저장하고 기사(중요도·자사 표시)를 다시 계산해 받는다
  async function saveLists(next) {
    setLists(next)
    setListsError('')
    try {
      setLists(await saveListsApi(next))
      await reloadArticles()
    } catch (err) {
      setListsError(err.message)
    }
  }

  function toggleShowLow(on) {
    setShowLow(on)
    localStorage.setItem(SHOW_LOW_KEY, JSON.stringify(on))
  }

  function toggleExcludeOwn(on) {
    setExcludeOwn(on)
    localStorage.setItem(EXCLUDE_OWN_KEY, JSON.stringify(on))
  }

  // 자동 최신화 상태: 도는 중이면 3초, 아니면 30초마다 확인. 끝나면(마지막 실행 시각이 바뀌면) 기사를 다시 불러온다
  const lastRunRef = useRef(undefined)
  const refreshRunning = Boolean(refresh?.running)
  useEffect(() => {
    let alive = true
    const check = () =>
      fetchRefresh()
        .then((status) => {
          if (!alive) return
          setRefresh(status)
          if (lastRunRef.current !== undefined && status.lastRunAt !== lastRunRef.current) reloadArticles().catch(() => {})
          lastRunRef.current = status.lastRunAt
        })
        .catch(() => {})
    check()
    const timer = setInterval(check, refreshRunning || starting ? 3_000 : 30_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refreshRunning, starting, reloadArticles])

  // 보고서함: DB가 있으면 서버에서 불러온다. 처음 한 번은 브라우저에 있던 보고서를 DB로 옮긴다
  useEffect(() => {
    let alive = true
    fetchReports()
      .then(async ({ stored, reports: serverReports }) => {
        if (!alive || !stored) return
        const local = loadReports()
        const list = serverReports.length === 0 && local.length > 0 ? (await importReports(local)).reports : serverReports
        if (!alive) return
        setReportsInDb(true)
        setReports(list)
      })
      .catch(() => {}) // 서버가 없으면 브라우저 저장소 그대로
    return () => {
      alive = false
    }
  }, [])
  const [health, setHealth] = useState(null) // { model, modelReachable } | { error }

  const [switchingLlm, setSwitchingLlm] = useState(false)

  // 상단 메뉴 오른쪽의 AI 연결 상태 (1분마다 확인)
  useEffect(() => {
    let alive = true
    const check = () =>
      fetchHealth()
        .then((h) => alive && setHealth(h))
        .catch(() => alive && setHealth({ error: true }))
    check()
    const timer = setInterval(check, 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  // 상단에서 AI 서버를 바꾸면 바로 연결 상태를 다시 확인한다
  async function handleSelectLlm(provider) {
    setSwitchingLlm(true)
    try {
      await selectLlmProvider(provider)
      setHealth(await fetchHealth())
    } catch (err) {
      alert(err.message)
    } finally {
      setSwitchingLlm(false)
    }
  }
  const llmLabel = health?.llm?.providers.find((p) => p.id === health.llm.current)?.label ?? 'AI 서버'

  // DB가 없을 때만 브라우저에 저장한다 (DB가 있으면 서버가 저장)
  function updateReports(update) {
    setReports((prev) => {
      const next = update(prev)
      if (!reportsInDb) saveReports(next)
      return next
    })
  }

  async function handleDeleteReport(id) {
    if (reportsInDb) await deleteReportApi(id)
    updateReports((list) => list.filter((r) => r.id !== id))
  }

  useEffect(() => {
    localStorage.setItem(AI_SUMMARIES_KEY, JSON.stringify(aiSummaries))
  }, [aiSummaries])

  // 선별한 기사 중 이 브라우저에 요약이 없는 것은 DB에서 가져온다 (다른 브라우저·이전 작업에서 만든 요약)
  useEffect(() => {
    const missing = selectedIds.filter((id) => !aiSummaries[id])
    if (missing.length === 0) return
    lookupSummaries(missing)
      .then(({ summaries }) => {
        if (Object.keys(summaries).length) setAiSummaries((prev) => ({ ...summaries, ...prev }))
      })
      .catch(() => {})
    // aiSummaries가 바뀔 때마다 다시 부르지 않도록 선별 목록이 바뀔 때만 확인한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds])

  // 목록 기사 중 미리 요약된 것을 가져온다 (자동 최신화·다른 팀원이 만든 요약)
  // 자동 요약은 최신화와 따로 뒤에서 계속 돈다 → 진행 건수가 바뀌면 다시 가져온다
  const searchArticles = search?.articles
  const backlogDone = refresh?.backlog?.done
  useEffect(() => {
    const ids = [...fetched, ...(searchArticles ?? [])].map((a) => a.id).filter((id) => !aiSummaries[id])
    if (ids.length === 0) return
    let alive = true
    const chunks = []
    for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200))
    Promise.all(chunks.map((c) => lookupSummaries(c)))
      .then((results) => {
        const found = Object.assign({}, ...results.map((r) => r.summaries))
        if (alive && Object.keys(found).length) setAiSummaries((prev) => ({ ...found, ...prev }))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched, searchArticles, backlogDone])

  // 「선별 추가」하면 자동 요약 (08 13-1: 선별한 기사만 요약)
  const queue = useSummaryQueue({
    onDone: (id, result) => setAiSummaries((prev) => ({ ...prev, [id]: result })),
  })

  const [keywordsInDb, setKeywordsInDb] = useState(false)

  useEffect(() => {
    localStorage.setItem(KEYWORDS_KEY, JSON.stringify(keywords))
  }, [keywords])

  // 키워드: DB가 있으면 팀이 같이 쓰는 목록을 불러온다. DB가 비어 있으면 이 브라우저의 키워드를 올린다
  useEffect(() => {
    let alive = true
    fetchKeywords()
      .then(async ({ stored, keywords: serverWords }) => {
        if (!alive || !stored) return
        const words = serverWords.length ? serverWords : (await saveKeywordsApi(load(KEYWORDS_KEY, DEFAULT_KEYWORDS))).keywords
        if (!alive) return
        setKeywords(words)
        setKeywordsInDb(true)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // 키워드를 바꾸면 DB에도 저장
  function changeKeywords(next) {
    setKeywords(next)
    if (keywordsInDb) saveKeywordsApi(next).catch((err) => setRefreshError(err.message))
  }

  useEffect(() => {
    localStorage.setItem(SELECTED_KEY, JSON.stringify(selectedIds))
  }, [selectedIds])

  useEffect(() => {
    localStorage.setItem(INCLUDED_KEY, JSON.stringify(includedIds))
  }, [includedIds])

  useEffect(() => {
    localStorage.setItem(EXTRA_KEY, JSON.stringify(extraArticles))
  }, [extraArticles])

  // 한 번도 수집하지 않았으면 샘플 기사를 보여 준다
  const isSample = fetched.length === 0
  // 화면 전체에서 쓰는 기사: 수집 기사 + 찾기에서 선별한 기사 + 지금 찾기 결과
  const pool = useMemo(() => {
    const base = isSample ? SAMPLE_ARTICLES : fetched.map(toView)
    const seen = new Set(base.map((a) => a.id))
    const more = [...extraArticles, ...(searchArticles ?? [])].filter((a) => !seen.has(a.id) && seen.add(a.id))
    return [...base, ...more.map(toView)]
  }, [isSample, fetched, extraArticles, searchArticles])
  const sources = useMemo(() => [...new Set(pool.map((a) => a.source))].sort(), [pool])

  // 수집 대상: 등록한 키워드에 해당하는 기사
  const collected = (isSample ? SAMPLE_ARTICLES : fetched.map(toView)).filter((a) => keywords.includes(a.keyword))
  const todayIssues = collected.filter((a) => a.hoursAgo < 24)
  const countArticles = (list) => list.reduce((n, a) => n + 1 + (a.sameIssue ?? 0), 0)

  const maxHours = PERIODS.find((p) => p.value === period).hours
  const q = query.trim().toLowerCase()
  const byId = new Map(pool.map((a) => [a.id, a]))
  // 자사·자회사만 나온 기사 (경쟁사도 함께 나오면 경쟁사 소식이라 남긴다)
  const isOwnOnly = (a) => Boolean(a.own) && !a.scoreParts?.competitorName
  const listed = searchArticles
    ? searchArticles
        .map((a) => ({ ...byId.get(a.id), rank: a.rank }))
        .filter((a) => source === 'all' || a.source === source)
        .sort((a, b) =>
          sort === 'relevance' ? a.rank - b.rank : sort === 'importance' ? b.importance - a.importance || a.hoursAgo - b.hoursAgo : a.hoursAgo - b.hoursAgo,
        )
    : collected
    .filter(
      (a) =>
        a.hoursAgo < maxHours &&
        (source === 'all' || a.source === source) &&
        (!q || a.title.toLowerCase().includes(q) || a.keyword.toLowerCase().includes(q)),
    )
    .sort((a, b) => (sort === 'importance' ? (b.importance ?? 0) - (a.importance ?? 0) : 0) || a.hoursAgo - b.hoursAgo)
  const isLow = (a) => a.relevance === 'low'
  const lowCount = listed.filter(isLow).length
  const ownCount = listed.filter(isOwnOnly).length
  const sentimentOf = (a) => sentimentLabel(pickSentiment(a, aiSummaries[a.id]?.summary))
  const visible = listed.filter(
    (a) =>
      (showLow || !isLow(a)) &&
      !(excludeOwn && isOwnOnly(a)) &&
      (sentimentFilter === 'all' || sentimentOf(a) === sentimentFilter),
  )

  // 정렬·필터·검색이 바뀌면 1페이지로 (13 문서 F2)
  const listKey = [period, source, sort, q, search?.query ?? '', keywords.join(','), excludeOwn, showLow, sentimentFilter].join('|')
  useEffect(() => {
    setPage(1)
  }, [listKey])
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const paged = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  function changePageSize(size) {
    setPageSize(size)
    setPage(1)
    localStorage.setItem(PAGE_SIZE_KEY, JSON.stringify(size))
  }

  function goPage(p) {
    setPage(Math.min(Math.max(1, p), pageCount))
    document.querySelector('.list-panel')?.scrollIntoView({ block: 'start' })
  }

  function handleAddKeyword(e) {
    e.preventDefault()
    const word = keywordInput.trim()
    if (!word || keywords.includes(word)) return
    changeKeywords([...keywords, word])
    setKeywordInput('')
  }

  function handleRemoveKeyword(word) {
    changeKeywords(keywords.filter((k) => k !== word))
  }

  // 「기사 찾기」: 등록 키워드와 상관없이 네이버에서 바로 찾는다
  async function handleSearch(e) {
    e.preventDefault()
    await runSearch(query.trim())
  }

  function saveRecent(next) {
    setRecent(next)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
      // 저장 공간을 못 쓰면 이번 화면에서만 유지
    }
  }

  async function runSearch(q) {
    if (!q || search?.loading) return
    setQuery(q)
    // 찾은 말은 최근 검색어 맨 위로 (같은 말은 하나만)
    saveRecent([q, ...recent.filter((r) => r !== q)].slice(0, RECENT_MAX))
    setSearch({ query: q, loading: true })
    try {
      const result = await searchNewsApi(q)
      setSearch({ query: result.query, articles: result.articles })
      setSort('relevance')
    } catch (err) {
      setSearch({ query: q, error: err.message })
    }
  }

  async function changeFavorites(next) {
    setFavorites(next)
    try {
      setFavorites(await saveFavoritesApi(next))
    } catch (err) {
      setSearch((prev) => (prev ? { ...prev, error: err.message } : prev))
    }
  }

  function closeSearch() {
    setSearch(null)
    setQuery('')
    if (sort === 'relevance') setSort('latest')
  }

  async function handleRefresh() {
    setStarting(true)
    setRefreshError('')
    try {
      setRefresh(await runRefresh(keywords))
    } catch (err) {
      setRefreshError(err.message)
    } finally {
      setStarting(false)
    }
  }

  async function handleRefreshSettings(settings, password) {
    setRefreshError('')
    try {
      setRefresh(await saveRefreshSettings(settings, password))
    } catch (err) {
      setRefreshError(err.message)
    }
  }

  function toggleSelected(article) {
    const { id } = article
    if (selectedIds.includes(id)) {
      setSelectedIds((prev) => prev.filter((x) => x !== id))
      // 선별을 풀면 보고서 포함 목록에서도 빼고, 아직 시작 전인 요약은 취소한다
      setIncludedIds((prev) => prev.filter((x) => x !== id))
      setExtraArticles((prev) => prev.filter((x) => x.id !== id))
      queue.remove(id)
    } else {
      setSelectedIds((prev) => [...prev, id])
      // 수집 목록에 없는 기사(찾기 결과)는 따로 보관해 선별·보고서에서 계속 쓸 수 있게
      if (!fetched.some((x) => x.id === id)) {
        // eslint-disable-next-line no-unused-vars
        const { hoursAgo, ...plain } = article
        setExtraArticles((prev) => [...prev.filter((x) => x.id !== id), plain].slice(-100))
      }
      if (!aiSummaries[id]) queue.enqueue(article)
    }
  }

  // 선별에서 빠진 기사는 보고서 포함 목록에서도 뺀다
  const candidates = pool.filter((a) => selectedIds.includes(a.id))
  const included = includedIds.filter((id) => selectedIds.includes(id))

  function handleExclude(id) {
    setSelectedIds((prev) => prev.filter((x) => x !== id))
    setExtraArticles((prev) => prev.filter((x) => x.id !== id))
    setIncludedIds((prev) => prev.filter((x) => x !== id))
    queue.remove(id)
  }

  // 보고서에는 선별 화면에서 고른 순서대로
  const reportArticles = included.map((id) => candidates.find((a) => a.id === id)).filter(Boolean)

  return (
    <div className="app">
      <nav className="topbar">
        <span className="brand">테크브리프</span>
        <div className="tabs">
        <button
          type="button"
          className={screen === 'collect' ? 'tab active' : 'tab'}
          onClick={() => setScreen('collect')}
        >
          수집 현황
        </button>
        <button
          type="button"
          className={screen === 'select' ? 'tab active' : 'tab'}
          onClick={() => setScreen('select')}
        >
          선별·요약
        </button>
        <button
          type="button"
          className={screen === 'report' ? 'tab active' : 'tab'}
          onClick={() => setScreen('report')}
        >
          보고서 초안
        </button>
        <button
          type="button"
          className={screen === 'archive' ? 'tab active' : 'tab'}
          onClick={() => setScreen('archive')}
        >
          보고서함{reports.length > 0 && <span className="tab-count">{reports.length}</span>}
        </button>
        </div>
        <span className="topbar-side">
          {health?.llm && (
            <label className="llm-pick" title="요약·보고서에 쓸 AI 모델">
              AI 모델
              <select
                className="llm-select"
                value={health.llm.current}
                disabled={switchingLlm}
                onChange={(e) => handleSelectLlm(e.target.value)}
              >
                {health.llm.providers.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.ready}>
                    {/* 예: 맥미니 · qwen3:14b, OpenRouter · dots-3-note-preview:free (회사 이름 앞부분은 줄임) */}
                    {p.label} · {p.ready ? p.model.split('/').pop() : '설정 없음'}
                  </option>
                ))}
              </select>
            </label>
          )}
          {health === null ? null : health.error ? (
            <span className="ai-status off">● 서버 연결 안 됨</span>
          ) : health.modelReachable ? (
            <span className="ai-status on" title={`AI 모델에 연결됨 (${health.model})`}>
              ● 연결됨
              {health.db?.enabled && (
                <span className={health.db.ok ? 'db-status on' : 'db-status off'} title={health.db.ok ? `기사 ${health.db.articles} · 요약 ${health.db.summaries} · 보고서 ${health.db.reports}` : health.db.error}>
                  {health.db.ok ? ' · DB' : ' · DB 오류'}
                </span>
              )}
            </span>
          ) : (
            <span className="ai-status off" title={`${llmLabel}(AI 서버)에 닿지 않아요. 요약·보고서를 만들 수 없어요`}>
              ● AI 연결 안 됨
            </span>
          )}
        </span>
      </nav>

      {screen === 'archive' ? (
        <ReportArchive
          reports={reports}
          onDelete={handleDeleteReport}
          onGoDraft={() => setScreen(reportArticles.length ? 'report' : 'select')}
        />
      ) : screen === 'report' ? (
        <ReportDraft
          articles={reportArticles}
          aiSummaries={aiSummaries}
          queue={queue}
          reports={reports}
          onSaved={(entry) => updateReports((list) => [entry, ...list])}
          storageLabel={reportsInDb ? 'DB' : '이 브라우저'}
          onUpdated={(entry) => updateReports((list) => list.map((r) => (r.id === entry.id ? entry : r)))}
          onGoSelect={() => setScreen('select')}
          onGoArchive={() => setScreen('archive')}
        />
      ) : screen === 'select' ? (
        <SelectSummary
          candidates={candidates}
          includedIds={included}
          setIncludedIds={setIncludedIds}
          onExclude={handleExclude}
          onGoCollect={() => setScreen('collect')}
          onGoReport={() => setScreen('report')}
          aiSummaries={aiSummaries}
          queue={queue}
        />
      ) : (
        <main className="page page-wide">
          <header className="page-header with-actions">
            <div>
              <h1>뉴스 수집 현황</h1>
              <p>
                {isSample
                  ? '키워드로 기사를 모아 보여 줘요. 아직 수집 전이라 샘플 기사를 보여 줘요.'
                  : '네이버 뉴스에서 모은 기사예요. 같은 이슈 기사는 하나로 묶었어요.'}
              </p>
            </div>
            <div className="header-actions">
              <span className="header-count">
                {refreshRunning ? '최신화 중…' : collectedAt ? `마지막 수집 ${new Date(collectedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '아직 수집 전'}
                {' · '}선별 <strong>{selectedIds.length}건</strong>
              </span>
              <button
                type="button"
                className="btn primary"
                onClick={() => setScreen('select')}
                disabled={selectedIds.length === 0}
                title={selectedIds.length === 0 ? '목록에서 「선별 추가」를 눌러 기사를 고르세요' : undefined}
              >
                선별·요약으로 →
              </button>
            </div>
          </header>

          <section className="stats">
            <div className="stat">
              <span className="stat-label">오늘 수집된 이슈 · 기사</span>
              <strong>
                {todayIssues.length}개 <small>· 기사 {countArticles(todayIssues)}건</small>
              </strong>
            </div>
            <div className="stat">
              <span className="stat-label">등록한 키워드</span>
              <strong>{keywords.length}개</strong>
            </div>
            <div className="stat">
              <span className="stat-label">선별한 기사</span>
              <strong>{selectedIds.length}건</strong>
            </div>
          </section>

          <div className="content with-favs">
            <FavoritesRail
              favorites={favorites}
              recent={recent}
              active={search?.query}
              onSearch={runSearch}
              onToggleFavorite={(q) => changeFavorites(favorites.includes(q) ? favorites.filter((f) => f !== q) : [...favorites, q])}
              onRemoveRecent={(q) => saveRecent(recent.filter((r) => r !== q))}
            />
            <section className="panel list-panel">
              <div className="filters">
                <form className="search-form" onSubmit={handleSearch}>
                  <input
                    type="search"
                    placeholder="기사 찾기 (키워드·제목)"
                    aria-label="기사 찾기"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button type="submit" className="btn outline" disabled={!query.trim() || search?.loading}>
                    {search?.loading ? '찾는 중…' : '네이버에서 찾기'}
                  </button>
                </form>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  aria-label="기간"
                  disabled={Boolean(searchArticles)}
                  title={searchArticles ? '찾기 결과에는 기간을 적용하지 않아요' : undefined}
                >
                  {PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="출처">
                  <option value="all">모든 출처</option>
                  {sources.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬">
                  {searchArticles && <option value="relevance">정확도순</option>}
                  <option value="latest">최신순</option>
                  <option value="importance">중요도순</option>
                </select>
              </div>
              {search ? (
                <div className="search-banner">
                  <span>
                    <strong>‘{search.query}’</strong> 네이버 찾기 결과
                    {search.articles && ` · 이슈 ${visible.length}개 · 기사 ${countArticles(visible)}건`}
                    {search.loading && ' · 찾는 중…'}
                    <span className="search-note"> · 수집 목록에는 쌓이지 않아요. 선별·요약하면 그 기사만 남아요</span>
                  </span>
                  <button type="button" className="btn" onClick={closeSearch}>
                    모은 기사로 돌아가기
                  </button>
                </div>
              ) : (
                <p className="list-meta">
                  이슈 {visible.length}개 · 기사 {countArticles(visible)}건
                  {q && <span className="search-note"> · 모은 기사에서 찾는 중. 없으면 「네이버에서 찾기」</span>}
                </p>
              )}
              <div className="list-tools">
                <label className="own-toggle" title="키워드가 제목·발췌에 없거나, 정치·사회 섹션 기사예요">
                  <input type="checkbox" checked={showLow} onChange={(e) => toggleShowLow(e.target.checked)} />
                  관련도 낮은 기사도 보기 <span className="own-count">{lowCount}건</span>
                </label>
                <select
                  className="sentiment-filter"
                  value={sentimentFilter}
                  onChange={(e) => setSentimentFilter(e.target.value)}
                  aria-label="긍정·중립·부정 거르기"
                  title="기사 속 소식 자체의 성격이에요. 요약 전에는 제목 기준, 요약 후에는 요약 기준이에요 (투자 판단용 아님)"
                >
                  <option value="all">긍정·부정 전체</option>
                  <option value="긍정">○ 긍정만</option>
                  <option value="중립">△ 중립만</option>
                  <option value="부정">✕ 부정만</option>
                </select>
                <label className="own-toggle" title="자사·자회사만 나온 기사를 숨겨요. 경쟁사도 함께 나오면 남겨요">
                  <input type="checkbox" checked={excludeOwn} onChange={(e) => toggleExcludeOwn(e.target.checked)} />
                  자사·자회사 기사 제외 <span className="own-count">{ownCount}건</span>
                </label>
              </div>
              {search?.error && <p className="ai-error search-error">{search.error}</p>}

              {visible.length === 0 ? (
                <p className="empty">
                  {search
                    ? search.loading
                      ? '네이버에서 찾는 중이에요…'
                      : '찾은 기사가 없어요. 다른 말로 찾아보세요.'
                    : '조건에 맞는 기사가 없어요. 기간을 넓히거나 「네이버에서 찾기」를 눌러 보세요.'}
                </p>
              ) : (
                <table className="articles">
                  <colgroup>
                    <col />
                    <col className="col-source" />
                    <col className="col-time" />
                    <col className="col-keyword" />
                    <col className="col-actions" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>제목</th>
                      <th>출처</th>
                      <th>발행</th>
                      <th>키워드</th>
                      <th>작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((a) => {
                      const selected = selectedIds.includes(a.id)
                      const ai = aiSummaries[a.id]
                      const open = openSummaryId === a.id && ai
                      const groupOpen = openGroupId === a.id && a.related?.length > 0
                      const reasons = importanceReasons(a)
                      const job = queue.jobs.find((j) => j.id === a.id)
                      return (
                        <Fragment key={a.id}>
                        <tr className={open || groupOpen ? 'row-open' : undefined}>
                          <td>
                            <div className="title" title={a.title}>
                              {a.importanceLevel === 'high' && (
                                <span className="badge-important" title={scoreTitle(a)}>
                                  중요
                                </span>
                              )}
                              {a.relevance === 'low' && <span className="badge-low">관련 낮음</span>}
                              <SentimentBadge sentiment={pickSentiment(a, ai?.summary)} />
                              {a.url ? (
                                <a className="title-link" href={a.url} target="_blank" rel="noreferrer" title="원문 열기 (새 창)">
                                  <TitleWithIcon title={a.title} />
                                </a>
                              ) : (
                                a.title
                              )}
                            </div>
                            <div className="row-meta">
                              {a.sameIssue > 0 &&
                                (a.related?.length ? (
                                  <button
                                    type="button"
                                    className="same-issue same-issue-btn"
                                    aria-expanded={groupOpen}
                                    onClick={() => setOpenGroupId(groupOpen ? null : a.id)}
                                  >
                                    같은 이슈 기사 {a.sameIssue}건 {groupOpen ? '▴' : '▾'}
                                  </button>
                                ) : (
                                  <span className="same-issue">같은 이슈 기사 {a.sameIssue}건</span>
                                ))}
                              {reasons.length > 0 && (
                                <span className="why-important" title={scoreTitle(a)}>
                                  {reasons.join(' · ')}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="source" title={a.source}>
                            {a.source}
                          </td>
                          <td className="time">{formatPublished(a.hoursAgo)}</td>
                          <td>
                            <span className="chip">{a.keyword}</span>
                          </td>
                          <td className="actions">
                            {ai ? (
                              <button
                                type="button"
                                className={open ? 'btn summary-btn open' : 'btn summary-btn'}
                                aria-expanded={Boolean(open)}
                                onClick={() => setOpenSummaryId(open ? null : a.id)}
                              >
                                {open ? '요약 접기' : '요약 보기'}
                              </button>
                            ) : job?.status === 'queued' || job?.status === 'running' ? (
                              <button type="button" className="btn summary-btn" disabled>
                                {job.status === 'running' ? '요약 중…' : '요약 대기'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn outline summary-btn"
                                title={job?.status === 'error' ? `요약 오류: ${job.error}` : 'AI로 6항목 요약 (선별하지 않아도 됨)'}
                                onClick={() => queue.enqueue(a)}
                              >
                                {job?.status === 'error' ? '요약 재시도' : '요약 추가'}
                              </button>
                            )}
                            <button
                              type="button"
                              className={selected ? 'btn primary' : 'btn outline'}
                              onClick={() => toggleSelected(a)}
                            >
                              {selected ? '선별됨 ✓' : '선별 추가'}
                            </button>
                          </td>
                        </tr>
                        {groupOpen && (
                          <tr className="group-row">
                            <td colSpan={5}>
                              <ul className="group-list">
                                {a.related.map((r) => (
                                  <li key={r.id ?? r.url}>
                                    {r.url ? (
                                      <a href={r.url} target="_blank" rel="noreferrer">
                                        {r.title}
                                      </a>
                                    ) : (
                                      r.title
                                    )}
                                    <span className="group-source"> · {r.source}</span>
                                  </li>
                                ))}
                              </ul>
                              {a.sameIssue > a.related.length && (
                                <p className="hint">외 {a.sameIssue - a.related.length}건 · 제목이 비슷한 기사를 48시간 안에서 묶었어요</p>
                              )}
                            </td>
                          </tr>
                        )}
                        {open && (
                          <tr className="summary-row">
                            <td colSpan={5}>
                              <SummaryItems summary={ai.summary} />
                              <p className="hint">
                                모델 {ai.model} · {new Date(ai.createdAt).toLocaleString('ko-KR')}
                              </p>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              )}
              {visible.length > 0 && (
                <Pager page={currentPage} pageSize={pageSize} total={visible.length} onPage={goPage} onPageSize={changePageSize} />
              )}
            </section>

            <aside className="panel settings">
              <h2>수집 설정</h2>
              <form onSubmit={handleAddKeyword}>
                <label htmlFor="keyword">키워드</label>
                <input
                  id="keyword"
                  type="text"
                  placeholder="키워드를 입력하고 Enter"
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                />
              </form>
              <div className="chips">
                {keywords.map((k) => (
                  <span key={k} className="chip">
                    {k}
                    <button type="button" onClick={() => handleRemoveKeyword(k)} aria-label={`${k} 삭제`}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <RefreshPanel
                status={refresh}
                error={refreshError}
                starting={starting}
                disabled={keywords.length === 0}
                onRun={handleRefresh}
                onSave={handleRefreshSettings}
                onUnlock={unlockRefresh}
              />
              <ListsPanel lists={lists} onSave={saveLists} error={listsError} />
              {isSample && <p className="hint">샘플 기사에는 생성형 AI · 반도체 · 클라우드 · OLED 키워드가 있어요.</p>}
            </aside>
          </div>
        </main>
      )}
      <ProgressPanel queue={queue} />
    </div>
  )
}

export default App
