// 관리자 화면 (/admin, 17 문서). 모두에게 영향을 주는 설정을 여기서만 바꾼다
// - 로그인: 서버 .env.local의 ADMIN_PASSWORD. 이름(별칭)은 변경 기록에 남기는 용도
// - 바꾸는 API는 서버가 로그인 쿠키를 확인하므로, 이 화면을 우회해도 일반 사용자는 못 바꾼다
// - 왼쪽 메뉴로 영역을 나누고, 지금 보는 영역은 주소 뒤 #으로 기억한다 (새로고침해도 그대로)
import { useEffect, useState } from 'react'
import './App.css'
import './Admin.css'
import {
  adminLogin,
  adminLogout,
  fetchAdminLog,
  fetchAdminMe,
  fetchHealth,
  fetchKeywords,
  fetchLists,
  fetchRefresh,
  runRefresh,
  saveKeywordsApi,
  saveListsApi,
  saveRefreshSettings,
  selectLlmProvider,
} from './api.js'
import { ChipList, ListsEditor } from './ListsPanel.jsx'
import RefreshPanel from './RefreshPanel.jsx'

const SECTIONS = [
  ['overview', '개요', '시스템 상태와 확인할 일을 한눈에 봐요.'],
  ['targets', '수집 대상', '무엇을 모으고, 어떤 회사·기술을 중요하게 볼지 정해요. 다음 최신화부터 반영되고, 이미 모은 기사는 그대로예요.'],
  ['refresh', '자동 최신화', '언제 기사를 모으고, 자동 요약을 할지 정해요.'],
  ['llm', 'AI 모델', '요약·보고서에 쓸 AI 서버를 골라요. 모든 사용자에게 바로 적용돼요.'],
  ['log', '변경 기록', '언제 누가 무엇을 바꿨는지 최근 200건까지 남아요.'],
]
const STALE_HOURS = 24 // 이 시간 넘게 수집이 없으면 경고

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

function sectionFromHash() {
  const id = window.location.hash.slice(1)
  return SECTIONS.some(([key]) => key === id) ? id : 'overview'
}

