// 자동 보고서 확인 창 (11/15 조장: 「키워드만 넣으면 보고서 만드는 창까지 — 확인창 두고」)
// 대시보드 「자동으로 보고서 만들기」 → 범위 찾기(고른 말이 든 자료) → 중요도로 자동 선별(autoPick.js) → 이 창에서 확인 · 고치기
// → 「이대로 만들기」: 고른 자료를 선별(폴더 「키워드 · 자동」)에 담고 요약 대기열에 넣음 → 다 요약되면 보고서 작업을 자동으로 넣음 (App.jsx)
import { useEffect, useRef, useState } from 'react'
import { AUTO_PICK, reasonOf } from './autoPick.js'
import { Seg } from './Dropdown.jsx'
import EtaBar from './EtaBar.jsx'
import { reportLimit } from './limits.js'

const LEVELS = [
  ['selected', '선택한 자료만', '가장 빨라요'],
  ['owned', '보유 자료까지', '근거 없는 줄을 모은 자료 · 원문으로 보충'],
  ['research', '추가 자료 조사까지', '논문 · 뉴스를 새로 찾아 보충, 가장 오래 걸림'],
]
const WHY = { important: '중요', fill: '채움', term: '고른 말', added: '직접 추가' }
const SUMMARY_SEC = 25 // 요약 한 건 평균 (summaryQueue.js 기본값과 같음)

