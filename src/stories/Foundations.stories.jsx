// 디자인 토큰 한눈에 보기: 색 · 글자 · 간격 · 모서리 · 그림자
// 값은 브라우저가 실제로 계산한 값을 읽어 보여 준다 (tokens.css·index.css를 고치면 여기도 바로 바뀜)
// 브라우저가 계산한 CSS 변수 값
function cssVars(names) {
  const cs = getComputedStyle(document.documentElement)
  return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]))
}

const box = { border: '1px solid var(--tb-color-line-soft)', borderRadius: 12, background: '#fff', padding: 16 }
const mono = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: 'var(--tb-color-text-sub)' }

const COLOR_GROUPS = [
  ['바탕과 면', [
    ['--tb-color-bg', '페이지 바탕'],
    ['--tb-color-bg-strong', '구역 구분 · Warm Grey'],
    ['--tb-color-surface', '카드'],
    ['--tb-color-surface-inverse', '어두운 면 (관리 메뉴, 저장 막대)'],
  ]],
  ['글자와 선', [
    ['--tb-color-text', '본문'],
    ['--tb-color-text-sub', '보조'],
    ['--tb-color-text-faint', '힌트'],
    ['--tb-color-line', '선'],
    ['--tb-color-line-focus', '입력 중인 칸 선'],
  ]],
  ['브랜드 레드 — 강조에만', [
    ['--tb-color-accent', 'Active Red · 점, 선택, 새 신호'],
    ['--tb-color-accent-soft', '연한 레드 바탕'],
    ['--tb-color-highlight', 'Heritage Red · 강조 글자'],
  ]],
  ['상태', [
    ['--tb-color-success', '성공'],
    ['--tb-color-warning', '주의'],
    ['--tb-color-danger', '오류 (강조 레드보다 어둡게)'],
  ]],
  ['기본 버튼 (위 도구막대에서 안 바꾸기)', [
    ['--tb-color-primary', '기본 버튼 바탕'],
    ['--tb-color-on-primary', '기본 버튼 글자'],
  ]],
]

function Colors() {
  const names = COLOR_GROUPS.flatMap(([, items]) => items.map(([n]) => n))
  const v = cssVars(names)
  return (
    <div style={{ display: 'grid', gap: 28 }}>
      <p style={{ margin: 0, color: 'var(--tb-color-text-sub)' }}>
        LG UI Kit 공개 토큰(@enovaui/web-tokens · lg-brand)을 바탕으로 합니다. LG전자 사이트처럼 화면 대부분은 흑백·따뜻한 회색이고, 레드는 작은 강조에만 씁니다.
      </p>
      {COLOR_GROUPS.map(([title, items]) => (
        <section key={title}>
          <h3 style={{ margin: '0 0 12px', fontSize: 'var(--fs-lg)' }}>{title}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {items.map(([name, label]) => (
              <div key={name} style={{ ...box, padding: 0, overflow: 'hidden' }}>
                <div style={{ height: 64, background: `var(${name})`, borderBottom: '1px solid var(--tb-color-line-soft)' }} />
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>{label}</div>
                  <div style={mono}>{name}</div>
                  <div style={mono}>{v[name]}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

const TYPE = [
  ['--fs-h1', '페이지 제목', 700],
  ['--fs-stat', '숫자 카드 값', 700],
  ['--fs-brand', '브랜드 이름', 700],
  ['--fs-lg', '카드 제목', 700],
  ['--fs-base', '본문 · 메뉴 · 기사 제목', 400],
  ['--fs-md', '버튼 · 입력 · 이름표', 400],
  ['--fs-sm', '설명 · 힌트 · 표 머리', 400],
  ['--fs-xs', '배지 · 보조 숫자', 400],
]

function Typography() {
  const v = cssVars(TYPE.map(([n]) => n))
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <p style={{ margin: '0 0 12px', color: 'var(--tb-color-text-sub)' }}>
        글꼴 Pretendard(SIL OFL, 서버에서 직접 제공). 본문 줄 간격 1.5, 제목 1.25. LG 전용 서체(LG EI Text)는 배포 조건이 없어 쓰지 않습니다.
      </p>
      {TYPE.map(([name, role, weight]) => (
        <div key={name} style={{ display: 'grid', gridTemplateColumns: '220px 1fr', alignItems: 'baseline', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--tb-color-line-soft)' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>{role}</div>
            <div style={mono}>
              {name} · {v[name]}
            </div>
          </div>
          <div style={{ fontSize: `var(${name})`, fontWeight: weight, lineHeight: 'var(--lh-tight)' }}>기술 동향 브리핑 Tech Brief 2026</div>
        </div>
      ))}
    </div>
  )
}

const SPACE = ['--tb-space-1', '--tb-space-2', '--tb-space-3', '--tb-space-4', '--tb-space-5', '--tb-space-6', '--tb-space-8', '--tb-space-10']
const RADIUS = [
  ['--tb-radius-button', '버튼'],
  ['--tb-radius-input', '입력칸'],
  ['--tb-radius-card-s', '작은 카드'],
  ['--tb-radius-card', '카드'],
  ['--tb-radius-dialog', '확인 창'],
  ['--tb-radius-full', '칩 · 배지 · 스위치'],
]

function SpacingRadius() {
  const v = cssVars([...SPACE, ...RADIUS.map(([n]) => n)])
  return (
    <div style={{ display: 'grid', gap: 32 }}>
      <section>
        <h3 style={{ margin: '0 0 12px', fontSize: 'var(--fs-lg)' }}>간격 (LG spacing)</h3>
        {SPACE.map((n) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '4px 0' }}>
            <span style={{ ...mono, width: 160 }}>
              {n} · {v[n]}
            </span>
            <span style={{ height: 16, width: `var(${n})`, background: 'var(--tb-color-text)', borderRadius: 2 }} />
          </div>
        ))}
      </section>
      <section>
        <h3 style={{ margin: '0 0 12px', fontSize: 'var(--fs-lg)' }}>모서리 (LG radius-semantic)</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {RADIUS.map(([n, label]) => (
            <div key={n} style={{ textAlign: 'center' }}>
              <div style={{ width: 120, height: 72, border: '2px solid var(--tb-color-text)', borderRadius: `var(${n})`, background: '#fff' }} />
              <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600, marginTop: 6 }}>{label}</div>
              <div style={mono}>{v[n]}</div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3 style={{ margin: '0 0 12px', fontSize: 'var(--fs-lg)' }}>그림자</h3>
        <div style={{ display: 'flex', gap: 24 }}>
          {['--tb-shadow-card', '--tb-shadow-pop'].map((n) => (
            <div key={n} style={{ width: 160, height: 90, borderRadius: 12, background: '#fff', boxShadow: `var(${n})`, display: 'grid', placeItems: 'center', ...mono }}>
              {n}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default { title: 'Foundations', parameters: { backgrounds: { default: 'page' } } }
export const 색 = { render: () => <Colors /> }
export const 글자 = { render: () => <Typography /> }
export const 간격과_모서리 = { name: '간격과 모서리', render: () => <SpacingRadius /> }
