// 호재·악재 ○ △ ✕ (13 문서 F5). 선별할지 빠르게 판단하는 보조 표시 — 투자 판단용이 아님
const MARK = { 호재: '○', 중립: '△', 악재: '✕' }
const CLASS = { 호재: 'good', 중립: 'neutral', 악재: 'bad' }

function SentimentBadge({ sentiment }) {
  if (!sentiment?.label || !MARK[sentiment.label]) return null
  return (
    <span className={`sentiment ${CLASS[sentiment.label]}`} title={`${sentiment.reason ?? ''} (투자 판단용이 아니에요)`}>
      {MARK[sentiment.label]} {sentiment.label}
    </span>
  )
}

export default SentimentBadge
