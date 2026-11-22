// 내 보고서 (11/13 조장 개편: 「보고서함」 → 「내 보고서」, 참고 화면 배치)
// - 왼쪽: 전체 보고서(팀 공용) · 내가 만든 · 최근 생성(7일) · 중요 보고서(IP별 별표) · 휴지통(내가 지운 것) · 생성 기간 · 키워드로 거르기
// - 오른쪽 표: 제목 + 헤드라인(없으면 첫 줄) · 분석 키워드 칩 · 생성일시 · 미리보기 · 다운로드(PPT 4:3 · 텍스트 복사) · ⋯(중요 · 휴지통)
// - 지우기 = 휴지통으로 (만든 사람만). 휴지통에서 되살리기 · 영구 삭제(만든 사람). 휴지통 보관 기간은 관리자가 관리 페이지에서 (기본 30일)
// 아래는 11/08 개편 때 설명 (보고서 화면은 그대로)
// 보고서함 (11/08 조장 개편)
// - 목록 화면(기본): 찾기(제목 · 방향 · 본문 · 근거 기사 제목) · 「전체 | 내가 만든」 · 날짜별 묶음. 화면 높이에 맞추고 안에서 스크롤
//   「내가 만든」: 이 브라우저에서 만든 보고서 (브라우저 무작위 번호, IP는 쓰지 않음). 11/08 전 보고서는 기록 없음
// - 보고서 화면: 줄을 누르면 넓은 본문 | 근거 기사 (두 칸 높이 같게, 각자 스크롤). 「← 보고서 목록」으로 돌아감
// - 지우기: 관리자 또는 그 보고서를 만든 브라우저
// - 보고서를 열었을 때 그 보고서에 쓴 기사가 아직 선별 목록에 있으면 정리할지 한 번 묻는다
// onDelete가 없으면 「지우기」를 숨긴다 (공용 보고서함은 관리자만 지움, 17 문서)
import { useEffect, useRef, useState } from 'react'
import { Seg } from './Dropdown.jsx'
import { exportPptx, loadReportExtra, printReport } from './reportExport.js'
import { SlideFrame } from './ReportSlide.jsx'
import { reportPages } from './reportSlides.js'
import { copyText, toPlainText } from './reportStore.js'
import { clientId, secondsSince, track } from './usage.js'
import ReportView from './ReportView.jsx'
import { load } from './utils.js'
import TitleBand, { SearchBox } from './TitleBand.jsx'

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


