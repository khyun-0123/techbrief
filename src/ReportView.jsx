// 완성된 보고서 한 건을 보여 준다 (보고서 초안·보고서함 공용)
import { formatDate, SECTIONS } from './reportStore.js'

function ReportView({ saved, onRegenerate, regenKey, busy }) {
  const { report } = saved
  return (
    <div className="report-layout">
      <article className="panel report-doc">
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
                <button type="button" className="btn" onClick={() => onRegenerate(key)} disabled={busy}>
                  {regenKey === key ? '다시 쓰는 중…' : '다시 쓰기'}
                </button>
              )}
            </div>
            <ul className="report-bullets">
              {(report.sections[key]?.bullets ?? []).map((b) => (
                <li key={b.text}>
                  {b.text}
                  {b.refs.length > 0 ? (
                    b.refs.map((n) => (
                      <a key={n} className="report-ref" href={`#ref-${saved.id}-${n}`} title={saved.articles[n - 1]?.title}>
                        [{n}]
                      </a>
                    ))
                  ) : (
                    <span className="basis basis-ai_background" title="원래 기사 내용에서 확인되지 않은 문장">
                      근거 없음 · 확인 필요
                    </span>
                  )}
                  {b.han && <span className="basis basis-ai_background">한자 확인</span>}
                </li>
              ))}
            </ul>
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
