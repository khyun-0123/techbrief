// 관리 페이지 「보고서 관리」 (11/08)
// - 모든 보고서를 지울 수 있는 곳은 여기뿐이다. 일반 화면에서는 관리자도 자기 IP로 만든 보고서만 지운다
// - 자동 정리: 만든 지 정한 기간이 지난 보고서를 하루 한 번 휴지통으로 (기본 꺼짐). 바꾸면 바로 한 번 정리
// - 휴지통 보관 기간 (11/13 조장): 휴지통에 정한 기간 있으면 영구 삭제 (기본 30일, 「안 지움」 가능). 여기서 지우면 휴지통 없이 바로 영구 삭제
import { useEffect, useState } from 'react'
import { deleteReportApi, fetchAdminReports, saveReportRetentionApi, saveReportTrashDaysApi } from './api.js'

const TRASH = [
  [0, '안 지움'],
  [7, '7일'],
  [30, '30일'],
  [90, '90일'],
]
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
      } else if (confirm.kind === 'trash') {
        const { purged } = await saveReportTrashDaysApi(confirm.days)
        onToast({ text: confirm.days ? `휴지통 보관 기간을 ${confirm.days}일로 바꿨어요. 지금 ${purged}개를 영구 삭제했어요.` : '휴지통을 자동으로 비우지 않아요.' })
      } else {
        const { deleted } = await saveReportRetentionApi(confirm.days)
        onToast({ text: confirm.days ? `자동 정리를 ${confirm.days}일로 바꿨어요. 지금 ${deleted}개를 휴지통으로 옮겼어요.` : '자동 정리를 껐어요.' })
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
        <h2>휴지통 보관 기간</h2>
        <p className="adm-desc">
          일반 화면에서 지운 보고서는 휴지통으로 가요. 휴지통에 이 기간 있으면 하루 한 번 영구 삭제해요. 만든 사람은 그 전에 휴지통에서 되살리거나 직접 영구 삭제할 수 있어요. 지금:{' '}
          <strong>{data.trashDays ? `${data.trashDays}일 뒤 영구 삭제` : '자동으로 지우지 않음'}</strong> · 휴지통 {data.reports.filter((r) => r.deletedAt).length}개
        </p>
        <div className="adm-segment" role="radiogroup" aria-label="휴지통 보관 기간">
          {TRASH.map(([days, label]) => (
            <button
              key={days}
              type="button"
              role="radio"
              aria-checked={data.trashDays === days}
              disabled={busy}
              onClick={() => days !== data.trashDays && setConfirm({ kind: 'trash', days, count: data.reports.filter((r) => r.deletedAt && days && Date.parse(r.deletedAt) < Date.now() - days * 86_400_000).length })}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="adm-card">
        <h2>자동 정리</h2>
        <p className="adm-desc">
          만든 지 정한 기간이 지난 보고서를 하루 한 번 휴지통으로 옮겨요 (바로 지우지 않음). 지금:{' '}
          <strong>{data.retentionDays ? `${data.retentionDays}일 지나면 휴지통으로` : '꺼짐'}</strong>
        </p>
        <div className="adm-segment" role="radiogroup" aria-label="보고서 자동 정리 기간">
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
          일반 화면에서는 보고서를 만든 IP에서만 휴지통으로 옮기고 되살려요. 관리자도 일반 화면에서는 같아요. 여기서 지우면 휴지통을 거치지 않고 바로 영구 삭제돼요.
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
                    <small className="adm-sub"> · 기사 {r.articles?.length ?? 0}건{r.deletedAt ? ` · 휴지통 (${formatAt(r.deletedAt)})` : ''}</small>
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
                : confirm.kind === 'trash'
                  ? confirm.days
                    ? `휴지통 보관 기간을 ${confirm.days}일로 할까요?`
                    : '휴지통을 자동으로 비우지 않을까요?'
                  : confirm.days
                    ? `만든 지 ${confirm.days}일 지난 보고서를 휴지통으로 옮길까요?`
                    : '자동 정리를 끌까요?'}
            </h2>
            <p>
              {confirm.kind === 'delete'
                ? `${formatAt(confirm.report.createdAt)}에 만든 보고서예요. 휴지통을 거치지 않고 모든 사람의 보고서함에서 사라지며 되돌릴 수 없어요.`
                : confirm.kind === 'trash'
                  ? confirm.days
                    ? `저장하면 휴지통에 ${confirm.days}일 넘게 있던 ${confirm.count}개가 지금 영구 삭제되고, 그 뒤 하루 한 번 정리해요. 되돌릴 수 없어요.`
                    : '휴지통의 보고서는 만든 사람이나 관리자가 지울 때까지 남아요.'
                  : confirm.days
                    ? `저장하면 지금 ${confirm.count}개가 휴지통으로 옮겨지고, 그 뒤 하루 한 번 정리해요. 휴지통에서 되살릴 수 있어요.`
                    : '이제 보고서를 자동으로 휴지통에 옮기지 않아요.'}
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
