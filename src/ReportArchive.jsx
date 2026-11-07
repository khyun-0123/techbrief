// 보고서함 (11/08 조장 개편)
// - 왼쪽 목록을 없앴다: 맨 위 「보고서 고르기」를 누르면 찾기 칸 + 목록이 펼쳐진다 (제목 · 방향 · 본문 · 근거 기사 제목에서 찾기)
//   「내가 만든」: 이 브라우저에서 만든 보고서만 (브라우저 무작위 번호, IP는 쓰지 않음). 11/08 전 보고서는 누가 만들었는지 기록 없음
// - ‹ › 로 앞뒤 보고서로 넘긴다
// - 보고서 본문을 넓게, 근거 기사는 오른쪽. 두 칸 높이는 화면에 맞추고 각자 안에서 스크롤 (페이지 스크롤 없음)
// - 보고서를 열었을 때 그 보고서에 쓴 기사가 아직 선별 목록에 있으면 정리할지 한 번 묻는다
// onDelete가 없으면 「지우기」를 숨긴다 (공용 보고서함은 관리자만 지움, 17 문서)
import { useEffect, useRef, useState } from 'react'
import { copyText, formatDate, toPlainText } from './reportStore.js'
import { clientId, track } from './usage.js'
import ReportView from './ReportView.jsx'
import { load } from './utils.js'

const ASKED_KEY = 'techbrief-cleanup-asked' // 선별 정리를 이미 물어본 보고서 id

// 찾기 대상 글: 제목 · 방향 · 모든 줄 · 근거 기사 제목
function textOf(r) {
  const lines = Object.values(r.report.sections ?? {}).flatMap((s) => (s.bullets ?? []).map((b) => b.text))
  return [r.report.title, r.report.direction ?? '', ...lines, ...r.articles.map((a) => a.title)].join('\n')
}

const norm = (s) => s.toLowerCase().replace(/\s+/g, '')

// 찾은 말이 나온 줄 (찾는 말이 없으면 핵심 요약 첫 줄)
function snippetOf(r, q) {
  if (!q) return r.report.sections.summary?.bullets?.find((b) => !b.excluded)?.text ?? ''
  const nq = norm(q)
  return (
    textOf(r)
      .split('\n')
      .find((l) => norm(l).includes(nq)) ?? ''
  )
}

