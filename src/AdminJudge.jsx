// 관리 페이지 「판정 기준」 (11/20, 관리자 인수인계 — server/judgeSettings.js)
// ① 기술 단계 · 자사 위협 · 기회를 정하는 숫자 기준 ② 자사 · 경쟁사의 특허 출원인 이름
// 예전에는 둘 다 코드에 있어 바꾸려면 프로그램을 고쳐 다시 올려야 했다. 경쟁사를 더해도 출원인 이름이 사전에 없으면 특허 비교에서 조용히 빠졌다
import { useCallback, useEffect, useState } from 'react'
import { checkOwner, fetchJudge, saveJudge, saveOwnerApi } from './api.js'

const fmtAt = (iso) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const GROUPS = [
  ['기술 단계', ['relFast', 'relMild', 'relFlat', 'peakDrop', 'communityMin', 'patMin']],
  ['자사 위협 · 기회', ['threatFactor', 'shareMin', 'ratioPrior']],
]
const SOURCE = { custom: ['직접 넣음', 'ok'], dict: ['기본 사전', 'muted'], none: ['특허 비교에서 빠짐', 'bad'] }

function OwnerRow({ c, onSaved, onToast }) {
  const [text, setText] = useState(c.source === 'custom' ? c.like.join(', ') : '')
  const [check, setCheck] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const [label, tone] = SOURCE[c.source] ?? SOURCE.none
  return (
    <tr>
      <th scope="row">
        {c.name}
        <span className="muted"> · {c.role === 'own' ? '자사' : '경쟁사'}</span>
      </th>
      <td>
        <span className={`adm-state ${tone}`}>{label}</span>
        {c.like.length > 0 && <div className="muted adm-judge-like">{c.like.join(', ')}</div>}
      </td>
      <td>
        <div className="adm-judge-owner">
          <input
            type="text"
            value={text}
            placeholder={c.source === 'dict' ? '기본 사전 이름을 쓰는 중 (바꿀 때만)' : '예: SAMSUNG DISPLAY'}
            onChange={(e) => {
              setText(e.target.value)
              setCheck(null)
            }}
            aria-label={`${c.name} 특허 출원인 이름`}
          />
          <button type="button" className="adm-btn" disabled={busy || !text.trim()} onClick={() => run(async () => setCheck(await checkOwner(text)))}>
            건수 확인
          </button>
          <button
            type="button"
            className="adm-btn primary"
            disabled={busy || !check}
            title={check ? '' : '「건수 확인」을 먼저 해 주세요'}
            onClick={() =>
              run(async () => {
                await saveOwnerApi(c.name, text)
                onToast?.(`${c.name} 특허 이름을 저장했어요`)
                onSaved()
              })
            }
          >
            저장
          </button>
          {c.source === 'custom' && (
            <button
              type="button"
              className="adm-link-btn"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await saveOwnerApi(c.name, [])
                  onToast?.(`${c.name}: 직접 넣은 이름을 지웠어요`)
                  onSaved()
                })
              }
            >
              지우기
            </button>
          )}
        </div>
        {check && (
          <p className="adm-judge-check" aria-live="polite">
            최근 6년 디스플레이 특허 <b>{check.count == null ? '확인 못 함' : `${check.count.toLocaleString()}건`}</b>
            {check.samples?.length > 0 && <span className="muted"> · {check.samples.map((s) => `${s.name} ${s.n.toLocaleString()}`).join(' · ')}</span>}
            {check.count === 0 && <span className="adm-state bad"> · 잡히는 특허가 없어요. 이름을 다시 봐 주세요</span>}
          </p>
        )}
        {error && <p className="adm-error">{error}</p>}
      </td>
    </tr>
  )
}

