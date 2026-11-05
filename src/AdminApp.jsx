// 관리자 화면 (/admin, 17 문서). 모두에게 영향을 주는 설정을 여기서만 바꾼다
// - 로그인: 서버 .env.local의 ADMIN_PASSWORD. 이름(별칭)은 변경 기록에 남기는 용도
// - 바꾸는 API는 서버가 로그인 쿠키를 확인하므로, 이 화면을 우회해도 일반 사용자는 못 바꾼다
// - 왼쪽 메뉴로 영역을 나누고, 지금 보는 영역은 주소 뒤 #으로 기억한다 (새로고침해도 그대로)
import { useEffect, useRef, useState } from 'react'
import './App.css'
import './Admin.css'
import {
  adminLogin,
  adminLogout,
  fetchAdminLog,
  fetchAdminMe,
  fetchFeatures,
  fetchHealth,
  fetchKeywords,
  fetchLists,
  fetchOps,
  fetchRefresh,
  runRefresh,
  saveFeaturesApi,
  saveKeywordsApi,
  saveListsApi,
  saveRefreshSettings,
  selectLlmProvider,
} from './api.js'
import { ChipList, ListsEditor } from './ListsPanel.jsx'
import LogoMark from './Logo.jsx'
import AdminRefresh from './AdminRefresh.jsx'
import AdminUsage from './AdminUsage.jsx'
import AdminOps from './AdminOps.jsx'
import { OPS_LABEL } from './ops.js'

const SECTIONS = [
  ['overview', '개요', '시스템 상태와 확인할 일을 한눈에 봐요.'],
  ['usage', '사용 현황', '누가 얼마나 쓰고, 무엇을 찾고, 보고서까지 이어지는지 봐요. 일반 화면에서 한 일만 세요.'],
  ['targets', '수집 대상', '무엇을 모으고, 어떤 회사·기술을 중요하게 볼지 정해요. 다음 최신화부터 반영되고, 이미 모은 기사는 그대로예요.'],
  ['refresh', '자동 최신화', '언제 기사를 모으고, 자동 요약을 할지 정해요.'],
  ['llm', 'AI 모델', '요약·보고서에 쓸 AI 서버를 골라요. 모든 사용자에게 바로 적용돼요.'],
  ['features', '실험 기능', '새 기능을 테스트 페이지에서 먼저 써 보고, 괜찮으면 모두에게 켜요.'],
  ['ops', '운영', '일반 화면을 점검 중 · AI 기능 정지 · 공지로 바꾸고, 서버를 다시 켜요.'],
  ['log', '변경 기록', '언제 누가 무엇을 바꿨는지 최근 200건까지 남아요.'],
]
const STALE_HOURS = 24 // 이 시간 넘게 수집이 없으면 경고
const FLASH_KEY = 'techbrief-admin-flash' // 저장 뒤 새로고침해도 결과 안내를 보이게
const FEATURE_STATES = [
  ['off', '꺼짐'],
  ['test', '테스트에서만'],
  ['all', '모두에게'],
]

// 로그인 뒤 돌아갈 곳 (테스트 페이지에서 로그인하러 온 경우). 사이트 안 주소만 받는다
function nextPath() {
  const next = new URLSearchParams(window.location.search).get('next')
  return next === '/admin/test' ? next : null
}

function formatAt(iso, withDate = true) {
  if (!iso) return '-'
  const opts = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  return new Date(iso).toLocaleString('ko-KR', withDate ? { month: 'numeric', day: 'numeric', ...opts } : opts)
}

function hoursSince(iso) {
  return iso ? (Date.now() - Date.parse(iso)) / 3_600_000 : Infinity
}

function modeText(s) {
  if (!s || s.mode === 'off') return '꺼짐'
  return s.mode === 'daily' ? `매일 ${s.time}` : `${s.hours}시간마다`
}

// 저장 뒤 새로고침했으면 남겨 둔 결과 안내를 읽는다 (지우기는 화면을 그린 뒤 effect에서 — 개발 모드는 초기값 함수를 두 번 부른다)
function readFlash() {
  try {
    const text = sessionStorage.getItem(FLASH_KEY)
    return text ? { text, at: Date.now() } : null
  } catch {
    return null // 저장소를 못 쓰면 안내만 생략
  }
}

