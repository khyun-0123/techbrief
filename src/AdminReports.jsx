// 관리 페이지 「보고서 관리」 (11/08)
// - 모든 보고서를 지울 수 있는 곳은 여기뿐이다. 일반 화면에서는 관리자도 자기 IP로 만든 보고서만 지운다
// - 자동 삭제 주기: 만든 지 정한 기간이 지난 보고서를 하루 한 번 지운다 (기본 꺼짐). 바꾸면 바로 한 번 정리
import { useEffect, useState } from 'react'
import { deleteReportApi, fetchAdminReports, saveReportRetentionApi } from './api.js'

const RETENTION = [
  [0, '끄기'],
  [30, '30일'],
  [90, '90일'],
  [180, '180일'],
  [365, '1년'],
]

function formatAt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// 그 기간이면 지금 바로 지워질 개수 (누른 순간 기준)
function countOlderThan(reports, days) {
  if (!days) return 0
  const cutoff = Date.now() - days * 86_400_000
  return reports.filter((r) => Date.parse(r.createdAt) < cutoff).length
}

function AdminReports({ onToast, onChanged }) {
  const [data, setData] = useState(null) // { stored, retentionDays, reports }
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null) // { kind: 'delete', report } | { kind: 'retention', days }
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')

  const load = () =>
    fetchAdminReports()
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((err) => setError(err.message))
  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (!confirm) return undefined
    const onKey = (e) => e.key === 'Escape' && setConfirm(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm])

  if (error) return <p className="adm-empty" role="alert">{error}</p>
  if (!data) return <p className="adm-empty">불러오는 중…</p>

  const shown = data.reports.filter((r) => !q.trim() || `${r.report.title} ${r.createdIp ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))

  async function run() {
    setBusy(true)
    try {
      if (confirm.kind === 'delete') {
        await deleteReportApi(confirm.report.id)
        onToast({ text: `「${confirm.report.report.title}」 보고서를 지웠어요.` })
      } else {
        const { deleted } = await saveReportRetentionApi(confirm.days)
        onToast({ text: confirm.days ? `자동 삭제를 ${confirm.days}일로 바꿨어요. 지금 ${deleted}개를 지웠어요.` : '자동 삭제를 껐어요.' })
      }
      setConfirm(null)
      await load()
      onChanged?.()
    } catch (err) {
      onToast({ text: err.message, error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="adm-card">
        <h2>자동 삭제</h2>
        <p className="adm-desc">
          만든 지 정한 기간이 지난 보고서를 하루 한 번 지워요. 지운 보고서는 되돌릴 수 없어요. 지금:{' '}
          <strong>{data.retentionDays ? `${data.retentionDays}일 지나면 삭제` : '꺼짐 (지우지 않음)'}</strong>
        </p>
        <div className="adm-segment" role="radiogroup" aria-label="보고서 자동 삭제 기간">
          {RETENTION.map(([days, label]) => (
            <button
              key={days}
              type="button"
              role="radio"
              aria-checked={data.retentionDays === days}
              disabled={busy}
              onClick={() => days !== data.retentionDays && setConfirm({ kind: 'retention', days, count: countOlderThan(data.reports, days) })}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="adm-card">
        <div className="adm-card-head">
          <h2>모든 보고서 {data.reports.length}개</h2>
          <input
            type="search"
            className="adm-input"
            placeholder="제목 · IP로 찾기"
            aria-label="보고서 찾기"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <p className="adm-desc">
          일반 화면에서는 보고서를 만든 IP에서만 지울 수 있어요. 관리자도 일반 화면에서는 같아요. 다른 사람 보고서나 11/8 전에 만들어 IP가 없는 보고서는 여기서 지워요.
        </p>
        {!data.stored ? (
          <p className="adm-empty">DB가 연결되지 않아 보고서함이 각 브라우저에만 있어요.</p>
        ) : shown.length === 0 ? (
          <p className="adm-empty">보고서가 없어요.</p>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>만든 때</th>
                <th>제목</th>
                <th>만든 IP</th>
                <th>
                  <span className="sr-only">삭제</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="adm-nowrap">{formatAt(r.createdAt)}</td>
                  <td>
                    {r.report.title}
                    <small className="adm-sub"> · 기사 {r.articles?.length ?? 0}건</small>
                  </td>
                  <td className="adm-nowrap">{r.createdIp ?? '기록 없음'}</td>
                  <td className="adm-nowrap">
                    <button type="button" className="adm-btn" disabled={busy} onClick={() => setConfirm({ kind: 'delete', report: r })}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {confirm && (
        <div className="adm-modal-backdrop" onClick={() => !busy && setConfirm(null)}>
          <div className="adm-modal" role="alertdialog" aria-modal="true" aria-labelledby="rep-confirm-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="rep-confirm-title">
              {confirm.kind === 'delete'
                ? `「${confirm.report.report.title}」 보고서를 지울까요?`
                : confirm.days
                  ? `만든 지 ${confirm.days}일 지난 보고서를 자동으로 지울까요?`
                  : '자동 삭제를 끌까요?'}
            </h2>
            <p>
              {confirm.kind === 'delete'
                ? `${formatAt(confirm.report.createdAt)}에 만든 보고서예요. 모든 사람의 보고서함에서 사라지고 되돌릴 수 없어요.`
                : confirm.days
                  ? `저장하면 지금 바로 ${confirm.count}개가 지워지고, 그 뒤 하루 한 번 정리해요. 되돌릴 수 없어요.`
                  : '이제 보고서를 자동으로 지우지 않아요.'}
            </p>
            <div className="adm-modal-actions">
              <button type="button" className="adm-btn" onClick={() => setConfirm(null)} disabled={busy} autoFocus>
                취소
              </button>
              <button type="button" className="adm-btn primary" onClick={run} disabled={busy}>
                {confirm.kind === 'delete' ? '지우기' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default AdminReports
