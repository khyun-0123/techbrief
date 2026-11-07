// 용어 백과 (27 문서 4장): 위키백과 요약을 옆에 띄운다. 보고서 근거가 아니라 용어 이해용
// terms: 바로 누를 수 있는 용어 칩 (기사 핵심 키워드 등)
import { useState } from 'react'
import { lookupWikiApi } from './api.js'

function WikiLookup({ terms = [] }) {
  const [input, setInput] = useState('')
  const [state, setState] = useState(null) // { term, loading?, result?, error? }

  async function look(term) {
    const t = term.trim()
    if (!t) return
    setState({ term: t, loading: true })
    try {
      setState({ term: t, result: await lookupWikiApi(t) })
    } catch (err) {
      setState({ term: t, error: err.message })
    }
  }

  return (
    <div className="wiki-lookup">
      <h3>
        용어 백과 <small>위키백과 · 용어 이해용 (보고서 근거 아님)</small>
      </h3>
      <form
        className="wiki-form"
        onSubmit={(e) => {
          e.preventDefault()
          look(input)
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="모르는 용어 (예: 탠덤 OLED)" aria-label="찾을 용어" maxLength={60} />
        <button type="submit" className="btn outline" disabled={!input.trim() || state?.loading}>
          찾기
        </button>
      </form>
      {terms.length > 0 && (
        <div className="chips">
          {terms.slice(0, 8).map((t) => (
            <button key={t} type="button" className="chip chip-btn" onClick={() => look(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {state && (
        <div className="wiki-card" role="status">
          {state.loading ? (
            <p className="hint">「{state.term}」 찾는 중…</p>
          ) : state.error ? (
            <p className="ai-error">{state.error}</p>
          ) : state.result ? (
            <>
              <p className="wiki-title">
                <strong>{state.result.title}</strong>
                {state.result.description && <span> · {state.result.description}</span>}
                {state.result.lang === 'en' && <span className="chip muted">영어 문서</span>}
              </p>
              {state.result.near && <p className="hint">「{state.term}」과 딱 맞는 문서가 없어 가장 가까운 문서를 보여 줘요.</p>}
              <p className="wiki-extract">{state.result.extract}</p>
              <a href={state.result.url} target="_blank" rel="noreferrer">
                위키백과에서 보기 ↗
              </a>
            </>
          ) : (
            <p className="hint">「{state.term}」에 맞는 위키백과 문서가 없어요.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default WikiLookup
