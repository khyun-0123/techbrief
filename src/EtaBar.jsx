// 예상 시간 막대 · 경과 초 (11/26: 키워드 분석과 자동 보고서 확인 창이 같이 쓰도록 KeywordAnalysis.jsx에서 옮김)
import { useEffect, useState } from 'react'

// 기다리는 동안 1초마다 지금 시각을 새로 받는다 (경과 초)
function useNow(on) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}
const secs = (from, now) => (from ? Math.max(0, Math.round((now - from) / 1000)) : 0)

// 예상 시간 막대 (11/17 조장: 「빈 화면이면 이상하게 생각할 수 있다 — 시간 예측해서 로딩되는 걸 보여 주자」)
// 퍼센트 숫자는 쓰지 않는다(서버도 진행률을 모름, 위 11/11 원칙). 대신 「보통 걸리는 시간」을 기준으로 막대가 차고,
// 그 시간을 넘으면 끝을 모르는 움직이는 막대로 바꾸고 이유를 알린다. 막대 옆 글자는 실제로 지난 초와 보통 시간
export default function EtaBar({ startedAt, expect, label = '보통', slowNote }) {
  const s = secs(startedAt, useNow(true))
  const over = s >= expect
  const pct = Math.min(92, Math.round((s / expect) * 100))
  return (
    <div className={over ? 'eta is-over' : 'eta'}>
      <span className="eta-track" aria-hidden="true">
        <span className="eta-fill" style={over ? undefined : { width: `${pct}%` }} />
      </span>
      <span className="eta-text">
        {s}초째 · {label} {expect}초 안팎
      </span>
      {over && slowNote && <p className="ka-wait-note">{slowNote}</p>}
    </div>
  )
}
