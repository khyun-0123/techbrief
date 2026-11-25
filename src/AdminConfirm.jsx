// 민감한 작업 전 비밀번호 다시 확인 (11/25, GitHub sudo 모드와 같은 방식 — server/admin.js confirmAdmin · requireConfirmed)
// withConfirm(fn): fn을 해 보고 서버가 CONFIRM_REQUIRED로 답하면 비밀번호 창을 띄워 확인한 뒤 한 번 더 한다. 확인은 10분 동안 유효
// <ConfirmHost />를 관리 페이지에 하나만 둔다
import { useEffect, useRef, useState } from 'react'
import { confirmAdminApi } from './api.js'

let openAsk = null

function ask() {
  return new Promise((resolve) => (openAsk ? openAsk({ resolve }) : resolve(false)))
}

export async function withConfirm(fn) {
  try {
    return await fn()
  } catch (err) {
    if (err.code !== 'CONFIRM_REQUIRED') throw err
    if (!(await ask())) throw Object.assign(new Error('취소했어요.'), { cancelled: true })
    return fn()
  }
}

export function ConfirmHost() {
  const [req, setReq] = useState(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef(null)
  useEffect(() => {
    openAsk = (r) => {
      setPassword('')
      setError('')
      setReq(r)
    }
    return () => {
      openAsk = null
    }
  }, [])
  useEffect(() => {
    if (req) input.current?.focus()
  }, [req])
  if (!req) return null
  const close = (ok) => {
    req.resolve(ok)
    setReq(null)
    setPassword('')
  }
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await confirmAdminApi(password)
      close(true)
    } catch (err) {
      if (err.code === 'LOGGED_OUT') {
        window.alert(err.message)
        window.location.reload()
        return
      }
      setError(err.message)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="adm-modal-backdrop" onClick={() => close(false)}>
      <form className="adm-modal adm-confirm" role="dialog" aria-modal="true" aria-labelledby="adm-confirm-title" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close(false)} onSubmit={submit}>
        <h2 id="adm-confirm-title">관리자 비밀번호 확인</h2>
        <p>API 키 · 연결 · 출처를 바꾸거나 지우는 일이라 한 번 더 확인해요. 확인하면 10분 동안은 다시 묻지 않아요.</p>
        <label className="adm-confirm-field">
          비밀번호
          <input ref={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="adm-error">{error}</p>}
        <div className="adm-modal-actions">
          <button type="button" className="adm-link-btn" onClick={() => close(false)}>
            취소
          </button>
          <span className="adm-modal-spacer" />
          <button type="submit" className="adm-btn primary" disabled={!password || busy}>
            {busy ? '확인 중…' : '확인'}
          </button>
        </div>
      </form>
    </div>
  )
}
