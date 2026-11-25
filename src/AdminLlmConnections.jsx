// 관리 페이지 「AI 서버」 › AI 연결 (11/25 조장: 「사이트에서 모든 걸」) — 주소 · API 키 넣기 · 되돌리기 · 끄기 · 시험 · 새 연결
// - API 키는 넣기만 한다(단방향). 서버는 「있음 · 없음 · 어디서 온 값」만 보낸다 (server/llm/connections.js)
// - 기본 세 곳은 지울 수 없고 바꾸기 · 되돌리기 · 끄기만. 새로 더한 연결은 관리자 비밀번호를 다시 넣어야 지운다
import { useEffect, useState } from 'react'
import { withConfirm } from './AdminConfirm.jsx'
import { addLlmConnection, deleteLlmConnection, fetchLlmConnections, revertLlmConnection, setLlmConnectionDisabled, testLlmConnection, updateLlmConnection } from './api.js'

const KEY_TEXT = {
  site: ['있음', '사이트에서 넣음', 'ok'],
  env: ['있음', '서버 설정 파일', 'ok'],
  broken: ['다시 넣어 주세요', '암호 열쇠가 바뀌어 읽을 수 없음', 'bad'],
  none: ['없음', '', 'bad'],
}
const URL_FROM = { site: '사이트에서 넣음', env: '서버 설정 파일', default: '기본 주소', none: '' }
const EMPTY_NEW = { label: '', baseUrl: '', model: '', reportModel: '', key: '' }

function TestLine({ r }) {
  if (!r) return null
  if (r.busy) return <p className="adm-conn-test muted">시험하는 중… (응답 시험은 AI 대기열을 거쳐요)</p>
  if (r.error) return <p className="adm-conn-test adm-error">{r.error}</p>
  const ping = r.ping?.ok ? <span className="adm-state ok">주소 · 키 확인 {r.ping.ms}ms</span> : <span className="adm-state bad">{r.ping?.error ?? '확인 실패'}</span>
  const chat = !r.chat ? null : r.chat.skipped ? <span className="muted">응답 시험 건너뜀 — {r.chat.skipped}</span> : r.chat.ok ? <span className="adm-state ok">응답 {(r.chat.ms / 1000).toFixed(1)}초 · {r.chat.model}</span> : <span className="adm-state bad">응답 실패 — {r.chat.error}</span>
  return (
    <p className="adm-conn-test">
      {ping} {chat}
    </p>
  )
}

