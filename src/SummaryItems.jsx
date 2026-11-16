// 6항목 요약 표시 (1차 인터뷰). 선별·요약 화면과 자료 현황 목록이 같이 쓴다
const ITEM_LABELS = [
  ['concept', '컨셉'],
  ['principle', '원리'],
  ['pros_cons', '장단점'],
  ['competitors', '타사 현황'],
  ['application', '활용 방안'],
  ['effect', '효과성'],
]
const BASIS_LABEL = {
  article: '자료 근거',
  ai_background: 'AI 보충 · 확인 필요',
  ai_suggestion: 'AI 제안',
}

// 원문 기반 요약 (11/07): 원문 본문으로 만든 요약인지, 원문을 못 가져와 발췌문으로 만든 요약인지
const SOURCE_LABEL = {
  fulltext: ['원문 기준', '기사 원문 본문을 읽고 만든 요약이에요'],
  excerpt: ['발췌문 기준', '원문을 가져오지 못해 검색 결과 발췌문으로 만든 요약이에요. 원문에서 확인하세요'],
  abstract: ['초록 기준', '열린 원문(오픈 액세스 · arXiv)이 없어 논문 초록으로 만든 요약이에요. 원문에서 확인하세요'],
}

function SummaryItems({ summary }) {
  const src = SOURCE_LABEL[summary.basisSource ?? 'excerpt']
  return (
    <>
    <p className={`summary-source summary-source-${summary.basisSource ?? 'excerpt'}`} title={summary.basisFrom ? `${src[1]} (원문: ${summary.basisFrom})` : src[1]}>
      {src[0]}
      {summary.basisFrom && ` · ${summary.basisFrom}`}
    </p>
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
    </>
  )
}

export default SummaryItems
