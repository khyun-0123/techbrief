// 유료 논문 표시 (11/14, 보고서팀 작업 이식 · 문구는 개조식으로 고침)
// - access: open(무료 원문) · paid(OpenAlex가 열린 사본을 못 찾음 → 초록까지만) · unknown(정보 없음)
// - 정보가 없으면 유료로 단정하지 않는다 (수집 논문 · 예전 저장 자료에는 access가 없음)
// 근거 기사 목록에서 유료 논문 뒤에 붙는 안내 (개조식)
export const PAID_NOTICE = '유료 논문 — 초록까지만 확인 · 원문: '
export const ACCESS_LABEL = { paid: '유료 논문 · 초록까지만', open: '무료 원문', unknown: '원문 공개 여부 모름' }
export const ACCESS_TITLE = {
  paid: '원문이 유료라 보고서에는 제목 · 저자 · 초록까지만 써요. 원문 링크에서 확인하세요',
  open: '무료로 공개된 원문이 있어요',
  unknown: '원문을 무료로 볼 수 있는지 정보가 없어요',
}
export function paperAccess(a) {
  if (!a?.paper) return null
  if (a.access === 'paid' || a.access === 'open' || a.access === 'unknown') return a.access
  if (a.oaUrl) return 'open'
  return 'unknown'
}
