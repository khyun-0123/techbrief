// 보고서 작성 칸 (11/08 조장: 「보고서 초안」 탭을 없애고 선별·요약 오른쪽으로 옮김)
// 사람이 주는 것 두 가지: ① 보고서 제목 ② 보고서 방향(주제 · 담아야 할 방향 한 줄 — AI 지시문에 들어감)
// 만들기 전: 체크한 기사 목록(요약 상태) / 만든 뒤: 보고서 미리보기(줄 빼기 · AI 보충 근거 찾기 · 다시 쓰기 · 내보내기)
// 만든 보고서는 보고서함에 저장되고, 마지막 보고서는 탭을 옮겨도 이 칸에 남는다
import { useEffect, useState } from 'react'
import { requestReport, requestReportSection } from './api.js'
import { articleKey, copyText, toPlainText } from './reportStore.js'
import { track } from './usage.js'
import { AI_BLOCKED_TITLE, useOps } from './ops.js'
import ReportView from './ReportView.jsx'
import { load } from './utils.js'

const REPORT_AVG_KEY = 'techbrief-report-avg-ms-v2'
const LAST_REPORT_KEY = 'techbrief-last-report' // 이 칸에 보여 줄 마지막 보고서 id
const DRAFT_INPUT_KEY = 'techbrief-report-input' // 제목 · 방향 · 기간 (쓰던 것 남기기)
const DEFAULT_REPORT_MS = 90_000
const PERIODS = { today: '오늘', week: '이번 주', month: '이번 달' }

// 한 번에 넣는 기사 수 (서버 MAX_REPORT_ARTICLES와 같음). 넘으면 고르게 한다 (21 문서 6-3)
const REPORT_LIMIT = 10
const REPORT_MAX_ALL = 40
const REPORT_CHUNK = 8
const chunkCalls = (n) => Math.ceil(n / REPORT_CHUNK) + 1

function topByImportance(articles, limit) {
  const keep = new Set(
    [...articles]
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || (a.hoursAgo ?? 0) - (b.hoursAgo ?? 0))
      .slice(0, limit)
      .map((a) => a.id),
  )
  return articles.filter((a) => keep.has(a.id))
}

function minutes(ms) {
  const m = Math.round(ms / 60_000)
  return m < 1 ? '1분 안' : `약 ${m}분`
}

