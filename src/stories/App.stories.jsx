// 지금 앱에서 쓰는 부품 (예전 스타일 그대로). Components의 새 부품으로 바꿔 끼울 때 비교용
import { useState } from 'react'
import AdminRefresh from '../AdminRefresh.jsx'
import { ChipList } from '../ListsPanel.jsx'
import LogoMark from '../Logo.jsx'
import Pager from '../Pager.jsx'
import SummaryItems from '../SummaryItems.jsx'

export default { title: 'App (현재 화면 부품)', parameters: { backgrounds: { default: 'page' } } }

export const 로고 = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'end', gap: 24 }}>
      {[16, 28, 40, 64].map((s) => (
        <div key={s} style={{ textAlign: 'center', fontSize: 12, color: 'var(--tb-color-text-sub)' }}>
          <LogoMark size={s} />
          <div>{s}px</div>
        </div>
      ))}
    </div>
  ),
}

function PagerDemo() {
    const [page, setPage] = useState(6)
    const [size, setSize] = useState(20)
    return (
      <div className="panel" style={{ maxWidth: 900 }}>
        <Pager page={page} pageSize={size} total={240} onPage={setPage} onPageSize={setSize} />
      </div>
    )
}

export const 페이지_이동 = { name: '페이지 이동', render: () => <PagerDemo /> }

const SAMPLE_SUMMARY = {
  items: {
    concept: { text: '마이크로LED는 수십 μm 크기의 LED를 화소로 쓰는 자발광 디스플레이임.', basis: 'article', refs: [1] },
    principle: { text: '각 화소가 스스로 빛을 내 백라이트가 필요 없음.', basis: 'ai_background', refs: [] },
    pros_cons: { text: '밝기·수명이 길지만 전사 공정 수율이 낮아 비쌈.', basis: 'article', refs: [1, 2] },
    competitors: { text: '삼성디스플레이가 양산 라인 구축을 검토 중임.', basis: 'article', refs: [2] },
    application: { text: '대형 사이니지와 AR 기기용 소형 패널부터 검토할 만함.', basis: 'ai_suggestion', refs: [] },
    effect: { text: '수율 개선 시 원가가 크게 낮아질 전망임.', basis: 'article', refs: [1] },
  },
}

export const 여섯_항목_요약 = {
  name: '6항목 요약',
  render: () => (
    <div className="panel" style={{ maxWidth: 760, padding: 20 }}>
      <SummaryItems summary={SAMPLE_SUMMARY} />
    </div>
  ),
}

function ListEditDemo() {
    const [words, setWords] = useState(['마이크로LED', 'OLED'])
    return (
      <div className="adm" style={{ display: 'block', minHeight: 0, background: 'none' }}>
        <section className="adm-card" style={{ maxWidth: 520 }}>
          <ChipList id="kw" label="키워드 추가" hint="일반 사용자는 「네이버에서 찾기」로 다른 말도 찾을 수 있어요" placeholder="예: 마이크로LED" words={words} onChange={setWords} />
        </section>
      </div>
    )
}

export const 목록_편집 = { name: '목록 편집 (관리 페이지)', render: () => <ListEditDemo /> }

const STATUS = {
  settings: { mode: 'interval', time: '06:00', hours: 2, autoSummary: 'off' },
  hourOptions: [1, 2, 3, 4, 6, 8, 12],
  running: null,
  backlog: { remaining: 0, important: 0, done: 0, failed: 0 },
  lastRunAt: '2026-11-05T01:17:00Z',
  lastResult: { added: 56, queued: 5 },
  nextRunAt: '2026-11-05T03:17:00Z',
}

function RefreshDemo() {
    const [settings, setSettings] = useState(STATUS.settings)
    return (
      <div className="adm" style={{ display: 'block', minHeight: 0, padding: 24 }}>
        <AdminRefresh status={{ ...STATUS, settings }} onSave={setSettings} onRun={() => {}} keywords={['마이크로LED', 'OLED']} onGoTargets={() => {}} />
      </div>
    )
}

export const 자동_최신화 = { name: '자동 최신화 (관리 페이지)', parameters: { layout: 'fullscreen' }, render: () => <RefreshDemo /> }
