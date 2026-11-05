// 기본 부품 (src/ui). 각 스토리는 상태별 모양을 한 화면에 모아 보여 준다
import { useState } from 'react'
import { Alert, Badge, Button, Card, Chip, Dialog, Pills, SaveBar, Segmented, StatTile, Switch, Tabs, TextField } from '../ui/index.jsx'

const row = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }
const col = { display: 'grid', gap: 20, maxWidth: 720 }
const label = { fontSize: 'var(--fs-sm)', color: 'var(--tb-color-text-sub)', margin: '0 0 8px', fontWeight: 600 }

export default { title: 'Components', parameters: { backgrounds: { default: 'page' } } }

export const 버튼 = {
  render: () => (
    <div style={col}>
      <p style={{ margin: 0, color: 'var(--tb-color-text-sub)' }}>
        위 도구막대 「기본 버튼」에서 검정 안 / 레드 안을 바꿔 볼 수 있어요. 한 화면에 기본 버튼은 하나만 둡니다.
      </p>
      {['md', 'sm', 'lg'].map((size) => (
        <div key={size}>
          <p style={label}>크기 {size}</p>
          <div style={row}>
            <Button size={size}>저장</Button>
            <Button size={size} variant="secondary">
              되돌리기
            </Button>
            <Button size={size} variant="ghost">
              전체 기록 보기
            </Button>
            <Button size={size} variant="danger">
              지우기
            </Button>
            <Button size={size} disabled>
              비활성
            </Button>
          </div>
        </div>
      ))}
    </div>
  ),
}

function BadgesAndChips() {
    const [words, setWords] = useState(['마이크로LED', 'OLED', 'QD-EL'])
    return (
      <div style={col}>
        <div>
          <p style={label}>배지</p>
          <div style={row}>
            <Badge tone="solid">중요</Badge>
            <Badge tone="accent" dot>
              새 신호
            </Badge>
            <Badge tone="accent">AI 사용</Badge>
            <Badge>AI 안 씀</Badge>
            <Badge tone="warning">AI 보충 · 확인 필요</Badge>
            <Badge tone="success">기사 근거</Badge>
          </div>
        </div>
        <div>
          <p style={label}>칩 (× 로 지우기)</p>
          <div style={row}>
            {words.map((w) => (
              <Chip key={w} onRemove={() => setWords(words.filter((x) => x !== w))}>
                {w}
              </Chip>
            ))}
            <Chip>보기 전용</Chip>
          </div>
        </div>
      </div>
    )
}

export const 배지와_칩 = { name: '배지와 칩', render: () => <BadgesAndChips /> }

export const 입력칸 = {
  render: () => (
    <div style={{ ...col, maxWidth: 420 }}>
      <TextField id="kw" label="키워드 추가" placeholder="예: 마이크로LED" hint="입력하고 「추가」 또는 Enter" action={<Button variant="secondary">추가</Button>} />
      <TextField id="id" label="아이디" defaultValue="admin" />
      <TextField id="pw" label="비밀번호" type="password" error="비밀번호를 입력해 주세요." />
    </div>
  ),
}

function Selection() {
    const [mode, setMode] = useState('interval')
    const [hours, setHours] = useState(2)
    const [tab, setTab] = useState('info')
    const [on, setOn] = useState(true)
    return (
      <div style={col}>
        <div>
          <p style={label}>세 칸 버튼 (Segmented)</p>
          <Segmented label="주기" options={[['off', '꺼짐'], ['daily', '매일'], ['interval', '몇 시간마다']]} value={mode} onChange={setMode} />
        </div>
        <div>
          <p style={label}>알약 버튼 (Pills)</p>
          <Pills label="간격" options={[1, 2, 3, 4, 6, 8, 12].map((h) => [h, `${h}시간`])} value={hours} onChange={setHours} />
        </div>
        <div>
          <p style={label}>스위치 — 켜짐은 Active Red</p>
          <div style={row}>
            <Switch checked={on} onChange={setOn} label={on ? '자동 요약 켜짐' : '자동 요약 꺼짐'} />
            <Switch checked={false} disabled label="비활성" />
          </div>
        </div>
        <div>
          <p style={label}>탭 — LG 사이트처럼 굵은 검정 + 밑줄</p>
          <Tabs tabs={[['info', '경영정보'], ['money', '재무정보'], ['stock', '주식정보'], ['ir', 'IR행사']]} value={tab} onChange={setTab} />
        </div>
      </div>
    )
}

export const 선택 = { render: () => <Selection /> }

export const 카드와_숫자 = {
  name: '카드와 숫자',
  render: () => (
    <div style={{ display: 'grid', gap: 16, maxWidth: 960 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatTile label="오늘 수집된 이슈" value="47개" sub="기사 99건" />
        <StatTile label="자동 수집 키워드" value="2개" />
        <StatTile label="마지막 수집" value="11. 5. 10:17" sub="새 기사 56건" />
        <StatTile label="자동 요약 대기" value="0건" sub="자동 요약 꺼짐" />
      </div>
      <Card title="수집 대상" desc="키워드 2개 · 관심 기술 2개 · 경쟁사 6개" action={<Button variant="secondary" size="sm">바꾸기</Button>}>
        <div style={row}>
          <Chip>마이크로LED</Chip>
          <Chip>OLED</Chip>
        </div>
      </Card>
    </div>
  ),
}

export const 알림 = {
  render: () => (
    <div style={{ ...col, gap: 8 }}>
      <Alert tone="success">모두 정상이에요.</Alert>
      <Alert tone="info">자동 최신화가 꺼져 있어요. 직접 누를 때만 모아요.</Alert>
      <Alert tone="warning" action={<Button variant="secondary" size="sm">수집 대상으로</Button>}>
        관심 기술이 비어 있어 사업 연관성을 판단하지 못해요.
      </Alert>
      <Alert tone="danger">AI 서버에 연결되지 않아 요약·보고서를 만들 수 없어요.</Alert>
    </div>
  ),
}

export const 저장_막대와_확인_창 = {
  name: '저장 막대와 확인 창',
  render: () => (
    <div style={{ ...col, maxWidth: 760 }}>
      <SaveBar count={2} items={['자동 수집 키워드', '자동 최신화']} />
      <div style={{ padding: 32, borderRadius: 16, background: 'rgb(16 24 40 / 45%)' }}>
        <Dialog
          title="아직 저장하지 않은 변경이 있어요"
          actions={
            <>
              <Button variant="danger">저장하지 않고 떠나기</Button>
              <span className="tb-spacer" />
              <Button variant="secondary">머무르기</Button>
              <Button>저장하고 이동</Button>
            </>
          }
        >
          <p>이 페이지를 떠나면 바꾼 내용이 사라져요: 자동 최신화</p>
        </Dialog>
      </div>
    </div>
  ),
}
