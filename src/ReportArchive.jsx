// 보고서함 — 지금까지 만든 보고서 목록
import { useState } from 'react'
import { copyText, formatDate, toPlainText } from './reportStore.js'
import ReportView from './ReportView.jsx'

function ReportArchive({ reports, onDelete, onGoDraft }) {
  const [openId, setOpenId] = useState(null)
  const [notice, setNotice] = useState('')
  const open = reports.find((r) => r.id === openId) ?? reports[0]

  async function handleCopy() {
    await copyText(toPlainText(open))
    setNotice('개조식 텍스트를 복사했어요.')
  }

  function handleDelete() {
    if (!window.confirm(`「${open.report.title}」 보고서를 지울까요?`)) return
    onDelete(open.id)
    setOpenId(null)
    setNotice('')
  }

  return (
    <main className="page">
      <header className="page-header with-actions">
        <div>
          <h1>보고서함</h1>
          <p>지금까지 만든 보고서예요. 최근 {reports.length}건 (최대 30건 보관)</p>
        </div>
        <button type="button" className="btn primary" onClick={onGoDraft}>
          새 보고서 만들기
        </button>
      </header>

      {reports.length === 0 ? (
        <section className="panel select-empty">
          <p className="empty">아직 만든 보고서가 없어요.</p>
        </section>
      ) : (
        <div className="archive-layout">
          <ul className="panel archive-list">
            {reports.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={r.id === open.id ? 'archive-item active' : 'archive-item'}
                  onClick={() => {
                    setOpenId(r.id)
                    setNotice('')
                  }}
                >
                  <span className="title">{r.report.title}</span>
                  <span className="meta">
                    {formatDate(r.createdAt, true)} · 기사 {r.articles.length}건
                  </span>
                  <span className="archive-preview">{r.report.sections.summary?.bullets?.[0]?.text}</span>
                </button>
              </li>
            ))}
          </ul>

          <div>
            <div className="archive-actions">
              <button type="button" className="btn" onClick={handleCopy}>
                텍스트 복사
              </button>
              <button type="button" className="btn danger" onClick={handleDelete}>
                지우기
              </button>
              {notice && <span className="report-copied">{notice}</span>}
            </div>
            <ReportView saved={open} />
          </div>
        </div>
      )}
    </main>
  )
}

export default ReportArchive
