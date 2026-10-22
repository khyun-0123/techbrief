// ③ 보고서 초안 (데모) — 10 보고서 계획 3절
import { useEffect, useState } from 'react'
import { requestReport, requestReportSection } from './api.js'
import { load } from './utils.js'

const REPORT_KEY = 'techbrief-report' // 마지막 초안
const REPORT_AVG_KEY = 'techbrief-report-avg-ms'
const DEFAULT_REPORT_MS = 45_000 // 맥미니 qwen3:14b 실측 약 41초 (기사 3건)

const SECTIONS = [
  ['summary', '핵심 요약'],
  ['tech', '기술 개요'],
  ['industry', '업계 동향'],
  ['implications', '시사점'],
]
const PERIODS = { today: '오늘', week: '이번 주', month: '이번 달' }

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : ''
}

// 업무망 문서에 붙여 넣기 좋은 개조식 텍스트
function toPlainText(saved) {
  const { report, articles, createdAt } = saved
  const lines = [`${report.title} (${formatDate(createdAt)} · 기사 ${articles.length}건 기준)`, '']
  for (const [key, label] of SECTIONS) {
    lines.push(`■ ${label}`)
    for (const b of report.sections[key]?.bullets ?? []) {
      lines.push(` - ${b.text}${b.refs.length ? ` [${b.refs.join('][')}]` : ' (근거 확인 필요)'}`)
    }
    lines.push('')
  }
  lines.push('[근거 기사]')
  articles.forEach((a, i) => lines.push(`[${i + 1}] ${a.title} — ${a.source}${a.publishedAt ? `, ${formatDate(a.publishedAt)}` : ''}${a.url ? ` ${a.url}` : ''}`))
  return lines.join('\n')
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}

