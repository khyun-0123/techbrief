// 완성된 보고서 한 건을 보여 준다 (보고서 초안·보고서함 공용)
import { useState } from 'react'
import { exportPptx, printReport } from './reportExport.js'
import { formatDate, kindOf, SECTIONS } from './reportStore.js'

// tools: 보고서 맨 위 오른쪽 도구 줄 (복사·지우기 등)
function ReportView({ saved, onRegenerate, regenKey, busy, tools }) {
  const { report } = saved
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  async function handlePptx() {
    setExporting(true)
    setExportError('')
    try {
      await exportPptx(saved)
    } catch (err) {
      setExportError(`PPT를 만들지 못했어요: ${err.message}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="report-layout">
      <article className="panel report-doc">
        <div className="report-toolbar">
          {exportError && <span className="toolbar-error">{exportError}</span>}
          <button type="button" className="btn" onClick={printReport} title="인쇄 창에서 'PDF로 저장'을 고르세요">
            PDF로 저장
          </button>
          <button type="button" className="btn" onClick={handlePptx} disabled={exporting}>
            {exporting ? 'PPT 만드는 중…' : 'PPT로 저장'}
          </button>
          {tools}
        </div>
        <header className="report-doc-head">
          <h2>{report.title}</h2>
          <span>
            {formatDate(saved.createdAt)} · {saved.periodLabel} · 기사 {saved.articles.length}건 기준
          </span>
        </header>

        {report.warnings?.length > 0 && (
          <ul className="report-warnings">
            {report.warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}

        {SECTIONS.map(([key, label]) => (
          <section key={key} className="report-section">
            <div className="report-section-head">
              <h3>■ {label}</h3>
              {onRegenerate && (
                <button type="button" className="btn-text" onClick={() => onRegenerate(key)} disabled={busy}>
                  {regenKey === key ? '다시 쓰는 중…' : '다시 쓰기'}
                </button>
              )}
            </div>
            {/* 기사에서 확인된 내용과 AI 해설·제안을 섞지 않고 나눠 보여 준다 (15 문서 F15) */}
            {(() => {
              const list = report.sections[key]?.bullets ?? []
              const facts = list.filter((b) => kindOf(b) === 'fact')
              const ai = list.filter((b) => kindOf(b) === 'ai')
              return (
                <>
                  {facts.length > 0 && (
                    <ul className="report-bullets">
                      {facts.map((b) => (
                        <li key={b.text}>
                          {b.text}
                          {b.refs.map((n) => (
                            <a key={n} className="report-ref" href={`#ref-${saved.id}-${n}`} title={saved.articles[n - 1]?.title}>
                              [{n}]
                            </a>
                          ))}
                          {b.han && <span className="basis basis-ai_background">한자 확인</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {ai.length > 0 && (
                    <div className="report-ai">
                      <p className="report-ai-label">AI 해설·제안 · 기사에서 확인된 내용이 아니에요, 확인 후 쓰세요</p>
                      <ul className="report-bullets">
                        {ai.map((b) => (
                          <li key={b.text}>
                            {b.text}
                            {b.han && <span className="basis basis-ai_background">한자 확인</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {facts.length === 0 && ai.length === 0 && <p className="hint">내용 없음</p>}
                </>
              )
            })()}
          </section>
        ))}

        <p className="hint">AI가 만든 초안이에요. 근거 기사를 확인하고 고쳐 쓰세요. · 모델 {saved.model}</p>
      </article>

      <aside className="panel report-refs">
        <h3>근거 기사</h3>
        <ol>
          {saved.articles.map((a, i) => (
            <li key={a.title} id={`ref-${saved.id}-${i + 1}`}>
              <span className="report-ref-num">[{i + 1}]</span>
              <div>
                <div className="title">{a.title}</div>
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
    </div>
  )
}

export default ReportView