export default function AdminLlmConnections({ currentId, onChanged, onToast }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [edit, setEdit] = useState(null) // { id, label, baseUrl, model, reportModel, key }
  const [tests, setTests] = useState({})
  const [adding, setAdding] = useState(null)

  useEffect(() => {
    fetchLlmConnections()
      .then((d) => setData(d.connections))
      .catch((err) => setError(err.message))
  }, [])

  const run = async (tag, fn, done) => {
    setBusy(tag)
    setError('')
    try {
      const d = await withConfirm(fn) // 키 · 연결을 바꾸거나 지우는 일은 서버가 비밀번호 확인을 요구하면 창을 띄움 (11/25)
      if (d?.connections) setData(d.connections)
      if (done) onToast?.(done)
      onChanged?.()
      return true
    } catch (err) {
      if (!err.cancelled) setError(err.message)
      return false
    } finally {
      setBusy('')
    }
  }
  const test = async (id) => {
    setTests((t) => ({ ...t, [id]: { busy: true } }))
    try {
      const r = await testLlmConnection(id)
      setTests((t) => ({ ...t, [id]: r }))
    } catch (err) {
      setTests((t) => ({ ...t, [id]: { error: err.message } }))
    }
  }

  if (!data) return error ? <section className="adm-card"><p className="adm-error">{error}</p></section> : null
  const rows = [...data.builtin.map((c) => ({ ...c, label: { local: '맥미니', openrouter: 'OpenRouter', exaone: 'EXAONE API' }[c.id] })), ...data.custom]
  const setE = (k, v) => setEdit((e) => ({ ...e, [k]: v }))

  return (
    <section className="adm-card">
      <h2>AI 연결 · API 키</h2>
      <p className="adm-desc">
        AI 서버 주소와 API 키를 여기서 넣고 바꿔요. <b>API 키는 넣기만 할 수 있어요</b> — 암호화해 저장하고, 화면에는 「있음 · 없음」만 보여요. 바꾼 뒤에도 「되돌리기」로 바로 전 값으로 돌아갈 수 있어요. 기본 세 곳은 지울 수 없고 끌 수만 있어요. 키를 넣거나 바꾸거나 지울 때는 관리자 비밀번호를 한 번 더 물어요(10분 동안 유지).
      </p>
      {data.secret !== 'dedicated' && (
        <p className={`adm-desc ${data.secret === 'none' ? 'adm-error' : ''}`}>
          {data.secret === 'none'
            ? '서버에 암호 열쇠(TB_SECRET_KEY)가 없어 키를 저장할 수 없어요 — 서버 담당에게 요청하세요.'
            : '지금은 서버 설정의 관리자 비밀번호로 키를 암호화해요. 그 설정값이 바뀌면 사이트에서 넣은 키를 다시 넣어야 해요 (서버 설정에 TB_SECRET_KEY를 따로 두면 안전).'}
        </p>
      )}
      <div className="adm-table-wrap">
        <table className="adm-table adm-conn-table">
          <thead>
            <tr>
              <th scope="col">연결</th>
              <th scope="col">주소</th>
              <th scope="col">API 키</th>
              <th scope="col">할 일</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const [keyWord, keyFrom, keyState] = KEY_TEXT[c.key] ?? KEY_TEXT.none
              const inUse = currentId === c.id
              const editing = edit?.id === c.id
              return (
                <tr key={c.id} className={c.disabled ? 'is-off' : undefined}>
                  <th scope="row">
                    {c.label}
                    <span className="adm-conn-tags">
                      <span className="adm-conn-tag">{c.builtin ? '기본' : '새 연결'}</span>
                      {inUse && <span className="adm-conn-tag on">사용 중</span>}
                      {c.disabled && <span className="adm-conn-tag off">꺼짐</span>}
                    </span>
                    {!c.builtin && (
                      <small className="muted">
                        {c.model}
                        {c.reportModel && ` · 보고서 ${c.reportModel}`}
                      </small>
                    )}
                  </th>
                  <td>
                    <span className="adm-conn-url">{c.baseUrl || '—'}</span>
                    {c.builtin && URL_FROM[c.baseUrlFrom] && <small className="muted">{URL_FROM[c.baseUrlFrom]}</small>}
                  </td>
                  <td>
                    <span className={`adm-state ${keyState}`}>{keyWord}</span>
                    {keyFrom && <small className="muted">{keyFrom}</small>}
                  </td>
                  <td>
                    <div className="adm-conn-actions">
                      <button type="button" className="adm-btn" onClick={() => setEdit(editing ? null : { id: c.id, label: c.builtin ? '' : c.label, baseUrl: '', model: c.builtin ? '' : c.model, reportModel: c.builtin ? '' : c.reportModel, key: '' })}>
                        {editing ? '닫기' : '바꾸기'}
                      </button>
                      {c.revert && (
                        <button
                          type="button"
                          className="adm-btn"
                          disabled={busy === `revert-${c.id}`}
                          title={c.revert === 'env' ? '사이트에서 넣은 값을 지우고 서버 설정 파일 값으로' : '바로 전에 넣은 값으로'}
                          onClick={() => window.confirm(`「${c.label}」을(를) ${c.revert === 'env' ? '서버 설정 파일 값' : '바로 전 값'}으로 되돌릴까요?`) && run(`revert-${c.id}`, () => revertLlmConnection(c.id), '되돌렸어요')}
                        >
                          되돌리기
                        </button>
                      )}
                      <button
                        type="button"
                        className="adm-btn"
                        disabled={busy === `off-${c.id}` || (inUse && !c.disabled)}
                        title={inUse && !c.disabled ? '지금 쓰는 연결은 끌 수 없어요 — 먼저 위에서 다른 AI 서버를 고르세요' : undefined}
                        onClick={() => run(`off-${c.id}`, () => setLlmConnectionDisabled(c.id, !c.disabled), c.disabled ? '켰어요' : '껐어요')}
                      >
                        {c.disabled ? '켜기' : '끄기'}
                      </button>
                      <button type="button" className="adm-btn" onClick={() => test(c.id)} disabled={tests[c.id]?.busy}>
                        시험
                      </button>
                      {!c.builtin && (
                        <button
                          type="button"
                          className="adm-link-btn danger"
                          disabled={inUse || busy === `del-${c.id}`}
                          title={inUse ? '지금 쓰는 연결은 지울 수 없어요' : undefined}
                          onClick={() => window.confirm(`「${c.label}」 연결과 키를 지울까요? 되돌릴 수 없어요.`) && run(`del-${c.id}`, () => deleteLlmConnection(c.id), `「${c.label}」 연결을 지웠어요`)}
                        >
                          지우기
                        </button>
                      )}
                    </div>
                    <TestLine r={tests[c.id]} />
                    {editing && (
                      <form
                        className="adm-conn-form"
                        onSubmit={async (e) => {
                          e.preventDefault()
                          const body = c.builtin ? { baseUrl: edit.baseUrl, key: edit.key } : { label: edit.label, baseUrl: edit.baseUrl, model: edit.model, reportModel: edit.reportModel, key: edit.key }
                          if (await run(`save-${c.id}`, () => updateLlmConnection(c.id, body), '저장했어요 — 다음 요청부터 바로 써요')) setEdit(null)
                        }}
                      >
                        {!c.builtin && (
                          <label>
                            이름
                            <input value={edit.label} onChange={(e) => setE('label', e.target.value)} maxLength={30} />
                          </label>
                        )}
                        <label>
                          주소 <small className="muted">비워 두면 그대로</small>
                          <input value={edit.baseUrl} onChange={(e) => setE('baseUrl', e.target.value)} placeholder={c.baseUrl || 'https://…/v1'} inputMode="url" />
                        </label>
                        {!c.builtin && (
                          <>
                            <label>
                              요약 모델
                              <input value={edit.model} onChange={(e) => setE('model', e.target.value)} />
                            </label>
                            <label>
                              보고서 모델 <small className="muted">비우면 요약 모델</small>
                              <input value={edit.reportModel} onChange={(e) => setE('reportModel', e.target.value)} />
                            </label>
                          </>
                        )}
                        <label>
                          새 API 키 <small className="muted">비워 두면 그대로 · 넣은 뒤에는 다시 볼 수 없어요</small>
                          <input type="password" value={edit.key} onChange={(e) => setE('key', e.target.value)} autoComplete="new-password" spellCheck={false} />
                        </label>
                        <div className="adm-actions">
                          <button type="submit" className="adm-btn primary" disabled={busy === `save-${c.id}`}>
                            {busy === `save-${c.id}` ? '저장 중…' : '저장'}
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
      {adding ? (
        <form
          className="adm-conn-form adm-conn-add"
          onSubmit={async (e) => {
            e.preventDefault()
            if (await run('add', () => addLlmConnection(adding), `「${adding.label}」 연결을 더했어요 — 「시험」으로 확인해 보세요`)) setAdding(null)
          }}
        >
          <h3>새 AI 연결 (OpenAI 호환 /chat/completions)</h3>
          <label>
            이름
            <input value={adding.label} onChange={(e) => setAdding((a) => ({ ...a, label: e.target.value }))} placeholder="예: 회사 GPU 서버" maxLength={30} required />
          </label>
          <label>
            주소
            <input value={adding.baseUrl} onChange={(e) => setAdding((a) => ({ ...a, baseUrl: e.target.value }))} placeholder="https://…/v1" inputMode="url" required />
          </label>
          <label>
            요약 모델
            <input value={adding.model} onChange={(e) => setAdding((a) => ({ ...a, model: e.target.value }))} placeholder="예: gpt-4o-mini" required />
          </label>
          <label>
            보고서 모델 <small className="muted">비우면 요약 모델</small>
            <input value={adding.reportModel} onChange={(e) => setAdding((a) => ({ ...a, reportModel: e.target.value }))} />
          </label>
          <label>
            API 키 <small className="muted">넣은 뒤에는 다시 볼 수 없어요</small>
            <input type="password" value={adding.key} onChange={(e) => setAdding((a) => ({ ...a, key: e.target.value }))} autoComplete="new-password" spellCheck={false} required />
          </label>
          <div className="adm-actions">
            <button type="submit" className="adm-btn primary" disabled={busy === 'add'}>
              {busy === 'add' ? '더하는 중…' : '연결 더하기'}
            </button>
            <button type="button" className="adm-link-btn" onClick={() => setAdding(null)}>
              취소
            </button>
          </div>
        </form>
      ) : (
        <div className="adm-actions">
          <button type="button" className="adm-btn" onClick={() => setAdding(EMPTY_NEW)} disabled={data.custom.length >= data.max || data.secret === 'none'}>
            + 새 AI 연결
          </button>
          <small className="muted">
            새 연결 {data.custom.length}/{data.max}
          </small>
        </div>
      )}
    </section>
  )
}