// initialId가 있으면(진행 창 「보고서함에서 보기」) 그 보고서를 바로 연다. 없으면 목록부터
// 분석 키워드 칩: ① 주제 키워드(11/12부터 저장) · 분석 묶음 키워드 ② 없을 때만(11/12 전 보고서) 근거 자료의 해시태그에서 많이 나온 것. 3개까지
// 11/17 조장: 「추천 키워드가 임의로 들어간 것 같다 — 분석 키워드 기준으로」 → 분석 키워드가 있으면 해시태그를 섞지 않는다
function analysisKeywordsOf(r) {
  return [...new Set([...(r.report?.sources?.topics ?? []), ...(r.report?.analysis ?? []).map((a) => a.keyword)].filter(Boolean))]
}
function keywordsOf(r, tagsFor) {
  const topics = analysisKeywordsOf(r)
  if (topics.length) return topics.slice(0, 3)
  const count = new Map()
  if (tagsFor) for (const a of r.inputs ?? []) for (const t of tagsFor(a) ?? []) count.set(t, (count.get(t) ?? 0) + 1)
  const tags = [...count].sort((a, b) => b[1] - a[1]).map(([t]) => t)
  return [...new Set([...topics, ...tags])].slice(0, 3)
}
const PERIODS = [
  ['all', '전체', null],
  ['today', '오늘', 1],
  ['7', '7일', 7],
  ['30', '30일', 30],
  ['90', '90일', 90],
]
const SORTS = [
  ['new', '최신순'],
  ['old', '오래된순'],
  ['title', '제목순'],
]
// 2026.11.12 · 22:05 (11/14: 「2026. 11. 12.」 · 「오후 10:05」보다 짧고 열이 맞음)
const pad2 = (n) => String(n).padStart(2, '0')
const fmtTime = (iso) => {
  const d = new Date(iso)
  return { day: `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`, time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
}

// 미리보기 창 (11/14 통합, 보고서팀 4:3 쪽 엔진): PDF · PPT와 같은 쪽을 한 장씩 넘겨 본다
function SlidePreview({ saved }) {
  const [extra, setExtra] = useState(null)
  const [index, setIndex] = useState(0)
  useEffect(() => {
    let on = true
    loadReportExtra(saved)
      .then((x) => on && setExtra(x))
      .catch(() => on && setExtra({}))
    return () => {
      on = false
    }
    // 같은 보고서(saved.id)면 다시 받지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.id])
  if (!extra) return <p className="hint">쪽을 만드는 중…</p>
  const deck = reportPages(saved, extra)
  const i = Math.min(index, deck.pages.length - 1)
  return (
    <div className="mr-slides">
      <SlideFrame deck={deck} index={i} />
      <div className="mr-slides-nav">
        <button type="button" className="mr-act" disabled={i === 0} onClick={() => setIndex(i - 1)} aria-label="이전 쪽">
          ← 이전
        </button>
        <span className="mr-slides-label">
          {i + 1} / {deck.pages.length} · {deck.pages[i].label}
        </span>
        <button type="button" className="mr-act" disabled={i >= deck.pages.length - 1} onClick={() => setIndex(i + 1)} aria-label="다음 쪽">
          다음 →
        </button>
      </div>
    </div>
  )
}

// newIds: 확인 안 한 내 보고서 (목록에 NEW). listNav: 메뉴 「내 보고서」를 누를 때마다 바뀜 → 열린 보고서를 닫고 목록으로 (11/18 조장)
function ReportArchive({ reports, onDelete, canDelete, onUpdated, initialId, selectedIds = [], onCleanup, onOpened, onRestore, onPurge, onStar, tagsFor, trashDays, newIds = [], listNav = 0 }) {
  const [openId, setOpenId] = useState(initialId ?? null)
  useEffect(() => {
    if (openId) onOpened?.(openId) // NEW 지우기
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])
  // 메뉴 「내 보고서」를 다시 누르면 목록으로 (보던 보기 · 검색어는 그대로)
  const firstNav = useRef(listNav)
  useEffect(() => {
    if (listNav === firstNav.current) return
    setOpenId(null)
    setPreviewId(null)
  }, [listNav])
  const [asked, setAsked] = useState(() => load(ASKED_KEY, []))
  const [notice, setNotice] = useState('')
  const [q, setQ] = useState('')
  // 처음 보기: 내가 만든 보고서가 있으면 「내가 만든」, 없으면 「전체」 (11/18 조장 — AI 대기열 「내 작업」과 같은 흐름)
  const [view, setView] = useState(() => (reports.some((r) => !r.deletedAt && (r.mine ?? r.report?.createdBy === clientId())) ? 'mine' : 'all')) // all | mine | others | recent | starred | trash
  const [period, setPeriod] = useState('all')
  const [kwq, setKwq] = useState('')
  const [sort, setSort] = useState('new')
  const [checked, setChecked] = useState([])
  const [previewId, setPreviewId] = useState(null)
  // 미리보기로 봐도 「확인함」 (NEW 지우기)
  useEffect(() => {
    if (previewId) onOpened?.(previewId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewId])
  const [menuId, setMenuId] = useState(null) // ⋯ · 다운로드 메뉴가 열린 줄 (`${kind}:${id}`)
  const [busy, setBusy] = useState(false)
  const me = clientId()
  // 내가 만든 보고서: 공용 보고서함이면 서버가 IP로 알려 준 mine, 브라우저에만 있으면 예전처럼 브라우저 번호 (11/08)
  const isMine = (r) => r.mine ?? r.report.createdBy === me // mine: 서버가 IP로 판단 (createdBy는 11/09부터 내려오지 않음)
  const open = reports.find((r) => r.id === openId) ?? null

  const live = reports.filter((r) => !r.deletedAt)
  const weekAgo = Date.now() - 7 * 86_400_000
  // 11/18: AI 대기열(전체 · 내 작업 · 자동 · 다른 사람)과 같은 구성 — 전체 · 내가 만든 · 다른 사람, 처음엔 내가 만든
  const VIEWS = [
    ['all', '전체 보고서', live, '팀 공용 보고서 모두'],
    ['mine', '내가 만든', live.filter(isMine), '이 IP에서 만든 보고서 (11/08부터 기록)'],
    ['others', '다른 사람', live.filter((r) => !isMine(r)), '다른 팀원이 만든 보고서'],
    ['recent', '최근 생성', live.filter((r) => Date.parse(r.createdAt) >= weekAgo), '최근 7일'],
    ['starred', '중요 보고서', live.filter((r) => r.starred), '내가 별표한 보고서'],
    ['trash', '휴지통', reports.filter((r) => r.deletedAt && isMine(r)), '내가 지운 보고서'],
  ]
  const base = VIEWS.find(([id]) => id === view)?.[2] ?? live
  const days = PERIODS.find(([id]) => id === period)?.[2]
  const since = days ? (days === 1 ? new Date(new Date().toDateString()).getTime() : Date.now() - days * 86_400_000) : null
  const kwOf = (r) => keywordsOf(r, tagsFor)
  const results = base
    .filter((r) => (!since || Date.parse(r.createdAt) >= since) && (!q.trim() || norm(textOf(r)).includes(norm(q))) && (!kwq.trim() || kwOf(r).some((k) => norm(k).includes(norm(kwq)))))
    .sort((a, b) => (sort === 'title' ? a.report.title.localeCompare(b.report.title, 'ko') : sort === 'old' ? Date.parse(a.createdAt) - Date.parse(b.createdAt) : Date.parse(b.createdAt) - Date.parse(a.createdAt)))
  const preview = reports.find((r) => r.id === previewId) ?? null
  const inTrash = view === 'trash'
  const checkedRows = results.filter((r) => checked.includes(r.id))

  async function run(fn, done) {
    setBusy(true)
    setNotice('')
    try {
      await fn()
      if (done) setNotice(done)
    } catch (err) {
      setNotice(err.message)
    } finally {
      setBusy(false)
      setMenuId(null)
    }
  }
  const toTrash = (list) =>
    run(async () => {
      for (const r of list) if (canDelete?.(r)) await onDelete(r.id)
      setChecked([])
    }, `휴지통으로 옮겼어요${trashDays ? ` (${trashDays}일 뒤 영구 삭제)` : ''}.`)
  const restore = (list) =>
    run(async () => {
      for (const r of list) await onRestore(r.id)
      setChecked([])
    }, '되살렸어요.')
  const purge = (list) => {
    if (!window.confirm(`${list.length === 1 ? `「${list[0].report.title}」` : `보고서 ${list.length}개`}를 영구 삭제할까요? 되돌릴 수 없어요.`)) return
    run(async () => {
      for (const r of list) await onPurge(r.id)
      setChecked([])
    }, '영구 삭제했어요.')
  }
  const download = (r, kind) =>
    run(async () => {
      if (kind === 'pptx') {
        await exportPptx(r)
        track('export', 'ppt', secondsSince(r)) // 예전엔 'pptx'라 서버가 버렸음 (11/19)
      } else {
        await copyText(toPlainText(r))
        track('export', 'copy', secondsSince(r))
      }
    }, kind === 'pptx' ? 'PPT(4:3)를 내려받았어요.' : '텍스트를 복사했어요.')

  const leftover = open ? (open.inputs ?? []).filter((a) => selectedIds.includes(a.id)) : []
  const askCleanup = onCleanup && open && leftover.length > 0 && !asked.includes(open.id)

  // 11/21 팀 회의: 「보관 폴더로」를 없애고 「목록에서 지우기 / 유지」만. 지우기는 확인창을 한 번 거친다
  function answerCleanup(action) {
    if (action === 'remove' && !window.confirm(`선별 목록에서 이 보고서에 쓴 기사 ${leftover.length}건을 지울까요?\n보고서에는 그대로 남아요.`)) return
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
    track('export', 'copy', secondsSince(open))
    setNotice('복사했어요.')
  }

  async function handleDelete() {
    if (!window.confirm(`「${open.report.title}」 보고서를 휴지통으로 옮길까요? 휴지통에서 되살릴 수 있어요${trashDays ? ` (${trashDays}일 뒤 영구 삭제)` : ''}.`)) return
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
        <div className="archive-body">
          {/* 보고서 화면 (11/09): 위의 큰 제목 줄을 없애고 「← 보고서 목록」 · 선별 정리 · 내보내기를 보고서 위 한 줄(스크롤해도 붙어 있음)에 모음.
              제목은 보고서 머리(report-doc-head)에 한 번만 */}
          <ReportView
            saved={open}
            onChange={onUpdated}
            lead={
              <>
                <button
                  type="button"
                  className="btn-text report-back"
                  onClick={() => {
                    setOpenId(null)
                    setNotice('')
                  }}
                >
                  ← 보고서 목록
                </button>
                {isMine(open) && <span className="report-mine">내가 만듦</span>}
              {/* 선별에 남은 기사 묻기: 큰 상자 대신 제목 줄 오른쪽 한 줄 (11/09 조장: 보고서 위 자리를 너무 차지함) */}
              {askCleanup && (
                <div className="cleanup-ask" role="status">
                  <span title="이 보고서에 쓴 자료가 아직 선별 목록에 있어요">
                    선별에 남은 기사 <strong>{leftover.length}건</strong>을 목록에서 지울까요?
                  </span>
                  <button type="button" className="cleanup-btn" onClick={() => answerCleanup('remove')} title="선별 목록에서 지워요 (보고서에는 그대로 남음) — 확인창이 한 번 떠요">
                    목록에서 지우기
                  </button>
                  <button type="button" className="cleanup-btn primary" onClick={() => answerCleanup('keep')} title="선별 목록에 그대로 둬요">
                    유지
                  </button>
                </div>
              )}
              </>
            }
            tools={
              <>
                {notice && <span className="toolbar-note">{notice}</span>}
                <button type="button" className="btn" onClick={handleCopy}>
                  텍스트 복사
                </button>
              </>
            }
            trailing={
              onDelete &&
              canDelete?.(open) && (
                <button type="button" className="btn-text danger report-trash" onClick={handleDelete} title="이 보고서를 만든 사람만 지울 수 있어요. 휴지통에서 되살릴 수 있어요">
                  휴지통으로
                </button>
              )
            }
          />
        </div>
      </main>
    )
  }

  // ── 목록 화면 (11/13: 왼쪽 메뉴 + 표 + 미리보기 창) ──
  // 11/14 디자인: 다른 화면과 같은 머리말 · 여백 규칙(20 문서 6장), 기간은 알약 버튼, 키워드는 지우기 · 자주 나온 키워드, 작업은 글자 버튼
  const allChecked = results.length > 0 && results.every((r) => checked.includes(r.id))
  // 자주 나온 키워드 (11/17): 보고서마다 분석 키워드만 센다. 분석 키워드가 하나도 없을 때(11/12 전 보고서만 있을 때)만 해시태그로
  const kwCount = new Map()
  const anyTopic = base.some((r) => analysisKeywordsOf(r).length)
  const kwShown = new Map() // 대소문자 · 띄어쓰기만 다른 말은 하나로 (「AI 안경」 · 「ai 안경」), 처음 본 표기로 보여 줌
  for (const r of base)
    for (const k of anyTopic ? analysisKeywordsOf(r) : kwOf(r)) {
      const key = norm(k)
      if (!kwShown.has(key)) kwShown.set(key, k)
      kwCount.set(key, (kwCount.get(key) ?? 0) + 1)
    }
  const topKw = [...kwCount].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([key]) => kwShown.get(key))
  return (
    <main className="page page-wide mr-page">
      {/* 위 제목 띠 (11/22 조장 A안, TitleBand.jsx): 왼쪽 = 보는 묶음 · 건수, 오른쪽 = 보고서 찾기 · 정렬 (예전 목록 카드 머리에 있던 것) */}
      <TitleBand over="내 보고서" title={((l) => (l.endsWith('보고서') || l === '휴지통' ? l : `${l} 보고서`))(VIEWS.find(([id]) => id === view)?.[1] ?? '보고서')} meta={`${results.length}건`}>
        <SearchBox id="mr-q" value={q} onChange={setQ} label="보고서 찾기" placeholder="제목 · 본문 · 근거 자료에서 찾기" />
        <Seg value={sort} onChange={setSort} label="정렬" size="lg" options={SORTS.map(([value, label]) => ({ value, label }))} />
      </TitleBand>

      <div className="mr-layout">
        <aside className="panel mr-side" aria-label="보고서 거르기">
          <nav className="mr-group mr-views" aria-label="보고서 묶음">
            {VIEWS.map(([id, label, list, title]) => (
              <button
                key={id}
                type="button"
                className={view === id ? 'mr-view active' : 'mr-view'}
                aria-current={view === id ? 'true' : undefined}
                title={title}
                onClick={() => {
                  setView(id)
                  setChecked([])
                }}
              >
                <span>{label}</span>
                {id === 'mine' && list.some((r) => newIds.includes(r.id)) && <span className="mr-new">NEW {list.filter((r) => newIds.includes(r.id)).length}</span>}
                <span className="mr-count">{list.length}</span>
              </button>
            ))}
          </nav>
          <div className="mr-group" role="radiogroup" aria-labelledby="mr-period-title">
            <h2 id="mr-period-title" className="mr-group-title">
              생성 기간
            </h2>
            {/* 11/15: 좁은 막대에 분리형 버튼 5칸이 끼어 글자가 눌렸음 → 11/14 디자인대로 알약 버튼(줄바꿈) */}
            <div className="pill-group">
              {PERIODS.map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={period === value} className={period === value ? 'pill on' : 'pill'} onClick={() => setPeriod(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mr-group">
            <h2 className="mr-group-title">
              <label htmlFor="mr-kw">키워드</label>
            </h2>
            <div className="field-clear">
              <input id="mr-kw" type="text" value={kwq} onChange={(e) => setKwq(e.target.value)} placeholder="예: OLED" autoComplete="off" />
              {kwq && (
                <button type="button" className="field-clear-btn" aria-label="키워드 지우기" onClick={() => setKwq('')}>
                  ×
                </button>
              )}
            </div>
            {topKw.length > 0 && (
              <div className="mr-kw-list" aria-label="자주 나온 키워드">
                {topKw.map((k) => (
                  <button key={k} type="button" className={norm(kwq) === norm(k) ? 'mr-kw on' : 'mr-kw'} aria-pressed={norm(kwq) === norm(k)} onClick={() => setKwq(norm(kwq) === norm(k) ? '' : k)}>
                    #{k}
                  </button>
                ))}
              </div>
            )}
          </div>
          {inTrash && (
            <p className="mr-group mr-trash-note">
              {trashDays ? `휴지통에 ${trashDays}일 있으면 자동으로 영구 삭제돼요.` : '휴지통은 자동으로 비우지 않아요.'} 보관 기간은 관리자가 정해요.
            </p>
          )}
        </aside>

        <section className="panel panel-flush mr-main" aria-labelledby="mr-list-title">
          <h2 id="mr-list-title" className="sr-only">
            {VIEWS.find(([id]) => id === view)?.[1]} 목록
          </h2>
          {(checkedRows.length > 0 || notice) && (
            <div className="mr-bulk" role="status">
              {checkedRows.length > 0 && <span>{checkedRows.length}개 고름</span>}
              {checkedRows.length > 0 && !inTrash && (
                <button type="button" className="btn" disabled={busy || !checkedRows.some((r) => canDelete?.(r))} onClick={() => toTrash(checkedRows)} title="내가 만든 보고서만 옮겨져요">
                  휴지통으로
                </button>
              )}
              {checkedRows.length > 0 && inTrash && onRestore && (
                <>
                  <button type="button" className="btn" disabled={busy} onClick={() => restore(checkedRows)}>
                    되살리기
                  </button>
                  <button type="button" className="btn-text danger" disabled={busy} onClick={() => purge(checkedRows)}>
                    영구 삭제
                  </button>
                </>
              )}
              {notice && <span className="toolbar-note">{notice}</span>}
            </div>
          )}

          {results.length === 0 ? (
            <p className="empty">{reports.length === 0 ? '아직 만든 보고서가 없어요.' : inTrash ? '휴지통이 비었어요.' : '맞는 보고서가 없어요.'}</p>
          ) : (
            <div className="mr-scroll">
              <table className="mr-table">
                <thead>
                  <tr>
                    <th scope="col" className="mr-check">
                      <input type="checkbox" aria-label="모두 고르기" checked={allChecked} onChange={(e) => setChecked(e.target.checked ? results.map((r) => r.id) : [])} />
                    </th>
                    <th scope="col">보고서</th>
                    <th scope="col" className="mr-kw-col">
                      분석 키워드
                    </th>
                    <th scope="col" className="mr-time">
                      만든 때
                    </th>
                    <th scope="col" className="mr-actions">
                      <span className="sr-only">작업</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const t = fmtTime(r.createdAt)
                    const line = r.report.headline?.text ?? snippetOf(r, q.trim())
                    const kws = kwOf(r)
                    return (
                      <tr key={r.id}>
                        <td className="mr-check">
                          <input type="checkbox" aria-label={`${r.report.title} 고르기`} checked={checked.includes(r.id)} onChange={(e) => setChecked((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)))} />
                        </td>
                        <td className="mr-title">
                          <button type="button" className="mr-title-btn" onClick={() => (inTrash ? setPreviewId(r.id) : setOpenId(r.id))}>
                            {r.starred && (
                              <span className="mr-star" aria-label="중요">
                                ★
                              </span>
                            )}
                            {newIds.includes(r.id) && (
                              <span className="mr-new" title="아직 열어 보지 않은 보고서">
                                NEW
                              </span>
                            )}
                            <Mark text={r.report.title} q={q.trim()} />
                            {/* 예전 기본 제목은 모두 같아 구분이 안 됨 → 첫 키워드를 흐리게 덧붙임 (11/14) */}
                            {r.report.title === '테크 동향 브리핑' && kws[0] && <span className="mr-title-kw"> · {kws[0]}</span>}
                          </button>
                          {isMine(r) && <span className="mine-badge">내가 만듦</span>}
                          {line && (
                            <span className="mr-line">
                              <Mark text={line} q={q.trim()} />
                            </span>
                          )}
                        </td>
                        <td className="mr-kw-col">
                          <span className="mr-chips">
                            {kws.slice(0, 2).map((k) => (
                              <button key={k} type="button" className="mr-kw" onClick={() => setKwq(k)} title={`「${k}」 키워드 보고서만`}>
                                #{k}
                              </button>
                            ))}
                            {kws.length > 2 && (
                              <span className="mr-kw-more" title={kws.slice(2).join(' · ')}>
                                +{kws.length - 2}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="mr-time">
                          {t.day}
                          <span>{t.time}</span>
                        </td>
                        <td className="mr-actions">
                          <button type="button" className="mr-act" onClick={() => setPreviewId(r.id)}>
                            미리보기
                          </button>
                          {!inTrash && (
                            <span className="mr-menu-wrap">
                              <button type="button" className="mr-act" aria-expanded={menuId === `dl:${r.id}`} onClick={() => setMenuId(menuId === `dl:${r.id}` ? null : `dl:${r.id}`)}>
                                다운로드 ▾
                              </button>
                              {menuId === `dl:${r.id}` && (
                                <span className="mr-menu" role="menu">
                                  <button type="button" role="menuitem" disabled={busy} onClick={() => download(r, 'pptx')}>
                                    PPT (4:3 가로)
                                  </button>
                                  {/* 11/17 (39 문서 E): 보고서팀 담당자 양식 — 본문 1장 + 유첨 4장, 칸 이름이 붙은 PPT (서버가 만듦) */}
                                  <a role="menuitem" className="mr-menu-link" href={`/api/reports/pptx?id=${encodeURIComponent(r.id)}`} download title="본문 1장 + 유첨 4장(상세 분석 · 트렌드 그래프 · 출처 목록 · 원문 요약), 칸 이름이 붙어 있어 고쳐 쓰기 쉬워요">
                                    PPT (담당자 양식 · 본문 1장 + 유첨)
                                  </a>
                                  <button type="button" role="menuitem" disabled={busy} onClick={() => download(r, 'copy')}>
                                    텍스트 복사
                                  </button>
                                  <button type="button" role="menuitem" onClick={() => printReport(r)} title="인쇄 창에서 「PDF로 저장」 — 미리보기와 같은 4:3 쪽">
                                    PDF (4:3 가로)
                                  </button>
                                </span>
                              )}
                            </span>
                          )}
                          <span className="mr-menu-wrap">
                            <button type="button" className="mr-act mr-more" aria-label="더 보기" aria-expanded={menuId === `more:${r.id}`} onClick={() => setMenuId(menuId === `more:${r.id}` ? null : `more:${r.id}`)}>
                              ⋯
                            </button>
                            {menuId === `more:${r.id}` && (
                              <span className="mr-menu" role="menu">
                                {!inTrash && onStar && (
                                  <button type="button" role="menuitem" onClick={() => run(() => onStar(r.id, !r.starred))}>
                                    {r.starred ? '중요 표시 빼기' : '중요 보고서로 표시'}
                                  </button>
                                )}
                                {!inTrash && canDelete?.(r) && (
                                  <button type="button" role="menuitem" className="danger" onClick={() => toTrash([r])}>
                                    휴지통으로
                                  </button>
                                )}
                                {inTrash && onRestore && (
                                  <button type="button" role="menuitem" onClick={() => restore([r])}>
                                    되살리기
                                  </button>
                                )}
                                {inTrash && onPurge && (
                                  <button type="button" role="menuitem" className="danger" onClick={() => purge([r])}>
                                    영구 삭제
                                  </button>
                                )}
                                {!inTrash && !canDelete?.(r) && <span className="mr-menu-note">다른 사람이 만든 보고서는 지울 수 없어요</span>}
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {preview && (
        <div className="mr-preview-backdrop" onClick={(e) => e.target === e.currentTarget && setPreviewId(null)} onKeyDown={(e) => e.key === 'Escape' && setPreviewId(null)} role="presentation">
          <div className="mr-preview panel" role="dialog" aria-modal="true" aria-label={`미리보기: ${preview.report.title}`}>
            <div className="mr-preview-bar">
              <strong>미리보기</strong>
              <span className="hint">{preview.deletedAt ? '휴지통에 있는 보고서' : '보기만 해요 — 고치려면 열기'}</span>
              {!preview.deletedAt && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    setOpenId(preview.id)
                    setPreviewId(null)
                  }}
                >
                  열기
                </button>
              )}
              <button type="button" className="btn" onClick={() => setPreviewId(null)} autoFocus>
                닫기
              </button>
            </div>
            <SlidePreview saved={preview} />
          </div>
        </div>
      )}
    </main>
  )
}

export default ReportArchive
