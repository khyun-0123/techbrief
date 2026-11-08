// 보고서함 (11/08 조장 개편)
// - 목록 화면(기본): 찾기(제목 · 방향 · 본문 · 근거 기사 제목) · 「전체 | 내가 만든」 · 날짜별 묶음. 화면 높이에 맞추고 안에서 스크롤
//   「내가 만든」: 이 브라우저에서 만든 보고서 (브라우저 무작위 번호, IP는 쓰지 않음). 11/08 전 보고서는 기록 없음
// - 보고서 화면: 줄을 누르면 넓은 본문 | 근거 기사 (두 칸 높이 같게, 각자 스크롤). 「← 보고서 목록」으로 돌아감
// - 지우기: 관리자 또는 그 보고서를 만든 브라우저
// - 보고서를 열었을 때 그 보고서에 쓴 기사가 아직 선별 목록에 있으면 정리할지 한 번 묻는다
// onDelete가 없으면 「지우기」를 숨긴다 (공용 보고서함은 관리자만 지움, 17 문서)
import { useState } from 'react'
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

// 날짜 묶음 이름: 오늘 · 어제 · 11월 6일 (목)
function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 86_400_000)
  if (days === 0) return '오늘'
  if (days === 1) return '어제'
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
}

// initialId가 있으면(진행 창 「보고서함에서 보기」) 그 보고서를 바로 연다. 없으면 목록부터
function ReportArchive({ reports, onDelete, canDelete, onGoDraft, onUpdated, initialId, selectedIds = [], onCleanup }) {
  const [openId, setOpenId] = useState(initialId ?? null)
  const [asked, setAsked] = useState(() => load(ASKED_KEY, []))
  const [notice, setNotice] = useState('')
  const [q, setQ] = useState('')
  const [mine, setMine] = useState(false)
  const me = clientId()
  // 내가 만든 보고서: 공용 보고서함이면 서버가 IP로 알려 준 mine, 브라우저에만 있으면 예전처럼 브라우저 번호 (11/08)
  const isMine = (r) => r.mine ?? r.report.createdBy === me
  const open = reports.find((r) => r.id === openId) ?? null

  const results = reports.filter((r) => (!mine || isMine(r)) && (!q.trim() || norm(textOf(r)).includes(norm(q))))
  const groups = []
  for (const r of results) {
    const label = dayLabel(r.createdAt)
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] })
    groups.at(-1).items.push(r)
  }

  const leftover = open ? (open.inputs ?? []).filter((a) => selectedIds.includes(a.id)) : []
  const askCleanup = onCleanup && open && leftover.length > 0 && !asked.includes(open.id)

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

  // ── 보고서 화면 ──
  if (open) {
    return (
      <main className="page page-wide archive-page">
        <header className="archive-head">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setOpenId(null)
              setNotice('')
            }}
          >
            ← 보고서 목록
          </button>
          <div className="archive-open-title">
            <h1>{open.report.title}</h1>
            <span className="hint">
              {formatDate(open.createdAt, true)}
              {isMine(open) && ' · 내가 만듦'}
            </span>
          </div>
        </header>
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
                {onDelete && canDelete?.(open) && (
                  <button type="button" className="btn-text danger" onClick={handleDelete} title="이 보고서를 만든 브라우저나 관리자만 지울 수 있어요">
                    지우기
                  </button>
                )}
              </>
            }
          />
        </div>
      </main>
    )
  }

  // ── 목록 화면 ──
  return (
    <main className="page page-wide archive-page">
      <header className="archive-head">
        <h1>보고서함</h1>
        <div className="archive-search">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목 · 방향 · 본문 · 근거 기사에서 찾기 (예: 탠덤)" aria-label="보고서 찾기" />
          <div className="composer-tabs" role="tablist" aria-label="누가 만든 보고서">
            <button type="button" role="tab" aria-selected={!mine} className={!mine ? 'active' : ''} onClick={() => setMine(false)}>
              전체 {reports.length}
            </button>
            <button type="button" role="tab" aria-selected={mine} className={mine ? 'active' : ''} onClick={() => setMine(true)} title="이 브라우저에서 만든 보고서 (11/08부터 기록)">
              내가 만든 {reports.filter(isMine).length}
            </button>
          </div>
        </div>
        <button type="button" className="btn primary" onClick={onGoDraft}>
          새 보고서 만들기
        </button>
      </header>

      <section className="panel archive-table" aria-label="보고서 목록">
        {reports.length === 0 ? (
          <p className="empty">아직 만든 보고서가 없어요.</p>
        ) : results.length === 0 ? (
          <p className="empty">맞는 보고서가 없어요{mine ? ' (「내가 만든」은 11/08부터 기록해요)' : ''}.</p>
        ) : (
          <div className="archive-scroll">
            {groups.map((g) => (
              <section key={g.label} className="archive-group">
                <h2>{g.label}</h2>
                <ul>
                  {g.items.map((r) => {
                    const base = r.articles.filter((a) => !a.supplement).length
                    const added = r.articles.length - base
                    return (
                      <li key={r.id}>
                        <button type="button" className="archive-row" onClick={() => setOpenId(r.id)}>
                          <span className="archive-row-main">
                            <span className="title">
                              <Mark text={r.report.title} q={q.trim()} />
                              {isMine(r) && <span className="mine-badge">내가 만듦</span>}
                            </span>
                            {r.report.direction && <span className="archive-direction">방향: <Mark text={r.report.direction} q={q.trim()} /></span>}
                            <span className="archive-preview">
                              <Mark text={snippetOf(r, q.trim())} q={q.trim()} />
                            </span>
                          </span>
                          <span className="archive-row-side">
                            <span>기사 {base}건{added ? ` · 보충 ${added}` : ''}</span>
                            <span className="hint">{new Date(r.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

export default ReportArchive
