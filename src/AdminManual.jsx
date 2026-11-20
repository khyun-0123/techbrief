// 관리 페이지 「관리 안내」 (11/20, 관리자 인수인계): 운영 담당자를 위한 설명서를 웹으로 보기(HTML) · 내려받기(PDF)
// 새 판으로 바꾸기는 배포를 마칠 때까지 잠가 둔다 (서버 MANUAL_UPLOAD=on일 때만 열림)
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchManualInfo } from './api.js'

const fmtAt = (iso) => new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' })
const label = (x) => (x?.source === 'uploaded' ? `관리자가 올린 판 (${fmtAt(x.at)})` : '기본 판')

export default function AdminManual({ onToast }) {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [frameKey, setFrameKey] = useState(0)
  const htmlRef = useRef(null)
  const pdfRef = useRef(null)
  const load = useCallback(() => {
    fetchManualInfo().then(setInfo).catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])

  const upload = async (kind, file) => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
      const res = await fetch(`/api/admin/manual/${kind}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: btoa(bin) }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `서버 오류 (${res.status})`)
      onToast?.(`관리 안내 ${kind.toUpperCase()}를 새 판으로 바꿨어요`)
      setFrameKey((k) => k + 1)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="adm-stack">
      <section className="adm-card">
        <div className="adm-ops-head">
          <div>
            <h2>운영 담당자 안내</h2>
            <p className="adm-desc">
              테크브리프를 맡게 된 분이 매일 볼 것, 설정을 바꾸면 무엇이 달라지는지, 문제가 생겼을 때 할 일을 모았어요. 웹 {label(info?.html)} · PDF {label(info?.pdf)}
            </p>
          </div>
          <div className="adm-actions">
            <a className="adm-btn" href="/api/admin/manual/html" target="_blank" rel="noopener">
              새 창으로 보기
            </a>
            <a className="adm-btn primary" href="/api/admin/manual/pdf">
              PDF 내려받기
            </a>
          </div>
        </div>
        <iframe key={frameKey} className="adm-manual-frame" src="/api/admin/manual/html" title="운영 담당자 안내" />
      </section>

      <section className="adm-card">
        <h2>안내 파일 바꾸기</h2>
        {info?.uploadOpen ? (
          <p className="adm-desc">고친 안내를 HTML(웹으로 보기) · PDF(내려받기)로 따로 올려요. 올리면 바로 바뀌고 변경 기록에 남아요. 8MB까지.</p>
        ) : (
          <p className="adm-alert-inline">
            <b>잠겨 있어요.</b> 배포를 마친 뒤 서버 관리자가 열어 드려요. 그전에는 안내를 고칠 내용을 팀에 알려 주세요.
          </p>
        )}
        <div className="adm-actions">
          <input ref={htmlRef} type="file" accept=".html,text/html" hidden onChange={(e) => upload('html', e.target.files?.[0])} />
          <input ref={pdfRef} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => upload('pdf', e.target.files?.[0])} />
          <button type="button" className="adm-btn" disabled={!info?.uploadOpen || busy} onClick={() => htmlRef.current?.click()}>
            HTML 바꾸기
          </button>
          <button type="button" className="adm-btn" disabled={!info?.uploadOpen || busy} onClick={() => pdfRef.current?.click()}>
            PDF 바꾸기
          </button>
        </div>
        {error && <p className="adm-error">{error}</p>}
      </section>
    </div>
  )
}
