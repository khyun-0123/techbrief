// 운영 상태 (관리 페이지 「운영」, server/ops.js). 일반 화면만 영향을 받고, 테스트 페이지(관리자)는 안내만 본다
import { createContext, useContext } from 'react'

export const OPS_LABEL = { normal: '정상', notice: '공지', ai_off: 'AI 기능 정지', maintenance: '점검 중' }

// { mode, message, until, aiBlocked } — aiBlocked: 이 화면에서 요약·보고서 버튼을 막을지
export const OpsContext = createContext({ mode: 'normal', message: '', until: '', aiBlocked: false })

export function useOps() {
  return useContext(OpsContext)
}

export const AI_BLOCKED_TITLE = '지금은 AI 요약·보고서를 잠시 멈췄어요'
