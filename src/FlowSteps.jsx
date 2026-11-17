// 지금 어느 단계인지 한 줄 (11/17 조장: 「버튼이 많아 뭘 눌러 다음으로 가야 할지 모르겠다」 → 39 문서 C6)
// 흐름 = 키워드 → 범위 고르기(맵) → 자료 고르기(자료 현황) → 보고서. 단계마다 진한 단추는 다음 단계로 가는 것 하나만 둔다
// current: 지금 단계 번호 (0부터). note: 지금 단계 옆 짧은 말 (예: 「투명 LED + 3개」)
const FLOW = ['키워드', '범위 고르기', '자료 고르기', '보고서']

export default function FlowSteps({ current, note }) {
  return (
    <ol className="flow-steps" aria-label="진행 단계">
      {FLOW.map((name, i) => (
        <li key={name} className={i < current ? 'is-done' : i === current ? 'is-now' : 'is-next'} aria-current={i === current ? 'step' : undefined}>
          <span className="flow-mark" aria-hidden="true">
            {i < current ? '✓' : i + 1}
          </span>
          {name}
          {i === current && note && <span className="flow-note">{note}</span>}
        </li>
      ))}
    </ol>
  )
}
