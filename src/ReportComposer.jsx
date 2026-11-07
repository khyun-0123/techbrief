// 보고서 칸 (선별·요약 오른쪽, 11/08 조장)
// 작성: ① 보고서 제목 ② 보고서 방향(한 줄, AI 지시문에 들어감) ③ 자료 조사 수준 → 「보고서 만들기」는 서버 대기열에 넣는다
//       다른 탭에 가도 오른쪽 아래 진행 창에서 진행 상황을 보고, 요약 안 된 기사를 써야 하면 거기서 묻는다
// 미리보기: 이 브라우저에서 마지막으로 만든 보고서 (줄 빼기 · 섹션 다시 쓰기 · 복사 · 내보내기)
// 기간: 예전에는 「오늘 · 이번 주 · 이번 달」을 골랐지만 보고서 머리글에만 붙는 글자였다 → 기사 날짜로 자동 (11/8)
import { useState } from 'react'
import { createReportJob, requestReportSection } from './api.js'
import { articleKey, copyText, toPlainText } from './reportStore.js'
import { clientId, track } from './usage.js'
import { AI_BLOCKED_TITLE, useOps } from './ops.js'
import ReportView from './ReportView.jsx'
import { load } from './utils.js'

const DRAFT_INPUT_KEY = 'techbrief-report-input' // 제목 · 방향 · 조사 수준 (쓰던 것 남기기)
const REPORT_LIMIT = 10 // 서버 MAX_REPORT_ARTICLES
const REPORT_MAX_ALL = 40
const ACTIVE = ['queued', 'running', 'need_confirm']

const LEVELS = [
  ['selected', '선택한 자료만', '체크한 기사만으로 써요. 가장 빨라요.'],
  ['owned', '보유 자료까지', '근거가 없는 「AI 해설」 줄을 우리가 모은 기사 · 원문 · 직접 추가 자료 · 위키백과로 보충해요.'],
  ['research', '추가 자료 조사까지', '보유 자료에 더해 네이버 뉴스 · 논문에서 새로 찾아 요약해 참고자료로 써요. 가장 오래 걸려요.'],
]

function topByImportance(articles, limit) {
  const keep = new Set(
    [...articles]
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || (a.hoursAgo ?? 0) - (b.hoursAgo ?? 0))
      .slice(0, limit)
      .map((a) => a.id),
  )
  return articles.filter((a) => keep.has(a.id))
}

// 기사 날짜로 기간 글자 만들기: 「11. 1. ~ 11. 8. 기사」
function periodOf(articles) {
  const times = articles.map((a) => (a.publishedAt ? Date.parse(a.publishedAt) : Date.now() - (a.hoursAgo ?? 0) * 3600_000)).filter(Number.isFinite)
  if (!times.length) return '기사 기준'
  const f = (t) => new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
  const [lo, hi] = [f(Math.min(...times)), f(Math.max(...times))]
  return lo === hi ? `${lo} 기사` : `${lo} ~ ${hi} 기사`
}

// 재료 미리보기: 보고서를 만들기 전, 체크한 기사의 요약이 섹션마다 어떤 재료로 들어가는지 (예전 보고서 초안 화면의 미리보기)
const SECTION_PLAN = [
  ['핵심 요약', '경영진이 먼저 알아야 할 내용, 3줄 이내', []],
  ['기술 개요', '어떤 기술이고 어떤 원리인지', [['concept', '컨셉'], ['principle', '원리']]],
  ['업계 동향', '타사의 개발 · 활용 현황과 장단점', [['competitors', '타사 현황'], ['pros_cons', '장단점']]],
  ['시사점', '우리 회사 활용 방안과 기대 효과', [['application', '활용 방안'], ['effect', '효과성']]],
]
const BASIS_SHORT = { article: '기사 근거', ai_background: 'AI 보충', ai_suggestion: 'AI 제안' }