function Mark({ text, q }) {
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark className="hl">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

function ReportArchive({ reports, onDelete, onGoDraft, onUpdated, initialId, selectedIds = [], onCleanup }) {
  const [openId, setOpenId] = useState(initialId ?? null)
  const [asked, setAsked] = useState(() => load(ASKED_KEY, []))
  const [notice, setNotice] = useState('')
  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const [mine, setMine] = useState(false)
  const pickerRef = useRef(null)
  const me = clientId()
  const open = reports.find((r) => r.id === openId) ?? reports[0]
  const index = open ? reports.indexOf(open) : -1

  const results = reports.filter((r) => (!mine || r.report.createdBy === me) && (!q.trim() || norm(textOf(r)).includes(norm(q))))

  // 바깥을 누르면 목록 닫기
  useEffect(() => {
    if (!picking) return undefined
    const close = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPicking(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [picking])

  function pick(id) {
    if (!id) return
    setOpenId(id)
    setNotice('')
    setPicking(false)
  }

  const leftover = open ? (open.inputs ?? []).filter((a) => selectedIds.includes(a.id)) : []
  const askCleanup = onCleanup && leftover.length > 0 && !asked.includes(open.id)

  function answerCleanup(action) {
    if (action !== 'keep') onCleanup(open, action)
    const next = [...asked, open.id].slice(-200)
    setAsked(next)
    try {
      localStorage.setItem(ASKED_KEY, JSON.stringify(next))
    } catch {
      // 저장 공간을 못 쓰면 이번 화면에서만
    }
  }

  async function handleCopy() {
    await copyText(toPlainText(open))
    track('export', 'copy')
    setNotice('복사했어요.')
  }

  async function handleDelete() {
    if (!window.confirm(`「${open.report.title}」 보고서를 지울까요? 모두의 보고서함에서 지워지고 되돌릴 수 없어요.`)) return
    try {
      await onDelete(open.id)
      setOpenId(null)
      setNotice('')
    } catch (err) {
      setNotice(err.message)
    }
  }

  return (
    <main className="page page-wide archive-page">
      <header className="archive-head">
        <h1>보고서함</h1>
        {reports.length > 0 && (
          <div className="archive-picker" ref={pickerRef}>
            <button type="button" className="archive-nav" onClick={() => pick(reports[index - 1]?.id)} disabled={index <= 0} aria-label="더 최근 보고서" title="더 최근 보고서">
              ‹
            </button>
            <button type="button" className="archive-current" aria-expanded={picking} onClick={() => setPicking((v) => !v)} title="보고서 고르기 · 찾기">
              <span className="archive-current-title">{open.report.title}</span>
              <span className="archive-current-meta">
                {formatDate(open.createdAt, true)} · {index + 1} / {reports.length}
              </span>
              <span aria-hidden="true">▾</span>
            </button>
            <button type="button" className="archive-nav" onClick={() => pick(reports[index + 1]?.id)} disabled={index >= reports.length - 1} aria-label="이전 보고서" title="이전 보고서">
              ›
            </button>

            {picking && (
              <div className="archive-pop" role="dialog" aria-label="보고서 고르기">
                <div className="archive-pop-tools">
                  <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목 · 방향 · 본문 · 근거 기사에서 찾기 (예: 탠덤)" aria-label="보고서 찾기" />
                  <div className="composer-tabs" role="tablist" aria-label="누가 만든 보고서">
                    <button type="button" role="tab" aria-selected={!mine} className={!mine ? 'active' : ''} onClick={() => setMine(false)}>
                      전체
                    </button>
                    <button type="button" role="tab" aria-selected={mine} className={mine ? 'active' : ''} onClick={() => setMine(true)} title="이 브라우저에서 만든 보고서 (11/08부터 기록)">
                      내가 만든
                    </button>
                  </div>
                </div>
                <p className="archive-pop-count">
                  {results.length}건{q.trim() ? ` · 「${q.trim()}」` : ''}
                  {mine && ' · 이 브라우저에서 만든 보고서 (11/08부터 기록)'}
                </p>
                <ul className="archive-results">
                  {results.length === 0 && <li className="hint">맞는 보고서가 없어요.</li>}
                  {results.map((r) => (
                    <li key={r.id}>
                      <button type="button" className={r.id === open.id ? 'archive-result active' : 'archive-result'} onClick={() => pick(r.id)}>
                        <span className="title">
                          <Mark text={r.report.title} q={q.trim()} />
                          {r.report.createdBy === me && <span className="mine-badge">내가 만듦</span>}
                        </span>
                        <span className="meta">
                          {formatDate(r.createdAt, true)} · 기사 {r.articles.filter((a) => !a.supplement).length}건{r.report.direction ? ` · 방향: ${r.report.direction}` : ''}
                        </span>
                        <span className="archive-preview">
                          <Mark text={snippetOf(r, q.trim())} q={q.trim()} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <button type="button" className="btn primary" onClick={onGoDraft}>
          새 보고서 만들기
        </button>
      </header>

      {reports.length === 0 ? (
        <section className="panel select-empty">
          <p className="empty">아직 만든 보고서가 없어요.</p>
        </section>
      ) : (
        <div className="archive-body">
          {askCleanup && (
            <div className="cleanup-ask" role="status">
              <p>
                <strong>이 보고서에 쓴 기사 {leftover.length}건</strong>이 아직 선별 목록에 있어요. 어떻게 할까요?
              </p>
              <div className="cleanup-actions">
                <button type="button" className="btn primary" onClick={() => answerCleanup('archive')}>
                  「보관」 폴더로 옮기기
                </button>
                <button type="button" className="btn" onClick={() => answerCleanup('remove')}>
                  선별에서 빼기
                </button>
                <button type="button" className="btn-text" onClick={() => answerCleanup('keep')}>
                  그대로 두기
                </button>
              </div>
            </div>
          )}
          <ReportView
            saved={open}
            onChange={onUpdated}
            tools={
              <>
                {notice && <span className="toolbar-note">{notice}</span>}
                <button type="button" className="btn" onClick={handleCopy}>
                  텍스트 복사
                </button>
                {onDelete && (
                  <button type="button" className="btn-text danger" onClick={handleDelete}>
                    지우기
                  </button>
                )}
              </>
            }
          />
        </div>
      )}
    </main>
  )
}

export default ReportArchive
