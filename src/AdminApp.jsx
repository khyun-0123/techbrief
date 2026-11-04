// 관리자 화면 (/admin, 17 문서). 모두에게 영향을 주는 설정을 여기서만 바꾼다
// - 로그인: 서버 .env.local의 ADMIN_PASSWORD. 이름(별칭)은 변경 기록에 남기는 용도
// - 바꾸는 API는 서버가 로그인 쿠키를 확인하므로, 이 화면을 우회해도 일반 사용자는 못 바꾼다
import { useEffect, useState } from 'react'
import './App.css'
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

function formatAt(iso) {
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

function LoginForm({ configured, onLogin }) {
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

  if (!configured) {
    return (
      <section className="panel admin-login">
        <h2>관리자 비밀번호가 없어요</h2>
        <p className="hint">서버의 .env.local에 ADMIN_PASSWORD=비밀번호 를 넣고 서버를 다시 켜 주세요.</p>
      </section>
    )
  }
  return (
    <form className="panel admin-login" onSubmit={submit}>
      <h2>관리자 로그인</h2>
      <label htmlFor="admin-name">이름 (변경 기록에 남아요, 선택)</label>
      <input id="admin-name" type="text" maxLength={20} placeholder="예: 김재현" value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="admin-password">비밀번호</label>
      <input
        id="admin-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit" className="btn primary" disabled={!password || busy}>
        {busy ? '확인 중…' : '로그인'}
      </button>
      {error && <p className="ai-error">{error}</p>}
    </form>
  )
}

function AdminApp() {
  const [me, setMe] = useState(null) // { configured, admin }
  const [keywords, setKeywords] = useState(null) // { stored, keywords }
  const [lists, setLists] = useState(null)
  const [refresh, setRefresh] = useState(null)
  const [health, setHealth] = useState(null)
  const [log, setLog] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    fetchAdminMe()
      .then(setMe)
      .catch(() => setMe({ configured: false, admin: null, offline: true }))
  }, [])

  const admin = me?.admin

  // 로그인하면 지금 설정을 한 번에 불러온다
  useEffect(() => {
    if (!admin) return
    Promise.all([fetchKeywords(), fetchLists(), fetchRefresh(), fetchHealth(), fetchAdminLog()])
      .then(([k, l, r, h, g]) => {
        setKeywords(k)
        setLists(l)
        setRefresh(r)
        setHealth(h)
        setLog(g)
      })
      .catch((err) => setError(err.message))
  }, [admin])

  // 자동 최신화 진행 상황은 돌고 있을 때만 자주 확인
  useEffect(() => {
    if (!admin) return
    const timer = setInterval(() => fetchRefresh().then(setRefresh).catch(() => {}), refresh?.running ? 3_000 : 30_000)
    return () => clearInterval(timer)
  }, [admin, refresh?.running])

  // 저장 공통: 실패하면 메시지, 세션이 끝났으면 로그인 화면으로
  async function save(work, message) {
    setError('')
    setNotice('')
    try {
      await work()
      setNotice(message)
      setLog(await fetchAdminLog())
    } catch (err) {
      setError(err.message)
      if (/관리자만/.test(err.message)) setMe((prev) => ({ ...prev, admin: null }))
    }
  }

  async function handleLogout() {
    await adminLogout().catch(() => {})
    setMe((prev) => ({ ...prev, admin: null }))
  }

  async function handleRun() {
    setStarting(true)
    setError('')
    try {
      setRefresh(await runRefresh(keywords?.keywords ?? []))
    } catch (err) {
      setError(err.message)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="app admin-app">
      <nav className="topbar">
        <span className="brand">테크브리프 관리자</span>
        <span className="topbar-side">
          {admin && <span className="admin-who">{admin.name}</span>}
          <a className="btn" href="/">
            사이트로
          </a>
          {admin && (
            <button type="button" className="btn" onClick={handleLogout}>
              로그아웃
            </button>
          )}
        </span>
      </nav>

      <main className="page">
        {me === null ? (
          <p className="hint">불러오는 중…</p>
        ) : me.offline ? (
          <p className="ai-error">서버에 연결되지 않아요. npm run dev가 켜져 있는지 확인해 주세요.</p>
        ) : !admin ? (
          <LoginForm configured={me.configured} onLogin={(a) => setMe((prev) => ({ ...prev, admin: a }))} />
        ) : (
          <>
            <header className="page-header">
              <h1>관리자 설정</h1>
              <p>여기서 바꾼 값은 모든 사용자에게 바로 적용돼요. 수집 대상은 다음 최신화부터 반영되고, 이미 모은 기사는 그대로예요.</p>
            </header>
            {(notice || error) && <p className={error ? 'ai-error' : 'admin-notice'}>{error || notice}</p>}

            <div className="admin-grid">
              <section className="panel admin-card">
                <h2>수집 대상</h2>
                {keywords && (
                  <ChipList
                    id="keywords"
                    label="자동 수집 키워드"
                    hint={keywords.stored ? '자동 최신화가 이 키워드로 네이버 뉴스를 모아요' : 'DB가 없어 저장할 수 없어요 (DATABASE_URL 확인)'}
                    placeholder="예: 마이크로LED"
                    words={keywords.keywords}
                    onChange={
                      keywords.stored
                        ? (next) =>
                            save(async () => setKeywords({ ...keywords, keywords: (await saveKeywordsApi(next)).keywords }), '자동 수집 키워드를 저장했어요.')
                        : undefined
                    }
                  />
                )}
                {lists && (
                  <ListsEditor lists={lists} onSave={(next) => save(async () => setLists(await saveListsApi(next)), '목록을 저장했어요.')} />
                )}
              </section>

              <section className="panel admin-card">
                <h2>자동 최신화</h2>
                {refresh && (
                  <RefreshPanel
                    status={refresh}
                    starting={starting}
                    disabled={!keywords?.keywords?.length}
                    onRun={handleRun}
                    onSave={(settings) => save(async () => setRefresh(await saveRefreshSettings(settings)), '자동 최신화 설정을 저장했어요.')}
                    canEdit
                  />
                )}
              </section>

              <section className="panel admin-card">
                <h2>AI 모델</h2>
                {health?.llm && (
                  <>
                    <label htmlFor="admin-llm">요약·보고서에 쓸 AI 서버</label>
                    <select
                      id="admin-llm"
                      value={health.llm.current}
                      onChange={(e) =>
                        save(async () => {
                          await selectLlmProvider(e.target.value)
                          setHealth(await fetchHealth())
                        }, 'AI 모델을 바꿨어요.')
                      }
                    >
                      {health.llm.providers.map((p) => (
                        <option key={p.id} value={p.id} disabled={!p.ready}>
                          {p.label} · {p.ready ? p.model.split('/').pop() : '설정 없음'}
                        </option>
                      ))}
                    </select>
                    <p className="hint">
                      {health.modelReachable ? '● 연결됨' : '● 연결 안 됨 — 요약·보고서를 만들 수 없어요'} · 서버를 다시 켜도 이 선택이 유지돼요
                    </p>
                  </>
                )}
              </section>

              <section className="panel admin-card admin-log">
                <h2>변경 기록</h2>
                {log.length === 0 ? (
                  <p className="hint">아직 기록이 없어요.</p>
                ) : (
                  <table className="admin-log-table">
                    <thead>
                      <tr>
                        <th>언제</th>
                        <th>누가</th>
                        <th>무엇을</th>
                        <th>내용</th>
                      </tr>
                    </thead>
                    <tbody>
                      {log.slice(0, 50).map((e, i) => (
                        <tr key={`${e.at}-${i}`}>
                          <td className="time">{formatAt(e.at)}</td>
                          <td>{e.name}</td>
                          <td>{e.action}</td>
                          <td>{e.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export default AdminApp
