// ③ 보고서 초안 — 선별·요약에서 체크한 기사로 새 보고서를 만든다 (10 보고서 계획 3절)
// 만들기 전: 담길 기사와 섹션별 재료 미리보기 / 생성 중: 섹션별 진행 표시 / 생성 직후: 결과 (보고서함에 저장)
import { useEffect, useState } from 'react'
import { requestReport, requestReportSection } from './api.js'
import { articleKey, copyText, SECTIONS, toPlainText } from './reportStore.js'
import { track } from './usage.js'
import { AI_BLOCKED_TITLE, useOps } from './ops.js'
import ReportView from './ReportView.jsx'
import { load } from './utils.js'

const REPORT_AVG_KEY = 'techbrief-report-avg-ms-v2' // 원문 반영 뒤 소요 시간이 달라져 새로 잰다
const DEFAULT_REPORT_MS = 90_000 // 원문 본문을 읽고 쓰므로 실측 약 1분 30초 (기사 3건, 맥미니)
const PERIODS = { today: '오늘', week: '이번 주', month: '이번 달' }

// 한 번에 넣는 기사 수 (서버 MAX_REPORT_ARTICLES와 같음). 넘으면 고르게 한다 (21 문서 6-3)
const REPORT_LIMIT = 10
const REPORT_MAX_ALL = 40 // 서버 MAX_REPORT_ALL
const REPORT_CHUNK = 8 // 서버 REPORT_CHUNK: 「전부」는 이만큼씩 나눠 쓰고 마지막에 합친다
const chunkCalls = (n) => Math.ceil(n / REPORT_CHUNK) + 1

// 중요도 높은 limit건 (고른 순서는 유지해 화면 번호가 크게 바뀌지 않게)
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

// 섹션마다 어떤 요약 항목이 재료가 되는지 (서버 reportPrompts.js와 같은 구성)
const SECTION_PLAN = {
  summary: { desc: '경영진이 가장 먼저 알아야 할 내용, 3줄 이내', items: [] },
  tech: { desc: '어떤 기술이고 어떤 원리인지', items: [['concept', '컨셉'], ['principle', '원리']] },
  industry: { desc: '타사의 개발·활용 현황과 장단점', items: [['competitors', '타사 현황'], ['pros_cons', '장단점']] },
  implications: { desc: '우리 회사 활용 방안과 기대 효과', items: [['application', '활용 방안'], ['effect', '효과성']] },
}
const BASIS_SHORT = { article: '기사 근거', ai_background: 'AI 보충', ai_suggestion: 'AI 제안' }

