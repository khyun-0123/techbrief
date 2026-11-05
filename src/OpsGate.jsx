// 운영 상태에 따라 일반 화면을 연다 (19 문서 6장)
// - 점검 중: 뉴스 화면 대신 안내 화면. 재개되면 저절로 다시 열림
// - 그 밖: 뉴스 화면에 운영 상태를 넘긴다 (공지 띠 · AI 버튼 막기는 App이)
// - 테스트 페이지(mode='test', 관리자)는 막지 않고 안내만
import { useEffect, useState } from 'react'
import { fetchOps } from './api.js'
import App from './App.jsx'
import LogoMark from './Logo.jsx'

const NORMAL = { mode: 'normal', message: '', until: '' }

function Maintenance({ ops }) {
  return (
    <main className="maint">
      <div className="maint-card">
        <div className="maint-brand">
          <LogoMark size={28} />
          <span>테크브리프</span>
        </div>
        <h1>점검 중이에요</h1>
        <p className="maint-msg">{ops.message || '더 나은 서비스를 위해 잠시 점검하고 있어요.'}</p>
        {ops.until && <p className="maint-until">재개 예정 · {ops.until}</p>}
        <p className="maint-note">점검이 끝나면 이 화면이 저절로 바뀌어요. 만들던 선별 · 보고서는 브라우저에 그대로 남아 있어요.</p>
      </div>
    </main>
  )
}

function OpsGate({ mode = 'normal' }) {
  const [ops, setOps] = useState(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      fetchOps()
        .then((o) => alive && setOps(o))
        .catch(() => alive && setOps((prev) => prev ?? NORMAL)) // 못 읽으면 막지 않음 (서버 오류는 화면이 따로 알림)
    load()
    const timer = setInterval(load, 30_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  if (!ops) return null
  if (mode !== 'test' && ops.mode === 'maintenance') return <Maintenance ops={ops} />
  return <App mode={mode} ops={ops} />
}

export default OpsGate
