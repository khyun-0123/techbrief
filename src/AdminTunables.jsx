// 관리 페이지 「세부 설정」 (11/26, notes/admin-review-1120 S5 · S7~S12 — server/tunables.js)
// 코드에만 있던 숫자 · 낱말 목록 · 세부 기술 분류를 카드(묶음)마다 바꾸고, 카드마다 「처음 값으로」 되돌린다
// 처음 값 = 예전 코드 값. 아무도 안 바꾸면 동작이 같다
import { Pane, SubTabs } from './AdminTabs.jsx'
import { useEffect, useState } from 'react'
import { fetchTunables, resetTunables, saveTunables } from './api.js'

const catText = (list) => list.map((c) => `${c.id} | ${c.name} | ${c.cpc}`).join('\n')

// 서버 값 → 입력 칸 값 (낱말 목록 · 분류는 한 줄에 하나)
function draftOf(data, group) {
  const d = {}
  for (const f of data.num) if (f.group === group) d[f.key] = String(data.values[f.key])
  for (const f of data.lists) if (f.group === group) d[f.key] = data.values[f.key].join('\n')
  if (group === 'categories') d.categories = catText(data.values.categories)
  return d
}

function TuneCard({ group, data, onData, onToast }) {
  const [draft, setDraft] = useState(() => draftOf(data, group.id))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const base = draftOf(data, group.id)

  const nums = data.num.filter((f) => f.group === group.id)
  const lists = data.lists.filter((f) => f.group === group.id)
  const keys = [...nums.map((f) => f.key), ...lists.map((f) => f.key), ...(group.id === 'categories' ? ['categories'] : [])]
  const edited = keys.some((k) => data.changed.includes(k)) // 처음 값과 다른 칸이 저장돼 있음
  const dirty = keys.some((k) => draft[k] !== base[k])

  const run = async (tag, fn, done) => {
    setBusy(tag)
    setError('')
    try {
      const d = await fn()
      onData(d)
      onToast?.(d.updated?.length ? done : '바뀐 값이 없어요')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }
  const save = () => {
    return run('save', () => saveTunables(group.id, draft), `「${group.title}」 저장했어요`)
  }
  const reset = () => {
    if (!window.confirm(`「${group.title}」을(를) 처음 값(예전 코드 값)으로 되돌릴까요?`)) return
    run('reset', () => resetTunables(group.id), `「${group.title}」을(를) 처음 값으로 돌렸어요`)
  }

  return (
    <section className="adm-card">
      <h2>
        {group.title} {edited ? <span className="adm-tag">바꿈</span> : <span className="adm-tag adm-tag-muted">처음 값</span>}
      </h2>
      <p className="adm-desc">반영: {group.note}</p>
      {nums.length > 0 && (
        <table className="adm-table adm-imp-table">
          <thead>
            <tr>
              <th scope="col">칸</th>
              <th scope="col">무엇을 정하나</th>
              <th scope="col">처음</th>
              <th scope="col">지금</th>
            </tr>
          </thead>
          <tbody>
            {nums.map((f) => (
              <tr key={f.key}>
                <th scope="row">{f.label}</th>
                <td className="muted">
                  {f.desc} <small>({f.min}~{f.max})</small>
                </td>
                <td>{f.def}</td>
                <td>
                  <input type="number" min={f.min} max={f.max} step={f.step} value={draft[f.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} aria-label={f.label} className="adm-imp-input" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {lists.map((f) => (
        <label key={f.key} className="adm-tune-list">
          <span><span className="adm-key-name">{f.label}</span> <small className="muted">{f.desc} · 한 줄에 하나 · 처음 {f.def.length}개</small></span>
          <textarea rows={6} value={draft[f.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} spellCheck={false} />
        </label>
      ))}
      {group.id === 'categories' && (
        <label className="adm-tune-list">
          <span><span className="adm-key-name">분류 목록</span> <small className="muted">한 줄에 「이름표 | 분류 이름 | CPC 식」 · 최대 15개 · CPC 식은 코드 앞부분(예: ^(H01L33|H10H)) · 이름표는 영문 소문자</small></span>
          <textarea rows={10} value={draft.categories ?? ''} onChange={(e) => setDraft((d) => ({ ...d, categories: e.target.value }))} spellCheck={false} />
        </label>
      )}
      {error && <p className="adm-error">{error}</p>}
      <div className="adm-actions">
        <button type="button" className="adm-btn primary" onClick={save} disabled={!dirty || Boolean(busy)}>
          {busy === 'save' ? '저장 중…' : '저장'}
        </button>
        <button type="button" className="adm-link-btn" onClick={() => setDraft(base)} disabled={!dirty || Boolean(busy)}>
          고친 것 취소
        </button>
        <button type="button" className="adm-link-btn" onClick={reset} disabled={!edited || Boolean(busy)} title="저장된 값을 지우고 예전 코드 값으로">
          {busy === 'reset' ? '되돌리는 중…' : '처음 값으로'}
        </button>
        {dirty && <span className="muted">저장 안 한 값이 있어요</span>}
      </div>
    </section>
  )
}

const TABS = [
  ['report', '보고서 · 미리 분석', ['report', 'precompute']],
  ['collect', '묶기 · 보관', ['dedupe', 'keep']],
  ['words', '낱말 · 맵', ['words', 'map']],
  ['categories', '세부 기술 분류', ['categories']],
]

export default function AdminTunables({ onToast }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetchTunables()
      .then(setData)
      .catch((err) => setError(err.message))
  }, [])
  if (!data) return error ? <p className="adm-error">{error}</p> : <p className="adm-desc">불러오는 중…</p>
  // 11/26: 카드 일곱을 주제별 탭 넷으로 (AdminTabs.jsx). 모르는 묶음은 마지막 탭에
  const card = (g) => (
    // 이 카드 값이 바뀌면 key가 바뀌어 입력 칸을 새 값으로 (다른 카드를 저장해도 고치던 칸은 그대로)
    <TuneCard key={`${g.id}:${JSON.stringify(draftOf(data, g.id))}`} group={g} data={data} onData={(d) => setData((old) => ({ ...old, ...d }))} onToast={onToast} />
  )
  const known = TABS.flatMap(([, , ids]) => ids)
  return (
    <SubTabs section="tunables" tabs={TABS.map(([k, label]) => [k, label])}>
      {TABS.map(([k, , ids], i) => (
        <Pane key={k} tab={k} className="adm-stack adm-tune-pair">
          {data.groups.filter((g) => ids.includes(g.id) || (i === TABS.length - 1 && !known.includes(g.id))).map(card)}
        </Pane>
      ))}
    </SubTabs>
  )
}