function MaterialsPreview({ articles, aiSummaries, title, direction, jobs }) {
  return (
    <div className="materials-preview">
      {jobs.length > 0 && (
        <p className="composer-jobs">
          {jobs.map((j) => (
            <span key={j.id}>
              「{j.title}」 {j.status === 'queued' ? `대기 ${j.queuePos}번째` : j.status === 'need_confirm' ? '확인 필요 — 오른쪽 아래 진행 창' : `${j.step} ${j.progress ?? 0}%`}
            </span>
          ))}
        </p>
      )}
      <header className="report-doc-head">
        <h2>{title || '제목 없음'}</h2>
        <span>재료 미리보기 · 기사 {articles.length}건</span>
      </header>
      {direction && <p className="report-direction">방향: {direction}</p>}
      {articles.length === 0 ? (
        <p className="hint">왼쪽에서 보고서에 넣을 기사를 체크하면, 섹션마다 어떤 내용이 들어갈지 여기에 보여 줘요.</p>
      ) : (
        <>
          <p className="hint">아직 만들기 전이에요. 「보고서 만들기」를 누르면 AI가 아래 재료를 섹션별로 묶어 개조식으로 정리해요.</p>
          {SECTION_PLAN.map(([label, desc, items]) => (
            <section key={label} className="report-section">
              <div className="report-section-head">
                <h3>■ {label}</h3>
              </div>
              <p className="section-desc">{desc}</p>
              <ul className="section-sources">
                {articles.map((a, i) => {
                  const ai = aiSummaries[a.id]
                  if (!ai) return <li key={a.id} className="muted">[{i + 1}] 요약 대기 중 · {a.title}</li>
                  if (items.length === 0) {
                    return (
                      <li key={a.id}>
                        <b>[{i + 1}]</b> {ai.summary.headline || a.title}
                      </li>
                    )
                  }
                  return items.map(([k, l]) => {
                    const item = ai.summary.items?.[k]
                    if (!item) return null
                    return (
                      <li key={`${a.id}-${k}`}>
                        <b>[{i + 1}]</b> {l}: {item.text} <span className={`basis basis-${item.basis}`}>{BASIS_SHORT[item.basis]}</span>
                      </li>
                    )
                  })
                })}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  )
}

function ReportComposer({ articles: picked, aiSummaries, queue, reports, onUpdated, onGoArchive, storageLabel, folderSummary, reportJobs = [], onJobAdded, lastReportId }) {
  const [saved0] = useState(() => load(DRAFT_INPUT_KEY, {}))
  const [title, setTitle] = useState(saved0.title ?? '테크 동향 브리핑')
  const [direction, setDirection] = useState(saved0.direction ?? '')
  const [level, setLevel] = useState(saved0.level ?? 'owned')
  const [mode, setMode] = useState('top')
  const [sending, setSending] = useState(false)
  const [regenKey, setRegenKey] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const { aiBlocked } = useOps()

  function remember(patch) {
    try {
      localStorage.setItem(DRAFT_INPUT_KEY, JSON.stringify({ title, direction, level, ...patch }))
    } catch {
      // 저장 공간을 못 쓰면 이번 화면에서만
    }
  }

  const tooMany = picked.length > REPORT_LIMIT
  const overMax = picked.length > REPORT_MAX_ALL
  const useAll = tooMany && mode === 'all' && !overMax
  const articles = tooMany && !useAll ? topByImportance(picked, REPORT_LIMIT) : picked
  const leftOut = tooMany && !useAll ? picked.filter((a) => !articles.includes(a)) : []

  const key = articleKey(picked.map((a) => a.id))
  // 미리보기 (11/08: 항상 누를 수 있게)
  // - 지금 체크한 기사로 만든 보고서가 있으면 그 보고서 (가장 최근)
  // - 없으면 「재료 미리보기」: 체크한 기사 요약이 섹션별로 어떻게 들어가는지 + 만드는 중이면 진행
  // - 「지난 보고서 보기」: 이 브라우저에서 마지막으로 만든 보고서
  const matching = reports.find((r) => r.articleKey === key && picked.length > 0)
  const last = reports.find((r) => r.id === lastReportId)
  const [showLast, setShowLast] = useState(false)
  const current = showLast ? last : matching
  const changed = current && current.articleKey && current.articleKey !== key
  const [view, setView] = useState(() => (matching ? 'preview' : 'compose'))
  const showReport = view === 'preview' && current
  const activeJobs = reportJobs.filter((j) => ACTIVE.includes(j.status))

  const missing = articles.filter((a) => !aiSummaries[a.id])
  const jobOf = (id) => queue.jobs.find((j) => j.id === id)
  const pending = missing.filter((a) => ['queued', 'running'].includes(jobOf(a.id)?.status))
  const canSend = articles.length > 0 && missing.length === 0 && !sending && !aiBlocked && !(tooMany && mode === 'all' && overMax)

  async function handleSend() {
    setSending(true)
    setError('')
    try {
      const job = await createReportJob({ articles, aiSummaries, title, direction, level, periodLabel: periodOf(articles), mode: useAll ? 'all' : undefined, clientId: clientId() })
      track('report')
      onJobAdded?.(job)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  async function handleRegenerate(sectionKey) {
    setRegenKey(sectionKey)
    setError('')
    try {
      const inputs = current.inputs ?? articles
      const summaries = Object.fromEntries(inputs.map((a) => [a.id, a.summary ? { summary: a.summary } : aiSummaries[a.id]]))
      const result = await requestReportSection({ articles: inputs, aiSummaries: summaries, key: sectionKey, report: current.report, reportId: current.id })
      onUpdated({ ...current, report: { ...current.report, sections: { ...current.report.sections, [sectionKey]: { bullets: result.bullets } } } })
    } catch (err) {
      setError(err.message)
    } finally {
      setRegenKey(null)
    }
  }

  async function handleCopy() {
    await copyText(toPlainText(current))
    track('export', 'copy')
    setNotice('복사했어요.')
  }

  return (
    <aside className="panel composer" aria-label="보고서">
      <div className="composer-head">
        <h2>보고서</h2>
        <div className="composer-tabs" role="tablist" aria-label="보고서">
          <button type="button" role="tab" aria-selected={view === 'compose'} className={view === 'compose' ? 'active' : ''} onClick={() => setView('compose')}>
            작성
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'preview'}
            className={view === 'preview' ? 'active' : ''}
            onClick={() => setView('preview')}
            title="체크한 기사로 만든 보고서, 아직 없으면 섹션별 재료 미리보기"
          >
            미리보기
          </button>
        </div>
      </div>

      {view === 'preview' && !showReport ? (
        <div className="composer-body">
          <MaterialsPreview articles={articles} aiSummaries={aiSummaries} title={title} direction={direction} jobs={activeJobs} />
          <div className="composer-foot">
            {last && (
              <button type="button" className="btn" onClick={() => setShowLast(true)}>
                지난 보고서 보기 — 「{last.report.title}」 {new Date(last.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </button>
            )}
            <button type="button" className="btn primary composer-go" onClick={() => setView('compose')}>
              작성으로 가서 보고서 만들기
            </button>
          </div>
        </div>
      ) : showReport ? (
        <div className="composer-body">
          <p className="composer-note">
            {changed ? (
              <span className="note-warn">지금 체크한 기사와 다른 기사로 만든 지난 보고서예요.</span>
            ) : (
              <span>✓ 지금 체크한 기사로 만든 보고서 · 보고서함에 저장됨 ({storageLabel})</span>
            )}{' '}
            {showLast && (
              <>
                ·{' '}
                <button type="button" className="link-btn" onClick={() => setShowLast(false)}>
                  지금 체크한 기사로 돌아가기
                </button>{' '}
              </>
            )}
            ·{' '}
            <button type="button" className="link-btn" onClick={onGoArchive}>
              보고서함에서 보기
            </button>
          </p>
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
        </div>
      ) : (
        <div className="composer-body">
          <div className="composer-form">
            <label>
              <span>보고서 제목</span>
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  remember({ title: e.target.value })
                }}
                maxLength={80}
              />
            </label>
            <label>
              <span>
                보고서 방향 <small>주제나 꼭 담을 방향을 한 줄로. AI가 이 방향으로 내용을 고르고 순서를 정해요</small>
              </span>
              <textarea
                rows={2}
                value={direction}
                onChange={(e) => {
                  setDirection(e.target.value)
                  remember({ direction: e.target.value })
                }}
                placeholder="예: WOLED 관점에서 마이크로LED가 위협이 되는 시점과 대응 방향 위주로"
                maxLength={300}
              />
            </label>
            <fieldset className="composer-levels">
              <legend>자료 조사 수준</legend>
              {LEVELS.map(([value, label, desc]) => (
                <label key={value} className={level === value ? 'level-option active' : 'level-option'}>
                  <input
                    type="radio"
                    name="report-level"
                    value={value}
                    checked={level === value}
                    onChange={() => {
                      setLevel(value)
                      remember({ level: value })
                    }}
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{desc}</small>
                  </span>
                </label>
              ))}
              <p className="hint">요약이 안 된 기사를 써야 하면 만드는 중에 오른쪽 아래 진행 창에서 물어봐요.</p>
            </fieldset>

            {tooMany && (
              <div className="report-mode-choices" role="radiogroup" aria-label="기사가 많을 때">
                <button type="button" role="radio" aria-checked={mode === 'top'} className="report-mode-choice" onClick={() => setMode('top')}>
                  <strong>중요도 높은 {REPORT_LIMIT}건으로</strong>
                  <span>빠름. 나머지 {picked.length - REPORT_LIMIT}건은 빠져요.</span>
                </button>
                <button type="button" role="radio" aria-checked={mode === 'all'} className="report-mode-choice" onClick={() => setMode('all')} disabled={overMax}>
                  <strong>{picked.length}건 모두</strong>
                  <span>{overMax ? `한 번에 ${REPORT_MAX_ALL}건까지만 돼요.` : '오래 걸려요.'}</span>
                </button>
              </div>
            )}
          </div>

          <div className="composer-articles">
            <div className="composer-articles-head">
              <h3>담길 기사 {articles.length}건</h3>
              {articles.length > 0 && <span className="hint">{periodOf(articles)}</span>}
              {folderSummary && <span className="hint">· {folderSummary}</span>}
            </div>
            {picked.length === 0 ? (
              <p className="hint">왼쪽 목록에서 보고서에 넣을 기사를 체크하세요. 여러 폴더의 기사를 함께 넣을 수 있어요.</p>
            ) : (
              <ol>
                {articles.map((a, i) => {
                  const job = jobOf(a.id)
                  const done = Boolean(aiSummaries[a.id])
                  const state = done ? '요약 완료' : job?.status === 'running' ? `요약 중 ${queue.progressOf(job)}%` : job?.status === 'queued' ? '요약 대기' : '요약 없음'
                  return (
                    <li key={a.id}>
                      <span className="report-ref-num">{i + 1}</span>
                      <span className="composer-article-title">{a.title}</span>
                      <span className={done ? 'summary-dot done' : 'summary-dot none'}>{state}</span>
                    </li>
                  )
                })}
              </ol>
            )}
            {leftOut.length > 0 && <p className="hint">이번 초안에서 빠지는 기사 {leftOut.length}건 (중요도 낮은 순)</p>}
          </div>

          <div className="composer-foot">
            {activeJobs.length > 0 && (
              <p className="composer-jobs">
                {activeJobs.map((j) => (
                  <span key={j.id}>
                    「{j.title}」 {j.status === 'queued' ? `대기 ${j.queuePos}번째` : j.status === 'need_confirm' ? '확인 필요 — 오른쪽 아래 진행 창' : `${j.step} ${j.progress ?? 0}%`}
                  </span>
                ))}
              </p>
            )}
            {missing.length > 0 && picked.length > 0 && (
              <p className="note-warn">
                요약이 없는 기사 {missing.length}건{pending.length > 0 ? ` (${pending.length}건 요약 중)` : ''} — 요약이 끝나면 만들 수 있어요.{' '}
                {pending.length < missing.length && (
                  <button type="button" className="link-btn" onClick={() => missing.forEach((a) => queue.enqueue(a))} disabled={aiBlocked} title={aiBlocked ? AI_BLOCKED_TITLE : undefined}>
                    남은 기사 요약하기
                  </button>
                )}
              </p>
            )}
            {error && <p className="ai-error">{error}</p>}
            <button type="button" className="btn primary composer-go" onClick={handleSend} disabled={!canSend} title={aiBlocked ? AI_BLOCKED_TITLE : picked.length === 0 ? '왼쪽에서 보고서에 넣을 기사를 체크하세요' : undefined}>
              {sending ? '대기열에 넣는 중…' : `체크한 기사 ${articles.length}건으로 보고서 만들기`}
            </button>
            <p className="hint composer-go-note">대기열에 들어가요. 다른 탭에 가도 오른쪽 아래 진행 창에서 볼 수 있고, 완성되면 보고서함에 저장돼요.</p>
          </div>
        </div>
      )}
    </aside>
  )
}

export default ReportComposer
