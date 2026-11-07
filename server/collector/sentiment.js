// 긍정·중립·부정 빠른 표시 (13 문서 F5). AI 없이 제목의 단어로만 판단한다
// 기사 속 소식 자체가 해당 기술·기업에 긍정적인지 부정적인지를 본다 (우리 회사 입장의 호재·악재가 아님)
// AI 요약이 끝나면 화면은 요약의 판단을 대신 보여 준다

const POSITIVE = [
  '성장', '증가', '상승', '급등', '호조', '호실적', '흑자', '최대', '신기록', '돌파', '탈환', '반등', '강세', '개선',
  '수주', '공급계약', '공급 계약', '선정', '수상', '출시', '양산', '상용화', '성공', '세계 최초', '국내 최초', '최초',
  '확대', '투자 유치', '협력', '협약', '맞손', '견인', '1위', '승인', '인증', '혁신상', '쾌거', '훈풍', '날개',
]
const NEGATIVE = [
  '감소', '하락', '급락', '적자', '손실', '부진', '둔화', '위기', '우려', '리스크', '철수', '중단', '지연', '연기',
  '소송', '제재', '규제', '관세', '해킹', '유출', '사고', '화재', '리콜', '결함', '감원', '구조조정', '파업', '약세',
  '경고', '악화', '취소', '실패', '피해', '논란', '의혹', '검거', '불안', '쇼크', '부담', '차질', '폐업', '타격', '먹구름',
]

// 부정 단어가 들어 있지만 뜻은 반대인 말 (먼저 지운다)
const NEGATED = ['차질없이', '차질 없이', '우려 해소', '우려해소', '리스크 해소', '적자 탈출', '흑자 전환']

const count = (text, words) => words.filter((w) => text.includes(w)).length

// 따옴표로 시작하는 제목(누군가의 말)이나 질문형 제목은 기사 속 사실이 아닐 수 있어 약하게 본다
// → 긍정·부정 단어 차이가 2개 이상일 때만 긍정·부정, 아니면 중립 (hedged: true)
const QUOTE_START = /^\s*["“”‘’'「『]/
const QUESTION = /\?|？|까\s*$|일까|할까|(^|[\s…])왜($|[\s?])|무슨 일|정체는|이유는/

export function titleSentiment(title) {
  let text = String(title ?? '')
  const hedged = QUOTE_START.test(text) || QUESTION.test(text)
  const flipped = NEGATED.filter((w) => text.includes(w)).length
  for (const w of NEGATED) text = text.replaceAll(w, ' ')
  const diff = count(text, POSITIVE) + flipped - count(text, NEGATIVE)
  const need = hedged ? 2 : 1
  const label = diff >= need ? '긍정' : diff <= -need ? '부정' : '중립'
  return hedged ? { label, by: 'title', hedged } : { label, by: 'title' }
}
