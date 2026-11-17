// 관리 페이지 「수집 대상」 › 자주 찾은 새 키워드 · 검색어 영문 표기 (11/10)
// - 자동 수집 키워드는 회의를 거쳐 관리자가 넣는다(11/10 조장). 이 표는 그 판단 자료: 최근 N일 동안 「논문 · 뉴스에서 찾기」로 찾은 말
//   (이미 자동 수집 키워드인 말은 뺌. 11/16 추천 검색어는 자동 수집 키워드로 합침). 사람은 날짜마다 IP를 해시로 세서 더한 값
// - 한글 검색어는 AI가 영문 검색어 1~3개를 만들어 논문 · 영문 출처를 찾는다. 틀렸으면 여기서 고친다 (고친 값은 AI가 덮어쓰지 않음)
import { useCallback, useEffect, useState } from 'react'
import { fetchSearchTerms, saveQueryTermsApi } from './api.js'

const SOURCE_LABEL = { llm: 'AI 번역', google: 'Google 번역', admin: '관리자', alias: '별칭표' }

function TermsCell({ row, onSave }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  if (!editing) {
    return (
      <>
        {row.terms?.length ? row.terms.join(' · ') : <span className="muted">없음</span>}
        {row.termsSource && <span className="adm-tag adm-tag-muted"> {SOURCE_LABEL[row.termsSource] ?? row.termsSource}</span>}{' '}
        <button
          type="button"
          className="adm-link-btn"
          onClick={() => {
            setText((row.terms ?? []).join(', '))
            setEditing(true)
          }}
        >
          고치기
        </button>
      </>
    )
  }
  async function save(terms) {
    setSaving(true)
    try {
      await onSave(row.query, terms)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }
  return (
    <span className="adm-field-inline">
      <input
        className="adm-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="예: gaming monitor, OLED gaming monitor"
        aria-label={`「${row.query}」 영문 검색어 (쉼표로 구분)`}
      />
      <button type="button" className="adm-btn primary" disabled={saving} onClick={() => save(text.split(',').map((t) => t.trim()).filter(Boolean))}>
        저장
      </button>
      <button type="button" className="adm-btn" disabled={saving} onClick={() => save([])} title="지우면 다음 찾기 때 AI가 다시 만들어요">
        지우기
      </button>
      <button type="button" className="adm-link-btn" onClick={() => setEditing(false)}>
        취소
      </button>
    </span>
  )
}

function AdminSearchTerms({ onToast }) {
  const [days, setDays] = useState(14)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    fetchSearchTerms(days)
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [days])
  useEffect(load, [load])

  async function saveTerms(query, terms) {
    try {
      const saved = await saveQueryTermsApi(query, terms)
      onToast?.({ text: saved.terms.length ? `「${query}」 영문 검색어를 바꿨어요.` : `「${query}」 영문 검색어를 지웠어요. 다음 찾기 때 AI가 다시 만들어요.` })
      load()
    } catch (err) {
      onToast?.({ text: err.message, error: true })
      throw err
    }
  }

  if (error) return <p className="adm-desc">{error}</p>
  if (!data) return <p className="adm-desc">불러오는 중…</p>
  const translatedOnly = data.translations.filter((t) => !data.frequent.some((f) => f.query === t.query))

  return (
    <>
      <p className="adm-desc">
        「논문 · 뉴스에서 찾기」로 찾은 말 중 자동 수집 키워드가 아닌 것이에요. 자동 수집 키워드로 넣을지는 회의에서 정해 위 「자동 수집 키워드」에 넣어 주세요. 사람 수는 날마다 따로 센 값의 합이에요.
      </p>
      <div className="adm-segment" role="radiogroup" aria-label="찾은 기간">
        {[7, 14, 30].map((d) => (
          <button key={d} type="button" role="radio" aria-checked={d === days} onClick={() => setDays(d)}>
            최근 {d}일
          </button>
        ))}
      </div>
      {data.frequent.length === 0 ? (
        <p className="adm-empty">최근 {data.days}일 동안 찾은 새 키워드가 없어요.</p>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>검색어</th>
              <th>찾은 횟수</th>
              <th>분석 연 횟수</th>
              <th>사람 · 일</th>
              <th>마지막</th>
              <th>논문 · 영문 출처 검색어</th>
            </tr>
          </thead>
          <tbody>
            {data.frequent.map((r) => (
              <tr key={r.query}>
                <td>
                  <b>{r.query}</b>
                </td>
                <td className="adm-nowrap">{r.searches}번</td>
                <td className="adm-nowrap">{r.opens ? `${r.opens}번` : '-'}</td>
                <td className="adm-nowrap">{r.people}</td>
                <td className="adm-nowrap">{r.lastDay}</td>
                <td>{/[가-힣]/.test(r.query) ? <TermsCell row={r} onSave={saveTerms} /> : <span className="muted">영문 그대로</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {translatedOnly.length > 0 && (
        <details>
          <summary className="adm-desc">기간 밖이거나 자동 수집 키워드인 말의 영문 검색어 {translatedOnly.length}개</summary>
          <table className="adm-table">
            <tbody>
              {translatedOnly.map((t) => (
                <tr key={t.query}>
                  <td>
                    <b>{t.query}</b>
                  </td>
                  <td>
                    <TermsCell row={{ query: t.query, terms: t.terms, termsSource: t.source }} onSave={saveTerms} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  )
}

export default AdminSearchTerms