// 확인할 일: 연결 끊김, 수집 실패, 오래 수집 안 됨, 설정 빈칸
function buildAlerts({ health, refresh, keywords, lists }) {
  const alerts = []
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

function LoginPage({ configured, onLogin }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onLogin((await adminLogin(password, name)).admin)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  return (
    <div className="adm-login-page">
      {configured ? (
        <form className="adm-login" onSubmit={submit}>
          <h1>테크브리프 관리자</h1>
          <p>수집 키워드·관심 기술·자동 최신화·AI 모델을 정하는 곳이에요.</p>
          <label htmlFor="admin-name">이름 (선택 · 변경 기록에 남아요)</label>
          <input id="admin-name" type="text" maxLength={20} placeholder="예: 김재현" value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="admin-password">비밀번호</label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="ai-error">{error}</p>}
          <button type="submit" className="adm-btn primary" disabled={!password || busy}>
            {busy ? '확인 중…' : '로그인'}
          </button>
          <p className="adm-login-foot">
            <a href="/">← 테크브리프로 돌아가기</a>
          </p>
        </form>
      ) : (
        <div className="adm-login">
          <h1>관리자 비밀번호가 없어요</h1>
          <p>서버의 .env.local에 ADMIN_PASSWORD=비밀번호 를 넣고 서버를 다시 켜 주세요.</p>
          <p className="adm-login-foot">
            <a href="/">← 테크브리프로 돌아가기</a>
          </p>
        </div>
      )}
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
  const [toast, setToast] = useState(null) // { text, error }
  const [starting, setStarting] = useState(false)

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
    Promise.all([fetchKeywords(), fetchLists(), fetchRefresh(), fetchHealth().catch(() => ({ error: true })), fetchAdminLog()])
      .then(([k, l, r, h, g]) => {
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

  // 저장 공통: 결과를 알리고 변경 기록을 다시 받는다. 세션이 끝났으면 로그인 화면으로
  async function save(work, message) {
    setToast(null)
    try {
      await work()
      setToast({ text: message })
      setLog(await fetchAdminLog())
    } catch (err) {
      setToast({ text: err.message, error: true })
      if (/관리자만/.test(err.message)) setMe((prev) => ({ ...prev, admin: null }))
    }
  }

  async function handleLogout() {
    await adminLogout().catch(() => {})
    setMe((prev) => ({ ...prev, admin: null }))
  }

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
        <div className="adm-login">
          <h1>서버에 연결되지 않아요</h1>
          <p>npm run dev가 켜져 있는지 확인해 주세요.</p>
        </div>
      </div>
    )
  }
  if (!admin) return <LoginPage configured={me.configured} onLogin={(a) => setMe((prev) => ({ ...prev, admin: a }))} />

  const alerts = buildAlerts({ health, refresh, keywords, lists })
  const [, title, desc] = SECTIONS.find(([key]) => key === section)
  const current = health?.llm?.providers.find((p) => p.id === health.llm.current)

  return (
    <div className="adm">
      <aside className="adm-side">
        <div className="adm-brand">
          테크브리프
          <small>관리자</small>
        </div>
        <nav className="adm-nav" aria-label="관리 메뉴">
          {SECTIONS.map(([key, label]) => (
            <button key={key} type="button" aria-current={section === key ? 'page' : undefined} onClick={() => go(key)}>
              {label}
              {key === 'overview' && alerts.some((a) => a.level === 'bad') && <span className="adm-dot" aria-label="확인할 일 있음" />}
            </button>
          ))}
        </nav>
        <div className="adm-side-foot">
          <span className="adm-who">
            {admin.name}
            <small>로그인 중 · 8시간 유지</small>
          </span>
          <a href="/">테크브리프로 →</a>
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
        {toast && <p className={toast.error ? 'adm-toast error' : 'adm-toast'}>{toast.text}</p>}

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

        {section === 'targets' && (
          <div className="adm-cols">
            <section className="adm-card">
              <h2>자동 수집 키워드</h2>
              <p className="adm-desc">자동 최신화가 이 키워드로 네이버 뉴스를 모아요. 일반 사용자는 「네이버에서 찾기」로 다른 말도 찾을 수 있어요.</p>
              {keywords && (
                <ChipList
                  id="keywords"
                  label="키워드 추가"
                  hint={keywords.stored ? '입력하고 Enter' : 'DB가 없어 저장할 수 없어요 (DATABASE_URL 확인)'}
                  placeholder="예: 마이크로LED"
                  words={keywords.keywords}
                  onChange={
                    keywords.stored
                      ? (next) => save(async () => setKeywords({ ...keywords, keywords: (await saveKeywordsApi(next)).keywords }), '자동 수집 키워드를 저장했어요.')
                      : undefined
                  }
                />
              )}
            </section>
            <section className="adm-card">
              <h2>회사 · 관심 기술</h2>
              <p className="adm-desc">중요도 점수(경쟁사 언급·관심 기술)와 「자사·자회사 기사 제외」에 쓰여요.</p>
              {lists && <ListsEditor lists={lists} onSave={(next) => save(async () => setLists(await saveListsApi(next)), '목록을 저장했어요.')} />}
            </section>
          </div>
        )}

        {section === 'refresh' && refresh && (
          <section className="adm-card adm-refresh">
            <RefreshPanel
              status={refresh}
              starting={starting}
              disabled={!keywords?.keywords?.length}
              onRun={handleRun}
              onSave={(settings) => save(async () => setRefresh(await saveRefreshSettings(settings)), '자동 최신화 설정을 저장했어요.')}
              canEdit
            />
          </section>
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
                  aria-pressed={health.llm.current === p.id}
                  disabled={!p.ready}
                  onClick={() =>
                    health.llm.current !== p.id &&
                    save(async () => {
                      await selectLlmProvider(p.id)
                      setHealth(await fetchHealth())
                    }, `AI 서버를 ${p.label}(으)로 바꿨어요.`)
                  }
                >
                  <strong>
                    {p.label}
                    {health.llm.current === p.id && ' · 사용 중'}
                  </strong>
                  <span>{p.ready ? p.model : '설정 없음'}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {section === 'log' && (
          <section className="adm-card">
            <LogTable log={log} />
          </section>
        )}
      </main>
    </div>
  )
}

function LogTable({ log, compact = false }) {
  if (log.length === 0) return <p className="adm-empty">아직 기록이 없어요.</p>
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
            <td className="adm-nowrap">{formatAt(e.at)}</td>
            {!compact && <td>{e.name}</td>}
            <td>
              <span className="adm-tag">{e.action}</span>
            </td>
            <td>{e.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default AdminApp
