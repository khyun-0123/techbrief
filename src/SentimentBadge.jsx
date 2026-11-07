// 긍정·중립·부정 ○ △ ✕ (13 문서 F5). 선별할지 빠르게 판단하는 보조 표시 — 투자 판단용이 아님
// 기사 속 소식 자체의 성격 (우리 회사 입장의 유불리가 아님)
// by: 'title'이면 제목 단어로 빠르게 판단한 것, 없으면 AI 요약의 판단
import { useFeature } from './features.js'

const MARK = { 긍정: '○', 중립: '△', 부정: '✕' }
const CLASS = { 긍정: 'good', 중립: 'neutral', 부정: 'bad' }
const OLD_LABEL = { 호재: '긍정', 악재: '부정' } // 예전 요약에 저장된 이름

export function sentimentLabel(sentiment) {
  const label = sentiment?.label
  return OLD_LABEL[label] ?? label
}

// AI 요약의 판단이 있으면 그것, 없으면 제목 기준
export function sentimentOf(article, summary) {
  return summary?.sentiment ?? article?.titleSentiment ?? null
}

function SentimentBadge({ sentiment }) {
  const show = useFeature('sentiment') // 실험 기능 (관리자 화면에서 켜고 끔)
  const label = sentimentLabel(sentiment)
  if (!show || !MARK[label]) return null
  const byTitle = sentiment.by === 'title'
  const title = byTitle
    ? `제목 단어로 빠르게 판단했어요.${sentiment.hedged ? ' 인용·질문형 제목이라 약하게 봤어요.' : ''} AI 요약이 끝나면 요약 기준으로 바뀌어요`
    : `${sentiment.reason ?? ''} (AI 요약 기준 · 투자 판단용이 아니에요)`
  return (
    <span className={`sentiment ${CLASS[label]}${byTitle ? ' by-title' : ''}`} title={title}>
      {MARK[label]} {label}
    </span>
  )
}

export default SentimentBadge
