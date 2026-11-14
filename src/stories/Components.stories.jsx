// 기본 부품 (src/ui). 각 스토리는 상태별 모양을 한 화면에 모아 보여 준다
import { useState } from 'react'
import { Alert, Badge, Button, Card, Chip, Dialog, Pills, SaveBar, Segmented, StatTile, Switch, Tabs, TextField } from '../ui/index.jsx'
import Dropdown, { PeriodSeg, Seg } from '../Dropdown.jsx'

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
    const [src, setSrc] = useState('all')
    const [folder, setFolder] = useState('inbox')
    return (
      <div style={col}>
        <p style={{ margin: 0, color: 'var(--tb-color-text-sub)' }}>
          고르는 칸 규칙 (11/15): 브라우저 기본 선택 칸(select)은 쓰지 않아요. 선택지가 2~3개이고 짧으면 분리형 버튼(Segmented), 많거나 길거나 개수가 바뀌면 드롭다운(Dropdown).
        </p>
        <div>
          <p style={label}>드롭다운 (Dropdown) — 출처처럼 묶음이 있는 목록 · 폴더처럼 개수가 바뀌는 목록</p>
          <div style={row}>
            <Dropdown
              label="출처"
              value={src}
              onChange={setSrc}
              options={[
                { value: 'all', label: '모든 출처' },
                { group: '출처 단계', options: [{ value: 'tier:1', label: '1차 · 기업 발표·학회·논문' }, { value: 'tier:2', label: '2차 · 전문매체' }, { value: 'tier:3', label: '3차 · 일반 뉴스' }] },
                { group: '매체', options: ['디일렉', 'ZDNet Korea', '전자신문', 'DIGITIMES'].map((x) => ({ value: x, label: x })) },
              ]}
            />
            <Dropdown size="sm" label="폴더" value={folder} onChange={setFolder} options={[{ value: 'inbox', label: '미분류' }, { value: 'f1', label: '탠덤 OLED · 자동' }, { value: 'f2', label: 'LED' }]} />
            <Dropdown label="비활성" value="x" disabled options={[{ value: 'x', label: '관리자가 정해요' }]} />
          </div>
        </div>
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

// 버튼 체계 (11/15 조장: 「버튼 사이즈 통일 · 요소마다 모양이 제각각 · 기간 버튼셋」) — 앱이 실제로 쓰는 클래스 · 부품 그대로
// 크기 2단계(큰 40 · 작은 32, tokens.css --tb-control-lg/md) × 모양은 역할마다 하나. docs/20 8장
function ButtonSystem() {
  const [p1, setP1] = useState('week')
  const [p2, setP2] = useState('all')
  const [sort, setSort] = useState('importance')
  const [view, setView] = useState('map')
  const [src, setSrc] = useState('all')
  const [size, setSize] = useState(20)
  const periods = [
    { value: 'today', label: '오늘' },
    { value: 'week', label: '최근 7일' },
    { value: 'all', label: '전체' },
  ]
  const th = { textAlign: 'left', padding: '8px 12px', fontSize: 'var(--fs-sm)', color: 'var(--tb-color-text-sub)', borderBottom: '1px solid var(--tb-color-line-soft)' }
  const td = { padding: '12px', borderBottom: '1px solid var(--tb-color-line-soft)', verticalAlign: 'middle' }
  const cell = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1000 }}>
      <p style={{ margin: 0, color: 'var(--tb-color-text-sub)' }}>
        크기는 두 단계예요 — <b>큰 40px</b>(쪽 머리 · 도구줄 · 입력칸과 한 줄), <b>작은 32px</b>(카드 · 목록 · 칸 안). 모양은 역할마다 하나라서, 모양만 보고 「누르면 일어나는 것 / 하나 고르는 것 / 켜고 빼는 값」을 알 수 있어요.
      </p>
      <table style={{ borderCollapse: 'collapse', background: 'var(--tb-color-surface)', borderRadius: 12 }}>
        <thead>
          <tr>
            <th style={th}>역할 · 모양</th>
            <th style={th}>큰 40 (쪽 머리 · 도구줄)</th>
            <th style={th}>작은 32 (카드 · 목록 · 칸 안)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={td}>
              <b>행동 버튼</b> · 박스 8
            </td>
            <td style={td}>
              <div style={cell}>
                <button type="button" className="btn primary">
                  자료 찾기 →
                </button>
                <button type="button" className="btn">
                  자동으로 보고서 만들기
                </button>
              </div>
            </td>
            <td style={td}>
              <div style={cell}>
                <button type="button" className="act-btn">
                  요약 보기
                </button>
                <button type="button" className="pane-zoom">
                  ⤢ 크게 보기
                </button>
                <button type="button" className="km-act">
                  PNG 저장
                </button>
              </div>
            </td>
          </tr>
          <tr>
            <td style={td}>
              <b>하나 고르기</b> · 분리형 (2~4개 · 짧은 글자)
            </td>
            <td style={td}>
              <div style={cell}>
                <PeriodSeg value={p1} onChange={setP1} options={periods} />
                <Seg size="lg" value={sort} onChange={setSort} label="정렬" options={[{ value: 'importance', label: '중요도순' }, { value: 'latest', label: '최신순' }]} />
              </div>
            </td>
            <td style={td}>
              <div style={cell}>
                <Seg value={view} onChange={setView} label="보기" options={[{ value: 'map', label: '마인드맵' }, { value: 'cloud', label: '워드클라우드' }]} />
                <div style={{ width: 172 }}>
                  <PeriodSeg size="md" full value={p2} onChange={setP2} label="생성 기간" options={[{ value: 'all', label: '전체' }, { value: 'today', label: '오늘' }, { value: '7', label: '7일' }, { value: '30', label: '30일' }, { value: '90', label: '90일' }]} />
                </div>
              </div>
            </td>
          </tr>
          <tr>
            <td style={td}>
              <b>목록에서 고르기</b> · 드롭다운 (많음 · 김 · 개수가 바뀜)
            </td>
            <td style={td}>
              <Dropdown size="lg" label="출처" value={src} onChange={setSrc} options={[{ value: 'all', label: '모든 출처' }, { group: '출처 단계', options: [{ value: 't1', label: '1차 · 기업 발표·학회·논문' }, { value: 't2', label: '2차 · 전문매체' }] }]} />
            </td>
            <td style={td}>
              <Dropdown size="sm" label="페이지당 개수" value={size} onChange={setSize} options={[10, 20, 50].map((n) => ({ value: n, label: `${n}개씩` }))} />
            </td>
          </tr>
          <tr>
            <td style={td}>
              <b>값 칩</b> · 알약 (고른 말 · 폴더 · 거르기, 켜고 빼기)
            </td>
            <td style={td}>—</td>
            <td style={td}>
              <div style={cell}>
                <button type="button" className="chip">
                  LG디스플레이 ×
                </button>
                <button type="button" className="folder-chip">
                  ▤ 미분류 17
                </button>
              </div>
            </td>
          </tr>
          <tr>
            <td style={td}>
              <b>아이콘 버튼</b> · 정사각 32
            </td>
            <td style={td}>—</td>
            <td style={td}>
              <button type="button" className="split-close" aria-label="닫기">
                ×
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p style={{ margin: 0, color: 'var(--tb-color-text-faint)', fontSize: 'var(--fs-sm)' }}>
        고르는 칸 배정 — 분리형: 기간(대시보드 · 자료 현황 · 내 보고서 생성 기간) · 정렬 · 마인드맵/워드클라우드 · 보고서 조사 수준 · 자동 최신화 주기 · 자동 요약 기간 / 드롭다운: 출처 · 폴더 · 출처 단계 · 긍정·부정 · 최신화 간격 · 페이지당 개수(자주 안 바꿈)
      </p>
    </div>
  )
}

export const 버튼_체계 = { name: '버튼 체계', render: () => <ButtonSystem /> }