function ReportDraft({ articles: picked, aiSummaries, queue, reports, onSaved, onUpdated, onGoSelect, onGoArchive, storageLabel }) {
  const [title, setTitle] = useState('테크 동향 브리핑')
  const [period, setPeriod] = useState('today')
  const [generating, setGenerating] = useState(null) // { startedAt }
  const [lastId, setLastId] = useState(null) // 이 화면에서 방금 만든 보고서
  const [regenKey, setRegenKey] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [avgMs, setAvgMs] = useState(() => load(REPORT_AVG_KEY, DEFAULT_REPORT_MS))
  const [now, setNow] = useState(() => Date.now())
  const [mode, setMode] = useState('top') // 10건 초과일 때: top = 중요도 높은 10건 / all = 전부

  const tooMany = picked.length > REPORT_LIMIT
  const overMax = picked.length > REPORT_MAX_ALL
  const useAll = tooMany && mode === 'all' && !overMax
  // 이번 초안에 실제로 들어가는 기사 (번호 [n]도 이 순서)
  const articles = tooMany && !useAll ? topByImportance(picked, REPORT_LIMIT) : picked
  const leftOut = tooMany && !useAll ? picked.filter((a) => !articles.includes(a)) : []
  const expectMs = useAll ? avgMs * chunkCalls(articles.length) : avgMs

  useEffect(() => {
    if (!generating) return undefined
    const timer = setInterval(() => setNow(Date.now()), 400)
    return () => clearInterval(timer)
  }, [generating])

  const key = articleKey(picked.map((a) => a.id))
  // 방금 만든 보고서가 지금 체크한 기사와 같을 때만 결과를 보여 준다. 기사를 바꾸면 다시 '만들기 전' 화면
  const current = reports.find((r) => r.id === lastId && r.articleKey === key)

  const missing = articles.filter((a) => !aiSummaries[a.id])
  const jobOf = (id) => queue.jobs.find((j) => j.id === id)
  const pending = missing.filter((a) => ['queued', 'running'].includes(jobOf(a.id)?.status))
  const { aiBlocked } = useOps() // 운영 상태 「AI 기능 정지」 (19 문서 6장)
  const canGenerate = articles.length > 0 && missing.length === 0 && !generating && !aiBlocked && !(tooMany && mode === 'all' && overMax)

  async function handleGenerate() {
    const startedAt = Date.now()
    setGenerating({ startedAt })
    setNow(startedAt)
    setError('')
    setNotice('')
    try {
      // 서버가 보고서함 한 건(entry)을 만들어 준다. DB가 있으면 서버에 이미 저장됨
      const { entry } = await requestReport({ articles, aiSummaries, title, periodLabel: PERIODS[period], mode: useAll ? 'all' : undefined })
      track('report')
      entry.articleKey = key
      onSaved(entry)
      setLastId(entry.id)
      // 평균은 AI 한 번 부른 시간으로 잰다 (「전부」는 나눠 부른 횟수로 나눔)
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
      // inputs에는 생성할 때의 요약이 들어 있다 (summary). 없으면 지금 요약을 쓴다
      const inputs = current.inputs ?? articles
      const summaries = Object.fromEntries(inputs.map((a) => [a.id, a.summary ? { summary: a.summary } : aiSummaries[a.id]]))
      const result = await requestReportSection({
        articles: inputs,
        aiSummaries: summaries,
        key: sectionKey,
        report: current.report,
        reportId: current.id,
      })
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
    setNotice('개조식 텍스트를 복사했어요. 업무 문서에 붙여 넣으세요.')
  }

  const progress = generating ? Math.min(95, Math.round(((now - generating.startedAt) / expectMs) * 100)) : 0

  if (picked.length === 0) {
    return (
      <main className="page">
        <header className="page-header">
          <h1>보고서 초안</h1>
          <p>선별·요약에서 체크한 기사로 1페이지 개조식 초안을 만들어요.</p>
        </header>
        <section className="panel select-empty">
          <p className="empty">보고서에 넣을 기사가 없어요. 선별·요약에서 기사를 체크해 주세요.</p>
          <div className="empty-actions">
            <button type="button" className="btn primary" onClick={onGoSelect}>
              선별·요약으로 가기
            </button>
            {reports.length > 0 && (
              <button type="button" className="btn" onClick={onGoArchive}>
                보고서함 보기 ({reports.length})
              </button>
            )}
          </div>
        </section>
      </main>
    )
  }

  // 생성 직후: 결과
  if (current) {
    return (
      <main className="page">
        <header className="page-header with-actions">
          <div>
            <h1>보고서 초안</h1>
            <p className="saved-note">
              ✓ 보고서함에 저장했어요 ({storageLabel}).{' '}
              <button type="button" className="link-btn" onClick={onGoArchive}>
                보고서함 보기
              </button>
            </p>
          </div>
          <div className="header-actions">
            <button type="button" className="btn" onClick={() => setLastId(null)} disabled={Boolean(regenKey)}>
              새 보고서 만들기
            </button>
          </div>
        </header>
        {error && <p className="ai-error">{error}</p>}
        <ReportView
          saved={current}
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
      </main>
    )
  }

  // 만들기 전 · 생성 중: 담길 내용 미리보기
  return (
    <main className="page">
      <header className="page-header with-actions">
        <div>
          <h1>보고서 초안</h1>
          <p>
            선별·요약에서 체크한 기사 {picked.length}건{leftOut.length > 0 ? ` 중 중요도 높은 ${articles.length}건` : ''}으로 만들어요. 아래는 보고서에 담길 재료예요.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn primary" onClick={handleGenerate} disabled={!canGenerate} title={aiBlocked ? AI_BLOCKED_TITLE : undefined}>
            {generating ? '초안 만드는 중…' : '초안 생성'}
          </button>
        </div>
      </header>

      <section className="panel report-settings">
        <label>
          <span>보고서 제목</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={Boolean(generating)} />
        </label>
        <label>
          <span>기간</span>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} disabled={Boolean(generating)}>
            {Object.entries(PERIODS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {tooMany && (
        <section className="panel report-mode" aria-labelledby="report-mode-title">
          <div className="report-mode-head">
            <h2 id="report-mode-title">기사가 {picked.length}건이에요. 어떻게 만들까요?</h2>
            <p>AI가 한 번에 읽을 수 있는 기사는 {REPORT_LIMIT}건이에요.</p>
          </div>
          <div className="report-mode-choices" role="radiogroup" aria-labelledby="report-mode-title">
            <button type="button" role="radio" aria-checked={mode === 'top'} className="report-mode-choice" onClick={() => setMode('top')} disabled={Boolean(generating)}>
              <strong>중요도 높은 {REPORT_LIMIT}건으로 만들기</strong>
              <span>빠름 · {minutes(avgMs)}. 나머지 {picked.length - REPORT_LIMIT}건은 이번 초안에서 빠져요.</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'all'}
              className="report-mode-choice"
              onClick={() => setMode('all')}
              disabled={Boolean(generating) || overMax}
            >
              <strong>고른 {picked.length}건 모두 인용하기</strong>
              <span>
                {overMax
                  ? `한 번에 ${REPORT_MAX_ALL}건까지만 돼요. 선별·요약에서 기사를 줄여 주세요.`
                  : `오래 걸림 · ${minutes(avgMs * chunkCalls(picked.length))}. ${REPORT_CHUNK}건씩 ${Math.ceil(picked.length / REPORT_CHUNK)}번 나눠 쓰고 하나로 합쳐요.`}
              </span>
            </button>
          </div>
        </section>
      )}

      {missing.length > 0 && (
        <p className="report-notice">
          AI 요약이 아직 없는 기사가 {missing.length}건 있어요
          {pending.length > 0 ? ` (${pending.length}건 요약 중 — 진행 창 참고)` : ''}. 요약이 끝나면 초안을 만들 수 있어요.{' '}
          {pending.length < missing.length && (
            <button type="button" className="btn" onClick={() => missing.forEach((a) => queue.enqueue(a))} disabled={aiBlocked} title={aiBlocked ? AI_BLOCKED_TITLE : undefined}>
              남은 기사 요약하기
            </button>
          )}
        </p>
      )}

      {generating && (
        <div className="report-progress">
          <div className="gauge gauge-running">
            <div className="gauge-fill" style={{ width: `${progress}%` }} />
          </div>
          <span>
            {useAll
              ? `기사 ${articles.length}건을 ${Math.ceil(articles.length / REPORT_CHUNK)}번 나눠 쓰고 합치는 중 ${progress}% (예상, ${minutes(expectMs)})`
              : `원문을 읽고 초안 쓰는 중 ${progress}% (예상, 약 ${Math.round(expectMs / 1000)}초)`}
          </span>
        </div>
      )}
      {error && <p className="ai-error">{error}</p>}

      <div className="report-layout">
        <article className={`panel report-doc report-preview${generating ? ' is-generating' : ''}`}>
          <header className="report-doc-head">
            <h2>{title || '제목 없음'}</h2>
            <span>
              {PERIODS[period]} · 기사 {articles.length}건 기준
            </span>
          </header>

          {SECTIONS.map(([sectionKey, label]) => {
            const plan = SECTION_PLAN[sectionKey]
            return (
              <section key={sectionKey} className="report-section">
                <div className="report-section-head">
                  <h3>■ {label}</h3>
                  <span className={generating ? 'section-state generating' : 'section-state'}>
                    {generating ? '생성 중…' : '생성 전'}
                  </span>
                </div>
                <p className="section-desc">{plan.desc}</p>
                <ul className="section-sources">
                  {articles.map((a, i) => {
                    const ai = aiSummaries[a.id]
                    if (!ai) {
                      return (
                        <li key={a.id} className="muted">
                          [{i + 1}] 요약 대기 중
                        </li>
                      )
                    }
                    if (plan.items.length === 0) {
                      return (
                        <li key={a.id}>
                          <b>[{i + 1}]</b> {ai.summary.headline || a.title}
                        </li>
                      )
                    }
                    return plan.items.map(([itemKey, itemLabel]) => {
                      const item = ai.summary.items?.[itemKey]
                      if (!item) return null
                      return (
                        <li key={`${a.id}-${itemKey}`}>
                          <b>[{i + 1}]</b> {itemLabel}: {item.text}
                          <span className={`basis basis-${item.basis}`}>{BASIS_SHORT[item.basis]}</span>
                        </li>
                      )
                    })
                  })}
                </ul>
              </section>
            )
          })}
          <p className="hint">
            회색 글은 보고서에 들어갈 재료(기사별 AI 요약)예요. 「초안 생성」을 누르면 AI가 섹션별로 묶어 개조식으로 정리해요.
          </p>
        </article>

        <aside className="panel report-refs">
          <div className="aside-head">
            <h3>담길 기사 {articles.length}건</h3>
            <button type="button" className="btn-text" onClick={onGoSelect}>
              기사 바꾸기
            </button>
          </div>
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
          {leftOut.length > 0 && (
            <div className="report-left-out">
              <h4>이번 초안에서 빠지는 기사 {leftOut.length}건</h4>
              <ul>
                {leftOut.map((a) => (
                  <li key={a.id}>
                    {a.title} <span className="meta">· 중요도 {a.importance ?? 0}점</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}

export default ReportDraft