function ReportComposer({ articles: picked, aiSummaries, queue, reports, onSaved, onUpdated, onGoArchive, storageLabel, folderSummary }) {
  const [saved0] = useState(() => load(DRAFT_INPUT_KEY, {}))
  const [title, setTitle] = useState(saved0.title ?? '테크 동향 브리핑')
  const [direction, setDirection] = useState(saved0.direction ?? '')
  const [period, setPeriod] = useState(saved0.period ?? 'today')
  const [generating, setGenerating] = useState(null)
  const [lastId, setLastId] = useState(() => load(LAST_REPORT_KEY, null))
  const [regenKey, setRegenKey] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [avgMs, setAvgMs] = useState(() => load(REPORT_AVG_KEY, DEFAULT_REPORT_MS))
  const [now, setNow] = useState(() => Date.now())
  const [mode, setMode] = useState('top')
  const [composing, setComposing] = useState(false) // 보고서가 있어도 새로 만들기 칸을 열었는지
  const { aiBlocked } = useOps()

  useEffect(() => {
    localStorage.setItem(DRAFT_INPUT_KEY, JSON.stringify({ title, direction, period }))
  }, [title, direction, period])

  useEffect(() => {
    localStorage.setItem(LAST_REPORT_KEY, JSON.stringify(lastId))
  }, [lastId])

  const tooMany = picked.length > REPORT_LIMIT
  const overMax = picked.length > REPORT_MAX_ALL
  const useAll = tooMany && mode === 'all' && !overMax
  const articles = tooMany && !useAll ? topByImportance(picked, REPORT_LIMIT) : picked
  const leftOut = tooMany && !useAll ? picked.filter((a) => !articles.includes(a)) : []
  const expectMs = useAll ? avgMs * chunkCalls(articles.length) : avgMs

  useEffect(() => {
    if (!generating) return undefined
    const timer = setInterval(() => setNow(Date.now()), 400)
    return () => clearInterval(timer)
  }, [generating])

  const key = articleKey(picked.map((a) => a.id))
  const current = reports.find((r) => r.id === lastId)
  const changed = current && current.articleKey !== key // 보고서를 만든 뒤 체크한 기사가 바뀜
  const showReport = current && !composing && !generating

  const missing = articles.filter((a) => !aiSummaries[a.id])
  const jobOf = (id) => queue.jobs.find((j) => j.id === id)
  const pending = missing.filter((a) => ['queued', 'running'].includes(jobOf(a.id)?.status))
  const canGenerate = articles.length > 0 && missing.length === 0 && !generating && !aiBlocked && !(tooMany && mode === 'all' && overMax)

  async function handleGenerate() {
    const startedAt = Date.now()
    setGenerating({ startedAt })
    setNow(startedAt)
    setError('')
    setNotice('')
    try {
      const { entry } = await requestReport({ articles, aiSummaries, title, direction, periodLabel: PERIODS[period], mode: useAll ? 'all' : undefined })
      track('report')
      entry.articleKey = key
      onSaved(entry)
      setLastId(entry.id)
      setComposing(false)
      const took = (Date.now() - startedAt) / (useAll ? chunkCalls(articles.length) : 1)
      const avg = Math.round(avgMs * 0.6 + took * 0.4)
      setAvgMs(avg)
      localStorage.setItem(REPORT_AVG_KEY, JSON.stringify(avg))
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(null)
    }
  }

  async function handleRegenerate(sectionKey) {
    setRegenKey(sectionKey)
    setError('')
    try {
      const inputs = current.inputs ?? articles
      const summaries = Object.fromEntries(inputs.map((a) => [a.id, a.summary ? { summary: a.summary } : aiSummaries[a.id]]))
      const result = await requestReportSection({ articles: inputs, aiSummaries: summaries, key: sectionKey, report: current.report, reportId: current.id })
      const report = { ...current.report, sections: { ...current.report.sections, [sectionKey]: { bullets: result.bullets } } }
      onUpdated({ ...current, report })
    } catch (err) {
      setError(err.message)
    } finally {
      setRegenKey(null)
    }
  }

  async function handleCopy() {
    await copyText(toPlainText(current))
    track('export', 'copy')
    setNotice('복사했어요. 업무 문서에 붙여 넣으세요.')
  }

  const progress = generating ? Math.min(95, Math.round(((now - generating.startedAt) / expectMs) * 100)) : 0

  if (showReport) {
    return (
      <section className="composer">
        <div className="composer-head">
          <div>
            <h2>보고서 미리보기</h2>
            <p className="saved-note">
              ✓ 보고서함에 저장됨 ({storageLabel}) ·{' '}
              <button type="button" className="link-btn" onClick={onGoArchive}>
                보고서함 보기
              </button>
            </p>
          </div>
          <button type="button" className="btn" onClick={() => setComposing(true)} disabled={Boolean(regenKey)}>
            새 보고서 만들기
          </button>
        </div>
        {changed && (
          <p className="report-notice">
            이 보고서를 만든 뒤 체크한 기사가 바뀌었어요. 바뀐 기사로 쓰려면 「새 보고서 만들기」를 누르세요.
          </p>
        )}
        {error && <p className="ai-error">{error}</p>}
        <ReportView
          saved={current}
          stacked
          onChange={onUpdated}
          onRegenerate={aiBlocked ? undefined : handleRegenerate}
          regenKey={regenKey}
          busy={Boolean(regenKey)}
          tools={
            <>
              {notice && <span className="toolbar-note">{notice}</span>}
              <button type="button" className="btn primary" onClick={handleCopy}>
                텍스트 복사
              </button>
            </>
          }
        />
      </section>
    )
  }

  return (
    <section className="composer">
      <div className="composer-head">
        <div>
          <h2>보고서 만들기</h2>
          <p className="hint">
            체크한 기사 {picked.length}건{leftOut.length > 0 ? ` 중 중요도 높은 ${articles.length}건` : ''}으로 개조식 보고서 한 편을 만들어요.
            {folderSummary && ` 폴더: ${folderSummary}`}
          </p>
        </div>
        {current && (
          <button type="button" className="btn" onClick={() => setComposing(false)} disabled={Boolean(generating)}>
            지난 보고서 보기
          </button>
        )}
      </div>

      <div className="panel composer-form">
        <label>
          <span>① 보고서 제목</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={Boolean(generating)} maxLength={80} />
        </label>
        <label>
          <span>
            ② 보고서 방향 <small>주제 · 꼭 담을 방향을 한 줄로. AI가 이 방향으로 내용을 고르고 순서를 정해요</small>
          </span>
          <input
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            placeholder="예: WOLED 관점에서 마이크로LED가 위협이 되는 시점과 대응 방향 위주로"
            disabled={Boolean(generating)}
            maxLength={300}
          />
        </label>
        <label className="composer-period">
          <span>기간</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} disabled={Boolean(generating)}>
            {Object.entries(PERIODS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {tooMany && (
          <div className="report-mode-choices" role="radiogroup" aria-label="기사가 많을 때">
            <button type="button" role="radio" aria-checked={mode === 'top'} className="report-mode-choice" onClick={() => setMode('top')} disabled={Boolean(generating)}>
              <strong>중요도 높은 {REPORT_LIMIT}건으로</strong>
              <span>빠름 · {minutes(avgMs)}. 나머지 {picked.length - REPORT_LIMIT}건은 빠져요.</span>
            </button>
            <button type="button" role="radio" aria-checked={mode === 'all'} className="report-mode-choice" onClick={() => setMode('all')} disabled={Boolean(generating) || overMax}>
              <strong>{picked.length}건 모두</strong>
              <span>{overMax ? `한 번에 ${REPORT_MAX_ALL}건까지만 돼요.` : `오래 걸림 · ${minutes(avgMs * chunkCalls(picked.length))}`}</span>
            </button>
          </div>
        )}

        {missing.length > 0 && picked.length > 0 && (
          <p className="report-notice">
            AI 요약이 아직 없는 기사가 {missing.length}건 있어요{pending.length > 0 ? ` (${pending.length}건 요약 중)` : ''}. 요약이 끝나면 만들 수 있어요.{' '}
            {pending.length < missing.length && (
              <button type="button" className="btn" onClick={() => missing.forEach((a) => queue.enqueue(a))} disabled={aiBlocked} title={aiBlocked ? AI_BLOCKED_TITLE : undefined}>
                남은 기사 요약하기
              </button>
            )}
          </p>
        )}

        <button type="button" className="btn primary composer-go" onClick={handleGenerate} disabled={!canGenerate} title={aiBlocked ? AI_BLOCKED_TITLE : picked.length === 0 ? '왼쪽에서 보고서에 넣을 기사를 체크하세요' : undefined}>
          {generating ? '초안 만드는 중…' : '보고서 초안 만들기'}
        </button>
        {generating && (
          <div className="report-progress">
            <div className="gauge gauge-running">
              <div className="gauge-fill" style={{ width: `${progress}%` }} />
            </div>
            <span>
              {useAll ? `${Math.ceil(articles.length / REPORT_CHUNK)}번 나눠 쓰고 합치는 중 ${progress}% (예상 ${minutes(expectMs)})` : `원문을 읽고 쓰는 중 ${progress}% (예상 약 ${Math.round(expectMs / 1000)}초)`}
            </span>
          </div>
        )}
        {error && <p className="ai-error">{error}</p>}
      </div>

      <div className="panel composer-list">
        <h3>담길 기사 {articles.length}건</h3>
        {picked.length === 0 ? (
          <p className="hint">왼쪽 목록에서 보고서에 넣을 기사를 체크하세요. 여러 폴더의 기사를 함께 넣을 수 있어요.</p>
        ) : (
          <ol>
            {articles.map((a, i) => {
              const job = jobOf(a.id)
              const state = aiSummaries[a.id] ? '요약 완료' : job?.status === 'running' ? `요약 중 ${queue.progressOf(job)}%` : job?.status === 'queued' ? '요약 대기' : '요약 없음'
              return (
                <li key={a.id}>
                  <span className="report-ref-num">[{i + 1}]</span>
                  <div>
                    <div className="title">{a.title}</div>
                    <div className="meta">
                      {a.source} · <span className={aiSummaries[a.id] ? 'summary-state done' : 'summary-state running'}>{state}</span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {leftOut.length > 0 && <p className="hint">이번 초안에서 빠지는 기사 {leftOut.length}건 (중요도 낮은 순)</p>}
      </div>
    </section>
  )
}

export default ReportComposer