function sectionFromHash() {
  const id = window.location.hash.slice(1)
  return SECTIONS.some(([key]) => key === id) ? id : 'overview'
}

// 확인할 일: 연결 끊김, 수집 실패, 오래 수집 안 됨, 설정 빈칸
function buildAlerts({ health, refresh, keywords, lists, ops }) {
  const alerts = []
  if (ops && ops.mode !== 'normal') alerts.push({ level: ops.mode === 'notice' ? 'warn' : 'bad', text: `일반 화면이 「${OPS_LABEL[ops.mode]}」 상태예요.`, go: 'ops' })
  if (health?.error) alerts.push({ level: 'bad', text: '서버에 연결되지 않아요.' })
  else if (health && !health.modelReachable) alerts.push({ level: 'bad', text: 'AI 서버에 연결되지 않아 요약·보고서를 만들 수 없어요.', go: 'llm' })
  if (health?.db?.enabled && !health.db.ok) alerts.push({ level: 'bad', text: `DB 오류: ${health.db.error}` })
  const last = refresh?.lastResult
  if (last?.error) alerts.push({ level: 'bad', text: `마지막 최신화가 실패했어요: ${last.error}`, go: 'refresh' })
  if (last?.failedKeywords?.length) alerts.push({ level: 'warn', text: `수집 실패 키워드: ${last.failedKeywords.join(', ')}`, go: 'refresh' })
  if (refresh && !refresh.running && hoursSince(refresh.lastRunAt) > STALE_HOURS) {
    alerts.push({ level: 'warn', text: `${STALE_HOURS}시간 넘게 기사를 모으지 않았어요.`, go: 'refresh' })
  }
  if (refresh?.settings?.mode === 'off') alerts.push({ level: 'warn', text: '자동 최신화가 꺼져 있어요. 직접 누를 때만 모아요.', go: 'refresh' })
  if (keywords && keywords.keywords.length === 0) alerts.push({ level: 'warn', text: '자동 수집 키워드가 없어요.', go: 'targets' })
  if (lists && lists.interests.length === 0) alerts.push({ level: 'warn', text: '관심 기술이 비어 있어 사업 연관성을 판단하지 못해요.', go: 'targets' })
  if (refresh?.backlog?.failed > 0) alerts.push({ level: 'warn', text: `자동 요약 실패 ${refresh.backlog.failed}건`, go: 'refresh' })
  return alerts
}

