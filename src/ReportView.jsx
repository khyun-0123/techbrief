// 완성된 보고서 한 건을 보여 준다 (선별·요약 오른쪽 · 보고서함 공용)
// 11/08 조장 요청
// - 줄 빼기: 줄마다 끝에 작은 「빼기」. 뺀 줄은 섹션 아래 「뺀 줄 N개」에 접혀 들어가고 「되살리기」로 돌린다
//   (체크박스를 줄마다 두면 정신없어서). 뺀 줄은 복사 · PDF · PPT에서 빠진다
// - AI 보충 근거 찾기: AI 해설 줄의 근거를 우리 자료(원문 · 모은 기사 · 직접 추가 자료)와 위키백과에서 찾아 고쳐 쓴다
//   근거를 찾으면 사실 줄로 옮기고 「근거 보충」 표시 + 근거 번호. 못 찾으면 그대로 두고 「근거 못 찾음」
import { useState } from 'react'
import { reinforceApi } from './api.js'
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
  const [finding, setFinding] = useState(null) // 'key:index' 근거 찾는 중인 줄
  const [findAll, setFindAll] = useState(null) // { done, total }
  const [findError, setFindError] = useState('')
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

  // 한 줄의 근거 찾기. entry를 받아 고친 entry를 돌려준다 (모두 찾기에서 이어 쓰려고)
  async function reinforce(entry, key, index) {
    const b = entry.report.sections[key].bullets[index]
    const result = await reinforceApi({ text: b.text, inputs: entry.inputs ?? [], existing: entry.articles })
    if (!result.found) return patchBullet(entry, key, index, { noRef: { tried: result.tried?.length ?? 0 } })
    const next = { ...entry, articles: [...entry.articles, ...result.added] }
    return patchBullet(next, key, index, { ...result.bullet, noRef: undefined })
  }

  async function handleFind(key, index) {
    setFinding(`${key}:${index}`)
    setFindError('')
    try {
      onChange(await reinforce(saved, key, index))
    } catch (err) {
      setFindError(`근거를 찾지 못했어요: ${err.message}`)
    } finally {
      setFinding(null)
    }
  }

  const aiTargets = SECTIONS.flatMap(([key]) =>
    (report.sections[key]?.bullets ?? []).flatMap((b, i) => (kindOf(b) === 'ai' && !b.excluded && !b.noRef ? [[key, i]] : [])),
  )

  async function handleFindAll() {
    setFindError('')
    setFindAll({ done: 0, total: aiTargets.length })
    let entry = saved
    try {
      for (const [i, [key, index]] of aiTargets.entries()) {
        setFinding(`${key}:${index}`)
        entry = await reinforce(entry, key, index)
        onChange(entry)
        setFindAll({ done: i + 1, total: aiTargets.length })
      }
    } catch (err) {
      setFindError(`근거 찾기가 멈췄어요: ${err.message}`)
    } finally {
      setFinding(null)
      setFindAll(null)
    }
  }

  const working = Boolean(finding) || busy

  function lineTools(key, i, b) {
    if (!editable) return null
    const ai = kindOf(b) === 'ai'
    return (
      <span className="line-tools">
        {ai && (
          <button type="button" className="line-btn" onClick={() => handleFind(key, i)} disabled={working} title="우리 자료(원문 · 모은 기사 · 직접 추가 자료)와 위키백과에서 근거를 찾아 고쳐 써요">
            {finding === `${key}:${i}` ? '찾는 중…' : '근거 찾기'}
          </button>
        )}
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
          {editable && aiTargets.length > 0 && (
            <button type="button" className="btn outline" onClick={handleFindAll} disabled={working} title="AI 해설 줄마다 우리 자료와 위키백과에서 근거를 찾아요 (줄마다 30초쯤)">
              {findAll ? `근거 찾는 중 ${findAll.done}/${findAll.total}` : `AI 해설 ${aiTargets.length}줄 근거 찾기`}
            </button>
          )}
        </div>
        {findError && <p className="ai-error">{findError}</p>}
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
              <summary>⚠ 확인할 점 {report.warnings.length}개</summary>
              <ul className="report-warnings">
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          ) : (
            <ul className="report-warnings">
              {report.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          ))}

        {SECTIONS.map(([key, label]) => {
          const list = (report.sections[key]?.bullets ?? []).map((b, i) => ({ b, i }))
          const facts = list.filter(({ b }) => !b.excluded && kindOf(b) === 'fact')
          const ai = list.filter(({ b }) => !b.excluded && kindOf(b) === 'ai')
          const out = list.filter(({ b }) => b.excluded)
          return (
            <section key={key} className="report-section">
              <div className="report-section-head">
                <h3>■ {label}</h3>
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
                    <li key={i} className={finding === `${key}:${i}` ? 'is-finding' : undefined}>
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
                  <p className="report-ai-label">AI 해설·제안 · 기사에서 확인된 내용이 아니에요. 「근거 찾기」로 우리 자료 · 백과에서 근거를 찾을 수 있어요</p>
                  <ul className="report-bullets">
                    {ai.map(({ b, i }) => (
                      <li key={i} className={finding === `${key}:${i}` ? 'is-finding' : undefined}>
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
