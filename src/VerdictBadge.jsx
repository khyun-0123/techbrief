// 자료 목록의 「자사 위협 기술 · 자사 기회 기술」 (11/17, 긍정·중립·부정 표시를 대신함)
// 기사 내용을 판정한 것이 아니라, 기사에 나온 **기술**의 특허 비교 판정(규칙, server/techVerdicts.js)을 보여 준다
// 모양은 「요즘 뜨는 기술」 옆 표시(.tr-verdict)와 같게
function VerdictBadge({ verdict }) {
  if (!verdict) return null
  const v = verdict
  const why = [
    `「${v.term}」 기술의 특허 비교 판정이에요 (이 자료 내용을 판정한 것이 아니에요).`,
    `${v.category} 특허 ${v.years}: ${v.fastest ? `${v.fastest.name} ${v.fastest.ratio}배 vs ` : ''}자사 ${v.own ?? '-'}배 (분야 ${v.field ?? '-'}배).`,
    `「${v.term}」 특허의 ${Math.round((v.share ?? 0) * 100)}%가 이 분류예요.`,
  ].join('\n')
  return (
    <span className={`tr-verdict verdict-badge tr-${v.verdict === '위협' ? 'threat' : 'chance'}`} title={why}>
      자사 {v.verdict} 기술 · {v.term}
    </span>
  )
}

export default VerdictBadge
