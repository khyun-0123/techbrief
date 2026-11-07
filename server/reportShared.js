// 보고서 글머리 공용 판단 (서버). 화면의 reportStore.js kindOf와 같은 규칙
// 사실(fact)인지 AI 해설·제안(ai)인지. 예전 보고서는 근거 번호로 판단
export const kindOfBullet = (b) => b.kind ?? (b.refs?.length ? 'fact' : 'ai')