// 로그인 화면: 왼쪽은 브랜드·안내, 오른쪽은 폼만 (관리 도구의 2단 로그인 카드)
function LoginPage({ configured, onLogin }) {
  const [id, setId] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState({}) // 빈칸으로 눌렀을 때 칸 아래 안내
  const [locked, setLocked] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const toTest = nextPath() === '/admin/test'

  async function submit(e) {
    e.preventDefault()
    // 버튼은 늘 눌리게 두고, 빈칸이면 칸 아래에 알려 준다 (회색 비활성 버튼은 고장처럼 보여서)
    const missing = { id: !id.trim(), password: !password }
    setFieldError(missing)
    if (missing.id || missing.password) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await adminLogin(id, password)
      if (result.reset) {
        // 잠금 리셋 조합: 대기만 풀리고 로그인은 원래 관리자 계정으로
        setLocked(false)
        setId('')
        setPassword('')
        setNotice('대기를 초기화했어요. 관리자 계정으로 로그인하세요.')
        return
      }
      onLogin(result.admin)
    } catch (err) {
      setError(err.message)
      setLocked(err.locked)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  // Caps Lock이 켜져 있으면 비밀번호 칸 아래에 알려 준다
  const watchCaps = (e) => setCapsLock(Boolean(e.getModifierState?.('CapsLock')))

  return (
    <div className="adm-login-page">
      <div className="adm-login">
        <aside className="adm-login-side">
          <div className="adm-login-logo">
            <LogoMark size={36} />
            <span>테크브리프</span>
            <span className="adm-login-badge">관리자</span>
          </div>
          <div className="adm-login-pitch">
            {/* 줄 나누는 위치를 정해 둔다 (글꼴에 따라 '곳'만 다음 줄로 떨어지지 않게) */}
            <h2>
              <span>기술 동향 수집과</span>
              <span>브리핑을 관리하는 곳</span>
            </h2>
            <p>설정과 상태를 한곳에서 관리해요.</p>
          </div>

          {/* 제품 미리보기 카드 (레퍼런스: 브랜드 영역의 떠 있는 쇼케이스 카드)
              로그인 전이라 실제 데이터는 넣지 않고, 로고의 세 줄 모양으로 '브리핑'을 그린다 */}
          <div className="adm-login-preview" aria-hidden="true">
            <div className="adm-preview-head">
              <span className="adm-preview-title">브리핑 초안</span>
              <span className="adm-preview-badge">새 신호</span>
            </div>
            <span className="adm-preview-line w100" />
            <span className="adm-preview-line w80" />
            <span className="adm-preview-line w55" />
            <div className="adm-preview-foot">
              <span className="adm-preview-chip" />
              <span className="adm-preview-chip short" />
              <span className="adm-preview-dot" />
            </div>
          </div>
          <a className="adm-login-back" href="/">
            ← 일반 화면으로
          </a>
        </aside>

        <div className="adm-login-main">
          {configured ? (
            <form onSubmit={submit} noValidate>
              <h1>로그인</h1>
              <p className="adm-login-sub">{toTest ? '로그인하면 테스트 페이지로 이동해요.' : '관리자 계정으로 로그인하세요.'}</p>

              <div className="adm-field">
                <label htmlFor="admin-id">아이디</label>
                <input
                  id="admin-id"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="off"
                  spellCheck={false}
                  autoFocus
                  value={id}
                  aria-invalid={fieldError.id || undefined}
                  onChange={(e) => {
                    setId(e.target.value)
                    setFieldError((f) => ({ ...f, id: false }))
                  }}
                />
                {fieldError.id && <p className="adm-field-note error">아이디를 입력해 주세요.</p>}
              </div>

              <div className="adm-field">
                <label htmlFor="admin-password">비밀번호</label>
                <div className="adm-pw">
                  <input
                    id="admin-password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    aria-invalid={fieldError.password || undefined}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      setFieldError((f) => ({ ...f, password: false }))
                    }}
                    onKeyUp={watchCaps}
                    onKeyDown={watchCaps}
                  />
                  <button type="button" className="adm-pw-toggle" onClick={() => setShowPw((v) => !v)} aria-pressed={showPw}>
                    {showPw ? '숨기기' : '보기'}
                  </button>
                </div>
                {fieldError.password ? (
                  <p className="adm-field-note error">비밀번호를 입력해 주세요.</p>
                ) : (
                  capsLock && <p className="adm-field-note">Caps Lock이 켜져 있어요.</p>
                )}
              </div>

              {error && (
                <div className="adm-login-alert error" role="alert">
                  <strong>{error}</strong>
                  {locked && <span>관리자라면 잠금 리셋 아이디·비밀번호로 바로 풀 수 있어요.</span>}
                </div>
              )}
              {notice && (
                <div className="adm-login-alert ok" role="status">
                  <strong>{notice}</strong>
                </div>
              )}

              <button type="submit" className="adm-login-submit" disabled={busy}>
                {busy ? '확인 중…' : '로그인'}
              </button>
            </form>
          ) : (
            <>
              <h1>관리자 비밀번호가 없어요</h1>
              <p className="adm-login-sub">서버의 .env.local에 ADMIN_PASSWORD를 넣고 서버를 다시 켜 주세요.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Tile({ label, value, sub, state }) {
  return (
    <div className="adm-tile">
      <span className="adm-tile-label">{label}</span>
      <span className="adm-tile-value">{state ? <span className={`adm-state ${state}`}>{value}</span> : value}</span>
      {sub && <span className="adm-tile-sub">{sub}</span>}
    </div>
  )
}

function AdminApp() {
  const [me, setMe] = useState(null) // { configured, admin }
  const [section, setSection] = useState(sectionFromHash)
  const [keywords, setKeywords] = useState(null) // { stored, keywords }
  const [lists, setLists] = useState(null)
  const [refresh, setRefresh] = useState(null)
  const [health, setHealth] = useState(null)
  const [log, setLog] = useState([])
  const [features, setFeatures] = useState(null) // { features: { key: state }, list }
  const [ops, setOps] = useState(null) // 일반 화면 운영 상태 (19 문서 6장)
  const [toast, setToast] = useState(readFlash) // { text, error } — 저장 뒤 새로고침했으면 결과 안내로 시작
  const [starting, setStarting] = useState(false)
  // 저장 전 변경: 바꾼 것만 담는다 { keywords?, lists?, refresh?, llm?, features? }. 「저장」을 눌러야 서버에 저장
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const leavingRef = useRef(false) // 저장 뒤 새로고침할 때는 떠나기 경고를 건너뛴다
  // 저장하지 않은 채 다른 곳으로 가려 할 때 띄우는 확인 창 { to: 주소 | 'logout' }
  const [leaveAsk, setLeaveAsk] = useState(null)

  useEffect(() => {
    try {
      sessionStorage.removeItem(FLASH_KEY)
    } catch {
      // 저장소를 못 쓰면 지울 것도 없음
    }
  }, [])

  useEffect(() => {
    fetchAdminMe()
      .then(setMe)
      .catch(() => setMe({ configured: false, admin: null, offline: true }))
    const onHash = () => setSection(sectionFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const admin = me?.admin

  // 로그인하면 지금 설정을 한 번에 불러온다
  useEffect(() => {
    if (!admin) return
    // 테스트 페이지에서 로그인하러 왔으면 로그인 뒤 그리로 돌려보낸다
    const next = nextPath()
    if (next) {
      window.location.replace(next)
      return
    }
    Promise.all([
      fetchKeywords(),
      fetchLists(),
      fetchRefresh(),
      fetchHealth().catch(() => ({ error: true })),
      fetchAdminLog(),
      fetchFeatures(),
      fetchOps().catch(() => null),
    ])
      .then(([k, l, r, h, g, f, o]) => {
        setOps(o)
        setFeatures(f)
        setKeywords(k)
        setLists(l)
        setRefresh(r)
        setHealth(h)
        setLog(g)
      })
      .catch((err) => setToast({ text: err.message, error: true }))
  }, [admin])

  // 상태는 주기적으로 다시 확인 (최신화가 돌고 있으면 자주)
  useEffect(() => {
    if (!admin) return
    const timer = setInterval(() => {
      fetchRefresh().then(setRefresh).catch(() => {})
      fetchOps().then(setOps).catch(() => {}) // 다른 관리자가 바꾼 운영 상태도 반영
      fetchHealth()
        .then(setHealth)
        .catch(() => setHealth({ error: true }))
    }, refresh?.running ? 3_000 : 30_000)
    return () => clearInterval(timer)
  }, [admin, refresh?.running])

  function go(key) {
    window.history.replaceState(null, '', `#${key}`)
    setSection(key)
    setToast(null)
  }

  // ── 저장 전 변경 ──
  // 저장된 값과 같아지면 그 항목은 변경 목록에서 뺀다
  const savedValue = {
    keywords: keywords?.keywords,
    lists,
    refresh: refresh?.settings,
    llm: health?.llm?.current,
    features: features?.features,
  }
  function change(key, value) {
    setDraft((d) => {
      const next = { ...d }
      if (JSON.stringify(value) === JSON.stringify(savedValue[key])) delete next[key]
      else next[key] = value
      return next
    })
  }
  const view = {
    keywords: draft.keywords ?? keywords?.keywords ?? [],
    lists: draft.lists ?? lists,
    refresh: draft.refresh ?? refresh?.settings,
    llm: draft.llm ?? health?.llm?.current,
    features: draft.features ?? features?.features,
  }
  const DRAFT_LABEL = { keywords: '자동 수집 키워드', lists: '회사 · 관심 기술', refresh: '자동 최신화', llm: 'AI 모델', features: '실험 기능' }
  const DRAFT_SECTION = { keywords: 'targets', lists: 'targets', refresh: 'refresh', llm: 'llm', features: 'features' }
  const dirty = Object.keys(draft)
  const dirtySections = new Set(dirty.map((k) => DRAFT_SECTION[k]))

  // 저장하지 않고 페이지를 떠나려 하면 브라우저가 한 번 묻는다
  useEffect(() => {
    if (dirty.length === 0) return
    const warn = (e) => {
      if (leavingRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty.length])

  // 「저장」: 바꾼 것만 차례로 저장하고, 관리 페이지를 새로고침해 서버 값으로 다시 그린다
  // then: 저장 뒤 할 일 (확인 창의 「저장하고 이동」). 없으면 새로고침
  async function saveAll(then) {
    setSaving(true)
    setToast(null)
    try {
      if (draft.keywords) await saveKeywordsApi(draft.keywords)
      if (draft.lists) await saveListsApi(draft.lists)
      if (draft.refresh) await saveRefreshSettings(draft.refresh)
      if (draft.llm) await selectLlmProvider(draft.llm)
      if (draft.features) await saveFeaturesApi(draft.features)
      try {
        sessionStorage.setItem(FLASH_KEY, `저장했어요: ${dirty.map((k) => DRAFT_LABEL[k]).join(', ')}`)
      } catch {
        // 저장소를 못 쓰면 안내만 생략
      }
      leavingRef.current = true
      if (then) then()
      else window.location.reload()
    } catch (err) {
      setToast({ text: `저장하지 못했어요: ${err.message}`, error: true })
      if (/관리자만/.test(err.message)) setMe((prev) => ({ ...prev, admin: null }))
      setSaving(false)
    }
  }

  function discardAll() {
    setDraft({})
    setToast({ text: '바꾼 내용을 되돌렸어요.', at: Date.now() })
  }

  // 저장 안내는 6초 뒤 사라진다 (오류는 남겨 둔다)
  useEffect(() => {
    if (!toast || toast.error) return
    const timer = setTimeout(() => setToast((t) => (t?.at === toast.at ? null : t)), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  async function logoutNow() {
    leavingRef.current = true
    setDraft({})
    setLeaveAsk(null)
    await adminLogout().catch(() => {})
    setMe((prev) => ({ ...prev, admin: null }))
  }

  function handleLogout() {
    if (dirty.length) setLeaveAsk({ to: 'logout' })
    else logoutNow()
  }

  // 관리 페이지 밖으로 가는 링크: 저장하지 않은 변경이 있으면 바로 가지 않고 확인 창
  function guardLink(e) {
    if (dirty.length === 0) return
    e.preventDefault()
    setLeaveAsk({ to: e.currentTarget.getAttribute('href') })
  }

  function leaveTo(to) {
    if (to === 'logout') return logoutNow()
    leavingRef.current = true
    window.location.assign(to)
  }

  // 확인 창이 열려 있으면 Esc = 머무르기
  useEffect(() => {
    if (!leaveAsk) return
    const onKey = (e) => e.key === 'Escape' && setLeaveAsk(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leaveAsk])

  async function handleRun() {
    setStarting(true)
    setToast(null)
    try {
      setRefresh(await runRefresh(keywords?.keywords ?? []))
    } catch (err) {
      setToast({ text: err.message, error: true })
    } finally {
      setStarting(false)
    }
  }

  if (me === null) return null
  if (me.offline) {
    return (
      <div className="adm-login-page">
        <div className="adm-login adm-login-single">
          <div className="adm-login-main">
            <h1>서버에 연결되지 않아요</h1>
            <p className="adm-login-sub">npm run dev가 켜져 있는지 확인해 주세요.</p>
          </div>
        </div>
      </div>
    )
  }
  if (!admin) return <LoginPage configured={me.configured} onLogin={(a) => setMe((prev) => ({ ...prev, admin: a }))} />

  const alerts = buildAlerts({ health, refresh, keywords, lists, ops })
  const [, title, desc] = SECTIONS.find(([key]) => key === section)
  const current = health?.llm?.providers.find((p) => p.id === health.llm.current)

  return (
    <div className="adm">
      <aside className="adm-side">
        <div className="adm-brand">
          <LogoMark size={28} />
          <span>
            테크브리프
            <small>관리 페이지</small>
          </span>
        </div>
        <nav className="adm-nav" aria-label="관리 메뉴">
          {SECTIONS.map(([key, label]) => (
            <button key={key} type="button" aria-current={section === key ? 'page' : undefined} onClick={() => go(key)}>
              {label}
              {key === 'overview' && alerts.some((a) => a.level === 'bad') && <span className="adm-dot" aria-label="확인할 일 있음" />}
              {key === 'ops' && ops && ops.mode !== 'normal' && <span className="adm-dot" aria-label={`운영 상태: ${OPS_LABEL[ops.mode]}`} />}
              {dirtySections.has(key) && <span className="adm-dot adm-dot-edit" aria-label="저장하지 않은 변경 있음" />}
            </button>
          ))}
        </nav>
        <div className="adm-side-foot">
          <span className="adm-who">
            {admin.name}
            <small>관리자로 로그인 중 · 8시간 유지</small>
          </span>
          <a href="/admin/test" onClick={guardLink}>
            테스트 페이지 →
          </a>
          <a href="/" onClick={guardLink}>
            일반 화면 →
          </a>
          <button type="button" onClick={handleLogout}>
            로그아웃
          </button>
        </div>
      </aside>

      <main className="adm-main">
        <header className="adm-head">
          <div>
            <h1>{title}</h1>
            <p>{desc}</p>
          </div>
        </header>
        {toast && (
          <div className={toast.error ? 'adm-toast error' : 'adm-toast'} role={toast.error ? 'alert' : 'status'}>
            <span>{toast.text}</span>
          </div>
        )}

        {section === 'overview' && (
          <>
            <div className="adm-tiles">
              <Tile
                label="AI 서버"
                value={health?.error ? '연결 안 됨' : health?.modelReachable ? '연결됨' : health ? '연결 안 됨' : '확인 중'}
                state={health?.modelReachable ? 'ok' : health ? 'bad' : undefined}
                sub={current ? `${current.label} · ${current.model.split('/').pop()}` : undefined}
              />
              <Tile
                label="마지막 수집"
                value={refresh?.running ? '수집 중' : formatAt(refresh?.lastRunAt)}
                state={refresh?.running ? 'warn' : undefined}
                sub={refresh?.lastResult && !refresh.lastResult.error ? `새 기사 ${refresh.lastResult.added}건` : undefined}
              />
              <Tile
                label="자동 최신화"
                value={modeText(refresh?.settings)}
                sub={refresh?.settings?.mode !== 'off' && refresh?.nextRunAt ? `다음 ${formatAt(refresh.nextRunAt)}` : '직접 누를 때만'}
              />
              <Tile
                label="자동 요약 대기"
                value={`${refresh?.backlog?.remaining ?? 0}건`}
                sub={refresh?.settings?.autoSummary === 'off' ? '자동 요약 꺼짐' : `완료 ${refresh?.backlog?.done ?? 0} · 실패 ${refresh?.backlog?.failed ?? 0}`}
              />
              {health?.db?.ok && (
                <Tile
                  label="쌓인 데이터"
                  value={`기사 ${health.db.articles.toLocaleString()}`}
                  sub={`요약 ${health.db.summaries.toLocaleString()} · 보고서 ${health.db.reports}`}
                />
              )}
            </div>

            <section className="adm-card">
              <h2>확인할 일</h2>
              <p className="adm-desc">문제가 생기면 여기에 떠요.</p>
              {alerts.length === 0 ? (
                <ul className="adm-alerts">
                  <li className="ok">모두 정상이에요.</li>
                </ul>
              ) : (
                <ul className="adm-alerts">
                  {alerts.map((a) => (
                    <li key={a.text} className={a.level}>
                      {a.text}
                      {a.go && (
                        <button type="button" className="adm-btn" onClick={() => go(a.go)}>
                          {SECTIONS.find(([key]) => key === a.go)[1]}로
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="adm-cols">
              <section className="adm-card">
                <h2>수집 대상</h2>
                <p className="adm-desc">
                  키워드 {keywords?.keywords.length ?? 0}개 · 관심 기술 {lists?.interests.length ?? 0}개 · 경쟁사 {lists?.competitors.length ?? 0}개
                </p>
                <div className="chips">
                  {(keywords?.keywords ?? []).map((k) => (
                    <span key={k} className="chip">
                      {k}
                    </span>
                  ))}
                </div>
                <p>
                  <button type="button" className="adm-btn" onClick={() => go('targets')}>
                    수집 대상 바꾸기
                  </button>
                </p>
              </section>
              <section className="adm-card">
                <h2>최근 변경</h2>
                <p className="adm-desc">최근 5건</p>
                <LogTable log={log.slice(0, 5)} compact />
                {log.length > 5 && (
                  <p>
                    <button type="button" className="adm-btn" onClick={() => go('log')}>
                      전체 기록 보기
                    </button>
                  </p>
                )}
              </section>
            </div>
          </>
        )}

        {section === 'usage' && (
          <AdminUsage
            keywords={view.keywords ?? []}
            onAddKeyword={keywords?.stored ? (word) => change('keywords', [...new Set([...(view.keywords ?? []), word])]) : undefined}
            refresh={refresh}
          />
        )}

        {section === 'targets' && (
          <div className="adm-cols">
            <section className="adm-card">
              <h2>자동 수집 키워드</h2>
              <p className="adm-desc">자동 최신화가 이 키워드로 네이버 뉴스를 모아요.</p>
              {keywords && (
                <ChipList
                  id="keywords"
                  label="키워드 추가"
                  hint={keywords.stored ? '일반 사용자는 「네이버에서 찾기」로 다른 말도 찾을 수 있어요' : 'DB가 없어 저장할 수 없어요 (DATABASE_URL 확인)'}
                  placeholder="예: 마이크로LED"
                  words={view.keywords}
                  onChange={keywords.stored ? (next) => change('keywords', next) : undefined}
                />
              )}
            </section>
            <section className="adm-card">
              <h2>회사 · 관심 기술</h2>
              <p className="adm-desc">중요도 점수(경쟁사 언급·관심 기술)와 「자사·자회사 기사 제외」에 쓰여요.</p>
              {view.lists && <ListsEditor lists={view.lists} onSave={(next) => change('lists', next)} />}
            </section>
          </div>
        )}

        {section === 'refresh' && refresh && (
          <AdminRefresh
            status={{ ...refresh, settings: view.refresh }}
            starting={starting}
            disabled={!keywords?.keywords?.length}
            onRun={handleRun}
            onSave={(settings) => change('refresh', settings)}
            keywords={keywords?.keywords ?? []}
            onGoTargets={() => go('targets')}
          />
        )}

        {section === 'llm' && health?.llm && (
          <section className="adm-card">
            <h2>요약·보고서에 쓸 AI 서버</h2>
            <p className="adm-desc">
              지금 {health.modelReachable ? <span className="adm-state ok">연결됨</span> : <span className="adm-state bad">연결 안 됨</span>} · 서버를 다시 켜도 이 선택이 유지돼요. 설정이 없는 서버는 .env.local에 값을 넣어야 고를 수 있어요.
            </p>
            <div className="adm-choices">
              {health.llm.providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="adm-choice"
                  aria-pressed={view.llm === p.id}
                  disabled={!p.ready}
                  onClick={() => change('llm', p.id)}
                >
                  <strong>
                    {p.label}
                    {health.llm.current === p.id && <span className="adm-choice-badge">사용 중</span>}
                    {draft.llm === p.id && <span className="adm-choice-badge pending">저장하면 바뀜</span>}
                  </strong>
                  <span>{p.ready ? p.model : '설정 없음'}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {section === 'features' && features && (
          <section className="adm-card">
            <div className="adm-card-head">
              <h2>기능별 공개 범위</h2>
              <a className="adm-btn" href="/admin/test" onClick={guardLink}>
                테스트 페이지 열기 →
              </a>
            </div>
            <p className="adm-desc">
              「테스트에서만」은 관리자 테스트 페이지(<a href="/admin/test" onClick={guardLink}>/admin/test</a>)에서만 보여요. 「모두에게」로 바꾸면 일반 화면에도 바로 보여요.
            </p>
            <ul className="adm-features">
              {features.list.map((f) => (
                <li key={f.key}>
                  <div>
                    <strong>{f.label}</strong>
                    <span>{f.desc}</span>
                  </div>
                  <div className="adm-segment" role="radiogroup" aria-label={`${f.label} 공개 범위`}>
                    {FEATURE_STATES.map(([state, label]) => (
                      <button
                        key={state}
                        type="button"
                        role="radio"
                        aria-checked={view.features[f.key] === state}
                        onClick={() => change('features', { ...view.features, [f.key]: state })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {section === 'ops' && ops && (
          <AdminOps
            key={ops.updatedAt ?? 'initial'} // 운영 상태가 바뀌면(다른 관리자 포함) 입력칸을 새 상태로
            ops={ops}
            onOps={(o) => {
              setOps(o)
              fetchAdminLog().then(setLog).catch(() => {})
            }}
            onToast={setToast}
            health={health}
            refreshRunning={Boolean(refresh?.running)}
            dirtyCount={dirty.length}
          />
        )}

        {section === 'log' && (
          <section className="adm-card">
            <LogTable log={log} />
          </section>
        )}
      
        {/* 떠나기 확인 창: 브라우저 기본 경고 대신, 무엇이 저장되지 않았는지 알려 주고 고르게 한다 */}
        {leaveAsk && (
          <div className="adm-modal-backdrop" onClick={() => setLeaveAsk(null)}>
            <div
              className="adm-modal"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="leave-title"
              aria-describedby="leave-desc"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="leave-title">아직 저장하지 않은 변경이 있어요</h2>
              <p id="leave-desc">
                {leaveAsk.to === 'logout' ? '로그아웃하면' : '이 페이지를 떠나면'} 아래 바꾼 내용이 사라져요.
              </p>
              <ul>
                {dirty.map((k) => (
                  <li key={k}>{DRAFT_LABEL[k]}</li>
                ))}
              </ul>
              <div className="adm-modal-actions">
                <button type="button" className="adm-btn danger-text" onClick={() => leaveTo(leaveAsk.to)} disabled={saving}>
                  저장하지 않고 {leaveAsk.to === 'logout' ? '로그아웃' : '떠나기'}
                </button>
                <span className="adm-modal-spacer" />
                <button type="button" className="adm-btn" onClick={() => setLeaveAsk(null)} disabled={saving} autoFocus>
                  머무르기
                </button>
                <button type="button" className="adm-btn primary" onClick={() => saveAll(() => leaveTo(leaveAsk.to))} disabled={saving}>
                  {saving ? '저장 중…' : `저장하고 ${leaveAsk.to === 'logout' ? '로그아웃' : '이동'}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 저장 막대: 바꾼 것이 있을 때만, 화면 아래에 붙어 있다 */}
        {dirty.length > 0 && (
          <div className="adm-savebar" role="region" aria-label="저장하지 않은 변경">
            <span>
              <strong>저장하지 않은 변경 {dirty.length}개</strong> · {dirty.map((k) => DRAFT_LABEL[k]).join(', ')}
            </span>
            <div>
              <button type="button" className="adm-btn" onClick={discardAll} disabled={saving}>
                되돌리기
              </button>
              <button type="button" className="adm-btn primary" onClick={() => saveAll()} disabled={saving}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function LogTable({ log, compact = false }) {
  if (log.length === 0) return <p className="adm-empty">아직 기록이 없어요. 수집 대상·자동 최신화·AI 모델·실험 기능을 바꾸면 여기에 남아요.</p>
  return (
    <table className="adm-table">
      <thead>
        <tr>
          <th>언제</th>
          {!compact && <th>누가</th>}
          <th>무엇을</th>
          <th>내용</th>
        </tr>
      </thead>
      <tbody>
        {log.map((e, i) => (
          <tr key={`${e.at}-${i}`}>
            <td className="adm-nowrap adm-log-at">{formatAt(e.at)}</td>
            {!compact && <td className="adm-nowrap adm-log-who">{e.name}</td>}
            <td className="adm-log-action">
              <span className="adm-tag">{e.action}</span>
            </td>
            <td className="adm-log-detail">{e.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default AdminApp