export default function AdminJudge({ onToast }) {
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    fetchJudge()
      .then((d) => {
        setData(d)
        setDraft({ ...d.rule })
      })
      .catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])
  if (error && !data) return <p className="adm-error">{error}</p>
  if (!data || !draft) return <p className="adm-desc">불러오는 중…</p>

  const field = Object.fromEntries(data.fields.map((f) => [f[0], f]))
  const changed = data.fields.some(([k]) => Number(draft[k]) !== data.rule[k])
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const out = await saveJudge(Object.fromEntries(data.fields.map(([k]) => [k, Number(draft[k])])))
      setData((d) => ({ ...d, rule: out.rule, history: out.history }))
      onToast?.('판정 기준을 저장했어요 — 키워드를 열 때 새 기준으로 다시 판정해요')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const missing = data.companies.filter((c) => c.source === 'none')
  return (
    <div className="adm-stack">
      <section className="adm-card">
        <h2>
          판정 숫자 <span className="adm-tag adm-tag-muted">AI 안 씀</span>
        </h2>
        <p className="adm-desc">기술 단계(신생 · 성장 · 성숙 · 감소)와 「자사 위협 · 기회」는 AI가 아니라 아래 숫자로 정해요. 처음 값은 팀이 알려진 기술 12개로 맞춘 출발값이에요.</p>
        {GROUPS.map(([title, keys]) => (
          <div key={title}>
            <h3 className="adm-sub">{title}</h3>
            <table className="adm-table adm-imp-table">
              <thead>
                <tr>
                  <th scope="col">기준</th>
                  <th scope="col">무엇을 정하나</th>
                  <th scope="col">기본</th>
                  <th scope="col">지금</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const [, label, desc, def, min, max, step] = field[k]
                  return (
                    <tr key={k}>
                      <th scope="row">{label}</th>
                      <td className="muted">{desc}</td>
                      <td>{def}</td>
                      <td>
                        <input
                          type="number"
                          min={min}
                          max={max}
                          step={step}
                          value={draft[k]}
                          onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                          aria-label={label}
                          className="adm-imp-input"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
        <p className="adm-desc">저장하면 키워드를 열 때 이미 모아 둔 논문 · 특허로 단계만 다시 계산해요 (다시 받지 않음). 자료 목록의 「자사 위협 · 기회」 표시도 새 기준으로 바뀌어요.</p>
        {error && <p className="adm-error">{error}</p>}
        <div className="adm-actions">
          <button type="button" className="adm-btn primary" onClick={save} disabled={!changed || busy}>
            {busy ? '저장 중…' : '저장'}
          </button>
          <button type="button" className="adm-link-btn" onClick={() => setDraft({ ...data.defaults })}>
            기본값으로
          </button>
          {changed && <span className="muted">바뀐 값이 있어요</span>}
        </div>
      </section>

      <section className="adm-card">
        <h2>회사 특허 이름</h2>
        <p className="adm-desc">
          특허는 출원인 이름(영문)으로 회사를 찾아요. 「수집 대상 › 회사」에 넣은 자사 · 경쟁사가 여기 나와요. 기본 사전에 없는 회사는 출원인 이름을 넣어야 특허 비교에 들어가요. 여러 이름은 쉼표로, 「%」는 「아무 글자」예요 (예: <code>%TIANMA%</code>). 자사는 「자사」 목록에서 이름을 찾은 첫 회사예요.
        </p>
        {missing.length > 0 && <p className="adm-alert-inline">특허 비교에서 빠진 회사가 있어요: {missing.map((c) => c.name).join(', ')} — 출원인 이름을 넣어 주세요.</p>}
        <table className="adm-table adm-judge-table">
          <thead>
            <tr>
              <th scope="col">회사</th>
              <th scope="col">지금 쓰는 이름</th>
              <th scope="col">출원인 이름 넣기</th>
            </tr>
          </thead>
          <tbody>
            {data.companies.map((c) => (
              <OwnerRow key={`${c.role}-${c.name}-${c.source}`} c={c} onSaved={load} onToast={onToast} />
            ))}
          </tbody>
        </table>
      </section>

      <section className="adm-card">
        <h2>바꾼 기록</h2>
        {data.history?.length ? (
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">언제</th>
                <th scope="col">누가</th>
                <th scope="col">기본값과 다른 기준</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((h) => (
                <tr key={h.at}>
                  <td>{fmtAt(h.at)}</td>
                  <td>{h.name}</td>
                  <td>
                    {data.fields
                      .filter(([k]) => h.rule[k] !== data.defaults[k])
                      .map(([k, label]) => `${label} ${h.rule[k]}`)
                      .join(' · ') || '모두 기본값'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="adm-desc">아직 바꾼 적이 없어요. 지금은 모두 기본값이에요.</p>
        )}
      </section>
    </div>
  )
}
