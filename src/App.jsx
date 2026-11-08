import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  deleteMaterialApi,
  answerReportJob,
  cancelReportJob,
  deleteReportApi,
  fetchReportJobs,
  updateReportApi,
  fetchAdminMe,
  fetchArticles,
  fetchFavorites,
  fetchFeatures,
  fetchHealth,
  fetchKeywords,
  fetchLists,
  fetchMaterials,
  fetchSelection,
  fetchRefresh,
  fetchReports,
  importReports,
  lookupSummaries,
  runRefresh,
  saveFavoritesApi,
  saveSelectionApi,
  searchNewsApi,
} from './api.js'
import SelectToggle from './SelectToggle.jsx'
import FavoritesRail from './FavoritesRail.jsx'
import Highlight from './Highlight.jsx'
import { highlightPattern, matchesTerms } from './highlightTerms.js'
import Pager from './Pager.jsx'
import ProgressPanel from './ProgressPanel.jsx'
import ReportArchive from './ReportArchive.jsx'
import { loadReports, saveReports } from './reportStore.js'
import { useSummaryQueue } from './summaryQueue.js'
import { DEFAULT_KEYWORDS, SAMPLE_ARTICLES } from './sampleArticles.js'
import SelectSummary from './SelectSummary.jsx'
import { enabledFeatures, FeaturesContext } from './features.js'
import Dashboard from './Dashboard.jsx'
import { AI_BLOCKED_TITLE, OPS_LABEL, OpsContext } from './ops.js'
import ListsPanel from './ListsPanel.jsx'
import LogoMark from './Logo.jsx'
import RefreshPanel from './RefreshPanel.jsx'
import TestTools from './TestTools.jsx'
import SentimentBadge, { sentimentLabel, sentimentOf as pickSentiment } from './SentimentBadge.jsx'
import SummaryItems from './SummaryItems.jsx'
import { formatPublished, load } from './utils.js'
import { clientId, enableUsage, track, trackVisit } from './usage.js'
import AddMaterial from './AddMaterial.jsx'
import DataMove from './DataMove.jsx'
import FolderBar from './FolderBar.jsx'
import { INBOX, INBOX_FOLDER } from './folders.js'

const KEYWORDS_KEY = 'techbrief-keywords'
const SELECTED_KEY = 'techbrief-selected'
const INCLUDED_KEY = 'techbrief-included'
const ARTICLES_KEY = 'techbrief-articles' // 마지막으로 수집한 기사 (서버를 꺼도 화면에 남게)
const COLLECTED_AT_KEY = 'techbrief-collected-at'
const AI_SUMMARIES_KEY = 'techbrief-ai-summaries'
const PAGE_SIZE_KEY = 'techbrief-page-size'
const EXCLUDE_OWN_KEY = 'techbrief-exclude-own'
const SHOW_LOW_KEY = 'techbrief-show-low'
const SUMMARIZED_FIRST_KEY = 'techbrief-summarized-first'
const RECENT_KEY = 'techbrief-recent-searches' // 최근 검색어: 11/09부터 서버(IP별)에 두고, 예전 브라우저 값은 처음 한 번 올린다
const RECENT_MAX = 10
// 출처 단계 (14 문서 4-B). 서버 collector/feeds.js와 같은 구분
const TIER_TITLE = { 1: '1차 출처: 기업 발표·학회·논문', 2: '2차 출처: 전문매체', 3: '3차 출처: 일반 뉴스' }
const EXTRA_KEY = 'techbrief-extra-articles' // 「기사 찾기」 결과에서 선별한 기사 (수집 목록에 없는 것)
const MAX_SAVED = 400
// 선별 폴더 (11/07 결정, 27 문서 2장). 브라우저에 두고 서버(selections)에도 같이 저장한다
const FOLDERS_KEY = 'techbrief-folders'
const FOLDER_OF_KEY = 'techbrief-folder-of'
const TARGET_FOLDER_KEY = 'techbrief-target-folder'

// 「미분류」는 항상 맨 앞에 있다
function withInbox(list) {
  const rest = (Array.isArray(list) ? list : []).filter((f) => f?.id && f.id !== INBOX)
  return [INBOX_FOLDER, ...rest]
}

// 직접 추가한 자료: 「발행」 칸에는 올린 때를 보여 준다 (논문 날짜는 제목 옆에)
function materialView(m) {
  return { ...m, hoursAgo: Math.max(0, (Date.now() - Date.parse(m.addedAt)) / 3600_000) }
}

// 서버 기사(publishedAt)를 화면에서 쓰는 모양(hoursAgo)으로 바꾼다
function toView(a) {
  if (a.hoursAgo !== undefined) return a
  return { ...a, hoursAgo: Math.max(0, (Date.now() - Date.parse(a.publishedAt)) / 3600_000) }
}

// 원문 링크 표시(↗)가 혼자 다음 줄로 넘어가지 않게 마지막 단어와 붙여 둔다
// terms: 강조할 검색어 (자르는 곳이 강조할 말 가운데면 그 말 앞에서 자른다)
function TitleWithIcon({ title, terms }) {
  let cut = title.lastIndexOf(' ') + 1
  const re = highlightPattern(terms)
  for (const m of re ? title.matchAll(re) : []) if (m.index < cut && cut < m.index + m[0].length) cut = m.index
  return (
    <>
      <Highlight text={title.slice(0, cut)} terms={terms} />
      <span className="nowrap">
        <Highlight text={title.slice(cut)} terms={terms} />
        <svg className="external-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7 9" />
        </svg>
      </span>
    </>
  )
}

// 왜 중요한지 (13 문서 F7). 보도량(같은 이슈 N건)과 최신성(발행 칸)은 이미 줄에 보이므로
// 선별에 도움이 되는 전문 매체·경쟁사·관심 기술·기술 소식만 글로 보여 준다. 점수 전체는 마우스를 올리면
function importanceReasons(a) {
  const p = a.scoreParts ?? {}
  const out = []
  if (p.competitorName) out.push(`경쟁사 ${p.competitorName} 언급`)
  if (p.interestName) out.push(`관심 기술 ${p.interestName}`)
  if (p.eventWords?.length) out.push(`${p.eventWords.join('·')} 소식`)
  if (p.expert) out.push('전문 매체')
  return out
}

function scoreTitle(a) {
  const p = a.scoreParts ?? {}
  const parts = [
    `보도량 ${p.coverage ?? 0}`,
    `전문 매체 ${p.expert ?? 0}`,
    `경쟁사 ${p.competitor ?? 0}`,
    `관심 기술 ${p.interest ?? 0}`,
    `기술·사업 소식 ${p.event ?? 0}`,
    `최신성 ${p.recency ?? 0}`,
  ]
  if (p.noise) parts.push(`시황·홍보성 ${p.noise}`)
  const weight = p.weight ?? 1
  const relevance = weight < 1 ? ` × 관련도 ${weight} (${weight >= 0.5 ? '관련도 중간' : '관련도 낮음'})` : ''
  return `중요도 ${a.importance ?? 0}점 = (${parts.join(' + ')})${relevance} · 60점 이상이면 중요`
}

const NEW_REPORTS_KEY = 'techbrief.newReports' // 아직 안 연 새 보고서 id
const SEEN_REPORTS_KEY = 'techbrief.seenReports' // 한 번이라도 연 보고서 id (새로 고침 뒤 다시 「새」로 뜨지 않게)

