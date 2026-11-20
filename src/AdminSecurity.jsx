// 관리 페이지 「접속 · 보안」 (11/20, 관리자 인수인계 — server/credentials.js)
// 접속 코드 · 관리자 비밀번호를 서버에 들어가지 않고 바꾼다. 값은 화면 · 기록 어디에도 보이지 않는다 (지금 비밀번호로 한 번 더 확인)
import { useCallback, useEffect, useState } from 'react'
import { fetchSecurity, resetAccessCode, resetAdminPassword, saveAccessCode, saveAdminPasswordApi } from './api.js'

const SOURCE = { admin: '관리 페이지에서 바꾼 값', env: '서버 설정 파일 값', none: '없음' }

export default function AdminSecurity({ onToast }) {
  const [info, setInfo] = useState(null)
  const [code, setCode] = useState('')
  const [code2, setCode2] = useState('')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [next2, setNext2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    fetchSecurity().then(setInfo).catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])
  const run = async (fn, done) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      onToast?.(done)
      setCode('')
      setCode2('')
      setNext('')
      setNext2('')
      setCurrent('')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  if (!info) return error ? <p className="adm-error">{error}</p> : <p className="adm-desc">불러오는 중…</p>
  return (
    <div className="adm-stack">
      <section className="adm-card">
        <h2>지금 비밀번호로 확인</h2>
        <p className="adm-desc">아래 두 가지는 모두 지금 관리자 비밀번호를 한 번 더 넣어야 바뀌어요.</p>
        <label className="adm-field">
          지금 관리자 비밀번호
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        {error && <p className="adm-error">{error}</p>}
      </section>

      <section className="adm-card">
        <h2>접속 코드</h2>
        <p className="adm-desc">
          사이트에 처음 들어올 때 넣는 코드예요. 지금: <b>{SOURCE[info.accessCode]}</b>. 바꾸면 <b>모든 사람(팀원 · 담당자)이 새 코드를 다시 넣어야</b> 해요 — 바꾸기 전에 새 코드를 전할 방법을 정해 두세요. 바꾼 이 브라우저는 바로 새 코드로 들어와져요.
        </p>
        <div className="adm-sec-grid">
          <label className="adm-field">
            새 접속 코드 (6~40자)
            <input type="password" autoComplete="new-password" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label className="adm-field">
            한 번 더
            <input type="password" autoComplete="new-password" value={code2} onChange={(e) => setCode2(e.target.value)} />
          </label>
        </div>
        <div className="adm-actions">
          <button
            type="button"
            className="adm-btn primary"
            disabled={busy || !current || code.trim().length < 6 || code !== code2}
            onClick={() => run(() => saveAccessCode(code, current), '접속 코드를 바꿨어요 — 새 코드를 팀원 · 담당자에게 알려 주세요')}
          >
            접속 코드 바꾸기
          </button>
          {code && code2 && code !== code2 && <span className="adm-state bad">두 칸이 달라요</span>}
          {info.accessCode === 'admin' && (
            <button type="button" className="adm-link-btn" disabled={busy || !current} onClick={() => run(() => resetAccessCode(current), '접속 코드를 서버 설정 파일 값으로 되돌렸어요')}>
              설정 파일 값으로 되돌리기
            </button>
          )}
        </div>
      </section>

      <section className="adm-card">
        <h2>관리자 비밀번호</h2>
        <p className="adm-desc">
          관리 페이지 로그인 비밀번호예요. 지금: <b>{SOURCE[info.password]}</b>
          {info.passwordAt && ` (${new Date(info.passwordAt).toLocaleDateString('ko-KR')} 바꿈)`}. 아이디는 그대로예요. 담당자가 바뀌면 여기서 바꿔 주세요.
        </p>
        <div className="adm-sec-grid">
          <label className="adm-field">
            새 비밀번호 (10자 이상, 영문 + 숫자)
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <label className="adm-field">
            한 번 더
            <input type="password" autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} />
          </label>
        </div>
        <div className="adm-actions">
          <button
            type="button"
            className="adm-btn primary"
            disabled={busy || !current || next.length < 10 || next !== next2}
            onClick={() => run(() => saveAdminPasswordApi(current, next), '관리자 비밀번호를 바꿨어요 — 다음 로그인부터 새 비밀번호예요')}
          >
            비밀번호 바꾸기
          </button>
          {next && next2 && next !== next2 && <span className="adm-state bad">두 칸이 달라요</span>}
          {info.password === 'admin' && (
            <button type="button" className="adm-link-btn" disabled={busy || !current} onClick={() => run(() => resetAdminPassword(current), '관리자 비밀번호를 서버 설정 파일 값으로 되돌렸어요')}>
              설정 파일 값으로 되돌리기
            </button>
          )}
        </div>
        <p className="adm-note">여기서 바꾼 뒤에는 설정 파일 비밀번호로는 들어올 수 없어요. 잊으면 서버 관리자가 서버에서 <code>npm run admin-reset -- password</code>를 하면 설정 파일 비밀번호로 돌아가요.</p>
      </section>
    </div>
  )
}