export default function AutoReportDialog({ run, onStart, onClose, onOpenSelect }) {
  const ONE_SHOT = reportLimit() // 이보다 많으면 서버가 나눠 쓰고 합침 (server/index.js MAX_REPORT_ARTICLES — 11/26 관리 페이지 「세부 설정」, 기본 10)
  const closeRef = useRef(null)
  useEffect(() => {
    closeRef.current?.focus()
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const { step, scope, result } = run
  const [off, setOff] = useState({}) // 확인 창에서 뺀 자료 { id: true }
  const [added, setAdded] = useState([]) // 빠진 말을 눌러 직접 더 넣은 자료 (11/26 조장)
  const [openTerm, setOpenTerm] = useState(null)
  const [allTerms, setAllTerms] = useState(false) // 위 고른 말 칩: 많으면 6개만 (11/26: 24개면 네 줄을 차지해 목록이 눌렸음)
  const [title, setTitle] = useState(`${scope.query} 동향 브리핑`)
  const [level, setLevel] = useState('owned')
  const [summarizeNew, setSummarizeNew] = useState(false) // 「보유 자료까지」에서만 고름. 「추가 자료 조사까지」는 늘 요약 (11/20)
  const summarizeOn = level === 'research' || summarizeNew
  const rows = [...(result?.picked ?? []), ...added.map((a) => ({ article: a, why: 'added' }))]
  const chosen = rows.filter((c) => !off[c.article.id])
  const full = chosen.length >= AUTO_PICK.max
  const needSummary = chosen.filter((c) => !c.article.hasSummary).length
  const split = chosen.length > ONE_SHOT
  const estMin = Math.max(1, Math.round((needSummary * SUMMARY_SEC + 60 * (split ? Math.ceil(chosen.length / 8) + 1 : 1)) / 60))
  // 고른 말 중 담긴 자료에 없는 말 — 지금 체크 기준으로 다시 셈
  const hitNow = new Set(chosen.flatMap((c) => c.article.scopeHits ?? []))
  const terms = result?.termInfo ?? []
  const missing = terms.filter((t) => (!hitNow.has(t.term) || t.term === openTerm) && t.count > 0) // 열어 둔 말은 넣은 뒤에도 남겨 둠
  const noData = terms.filter((t) => t.count === 0)
  const inRows = new Set(rows.map((c) => c.article.id))
  const termList = openTerm ? (result?.poolList ?? []).filter((a) => a.scopeHits?.includes(openTerm) && !inRows.has(a.id)).slice(0, 8) : []
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
              + {(allTerms ? scope.terms : scope.terms.slice(0, 6)).map((t) => (
                <span key={t} className="ar-term">
                  {t}
                </span>
              ))}
              {scope.terms.length > 6 && (
                <button type="button" className="link-btn" aria-expanded={allTerms} onClick={() => setAllTerms((v) => !v)}>
                  {allTerms ? '접기' : `외 ${scope.terms.length - 6}개`}
                </button>
              )}
            </>
          ) : (
            ' 만'
          )}
        </p>

        {/* 11/26 조장: 「5~10초」 글자만 있던 자리에 맵 기다릴 때와 같은 예상 시간 막대 */}
        {step === 'search' && (
          <div className="ar-wait" role="status">
            <p className="hint">고른 말이 든 자료를 찾는 중…</p>
            <EtaBar startedAt={run.startedAt} expect={10} slowNote="평소보다 오래 걸려요. 네이버 · 논문 응답을 기다리는 중일 수 있어요." />
          </div>
        )}
        {step === 'error' && <p className="form-error">{run.error}</p>}

        {step === 'confirm' && result && (
          <>
            <p className="ar-rule">
              자료 {result.pool}건(같은 이슈는 하나로) 중 <b>「중요」({result.rule.high}점 이상) {result.important}건</b>
              {result.important > AUTO_PICK.max
                ? ` — 많아서 점수 높은 ${AUTO_PICK.max}건만 넣어요 (보고서 한 편의 한도)`
                : result.important < AUTO_PICK.min
                  ? ` — 적어서 다음으로 점수 높은 자료로 ${AUTO_PICK.min}건까지 채웠어요 (자료가 너무 적으면 보고서가 얕아져요)`
                  : ' — 모두 넣었어요'}
              . 빼고 싶은 자료는 체크를 끄세요.
            </p>
            <ul className="ar-list">
              {rows.map((c) => {
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
            {/* 11/26 조장: 고른 말은 보장하지 않고 보여 준다 — 빠진 말을 누르면 그 말이 든 자료를 보고 더 넣는다 */}
            {terms.length > 0 && (
              <div className="ar-terms">
                <p className="ar-terms-head">
                  고른 말 {terms.length}개 중 <b>{terms.length - missing.length - noData.length}개</b>가 담긴 자료에 있어요
                  {missing.length > 0 && ' · 빠진 말을 누르면 그 말이 든 자료를 더 넣을 수 있어요'}
                </p>
                {missing.length > 0 && (
                  <div className="ar-term-chips" role="group" aria-label="담긴 자료에 없는 말">
                    {missing.map((t) => (
                      <button key={t.term} type="button" className={`ar-term-chip${openTerm === t.term ? ' is-open' : ''}`} aria-expanded={openTerm === t.term} onClick={() => setOpenTerm(openTerm === t.term ? null : t.term)}>
                        {t.term} <small>{t.count}</small>
                      </button>
                    ))}
                  </div>
                )}
                {noData.length > 0 && <p className="hint">찾은 자료에 없는 말: {noData.map((t) => t.term).join(', ')}</p>}
                {openTerm && (
                  <ul className="ar-list ar-term-list" aria-label={`「${openTerm}」이 든 자료`}>
                    {termList.length === 0 && <li className="hint ar-term-empty">더 넣을 자료가 없어요 (이미 모두 담겼어요)</li>}
                    {termList.map((a) => (
                      <li key={a.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={false}
                            disabled={full}
                            onChange={() => {
                              setAdded((list) => [...list, a])
                              setOff((m) => ({ ...m, [a.id]: false }))
                            }}
                          />
                          <span className="ar-main">
                            <span className="ar-title">{a.title}</span>
                            <span className="ar-meta">
                              {reasonOf(a)} · {a.source}
                              {a.hasSummary ? ' · 요약 있음' : ''}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                    {full && <li className="hint ar-term-empty">보고서 한 편에 {AUTO_PICK.max}건까지예요. 다른 자료의 체크를 빼면 넣을 수 있어요.</li>}
                  </ul>
                )}
              </div>
            )}
            <div className="ar-form">
              <label>
                보고서 제목
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
              </label>
              <Seg value={level} onChange={setLevel} label="자료 조사 수준" size="md" options={LEVELS.map(([value, label]) => ({ value, label }))} />
              {level === 'research' && <p className="pre-choice-note">새로 찾은 자료와 요약 안 된 보충 자료는 요약해서 써요 (한 건 약 40초 더).</p>}
              {level === 'owned' && (
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
                {chosen.length}건 · 요약 {needSummary}건 필요 · 약 {estMin}분 (요약 한 건 약 {SUMMARY_SEC}초 + 보고서 {split ? `${ONE_SHOT}건이 넘어 나눠 쓰고 합침` : '약 1분'})
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
            <p className="hint">이 창을 닫아도 계속돼요. 고른 자료는 선별에 「{run.tag}」 태그로 담았어요.</p>
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
