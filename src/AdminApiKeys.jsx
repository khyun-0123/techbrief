// 관리 페이지 「수집 · 검색」 › 수집 API 키 (11/26 조장: 「유동적인 폼으로」)
// - 서비스마다 필요한 칸이 다르다. 서버가 보내는 칸 목록(server/apiKeys.js SERVICES)대로 칸을 그린다
//   (비밀값 · 아이디 · 이메일 · MAC 주소 · 서비스 계정 JSON 붙여넣기)
// - 키는 넣기만 한다(단방향). 화면에는 칸마다 「있음 · 없음 · 어디서 온 값」만. 바꾸기 · 되돌리기는 관리자 비밀번호를 한 번 더 (AI 연결과 같음)
import { useEffect, useState } from 'react'
import { withConfirm } from './AdminConfirm.jsx'
import { fetchApiKeys, resetApiKeys, revertApiKeys, updateApiKeys } from './api.js'

const STATE = {
  site: ['있음', '사이트에서 넣음', 'ok'],
  env: ['있음', '서버 설정', 'ok'],
  broken: ['다시 넣어 주세요', '암호 열쇠가 바뀌어 읽을 수 없음', 'bad'],
  none: ['없음', '', 'bad'],
}
const PLACEHOLDER = { email: 'name@example.com', mac: '00-11-22-33-44-55', json: '{ "type": "service_account", … } 파일 내용을 그대로' }

export default function AdminApiKeys({ onToast }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [edit, setEdit] = useState(null) // { id, values: { ENV: '' } }

  useEffect(() => {
    fetchApiKeys()
      .then(setData)
      .catch((err) => setError(err.message))
  }, [])

  const run = async (tag, fn, done) => {
    setBusy(tag)
    setError('')
    try {
      const d = await withConfirm(fn)
      if (d?.services) setData(d)
      if (done) onToast?.(done)
      return true
    } catch (err) {
      if (!err.cancelled) setError(err.message)
      return false
    } finally {
      setBusy('')
    }
  }

  if (!data) return error ? <p className="adm-error">{error}</p> : <p className="muted">불러오는 중…</p>
  const setV = (env, v) => setEdit((e) => ({ ...e, values: { ...e.values, [env]: v } }))

  return (
    <>
      <p className="adm-desc">
        뉴스 · 논문 · 특허를 가져오는 API의 키예요. 서비스마다 필요한 칸이 달라 칸 목록대로 보여 줘요. <b>넣기만 할 수 있어요</b> — 암호화해 저장하고 화면에는 「있음 · 없음」만 보여요. 사이트에서 넣은 값이 서버 설정(Railway 변수)보다 먼저 쓰이고, 「서버 설정 값으로」를 누르면 사이트 값을 지워요. 바꾸거나 되돌릴 때는 관리자 비밀번호를 한 번 더 물어요.
      </p>
      {data.secret === 'none' && <p className="adm-desc adm-error">서버에 암호 열쇠(TB_SECRET_KEY)가 없어 키를 저장할 수 없어요 — 서버 담당에게 요청하세요.</p>}
      <div className="adm-table-wrap">
        <table className="adm-table adm-conn-table adm-key-table">
          <thead>
            <tr>
              <th scope="col">서비스</th>
              <th scope="col">칸</th>
              <th scope="col">할 일</th>
            </tr>
          </thead>
          <tbody>
            {data.services.map((s) => {
              const editing = edit?.id === s.id
              return (
                <tr key={s.id}>
                  <th scope="row">
                    {s.label}
                    <span className="adm-conn-tags">
                      {s.optional ? <span className="adm-conn-tag">없어도 됨</span> : s.ready ? <span className="adm-conn-tag on">준비됨</span> : <span className="adm-conn-tag off">칸이 비었음</span>}
                    </span>
                    <small className="muted">{s.use}</small>
                  </th>
                  <td>
                    <ul className="adm-key-fields">
                      {s.fields.map((f) => {
                        const [word, from, st] = STATE[f.state] ?? STATE.none
                        return (
                          <li key={f.env}>
                            <span className="adm-key-name">{f.label}</span> <span className={`adm-state ${st}`}>{word}</span> {from && <small className="muted">{from}</small>}
                          </li>
                        )
                      })}
                    </ul>
                  </td>
                  <td>
                    <div className="adm-conn-actions">
                      <button type="button" className="adm-btn" disabled={data.secret === 'none'} onClick={() => setEdit(editing ? null : { id: s.id, values: {} })}>
                        {editing ? '닫기' : '바꾸기'}
                      </button>
                      {s.canRevert && (
                        <button type="button" className="adm-btn" disabled={busy === `revert-${s.id}`} onClick={() => window.confirm(`「${s.label}」을(를) 바로 전 값으로 되돌릴까요?`) && run(`revert-${s.id}`, () => revertApiKeys(s.id), '되돌렸어요')}>
                          되돌리기
                        </button>
                      )}
                      {s.canReset && (
                        <button type="button" className="adm-link-btn" disabled={busy === `reset-${s.id}`} title="사이트에서 넣은 값을 지우고 서버 설정(Railway 변수) 값으로" onClick={() => window.confirm(`「${s.label}」의 사이트 값을 지우고 서버 설정 값으로 돌릴까요?`) && run(`reset-${s.id}`, () => resetApiKeys(s.id), '서버 설정 값으로 돌렸어요')}>
                          서버 설정 값으로
                        </button>
                      )}
                    </div>
                    {editing && (
                      <form
                        className="adm-conn-form"
                        onSubmit={async (e) => {
                          e.preventDefault()
                          if (await run(`save-${s.id}`, () => updateApiKeys(s.id, edit.values), '저장했어요 — 다음 요청부터 바로 써요')) setEdit(null)
                        }}
                      >
                        {s.fields.map((f) => (
                          <label key={f.env}>
                            {f.label} <small className="muted">비워 두면 그대로 · 넣은 뒤에는 다시 볼 수 없어요</small>
                            {f.kind === 'json' ? (
                              <textarea rows={4} value={edit.values[f.env] ?? ''} onChange={(e) => setV(f.env, e.target.value)} placeholder={PLACEHOLDER.json} spellCheck={false} autoComplete="off" />
                            ) : (
                              <input
                                type={f.kind === 'secret' ? 'password' : f.kind === 'email' ? 'email' : 'text'}
                                value={edit.values[f.env] ?? ''}
                                onChange={(e) => setV(f.env, e.target.value)}
                                placeholder={PLACEHOLDER[f.kind] ?? ''}
                                autoComplete={f.kind === 'secret' ? 'new-password' : 'off'}
                                spellCheck={false}
                              />
                            )}
                          </label>
                        ))}
                        <div className="adm-actions">
                          <button type="submit" className="adm-btn primary" disabled={busy === `save-${s.id}`}>
                            {busy === `save-${s.id}` ? '저장 중…' : '저장'}
                          </button>
                          <button type="button" className="adm-link-btn" onClick={() => setEdit(null)}>
                            취소
                          </button>
                        </div>
                      </form>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="adm-error">{error}</p>}
    </>
  )
}