function ReportDraft({ articles, aiSummaries, queue, onGoSelect }) {
  const [title, setTitle] = useState('테크 동향 브리핑')
  const [period, setPeriod] = useState('today')
  const [saved, setSaved] = useState(() => load(REPORT_KEY, null))
  const [generating, setGenerating] = useState(null) // { startedAt } — 초안 전체 생성 중
  const [regenKey, setRegenKey] = useState(null) // 다시 쓰는 섹션
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [avgMs, setAvgMs] = useState(() => load(REPORT_AVG_KEY, DEFAULT_REPORT_MS))
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!generating) return undefined
    const timer = setInterval(() => setNow(Date.now()), 400)
    return () => clearInterval(timer)
  }, [generating])

  function save(next) {
    setSaved(next)
    localStorage.setItem(REPORT_KEY, JSON.stringify(next))
  }

  const missing = articles.filter((a) => !aiSummaries[a.id])
  const pending = missing.filter((a) => queue.jobs.some((j) => j.id === a.id && (j.status === 'queued' || j.status === 'running')))
  const canGenerate = articles.length > 0 && missing.length === 0 && !generating && !regenKey

  async function handleGenerate() {
    const startedAt = Date.now()
    setGenerating({ startedAt })
    setNow(startedAt)
    setError('')
    setNotice('')
    try {
      const result = await requestReport({ articles, aiSummaries, title, periodLabel: PERIODS[period] })
      save({
        report: result.report,
        model: result.model,
        createdAt: result.createdAt,
        periodLabel: PERIODS[period],
        articles: articles.map(({ title: t, source, url, publishedAt }) => ({ title: t, source, url, publishedAt })),
        // 섹션 다시 쓰기에 쓰려고 생성할 때의 기사를 같이 둔다
        inputs: articles,
      })
      const took = Date.now() - startedAt
      const avg = Math.round(avgMs * 0.6 + took * 0.4)
      setAvgMs(avg)
      localStorage.setItem(REPORT_AVG_KEY, JSON.stringify(avg))
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(null)
    }
  }

  async function handleRegenerate(key) {
    if (!saved) return
    setRegenKey(key)
    setError('')
    try {
      const inputs = saved.inputs ?? articles
      const result = await requestReportSection({ articles: inputs, aiSummaries, key, report: saved.report })
      const report = { ...saved.report, sections: { ...saved.report.sections, [key]: { bullets: result.bullets } } }
      save({ ...saved, report })
    } catch (err) {
      setError(err.message)
    } finally {
      setRegenKey(null)
    }
  }

  async function handleCopy() {
    await copyText(toPlainText(saved))
    setNotice('개조식 텍스트를 복사했어요. 업무 문서에 붙여 넣으세요.')
  }

  const progress = generating ? Math.min(95, Math.round(((now - generating.startedAt) / avgMs) * 100)) : 0
  const report = saved?.report

  return (
    <main className="page">
      <header className="page-header">
        <h1>보고서 초안</h1>
        <p>보고서에 포함한 기사의 AI 요약으로 1페이지 개조식 초안을 만들어요. 데모 단계예요.</p>
      </header>

      <section className="panel report-settings">
        <label>
          <span>보고서 제목</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          <span>기간</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {Object.entries(PERIODS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="report-settings-actions">
          <button type="button" className="btn primary" onClick={handleGenerate} disabled={!canGenerate}>
            {generating ? '초안 만드는 중…' : report ? '초안 새로 만들기' : '초안 생성'}
          </button>
          <button type="button" className="btn" onClick={handleCopy} disabled={!report || Boolean(generating)}>
            텍스트 복사
          </button>
        </div>
      </section>

      {articles.length === 0 ? (
        <section className="panel select-empty">
          <p className="empty">보고서에 포함한 기사가 없어요. 선별·요약에서 「보고서에 포함」을 눌러 주세요.</p>
          <button type="button" className="btn primary" onClick={onGoSelect}>
            선별·요약으로 가기
          </button>
        </section>
      ) : (
        missing.length > 0 && (
          <p className="report-notice">
            AI 요약이 아직 없는 기사가 {missing.length}건 있어요
            {pending.length > 0 ? ` (${pending.length}건 요약 중 — 진행 창 참고)` : ''}. 요약이 끝나야 초안을 만들 수 있어요.{' '}
            {pending.length < missing.length && (
              <button type="button" className="btn" onClick={() => missing.forEach((a) => queue.enqueue(a))}>
                남은 기사 요약하기
              </button>
            )}
          </p>
        )
      )}

      {generating && (
        <div className="report-progress">
          <div className="gauge gauge-running">
            <div className="gauge-fill" style={{ width: `${progress}%` }} />
          </div>
          <span>초안 만드는 중 {progress}% (예상, 약 {Math.round(avgMs / 1000)}초 걸려요)</span>
        </div>
      )}
      {error && <p className="ai-error">{error}</p>}
      {notice && <p className="report-copied">{notice}</p>}

      {report && (
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
                  <button
                    type="button"
                    className="btn"
                    onClick={() => handleRegenerate(key)}
                    disabled={Boolean(generating) || Boolean(regenKey)}
                  >
                    {regenKey === key ? '다시 쓰는 중…' : '다시 쓰기'}
                  </button>
                </div>
                <ul className="report-bullets">
                  {(report.sections[key]?.bullets ?? []).map((b) => (
                    <li key={b.text}>
                      {b.text}
                      {b.refs.length > 0 ? (
                        b.refs.map((n) => (
                          <a key={n} className="report-ref" href={`#ref-${n}`} title={saved.articles[n - 1]?.title}>
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

            <p className="hint">
              AI가 만든 초안이에요. 근거 기사를 확인하고 고쳐 쓰세요. · 모델 {saved.model}
            </p>
          </article>

          <aside className="panel report-refs">
            <h3>근거 기사</h3>
            <ol>
              {saved.articles.map((a, i) => (
                <li key={a.title} id={`ref-${i + 1}`}>
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
      )}
    </main>
  )
}

export default ReportDraft