const PERIODS = [
  { value: 'today', label: '오늘', hours: 24 },
  { value: 'week', label: '최근 7일', hours: 24 * 7 },
  { value: 'all', label: '전체', hours: Infinity },
]

// 찾기 결과가 어떤 기준인지 (18 문서)
function searchScope(period) {
  if (period === 'today') return '최근 24시간 · 최신순'
  if (period === 'week') return '최근 7일 · 최신순'
  return '기간 전체 · 정확도 높은 100건'
}

// mode: 'normal'(일반 접속 /) | 'test'(관리자 테스트 페이지 /admin/test). 테스트에서는 '테스트에서만' 실험 기능까지 켠다
function App({ mode = 'normal', ops = { mode: 'normal' } }) {
  const isTest = mode === 'test'
  // 운영 상태 (19 문서 6장): AI 기능 정지면 일반 화면의 요약·보고서 버튼을 막는다. 테스트 페이지(관리자)는 그대로
  const opsValue = useMemo(() => ({ ...ops, aiBlocked: !isTest && ops.mode === 'ai_off' }), [ops, isTest])
  const [featureStates, setFeatureStates] = useState({}) // 실험 기능 { key: 'off' | 'test' | 'all' }
  const [featureList, setFeatureList] = useState([]) // [{ key, label }] 테스트 띠에 한글 이름으로 보여 줄 때
  const features = useMemo(() => enabledFeatures(featureStates, mode), [featureStates, mode])
  const [lists, setLists] = useState(null) // 자사·경쟁사·관심 기술 (「수집 설정」 칸 실험 기능에서 보기만)
  const [refreshError, setRefreshError] = useState('')
  const [starting, setStarting] = useState(false)
  const [keywords, setKeywords] = useState(() => load(KEYWORDS_KEY, DEFAULT_KEYWORDS))
  const [selectedIds, setSelectedIds] = useState(() => load(SELECTED_KEY, []))
  const [folders, setFolders] = useState(() => withInbox(load(FOLDERS_KEY, [])))
  const [folderOf, setFolderOf] = useState(() => load(FOLDER_OF_KEY, {})) // { 기사 id: 폴더 id }
  const [targetFolder, setTargetFolder] = useState(() => load(TARGET_FOLDER_KEY, INBOX)) // 자료 현황에서 「선별 추가」가 담을 폴더
  const [materials, setMaterials] = useState([]) // 직접 추가한 자료 (서버)
  const [showAdd, setShowAdd] = useState(false)
  const [showMove, setShowMove] = useState(false) // 내 자료 옮기기 (11/08)
  const [includedIds, setIncludedIds] = useState(() => load(INCLUDED_KEY, []))
  const [screen, setScreen] = useState('dashboard')
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState('all') // 기본 「전체」 (11/09 조장). 모은 기사 목록은 서버가 7일치만 보냄 (30 문서 1장)
  const [source, setSource] = useState('all')
  const [fetched, setFetched] = useState(() => load(ARTICLES_KEY, []))
  const [collectedAt, setCollectedAt] = useState(() => load(COLLECTED_AT_KEY, null))
  const [refresh, setRefresh] = useState(null) // 자동 최신화 상태 (서버)
  const [openSummaryId, setOpenSummaryId] = useState(null) // 목록에서 요약을 펼친 기사

  // 사용 현황 기록 (17 문서 4장): 일반 화면에서만. 테스트 페이지는 관리자 시험이라 빼고
  useEffect(() => {
    enableUsage(!isTest)
    trackVisit()
    return () => enableUsage(false)
  }, [isTest])
  const [openGroupId, setOpenGroupId] = useState(null) // 같은 이슈 기사를 펼친 기사
  const [search, setSearch] = useState(null) // 뉴스 · 논문 찾기 { query, articles?, loading?, error? } (11/08: 네이버 + 논문)
  const [extraArticles, setExtraArticles] = useState(() => load(EXTRA_KEY, []))
  const [page, setPage] = useState(1)
  const [excludeOwn, setExcludeOwn] = useState(() => load(EXCLUDE_OWN_KEY, false))
  const [showLow, setShowLow] = useState(() => load(SHOW_LOW_KEY, false)) // 관련도 낮은 기사도 보기 (F4)
  // 요약된 기사 먼저: 지금 정렬은 그대로 두고 요약된 기사를 위로 (요약을 먼저 보고 고르게)
  const [summarizedFirst, setSummarizedFirst] = useState(() => load(SUMMARIZED_FIRST_KEY, true))
  const [sentimentFilter, setSentimentFilter] = useState('all') // 긍정·중립·부정 거르기 (F5)
  const [recommended, setRecommended] = useState([]) // 추천 검색어 (공용, 관리자가 고름)
  const [favorites, setFavorites] = useState([]) // 즐겨찾기 ☆ (IP별, 11/09)
  const [recent, setRecent] = useState(() => load(RECENT_KEY, [])) // 최근 검색어 (IP별, 서버 값이 오기 전엔 브라우저 값)
  const [pageSize, setPageSize] = useState(() => load(PAGE_SIZE_KEY, 20))
  const [sort, setSort] = useState('importance') // 기본은 중요도순, 최신순은 선택
  const [aiSummaries, setAiSummaries] = useState(() => load(AI_SUMMARIES_KEY, {}))
  const [reports, setReports] = useState(() => loadReports())
  const [reportsInDb, setReportsInDb] = useState(false) // true면 보고서함을 서버 DB에 저장
  // 보고서 작업 대기열 (11/08): 서버가 만들고, 화면은 3초마다 상태를 받아 진행 창에 보여 준다
  const [reportJobs, setReportJobs] = useState([])
  const ingestedJobs = useRef(new Set())
  const [archiveTarget, setArchiveTarget] = useState(null) // 진행 창 「보고서함에서 보기」로 바로 열 보고서
  // 이 브라우저에서 만들어졌고 아직 안 연 보고서 (11/09): 「보고서함」 탭을 누르면 가장 최근 것이 바로 열린다. 한 번 열면 빠짐
  const [newReportIds, setNewReportIds] = useState(() => load(NEW_REPORTS_KEY, []))
  useEffect(() => {
    try {
      localStorage.setItem(NEW_REPORTS_KEY, JSON.stringify(newReportIds))
    } catch {
      // 저장이 막힌 브라우저면 이번 접속 동안만 기억
    }
  }, [newReportIds])
  function markReportSeen(id) {
    setNewReportIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev))
    const seen = load(SEEN_REPORTS_KEY, [])
    if (!seen.includes(id)) {
      try {
        localStorage.setItem(SEEN_REPORTS_KEY, JSON.stringify([id, ...seen].slice(0, 200)))
      } catch {
        // 무시
      }
    }
  }

  // 서버에 쌓인 기사를 불러온다. 앱을 열 때, 최신화가 끝났을 때
  const reloadArticles = useCallback(async () => {
    const result = await fetchArticles()
    if (result.articles.length === 0) return
    // 화면에는 서버가 준 기사 전부 (최근 7일). 브라우저 저장은 용량 때문에 최신 MAX_SAVED개만 (서버가 꺼졌을 때 보여 줄 용도)
    // 예전에는 화면도 400개로 잘라서, 빠짐없이 수집한 뒤로는 최근 몇 시간 치만 보였다
    setFetched(result.articles)
    setCollectedAt(result.lastCollectedAt)
    localStorage.setItem(ARTICLES_KEY, JSON.stringify(result.articles.slice(0, MAX_SAVED)))
    localStorage.setItem(COLLECTED_AT_KEY, JSON.stringify(result.lastCollectedAt))
  }, [])

  useEffect(() => {
    reloadArticles().catch(() => {})
    fetchFavorites()
      .then((d) => {
        setRecommended(d.recommended ?? [])
        setFavorites(d.favorites ?? [])
        if (Array.isArray(d.recent)) setRecent(d.recent)
        else if (load(RECENT_KEY, []).length) saveFavoritesApi({ recent: load(RECENT_KEY, []) }).catch(() => {}) // 예전 브라우저 값 올리기
      })
      .catch(() => {})
    fetchFeatures()
      .then((f) => {
        setFeatureStates(f.features)
        setFeatureList(f.list)
      })
      .catch(() => {})
    fetchLists()
      .then(setLists)
      .catch(() => {})
    fetchMaterials(clientId())
      .then(setMaterials)
      .catch(() => {})
  }, [reloadArticles])

  // 선별 폴더: 서버에 IP별로 담는다 (11/08). 이 IP의 선별이 서버에 있으면 그것을 쓰고, 없으면 이 브라우저 것을 올린다
  const selectionLoaded = useRef(false)
  useEffect(() => {
    const id = clientId()
    if (!id) {
      selectionLoaded.current = true
      return
    }
    fetchSelection(id)
      .then((saved) => {
        if (saved) {
          setFolders(withInbox(saved.folders))
          setFolderOf(saved.folderOf ?? {})
          setSelectedIds(saved.selectedIds ?? [])
        }
      })
      .catch(() => {})
      .finally(() => {
        selectionLoaded.current = true
      })
  }, [])

  // 「지금 최신화」 (실험 기능 refreshButton). 일반 사용자는 서버가 10분에 한 번으로 막는다
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

  function toggleSummarizedFirst(on) {
    setSummarizedFirst(on)
    localStorage.setItem(SUMMARIZED_FIRST_KEY, JSON.stringify(on))
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
    const timer = setInterval(check, refreshRunning ? 3_000 : 30_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refreshRunning, reloadArticles])

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

  // 관리자로 로그인했는지 (쿠키). 공용 보고서 지우기 같은 관리자 전용 버튼에 쓴다 (17 문서)
  const [admin, setAdmin] = useState(null)
  useEffect(() => {
    fetchAdminMe()
      .then((me) => setAdmin(me.admin))
      .catch(() => {})
  }, [])

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

  const llmLabel = health?.llm?.providers.find((p) => p.id === health.llm.current)?.label ?? 'AI 서버'

  // DB가 없을 때만 브라우저에 저장한다 (DB가 있으면 서버가 저장)
  function updateReports(update) {
    setReports((prev) => {
      const next = update(prev)
      if (!reportsInDb) saveReports(next)
      return next
    })
  }

  // 보고서 작업 상태 받기: 도는 작업이 있으면 3초, 없으면 20초마다. 끝난 작업의 보고서는 보고서함에 넣는다
  const reportJobsActive = reportJobs.some((j) => ['queued', 'running', 'need_confirm'].includes(j.status))
  useEffect(() => {
    const id = clientId()
    if (!id) return undefined
    let alive = true
    const check = () =>
      fetchReportJobs(id)
        .then((list) => {
          if (!alive) return
          setReportJobs(list)
          for (const j of list) {
            if (j.status !== 'done' || !j.result || ingestedJobs.current.has(j.id)) continue
            ingestedJobs.current.add(j.id)
            const entry = j.result
            if (!load(SEEN_REPORTS_KEY, []).includes(entry.id)) setNewReportIds((prev) => (prev.includes(entry.id) ? prev : [entry.id, ...prev]))
            setReports((prev) => {
              if (prev.some((r) => r.id === entry.id)) return prev
              const next = [entry, ...prev]
              if (!reportsInDb) saveReports(next)
              return next
            })
          }
        })
        .catch(() => {})
    check()
    const timer = setInterval(check, reportJobsActive ? 3_000 : 20_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
    // reportsInDb는 저장 위치만 정한다 (바뀌어도 다시 시작할 필요 없음)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportJobsActive])

  function refreshReportJobs() {
    const id = clientId()
    if (id) fetchReportJobs(id).then(setReportJobs).catch(() => {})
  }

  async function handleJobAnswer(jobId, use) {
    await answerReportJob(jobId, use, clientId()).catch(() => {})
    refreshReportJobs()
  }

  async function handleJobCancel(jobId) {
    await cancelReportJob(jobId, clientId()).catch(() => {})
    refreshReportJobs()
  }

  // 보고서함에서 보고서를 열면: 그 보고서에 쓴 기사가 아직 선별에 있으면 정리할지 묻는다 (한 번만)
  function handleCleanup(entry, action) {
    const ids = (entry.inputs ?? []).map((a) => a.id).filter((id) => selectedIds.includes(id))
    if (action === 'remove') ids.forEach(handleExclude)
    if (action === 'archive') {
      let archiveId = folders.find((f) => f.name === '보관')?.id
      if (!archiveId) archiveId = createFolder('보관')
      setFolderOf((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, archiveId])) }))
      setIncludedIds((prev) => prev.filter((id) => !ids.includes(id)))
    }
  }

  // 보고서 고치기 (줄 빼기 · AI 보충 근거): 화면에 바로 반영하고, DB가 있으면 서버에도 저장
  function handleReportUpdated(entry) {
    updateReports((list) => list.map((r) => (r.id === entry.id ? entry : r)))
    if (reportsInDb) updateReportApi(entry).catch(() => {})
  }

  async function handleDeleteReport(id) {
    if (reportsInDb) await deleteReportApi(id, clientId())
    updateReports((list) => list.filter((r) => r.id !== id))
  }
  // 공용 보고서함(DB): 일반 화면에서는 그 보고서를 만든 IP만 지운다(서버가 mine으로 알려 줌). 관리자로 로그인해 있어도 같다.
  // 관리자 권한은 관리 페이지(/admin 보고서 관리, /admin/test)에서만 (11/08 원칙). 브라우저에만 있는 보고서함은 각자 지움
  const canDeleteReport = (r) => !reportsInDb || Boolean(r?.mine) || (isTest && Boolean(admin))

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
  // 「네이버에서 찾기」 결과가 이미 모은 기사와 같은 이슈면 서버가 summaryId로 알려 준다 → 그 요약을 함께 쓴다
  useEffect(() => {
    const missing = [...fetched, ...(searchArticles ?? [])].filter((a) => !aiSummaries[a.id])
    const ids = [...new Set(missing.flatMap((a) => (a.summaryId && a.summaryId !== a.id ? [a.id, a.summaryId] : [a.id])))]
    if (ids.length === 0) return
    let alive = true
    const chunks = []
    for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200))
    Promise.all(chunks.map((c) => lookupSummaries(c)))
      .then((results) => {
        const found = Object.assign({}, ...results.map((r) => r.summaries))
        for (const a of missing) if (!found[a.id] && a.summaryId && found[a.summaryId]) found[a.id] = found[a.summaryId]
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

  useEffect(() => {
    localStorage.setItem(KEYWORDS_KEY, JSON.stringify(keywords))
  }, [keywords])

  // 자동 수집 키워드: 관리자가 정한 팀 공용 목록(DB)을 불러온다. 바꾸는 곳은 관리자 화면 (17 문서)
  useEffect(() => {
    let alive = true
    fetchKeywords()
      .then(({ stored, keywords: serverWords }) => {
        if (alive && stored && serverWords.length) setKeywords(serverWords)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(SELECTED_KEY, JSON.stringify(selectedIds))
  }, [selectedIds])

  useEffect(() => {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders))
    localStorage.setItem(FOLDER_OF_KEY, JSON.stringify(folderOf))
  }, [folders, folderOf])

  useEffect(() => {
    localStorage.setItem(TARGET_FOLDER_KEY, JSON.stringify(targetFolder))
  }, [targetFolder])

  // 서버에도 저장 (1.5초 모았다가 한 번). 불러오기가 끝나기 전에는 빈 값으로 덮지 않게 기다린다
  useEffect(() => {
    const id = clientId()
    if (!id || !selectionLoaded.current) return undefined
    const timer = setTimeout(() => saveSelectionApi(id, { folders, folderOf, selectedIds }).catch(() => {}), 1500)
    return () => clearTimeout(timer)
  }, [folders, folderOf, selectedIds])

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
    const base = [...(isSample ? SAMPLE_ARTICLES : fetched.map(toView)), ...materials.map(materialView)]
    const seen = new Set(base.map((a) => a.id))
    const more = [...extraArticles, ...(searchArticles ?? [])].filter((a) => !seen.has(a.id) && seen.add(a.id))
    return [...base, ...more.map(toView)]
  }, [isSample, fetched, extraArticles, searchArticles, materials])
  const sources = useMemo(() => [...new Set(pool.map((a) => a.source))].sort(), [pool])
  // 출처 거르기: 'all' · 'tier:1'(1차 기업·학회·논문) · 'tier:2'(2차 전문매체) · 'tier:3'(3차 일반 뉴스) · 매체 이름
  const sourceMatch = (a) =>
    source === 'all' || (source === 'material' ? Boolean(a.material) : source.startsWith('tier:') ? String(a.tier ?? 3) === source.slice(5) : a.source === source)

  // 수집 대상: 등록한 키워드에 해당하는 기사. 샘플은 키워드와 상관없이 모두 보여 준다 (샘플 키워드가 기본 키워드와 다름)
  const gathered = isSample ? SAMPLE_ARTICLES : fetched.map(toView).filter((a) => keywords.includes(a.keyword))
  const todayIssues = gathered.filter((a) => a.hoursAgo < 24)
  // 자료 현황 목록: 모은 기사 + 직접 추가한 자료
  const collected = [...gathered, ...materials.map(materialView)]
  const countArticles = (list) => list.reduce((n, a) => n + 1 + (a.sameIssue ?? 0), 0)

  const maxHours = PERIODS.find((p) => p.value === period).hours
  const q = query.trim().toLowerCase()
  const byId = new Map(pool.map((a) => [a.id, a]))
  // 자사·자회사만 나온 기사 (경쟁사도 함께 나오면 경쟁사 소식이라 남긴다)
  const isOwnOnly = (a) => Boolean(a.own) && !a.scoreParts?.competitorName
  const listed = searchArticles
    ? searchArticles
        .map((a) => byId.get(a.id))
        // 논문은 서버가 기간을 넓게 잡아 찾으므로(하루 · 일주일 안 논문은 거의 없음) 화면 기간으로 다시 거르지 않는다
        .filter((a) => (a.paper || a.hoursAgo < maxHours) && sourceMatch(a))
        .sort((a, b) =>
          sort === 'importance' ? b.importance - a.importance || a.hoursAgo - b.hoursAgo : a.hoursAgo - b.hoursAgo,
        )
    : collected
    .filter(
      (a) =>
        // 「직접 추가한 자료」만 볼 때는 기간과 상관없이 모두
        (a.hoursAgo < maxHours || source === 'material') &&
        sourceMatch(a) &&
        (!q || matchesTerms(`${a.title} ${a.keyword}`, [q])),
    )
    .sort((a, b) => (sort === 'importance' ? (b.importance ?? 0) - (a.importance ?? 0) : 0) || a.hoursAgo - b.hoursAgo)
  // 강조할 검색어: 네이버 찾기 결과면 찾은 말, 모은 기사에서 거르는 중이면 입력한 말 (Highlight.jsx)
  const hlTerms = search?.query ? [search.query] : q ? [q] : []
  const isLow = (a) => a.relevance === 'low'
  const lowCount = listed.filter(isLow).length
  const ownCount = listed.filter(isOwnOnly).length
  const sentimentOf = (a) => sentimentLabel(pickSentiment(a, aiSummaries[a.id]?.summary))
  const hasSummary = (a) => Boolean(aiSummaries[a.id]?.summary)
  const ordered = summarizedFirst ? [...listed.filter(hasSummary), ...listed.filter((a) => !hasSummary(a))] : listed
  const visible = ordered.filter(
    (a) =>
      (showLow || !isLow(a)) &&
      !(excludeOwn && isOwnOnly(a)) &&
      (!features.has('sentiment') || sentimentFilter === 'all' || sentimentOf(a) === sentimentFilter),
  )

  // 정렬·필터·검색이 바뀌면 1페이지로 (13 문서 F2)
  const listKey = [period, source, sort, q, search?.query ?? '', keywords.join(','), excludeOwn, showLow, sentimentFilter, summarizedFirst].join('|')
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

  // 「뉴스·논문에서 찾기」: 등록 키워드와 상관없이 네이버 뉴스 + 논문(OpenAlex 등)에서 바로 찾는다 (11/08)
  async function handleSearch(e) {
    e.preventDefault()
    await runSearch(query.trim())
  }

  function saveRecent(next) {
    setRecent(next)
    saveFavoritesApi({ recent: next }).catch(() => {}) // 실패하면 이번 화면에서만 유지
  }

  // 기간(p)도 함께 보낸다: 오늘·7일은 최신순으로 그 기간만, 전체는 정확도순 100건 (18 문서)
  // 찾는 중에 기간을 바꾸면 새 요청을 보내고, 늦게 온 이전 응답은 버린다
  const searchSeq = useRef(0)
  async function runSearch(q, p = period) {
    if (!q) return
    const seq = ++searchSeq.current
    track('search', q)
    setQuery(q)
    // 찾은 말은 최근 검색어 맨 위로 (같은 말은 하나만)
    saveRecent([q, ...recent.filter((r) => r !== q)].slice(0, RECENT_MAX))
    setSearch({ query: q, period: p, loading: true })
    try {
      const result = await searchNewsApi(q, p)
      if (seq !== searchSeq.current) return
      setSearch({ query: result.query, period: result.period, articles: result.articles, truncated: result.truncated, oldestAt: result.oldestAt, newsCount: result.newsCount, paperCount: result.paperCount, paperNote: result.paperNote })
    } catch (err) {
      if (seq !== searchSeq.current) return
      setSearch({ query: q, period: p, error: err.message })
    }
  }

  // 기간을 바꾸면: 모은 기사는 화면에서 바로 거르고, 찾기 결과를 보고 있으면 그 기간으로 다시 찾는다
  function changePeriod(p) {
    setPeriod(p)
    if (search?.query) runSearch(search.query, p)
  }

  async function changeFavorites(next) {
    setFavorites(next)
    try {
      setFavorites((await saveFavoritesApi({ favorites: next })).favorites ?? next)
    } catch (err) {
      setSearch((prev) => (prev ? { ...prev, error: err.message } : prev))
    }
  }

  function closeSearch() {
    searchSeq.current++ // 찾는 중에 닫으면 늦게 온 응답이 다시 열지 않게
    setSearch(null)
    setQuery('')
  }

  function toggleSelected(article, folderId = targetFolder) {
    const { id } = article
    if (selectedIds.includes(id)) {
      setSelectedIds((prev) => prev.filter((x) => x !== id))
      setFolderOf(({ [id]: _drop, ...rest }) => rest)
      // 선별을 풀면 보고서 포함 목록에서도 빼고, 아직 시작 전인 요약은 취소한다
      setIncludedIds((prev) => prev.filter((x) => x !== id))
      setExtraArticles((prev) => prev.filter((x) => x.id !== id))
      queue.remove(id)
    } else {
      setSelectedIds((prev) => [...prev, id])
      setFolderOf((prev) => ({ ...prev, [id]: folders.some((f) => f.id === folderId) ? folderId : INBOX }))
      track('select', article.keyword || search?.query || '')
      // 수집 목록에 없는 기사(찾기 결과)는 따로 보관해 선별·보고서에서 계속 쓸 수 있게
      if (!fetched.some((x) => x.id === id)) {
        // eslint-disable-next-line no-unused-vars
        const { hoursAgo, ...plain } = article
        setExtraArticles((prev) => [...prev.filter((x) => x.id !== id), plain].slice(-100))
      }
      // 원문 기반(11/07): 요약이 없거나 발췌문 요약이면 선별 표시와 함께 요청 → 서버가 원문을 저장하고 원문으로 요약
      // AI 요약을 허용하지 않은 직접 추가 자료는 요약하지 않는다
      if (aiSummaries[id]?.summary?.basisSource !== 'fulltext' && !opsValue.aiBlocked && article.aiAllowed !== false) queue.enqueue(article, { select: true })
    }
  }

  // 폴더로 담기 · 옮기기: 아직 선별 전이면 그 폴더로 선별, 선별한 기사면 폴더만 바꾼다 (끌어 놓기 · 폴더 메뉴)
  // 끌어 놓기로 오는 id는 글자라서 글자로 비교한다 (샘플 기사 id는 숫자)
  function putInFolder(articleId, folderId) {
    const key = String(articleId)
    const article = pool.find((x) => String(x.id) === key) ?? extraArticles.find((x) => String(x.id) === key)
    if (!article) return
    if (selectedIds.includes(article.id)) setFolderOf((prev) => ({ ...prev, [article.id]: folderId }))
    else toggleSelected(article, folderId)
  }

  function createFolder(name) {
    const id = `f-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    setFolders((prev) => [...prev, { id, name: name.slice(0, 40) }])
    return id
  }

  function renameFolder(id, name) {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: name.slice(0, 40) } : f)))
  }

  // 폴더를 지우면 안의 기사는 「미분류」로
  function deleteFolder(id) {
    if (id === INBOX) return
    setFolders((prev) => prev.filter((f) => f.id !== id))
    setFolderOf((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v === id ? INBOX : v])))
    if (targetFolder === id) setTargetFolder(INBOX)
  }

  const folderIdOf = (id) => (folders.some((f) => f.id === folderOf[id]) ? folderOf[id] : INBOX)
  const folderCounts = {}
  for (const id of selectedIds) folderCounts[folderIdOf(id)] = (folderCounts[folderIdOf(id)] ?? 0) + 1

  // 직접 추가: 자료 목록에 넣고, 고르면 선별에도 담는다
  function handleMaterialAdded(material, { select, folderId }) {
    setMaterials((prev) => [material, ...prev.filter((m) => m.id !== material.id)])
    if (select && !selectedIds.includes(material.id)) toggleSelected(materialView(material), folderId)
  }

  async function handleMaterialDelete(m) {
    if (!window.confirm(`「${m.title}」 자료를 지울까요? 되돌릴 수 없어요.`)) return
    try {
      await deleteMaterialApi(m.id, clientId())
      setMaterials((prev) => prev.filter((x) => x.id !== m.id))
    } catch (err) {
      window.alert(err.message)
    }
  }

  // 선별에서 빠진 기사는 보고서 포함 목록에서도 뺀다
  const candidates = pool.filter((a) => selectedIds.includes(a.id))
  const included = includedIds.filter((id) => selectedIds.includes(id))

  function handleExclude(id) {
    setSelectedIds((prev) => prev.filter((x) => x !== id))
    setFolderOf(({ [id]: _drop, ...rest }) => rest)
    setExtraArticles((prev) => prev.filter((x) => x.id !== id))
    setIncludedIds((prev) => prev.filter((x) => x !== id))
    queue.remove(id)
  }

  // 보고서에는 선별 화면에서 고른 순서대로
  const reportArticles = included.map((id) => candidates.find((a) => a.id === id)).filter(Boolean)
  // 보고서에 들어가는 기사가 어느 폴더에서 왔는지 (여러 폴더를 묶어 쓸 수 있음)
  const reportFolders = folders
    .map((f) => [f.name, reportArticles.filter((a) => folderIdOf(a.id) === f.id).length])
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name} ${n}건`)
    .join(' · ')

  return (
    <OpsContext.Provider value={opsValue}>
    <FeaturesContext.Provider value={features}>
    <div className={isTest ? 'app app-test' : 'app'}>
      {isTest && (
        <div className="test-banner">
          <strong>테스트 페이지</strong>
          <span title={featureList.filter((f) => features.has(f.key)).map((f) => f.label).join(' · ') || '켜진 실험 기능 없음'}>
            실험 기능 {features.size}개 켜짐
          </span>
          <span className="test-banner-note">일반 화면에는 「모두에게」로 정한 기능만 보여요</span>
          <a href="/admin#features">실험 기능 설정 →</a>
          <a href="/admin">관리 페이지 →</a>
        </div>
      )}
      <nav className="topbar">
        {/* 로고를 누르면 첫 화면(대시보드 맨 위)으로. 새 탭(Ctrl·⌘ 클릭)은 주소로 그대로 열림 */}
        <a
          className="brand"
          href={isTest ? '/admin/test' : '/'}
          title="첫 화면으로"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
            e.preventDefault()
            setScreen('dashboard')
            closeSearch()
            window.scrollTo({ top: 0 })
          }}
        >
          <LogoMark size={28} className="brand-mark" />
          테크브리프{isTest && <small className="brand-test"> 테스트</small>}
        </a>
        <div className="tabs">
        <button
          type="button"
          className={screen === 'dashboard' ? 'tab active' : 'tab'}
          aria-current={screen === 'dashboard' ? 'page' : undefined}
          onClick={() => setScreen('dashboard')}
        >
          대시보드
        </button>
        <button
          type="button"
          className={screen === 'collect' ? 'tab active' : 'tab'}
          aria-current={screen === 'collect' ? 'page' : undefined}
          onClick={() => setScreen('collect')}
        >
          자료 현황
        </button>
        <button
          type="button"
          className={screen === 'select' ? 'tab active' : 'tab'}
          aria-current={screen === 'select' ? 'page' : undefined}
          onClick={() => setScreen('select')}
        >
          선별·요약
        </button>
        <button
          type="button"
          className={screen === 'archive' ? 'tab active' : 'tab'}
          aria-current={screen === 'archive' ? 'page' : undefined}
          onClick={() => {
            // 새로 만들어진(아직 안 연) 내 보고서가 있으면 그것부터, 없으면 목록
            setArchiveTarget(newReportIds.find((id) => reports.some((r) => r.id === id)) ?? null)
            setScreen('archive')
          }}
        >
          보고서함{reports.length > 0 && <span className="tab-count">{reports.length}</span>}
          {newReportIds.some((id) => reports.some((r) => r.id === id)) && (
            <span className="tab-new" title="새로 만들어진 보고서가 있어요 — 누르면 바로 열려요">
              새 {newReportIds.filter((id) => reports.some((r) => r.id === id)).length}
            </span>
          )}
        </button>
        {isTest && (
          <button
            type="button"
            className={screen === 'tools' ? 'tab active' : 'tab'}
            aria-current={screen === 'tools' ? 'page' : undefined}
            onClick={() => setScreen('tools')}
          >
            시험 도구
          </button>
        )}
        </div>
        <span className="topbar-side">
          {/* 오늘 수집 · 선별 숫자 (11/08: 대시보드 숫자 칸을 메뉴 막대로 옮김). 누르면 그 화면으로 */}
          <span className="topbar-stats">
            <button type="button" onClick={() => setScreen('collect')} title="오늘(24시간) 모은 이슈 · 기사 — 자료 현황으로">
              오늘 이슈 <strong>{todayIssues.length}</strong> · 기사 <strong>{countArticles(todayIssues)}</strong>
            </button>
            <button type="button" onClick={() => setScreen('select')} title="선별한 기사 — 선별·요약으로">
              선별 <strong>{selectedIds.length}</strong>
            </button>
          </span>
          {/* 연결 상태만 보여 준다 (11/09: 모델 이름은 메뉴 막대에서 빼고 마우스를 올리면 보임). 모델은 관리자 화면에서 고른다 (17 문서) */}
          {health === null ? null : health.error ? (
            <span className="ai-status off">● 서버 연결 안 됨</span>
          ) : (
            <span className="conn-status">
              <span
                className={health.modelReachable ? 'ai-status on' : 'ai-status off'}
                title={
                  health.modelReachable
                    ? `AI 연결됨 · ${llmLabel} · ${health.llm?.providers.find((p) => p.id === health.llm.current)?.model.split('/').pop() || health.model || ''}`
                    : `${llmLabel}(AI 서버)에 닿지 않아요. 요약·보고서를 만들 수 없어요`
                }
              >
                ● AI {health.modelReachable ? '연결' : '끊김'}
              </span>
              <span
                className={health.db?.enabled && health.db.ok ? 'db-status on' : 'db-status off'}
                title={!health.db?.enabled ? 'DB 없이 실행 중 (서버를 끄면 자료가 사라져요)' : health.db.ok ? `DB 연결됨 · 기사 ${health.db.articles} · 요약 ${health.db.summaries} · 보고서 ${health.db.reports}` : health.db.error}
              >
                ● DB {!health.db?.enabled ? '없음' : health.db.ok ? '연결' : '오류'}
              </span>
            </span>
          )}
          <button type="button" className="topbar-link" onClick={() => setShowMove(true)} title="선별 · 폴더 등 이 브라우저의 자료를 파일로 내보내거나 불러와요 (자리 이동 · 다른 PC)">
            내 자료
          </button>
          <a className="admin-link" href="/admin" title="키워드·회사·관심 기술·자동 최신화·AI 모델 설정">
            {admin ? `관리자 (${admin.name})` : '관리자'}
          </a>
        </span>
      </nav>
      {ops.mode !== 'normal' && (isTest || ops.mode !== 'maintenance') && (
        <div className={`ops-banner ops-${ops.mode}`} role="status">
          <strong>{isTest ? `운영 상태: ${OPS_LABEL[ops.mode]}` : ops.mode === 'ai_off' ? 'AI 요약·보고서 잠시 멈춤' : '공지'}</strong>
          <span>
            {isTest && ops.mode === 'maintenance'
              ? '일반 사용자에게는 점검 화면이 보여요. 관리자는 여기서 그대로 확인할 수 있어요.'
              : isTest && ops.mode === 'ai_off'
                ? '일반 사용자는 요약·보고서를 쓸 수 없어요. 관리자는 그대로 쓸 수 있어요.'
                : ops.message || (ops.mode === 'ai_off' ? '기사 보기와 찾기는 그대로 쓸 수 있어요.' : '')}
            {!isTest && ops.until && ` · ${ops.until} 재개 예정`}
          </span>
          {isTest && <a href="/admin#ops">운영 설정 →</a>}
        </div>
      )}

      {screen === 'tools' && isTest ? (
        <TestTools providers={health?.llm?.providers ?? []} />
      ) : screen === 'dashboard' ? (
        <Dashboard
          stats={{
            todayIssues: todayIssues.length,
            todayArticles: countArticles(todayIssues),
            selected: selectedIds.length,
            collectedLabel: refreshRunning ? '최신화 중…' : collectedAt ? `마지막 수집 ${new Date(collectedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '아직 수집 전',
          }}
          keywords={keywords}
          recommended={recommended}
          favorites={favorites}
          recent={recent}
          periods={PERIODS}
          period={period}
          onPeriod={setPeriod}
          onSearch={(q) => {
            runSearch(q)
            setScreen('collect')
            window.scrollTo({ top: 0 })
          }}
          onKeyword={(k) => {
            searchSeq.current++
            setSearch(null)
            setQuery(k)
            setScreen('collect')
            window.scrollTo({ top: 0 })
          }}
          onGoCollect={() => setScreen('collect')}
        />
      ) : screen === 'archive' ? (
        <ReportArchive
          reports={reports}
          onDelete={handleDeleteReport}
          canDelete={canDeleteReport}
          onGoDraft={() => setScreen('select')}
          onUpdated={handleReportUpdated}
          selectedIds={selectedIds}
          onCleanup={handleCleanup}
          initialId={archiveTarget}
          onOpened={markReportSeen}
          key={archiveTarget ?? 'archive'}
        />
      ) : screen === 'select' ? (
        <SelectSummary
          candidates={candidates}
          includedIds={included}
          setIncludedIds={setIncludedIds}
          onExclude={handleExclude}
          onGoCollect={() => setScreen('collect')}
          aiSummaries={aiSummaries}
          queue={queue}
          folders={folders}
          folderIdOf={folderIdOf}
          folderCounts={folderCounts}
          onMove={putInFolder}
          onCreateFolder={createFolder}
          onRenameFolder={renameFolder}
          onDeleteFolder={deleteFolder}
          onMaterialAdded={handleMaterialAdded}
          reportArticles={reportArticles}
          reports={reports}
          reportJobs={reportJobs}
          onJobAdded={(job) => setReportJobs((prev) => [...prev.filter((j) => j.id !== job.id), job])}
          onOpenReport={(id) => {
            setArchiveTarget(id)
            setScreen('archive')
          }}
          folderSummary={reportFolders}
        />
      ) : (
        <main className="page page-wide collect-page">
          <header className="page-header with-actions">
            <div>
              <h1>자료 현황</h1>
              <p>
                {isSample
                  ? '키워드로 기사를 모아 보여 줘요. 아직 수집 전이라 샘플 기사를 보여 줘요.'
                  : '네이버 뉴스와 전문매체 · 기업 발표 · 학회에서 모은 기사예요. 같은 이슈 기사는 하나로 묶었어요.'}
              </p>
            </div>
            <div className="header-actions">
              <span className="header-count">
                {refreshRunning ? '최신화 중…' : collectedAt ? `마지막 수집 ${new Date(collectedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '아직 수집 전'}
                {' · '}선별 <strong>{selectedIds.length}건</strong>
              </span>
              {features.has('refreshButton') && (
                <button type="button" className="btn" onClick={handleRefresh} disabled={starting || refreshRunning || keywords.length === 0}>
                  {starting || refreshRunning ? '최신화 중…' : '지금 최신화'}
                </button>
              )}
              <button type="button" className={showAdd ? 'btn primary' : 'btn'} aria-expanded={showAdd} onClick={() => setShowAdd((v) => !v)}>
                + 자료 추가
              </button>
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
          {refreshError && <p className="ai-error" role="alert">{refreshError}</p>}
          {showAdd && <AddMaterial folders={folders} defaultFolder={targetFolder} onAdded={handleMaterialAdded} onClose={() => setShowAdd(false)} />}

          {/* 오늘 수집 숫자 · 키워드 추이는 대시보드로 옮김 (11/07 팀 회의) */}
          <div className={features.has('collectPanel') ? 'content with-favs' : 'content with-favs no-settings'}>
            <FavoritesRail
              recommended={recommended}
              favorites={favorites}
              recent={recent}
              active={search?.query}
              onSearch={runSearch}
              onToggleFavorite={(q) => changeFavorites(favorites.includes(q) ? favorites.filter((f) => f !== q) : [...favorites, q])}
              onRemoveRecent={(q) => saveRecent(recent.filter((r) => r !== q))}
            />
            <section className="panel list-panel">
              {/* 「선별 추가」가 담을 폴더 (11/08: 끌어 놓기는 뺐다. 담긴 기사는 옆 폴더 메뉴로 옮김) */}
              <FolderBar
                label="담을 폴더"
                folders={folders}
                counts={folderCounts}
                active={targetFolder}
                onPick={(id) => setTargetFolder(id ?? INBOX)}
                onCreate={(name) => setTargetFolder(createFolder(name))}
              />
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
                    {search?.loading ? '찾는 중…' : '뉴스·논문에서 찾기'}
                  </button>
                </form>
                <select
                  value={period}
                  onChange={(e) => changePeriod(e.target.value)}
                  aria-label="기간"
                  title={search ? '바꾸면 이 기간으로 다시 찾아요' : undefined}
                >
                  {PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="출처">
                  <option value="all">모든 출처</option>
                  <optgroup label="출처 단계">
                    <option value="tier:1">1차 · 기업 발표·학회·논문</option>
                    <option value="tier:2">2차 · 전문매체</option>
                    <option value="tier:3">3차 · 일반 뉴스</option>
                  </optgroup>
                  <option value="material">직접 추가한 자료 ({materials.length})</option>
                  <optgroup label="매체">
                    {sources.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬">
                  <option value="importance">중요도순</option>
                  <option value="latest">최신순</option>
                </select>
              </div>
              {search ? (
                <div className="search-banner">
                  <span aria-live="polite">
                    <strong>‘{search.query}’</strong> 찾기 결과 · 뉴스 {searchScope(search.period)}
                    {search.articles && ` · 뉴스 ${search.newsCount ?? 0}건 · 논문 ${search.paperCount ?? 0}건`}
                    {search.paperNote && <span className="search-note"> · {search.paperNote}</span>}
                    {search.articles && ` · 이슈 ${visible.length}개 · 기사 ${countArticles(visible)}건`}
                    {search.loading && ' · 찾는 중…'}
                    {search.truncated && (
                      <span className="search-note">
                        {' '}· 기사가 많아 {new Date(search.oldestAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} 이후 것만 가져왔어요. 더 구체적인 말로 찾아보세요
                      </span>
                    )}
                    <span className="search-note"> · 수집 목록에는 쌓이지 않아요. 선별·요약하면 그 기사만 남아요</span>
                  </span>
                  <button type="button" className="btn" onClick={closeSearch}>
                    모은 기사로 돌아가기
                  </button>
                </div>
              ) : (
                <p className="list-meta">
                  이슈 {visible.length}개 · 기사 {countArticles(visible)}건
                  {q && <span className="search-note"> · 모은 기사에서 찾는 중. 없으면 「뉴스·논문에서 찾기」</span>}
                </p>
              )}
              <div className="list-tools">
                <label className="own-toggle" title="지금 정렬은 그대로 두고, AI 요약이 있는 기사를 위로 올려요">
                  <input type="checkbox" checked={summarizedFirst} onChange={(e) => toggleSummarizedFirst(e.target.checked)} />
                  요약된 기사 먼저 <span className="own-count">{listed.filter(hasSummary).length}건</span>
                </label>
                <label className="own-toggle" title="키워드 이야기가 한두 줄뿐이거나, 제목이 주식·쇼핑·생활 등 다른 주제이고 기술 내용이 없는 기사예요 (기본은 숨김)">
                  <input type="checkbox" checked={showLow} onChange={(e) => toggleShowLow(e.target.checked)} />
                  관련도 낮은 기사도 보기 <span className="own-count">{lowCount}건</span>
                </label>
                {features.has('sentiment') && (
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
                )}
                <label className="own-toggle" title="자사·자회사만 나온 기사를 숨겨요. 경쟁사도 함께 나오면 남겨요">
                  <input type="checkbox" checked={excludeOwn} onChange={(e) => toggleExcludeOwn(e.target.checked)} />
                  자사·자회사 기사 제외 <span className="own-count">{ownCount}건</span>
                </label>
              </div>
              {search?.error && <p className="ai-error search-error" role="alert">{search.error}</p>}

              {visible.length === 0 ? (
                <p className="empty">
                  {search
                    ? search.loading
                      ? '뉴스 · 논문에서 찾는 중이에요…'
                      : search.error
                        ? '찾지 못했어요. 잠시 뒤 다시 찾아보세요.'
                        : search.period !== 'all'
                          ? '이 기간에는 찾은 기사가 없어요.'
                          : '찾은 기사가 없어요. 다른 말로 찾아보세요.'
                    : '조건에 맞는 기사가 없어요. 기간을 넓히거나 「뉴스·논문에서 찾기」를 눌러 보세요.'}
                  {search?.articles && search.period !== 'all' && (
                    <button type="button" className="btn outline empty-action" onClick={() => changePeriod('all')}>
                      전체 기간으로 다시 찾기
                    </button>
                  )}
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
                      {/* 정렬 (11/09 조장): 머리글은 그 칸 내용과 같은 쪽. 제목(여러 줄 글)만 왼쪽, 출처 · 발행 · 키워드 · 작업은 가운데 */}
                      <th>제목</th>
                      <th className="center">출처</th>
                      <th className="center">발행</th>
                      <th className="center">키워드</th>
                      <th className="center">작업</th>
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
                              {a.roundup && (
                                <span className="badge-low" title="여러 소식을 모은 기사예요. 아래 문장이 키워드 관련 꼭지예요">
                                  모음 기사
                                </span>
                              )}
                              {a.topicTag && (
                                <span className="badge-low" title={`제목은 ${a.topicTag} 이야기지만 발췌에 기술 정보가 있어 남겼어요`}>
                                  {a.topicTag} 기사 속 기술 정보
                                </span>
                              )}
                              {a.paper && <span className="badge-material" title={`논문 · 인용 ${a.cited ?? 0}회`}>논문</span>}
                              {a.material && (
                                <span className="badge-material" title={a.aiAllowed === false ? 'AI 요약 · 보고서에 쓰지 않는 자료예요' : undefined}>
                                  직접 추가 · {a.kindLabel}
                                  {a.aiAllowed === false && ' · AI 안 씀'}
                                </span>
                              )}
                              <SentimentBadge sentiment={pickSentiment(a, ai?.summary)} />
                              {a.url ? (
                                <a className="title-link" href={a.url} target="_blank" rel="noreferrer" title="원문 열기 (새 창)" onClick={() => track('open', a.title)}>
                                  <TitleWithIcon title={a.title} terms={hlTerms} />
                                </a>
                              ) : (
                                <Highlight text={a.title} terms={hlTerms} />
                              )}
                            </div>
                            {/* 제목이 내용을 대표하지 못할 때 (27 문서 7장): AI 요약 한 줄 · 키워드 이야기 문장 */}
                            {ai?.summary?.headline && ai.summary.headline !== a.title && (
                              <p className="row-sub">
                                <span className="row-sub-label">실제 내용</span>
                                <Highlight text={ai.summary.headline} terms={hlTerms} />
                              </p>
                            )}
                            {a.focus && (a.roundup || !ai?.summary?.headline) && (
                              <p className="row-sub" title="발췌에서 키워드 이야기 문장만 골랐어요">
                                <span className="row-sub-label">{a.keyword} 내용</span>
                                <Highlight text={a.focus} terms={hlTerms} />
                              </p>
                            )}
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
                              {(reasons.length > 0 || sort === 'importance') && (
                                <span className="why-important" title={scoreTitle(a)}>
                                  {[sort === 'importance' && `중요도 ${a.importance ?? 0}점`, ...reasons].filter(Boolean).join(' · ')}
                                </span>
                              )}
                              {a.material && (
                                <span className="why-important">
                                  {a.publishedAt && a.publishedAt.slice(0, 10) !== a.addedAt?.slice(0, 10) && `발행 ${a.publishedAt.slice(0, 10)} · `}
                                  {a.fileName ? `파일 ${a.fileName}` : a.url ? '링크' : '텍스트'}
                                  {a.mine && (
                                    <>
                                      {' · '}
                                      <button type="button" className="link-btn" onClick={() => handleMaterialDelete(a)}>
                                        자료 지우기
                                      </button>
                                    </>
                                  )}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="source center" title={`${a.source} · ${TIER_TITLE[a.tier ?? 3]}`}>
                            {a.tier && a.tier <= 2 && <span className={`tier tier-${a.tier}`}>{a.tier}차</span>}
                            {a.source}
                          </td>
                          <td className="time center">{formatPublished(a.hoursAgo)}</td>
                          <td className="center">
                            <span className="chip kw-chip">{a.keyword}</span>
                          </td>
                          <td className="actions">
                            {/* 작업 (11/09 조장: 같은 모양 버튼 두 개): 요약 · 선별 버튼을 같은 폭 · 같은 높이로.
                                내용을 여는 버튼(요약 보기)은 옅은 테두리, 하는 버튼(요약하기 · + 선별)은 진한 테두리 · 굵게, 선별됨은 옅은 바탕.
                                폴더 옮기기 · 빼기는 「✓ 선별됨 ▾」 메뉴 안 (SelectToggle) */}
                            <div className="row-actions">
                              {ai ? (
                                <button type="button" className={open ? 'act-btn view open' : 'act-btn view'} aria-expanded={Boolean(open)} onClick={() => setOpenSummaryId(open ? null : a.id)}>
                                  {open ? '요약 접기' : '요약 보기'}
                                </button>
                              ) : job?.status === 'queued' || job?.status === 'running' ? (
                                <button type="button" className="act-btn wait" disabled>
                                  {job.status === 'running' ? '요약 중…' : '요약 대기'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className={job?.status === 'error' ? 'act-btn do error' : 'act-btn do'}
                                  title={a.aiAllowed === false ? 'AI 요약을 허용하지 않은 자료예요' : opsValue.aiBlocked ? AI_BLOCKED_TITLE : job?.status === 'error' ? `요약 오류: ${job.error}` : 'AI로 6항목 요약 (선별하지 않아도 됨)'}
                                  disabled={opsValue.aiBlocked || a.aiAllowed === false}
                                  onClick={() => queue.enqueue(a)}
                                >
                                  {job?.status === 'error' ? '다시 요약' : '요약하기'}
                                </button>
                              )}
                              <SelectToggle
                                selected={selected}
                                folders={folders}
                                folderId={folderIdOf(a.id)}
                                targetName={folders.find((f) => f.id === targetFolder)?.name ?? '미분류'}
                                onToggle={() => toggleSelected(a)}
                                onMove={(id) => putInFolder(a.id, id)}
                              />
                            </div>
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

            {/* 실험 기능 collectPanel: 수집 설정을 보기 전용으로 (바꾸는 곳은 관리 페이지) */}
            {features.has('collectPanel') && (
              <aside className="panel settings">
                <h2>수집 설정</h2>
                <p className="list-label">자동 수집 키워드</p>
                <div className="chips">
                  {keywords.map((k) => (
                    <span key={k} className="chip">
                      {k}
                    </span>
                  ))}
                </div>
                <p className="list-hint">관리자가 정해요.</p>
                <RefreshPanel status={refresh} starting={starting} disabled={keywords.length === 0} onRun={handleRefresh} showRun={features.has('refreshButton')} />
                <ListsPanel lists={lists} />
              </aside>
            )}
          </div>
        </main>
      )}
      {showMove && (
        <DataMove
          rows={candidates.map((a) => ({
            folder: folders.find((f) => f.id === folderIdOf(a.id))?.name ?? '미분류',
            title: a.title,
            source: a.source,
            publishedAt: a.publishedAt,
            url: a.url,
            included: included.includes(a.id),
          }))}
          onClose={() => setShowMove(false)}
        />
      )}
      <ProgressPanel
        queue={queue}
        reportJobs={reportJobs}
        onAnswer={handleJobAnswer}
        onCancel={handleJobCancel}
        quiet={screen === 'select'}
        onOpenReport={(id) => {
          setArchiveTarget(id)
          setScreen('archive')
          window.scrollTo({ top: 0 })
        }}
      />
    </div>
    </FeaturesContext.Provider>
    </OpsContext.Provider>
  )
}

export default App
