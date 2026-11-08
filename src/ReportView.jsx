// 완성된 보고서 한 건을 보여 준다 (선별·요약 오른쪽 · 보고서함 공용)
// 11/08 조장 요청
// - 줄 빼기: 줄마다 끝에 작은 「빼기」. 뺀 줄은 섹션 아래 「뺀 줄 N개」에 접혀 들어가고 「되살리기」로 돌린다
//   (체크박스를 줄마다 두면 정신없어서). 뺀 줄은 복사 · PDF · PPT에서 빠진다
// - AI 해설 보충은 보고서를 만들 때 대기열에서 자동으로 한다(자료 조사 수준). 보충한 줄은 「근거 보충」 표시
import { useState } from 'react'
import { exportPptx, printReport } from './reportExport.js'
import { formatDate, kindOf, SECTIONS } from './reportStore.js'
import { track } from './usage.js'

const SUPPLEMENT_LABEL = { data: '우리 자료', wiki: '위키백과', 'data+wiki': '우리 자료 · 위키백과' }

// tools: 보고서 맨 위 오른쪽 도구 줄 (복사·지우기 등) · onChange(entry): 고친 보고서 저장 (없으면 보기만)
// stacked: 좁은 칸(선별·요약 오른쪽)에서는 근거 목록을 보고서 아래에
function ReportView({ saved, onRegenerate, regenKey, busy, tools, onChange, stacked = false }) {
  const { report } = saved
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const editable = Boolean(onChange)
  const baseCount = saved.articles.filter((a) => !a.supplement).length

  async function handlePptx() {
    setExporting(true)
    setExportError('')
    try {
      await exportPptx(saved)
      track('export', 'ppt')
    } catch (err) {
      setExportError(`PPT를 만들지 못했어요: ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  function patchBullet(entry, key, index, patch) {
    const bullets = (entry.report.sections[key]?.bullets ?? []).map((b, i) => (i === index ? { ...b, ...patch } : b))
    return { ...entry, report: { ...entry.report, sections: { ...entry.report.sections, [key]: { bullets } } } }
  }

  function toggleExclude(key, index, excluded) {
    onChange(patchBullet(saved, key, index, { excluded }))
  }

  const working = busy

  function lineTools(key, i, b) {
    if (!editable) return null
    return (
      <span className="line-tools">
        <button type="button" className="line-btn line-remove" onClick={() => toggleExclude(key, i, true)} disabled={working} aria-label={`「${b.text.slice(0, 20)}…」 줄 빼기`} title="이 줄을 보고서에서 빼요 (아래 「뺀 줄」에서 되살릴 수 있어요)">
          빼기
        </button>
      </span>
    )
  }

  return (
    <div className={stacked ? 'report-layout stacked' : 'report-layout'}>
      <article className={stacked ? 'report-doc' : 'panel report-doc'}>
        <div className="report-toolbar">
          {exportError && <span className="toolbar-error">{exportError}</span>}
          {tools}
          {stacked ? (
            <details className="export-menu">
              <summary className="btn">내보내기 ▾</summary>
              <div className="export-menu-pop">
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.closest('details').open = false
                    track('export', 'pdf')
                    printReport()
                  }}
                >
                  PDF로 저장
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.closest('details').open = false
                    handlePptx()
                  }}
                  disabled={exporting}
                >
                  {exporting ? 'PPT 만드는 중…' : 'PPT로 저장'}
                </button>
              </div>
            </details>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  track('export', 'pdf')
                  printReport()
                }}
                title="인쇄 창에서 'PDF로 저장'을 고르세요"
              >
                PDF로 저장
              </button>
              <button type="button" className="btn" onClick={handlePptx} disabled={exporting}>
                {exporting ? 'PPT 만드는 중…' : 'PPT로 저장'}
              </button>
            </>
          )}
        </div>
        <header className="report-doc-head">
          <h2>{report.title}</h2>
          <span>
            {formatDate(saved.createdAt)} · {saved.periodLabel} · 기사 {baseCount}건 기준
            {saved.articles.length > baseCount && ` · 보충 자료 ${saved.articles.length - baseCount}건`}
          </span>
        </header>
        {report.direction && <p className="report-direction">방향: {report.direction}</p>}

        {report.warnings?.length > 0 &&
          (stacked ? (
            <details className="report-warnings-fold">
              <summary>확인할 점 {report.warnings.length}개</summary>
              <ul className="report-warnings">
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          ) : (
            <div className="report-warnings">
              <p className="report-warnings-title">확인할 점 {report.warnings.length}개</p>
              <ul>
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ))}

        {/* AI 해설 안내는 보고서마다 한 번만 (11/09 디자인 정리, 28 문서 4장). 섹션에는 짧은 표시만 */}
        {SECTIONS.some(([key]) => (report.sections[key]?.bullets ?? []).some((b) => !b.excluded && kindOf(b) === 'ai')) && (
          <p className="report-ai-notice">
            <span className="report-ai-chip">AI 해설·제안</span> 표시가 붙은 줄은 기사에서 확인된 내용이 아니에요. 확인한 뒤에 쓰세요.
          </p>
        )}

        {SECTIONS.map(([key, label]) => {
          const list = (report.sections[key]?.bullets ?? []).map((b, i) => ({ b, i }))
          const facts = list.filter(({ b }) => !b.excluded && kindOf(b) === 'fact')
          const ai = list.filter(({ b }) => !b.excluded && kindOf(b) === 'ai')
          const out = list.filter(({ b }) => b.excluded)
          return (
            <section key={key} className="report-section">
              <div className="report-section-head">
                <h3>{label}</h3>
                {onRegenerate && (
                  <button type="button" className="btn-text" onClick={() => onRegenerate(key)} disabled={working}>
                    {regenKey === key ? '다시 쓰는 중…' : '다시 쓰기'}
                  </button>
                )}
              </div>
              {/* 기사에서 확인된 내용과 AI 해설·제안을 섞지 않고 나눠 보여 준다 (15 문서 F15) */}
              {facts.length > 0 && (
                <ul className="report-bullets">
                  {facts.map(({ b, i }) => (
                    <li key={i}>
                      <span className="line-text">
                        {b.text}
                        {b.refs.map((n) => (
                          <a key={n} className="report-ref" href={`#ref-${saved.id}-${n}`} title={saved.articles[n - 1]?.title}>
                            [{n}]
                          </a>
                        ))}
                        {b.supplement && (
                          <span className="basis basis-supplement" title={b.original ? `원래 AI 해설: ${b.original}` : undefined}>
                            근거 보충 · {SUPPLEMENT_LABEL[b.supplement] ?? b.supplement}
                          </span>
                        )}
                        {b.han && <span className="basis basis-ai_background">한자 확인</span>}
                      </span>
                      {lineTools(key, i, b)}
                    </li>
                  ))}
                </ul>
              )}
              {ai.length > 0 && (
                <div className="report-ai">
                  <p className="report-ai-label">AI 해설·제안</p>
                  <ul className="report-bullets">
                    {ai.map(({ b, i }) => (
                      <li key={i}>
                        <span className="line-text">
                          {b.text}
                          {b.noRef && <span className="basis basis-noref">근거 못 찾음{b.noRef.tried ? ` (자료 ${b.noRef.tried}건 확인)` : ''}</span>}
                          {b.han && <span className="basis basis-ai_background">한자 확인</span>}
                        </span>
                        {lineTools(key, i, b)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {facts.length === 0 && ai.length === 0 && <p className="hint">내용 없음</p>}
              {out.length > 0 && (
                <details className="excluded-lines">
                  <summary>뺀 줄 {out.length}개</summary>
                  <ul>
                    {out.map(({ b, i }) => (
                      <li key={i}>
                        <s>{b.text}</s>
                        {editable && (
                          <button type="button" className="line-btn" onClick={() => toggleExclude(key, i, false)} disabled={working}>
                            되살리기
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )
        })}

        <p className="hint">AI가 만든 초안이에요. 근거 기사를 확인하고 고쳐 쓰세요. · 모델 {saved.model}</p>
      </article>

      {stacked ? (
        <details className="report-refs report-refs-fold">
          <summary>근거 기사 {saved.articles.length}건</summary>
        <ol>
          {saved.articles.map((a, i) => (
            <li key={`${i}-${a.title}`} id={`ref-${saved.id}-${i + 1}`}>
              <span className="report-ref-num">[{i + 1}]</span>
              <div>
                <div className="title">
                  {a.supplement && <span className="basis basis-supplement">보충 · {a.supplement === 'wiki' ? '위키백과' : '우리 자료'}</span>} {a.title}
                </div>
                <div className="meta">
                  {a.source}
                  {a.publishedAt && ` · ${formatDate(a.publishedAt)}`}
                  {a.fulltext === true && <span className="fulltext-badge on"> · 원문 반영</span>}
                  {a.fulltext === false && (
                    <span className="fulltext-badge off" title="원문 페이지에서 본문을 가져오지 못해 네이버 발췌문으로 썼어요">
                      {' '}
                      · 발췌문으로 작성
                    </span>
                  )}
                </div>
                {a.url && (
                  <a href={a.url} target="_blank" rel="noreferrer">
                    원문 열기 ↗
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
        </details>
      ) : (
        <aside className="panel report-refs">
          <h3>근거 기사</h3>
        <ol>
          {saved.articles.map((a, i) => (
            <li key={`${i}-${a.title}`} id={`ref-${saved.id}-${i + 1}`}>
              <span className="report-ref-num">[{i + 1}]</span>
              <div>
                <div className="title">
                  {a.supplement && <span className="basis basis-supplement">보충 · {a.supplement === 'wiki' ? '위키백과' : '우리 자료'}</span>} {a.title}
                </div>
                <div className="meta">
                  {a.source}
                  {a.publishedAt && ` · ${formatDate(a.publishedAt)}`}
                  {a.fulltext === true && <span className="fulltext-badge on"> · 원문 반영</span>}
                  {a.fulltext === false && (
                    <span className="fulltext-badge off" title="원문 페이지에서 본문을 가져오지 못해 네이버 발췌문으로 썼어요">
                      {' '}
                      · 발췌문으로 작성
                    </span>
                  )}
                </div>
                {a.url && (
                  <a href={a.url} target="_blank" rel="noreferrer">
                    원문 열기 ↗
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
        </aside>
      )}
    </div>
  )
}

export default ReportView
