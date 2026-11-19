// 자동 보고서 확인 창 (11/15 조장: 「키워드만 넣으면 보고서 만드는 창까지 — 확인창 두고」)
// 대시보드 「자동으로 보고서 만들기」 → 범위 찾기(고른 말이 든 자료) → 중요도로 자동 선별(autoPick.js) → 이 창에서 확인 · 고치기
// → 「이대로 만들기」: 고른 자료를 선별(폴더 「키워드 · 자동」)에 담고 요약 대기열에 넣음 → 다 요약되면 보고서 작업을 자동으로 넣음 (App.jsx)
import { useEffect, useRef, useState } from 'react'
import { AUTO_PICK, reasonOf } from './autoPick.js'
import { Seg } from './Dropdown.jsx'

const LEVELS = [
  ['selected', '선택한 자료만', '가장 빨라요'],
  ['owned', '보유 자료까지', '근거 없는 줄을 모은 자료 · 원문으로 보충'],
  ['research', '추가 자료 조사까지', '논문 · 뉴스를 새로 찾아 보충, 가장 오래 걸림'],
]
const WHY = { important: '중요', fill: '채움', term: '고른 말' }
const SUMMARY_SEC = 25 // 요약 한 건 평균 (summaryQueue.js 기본값과 같음)

export default function AutoReportDialog({ run, onStart, onClose, onOpenSelect }) {
  const closeRef = useRef(null)
  useEffect(() => {
    closeRef.current?.focus()
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const { step, scope, result } = run
  const [off, setOff] = useState({}) // 확인 창에서 뺀 자료 { id: true }
  const [title, setTitle] = useState(`${scope.query} 동향 브리핑`)
  const [level, setLevel] = useState('owned')
  const [summarizeNew, setSummarizeNew] = useState(null) // null = 수준 기본값 (추가 자료 조사면 켬)
  const summarizeOn = summarizeNew ?? level === 'research'
  const chosen = (result?.picked ?? []).filter((c) => !off[c.article.id])
  const needSummary = chosen.filter((c) => !c.article.hasSummary).length
  const estMin = Math.max(1, Math.round((needSummary * SUMMARY_SEC + 60) / 60))
  return (
    <div className="modal-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel modal auto-report" role="dialog" aria-modal="true" aria-labelledby="ar-title">
        <div className="vm-head">
          <h2 id="ar-title">자동으로 보고서 만들기</h2>
          <button ref={closeRef} type="button" className="split-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <p className="ar-scope">
          <b>{scope.query}</b>
          {scope.terms.length ? (
            <>
              {' '}
              + {scope.terms.map((t) => (
                <span key={t} className="ar-term">
                  {t}
                </span>
              ))}
            </>
          ) : (
            ' 만'
          )}
        </p>

        {step === 'search' && <p className="hint">고른 말이 든 자료를 찾는 중… (보통 5~10초)</p>}
        {step === 'error' && <p className="form-error">{run.error}</p>}

        {step === 'confirm' && result && (
          <>
            <p className="ar-rule">
              자료 {result.pool}건(같은 이슈는 하나로) 중 <b>「중요」({result.rule.high}점 이상) {result.important}건</b>
              {result.important > AUTO_PICK.max
                ? ` — 많아서 점수 높은 ${AUTO_PICK.max}건만 넣어요 (보고서를 한 번에 쓰는 한도)`
                : result.important < AUTO_PICK.min
                  ? ` — 적어서 다음으로 점수 높은 자료로 ${AUTO_PICK.min}건까지 채웠어요`
                  : ' — 모두 넣었어요'}
              . 고른 말마다 최소 1건이 들어가게 했어요. 빼고 싶은 자료는 체크를 끄세요.
            </p>
            <ul className="ar-list">
              {result.picked.map((c) => {
                const a = c.article
                const on = !off[a.id]
                return (
                  <li key={a.id} className={on ? '' : 'off'}>
                    <label>
                      <input type="checkbox" checked={on} onChange={() => setOff((m) => ({ ...m, [a.id]: on }))} />
                      <span className="ar-main">
                        <span className="ar-title">{a.title}</span>
                        <span className="ar-meta">
                          <span className={`ar-why ar-why-${c.why}`}>{WHY[c.why]}</span> {reasonOf(a)}
                          {a.scopeHits?.length ? ` · ${a.scopeHits.join(', ')}` : ''} · {a.source}
                          {a.hasSummary ? ' · 요약 있음' : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <div className="ar-form">
              <label>
                보고서 제목
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
              </label>
              <Seg value={level} onChange={setLevel} label="자료 조사 수준" size="md" options={LEVELS.map(([value, label]) => ({ value, label }))} />
              {level !== 'selected' && (
                <label className="pre-choice">
                  <input type="checkbox" checked={summarizeOn} onChange={(e) => setSummarizeNew(e.target.checked)} />
                  <span>
                    보충할 자료가 요약 안 돼 있으면 요약해서 쓰기
                    <small>최대 6건, 한 건 약 40초 더 · 끄면 요약된 자료만 써요. 미리 정해 두면 만드는 중에 묻지 않아요</small>
                  </span>
                </label>
              )}
            </div>
            <div className="ar-foot">
              <span className="hint">
                {chosen.length}건 · 요약 {needSummary}건 필요 · 약 {estMin}분 (요약 한 건 약 {SUMMARY_SEC}초 + 보고서 약 1분)
              </span>
              <button type="button" className="btn" onClick={onClose}>
                취소
              </button>
              <button type="button" className="btn primary" disabled={!chosen.length} onClick={() => onStart({ articles: chosen.map((c) => c.article), title: title.trim() || `${scope.query} 동향 브리핑`, level, summarizeNew: level !== 'selected' && summarizeOn })}>
                이대로 만들기 →
              </button>
            </div>
          </>
        )}

        {(step === 'summarizing' || step === 'sending') && (
          <div className="ar-progress" aria-live="polite">
            <p>
              {step === 'summarizing' ? `① 자료 요약 중 ${run.done}/${run.total}` : '② 보고서 작업을 넣는 중…'}
              {run.failed ? ` · 요약 실패 ${run.failed}건은 빼고 만들어요` : ''}
            </p>
            <progress max={run.total + 1} value={run.done + (step === 'sending' ? 1 : 0)} />
            <p className="hint">이 창을 닫아도 계속돼요. 고른 자료는 선별 폴더 「{run.folderName}」에 담았어요.</p>
          </div>
        )}

        {step === 'sent' && (
          <div className="ar-progress" aria-live="polite">
            <p>
              ✓ 보고서 작업을 넣었어요 ({run.total - (run.failed ?? 0)}건). 다 되면 오른쪽 아래 진행 창에 알려 주고 「내 보고서」에 저장돼요 (보통 1분 안팎).
            </p>
            <div className="ar-foot">
              <button type="button" className="btn" onClick={onOpenSelect}>
                선별·요약에서 보기
              </button>
              <button type="button" className="btn primary" onClick={onClose}>
                닫기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
