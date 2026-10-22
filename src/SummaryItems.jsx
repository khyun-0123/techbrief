// 6항목 요약 표시 (1차 인터뷰). 선별·요약 화면과 수집 현황 목록이 같이 쓴다
const ITEM_LABELS = [
  ['concept', '컨셉'],
  ['principle', '원리'],
  ['pros_cons', '장단점'],
  ['competitors', '타사 현황'],
  ['application', '활용 방안'],
  ['effect', '효과성'],
]
const BASIS_LABEL = {
  article: '기사 근거',
  ai_background: 'AI 보충 · 확인 필요',
  ai_suggestion: 'AI 제안',
}

function SummaryItems({ summary }) {
  return (
    <dl className="ai-summary">
      {ITEM_LABELS.map(([key, label]) => {
        const item = summary.items?.[key]
        if (!item) return null
        return (
          <div key={key} className="ai-item">
            <dt>{label}</dt>
            <dd>
              {item.text}
              {item.basis === 'article' && item.refs?.length > 0 && <span className="ref"> [{item.refs.join('][')}]</span>}
              <span className={`basis basis-${item.basis}`}>{BASIS_LABEL[item.basis] ?? item.basis}</span>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

export default SummaryItems
