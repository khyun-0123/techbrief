// 서버가 알려 주는 한도 (11/26, 관리 페이지 「세부 설정 › 보고서 한도」 — server/tunables.js)
// /api/features 응답의 limits로 받는다 (App.jsx가 켜질 때). 못 받으면 처음 값 그대로
const L = { reportArticles: 10 }

export function setLimits(limits) {
  const n = Number(limits?.reportArticles)
  if (Number.isInteger(n) && n >= 5 && n <= 20) L.reportArticles = n
}
export const reportLimit = () => L.reportArticles
