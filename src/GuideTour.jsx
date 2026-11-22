// 사용 안내 (11/15 팀 회의: 「처음 방문했을 때 사용자 설명을 띄우고, 설명서 보는 버튼도 — 다음 다음 누르면서 보는 것」)
// - 처음 온 사람에게 대시보드에서 한 번 자동으로 열림 (이 브라우저에 「봤음」을 기억, App.jsx TOUR_KEY). 상단 「? 사용 안내」로 언제든 다시
// - 실제 화면 요소를 차례로 밝혀 주고(나머지는 어둡게) 옆에 설명 카드. 가리킬 요소가 없으면 화면 가운데 카드
// - 키보드: → · Enter = 다음, ← = 이전, Esc = 닫기
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { pageZoom } from './utils.js'

const TOUR_STEPS = [
  {
    title: '테크브리프에 오신 걸 환영해요',
    body: [
      '논문 · 특허 · 기업 발표 · 전문매체 · 뉴스를 모아, 근거 번호가 달린 보고서 초안까지 만들어 주는 도구예요.',
      '흐름은 네 단계예요 — ① 대시보드에서 키워드 분석 → ② 볼 범위 고르기 → ③ 자료 고르고 요약 → ④ 보고서.',
      '1분이면 둘러볼 수 있어요. 「다음」을 눌러 주세요.',
    ],
  },
  {
    target: '.dash-searchbar',
    title: '① 키워드 분석',
    body: ['궁금한 기술을 넣고 「분석」을 누르세요 (예: 탠덤 OLED).', '기술 단계(신생 · 성장 · 성숙)와 논문 · 특허 흐름, 연관 키워드 맵이 나와요.'],
  },
  {
    target: '.trend-rail',
    title: '요즘 뜨는 기술',
    body: ['평소보다 관심 · 연구 신호가 커진 기술이에요. 이름을 누르면 바로 분석해요.', '「자사 위협 · 기회」 표시를 누르면 경쟁사 특허 비교 근거를 볼 수 있어요.'],
  },
  {
    target: '.dash-search .ka',
    title: '② 볼 범위 고르기',
    body: [
      '처음엔 요즘 뜨는 기술 1위를 분석해 둬요. 마인드맵의 점을 누르면 볼 범위에 들어가고(검정 ✓ 알약), 검정 점 옆 「+n」은 가지를 펼쳐요.',
      '레버로 고를 개수를 정하고 「자료 찾기」 — 또는 「자동으로 보고서 만들기」를 누르면 중요한 자료를 골라 확인 창을 거쳐 보고서까지 만들어요.',
    ],
  },
  {
    target: '[data-tour="tab-collect"]',
    title: '③ 자료 현황',
    body: ['모은 자료(논문 · 기업 발표 · 전문매체 · 뉴스)예요. 기간 · 출처로 거르고, 「+ 선별」로 담아요.', '「+ 자료 추가」로 링크 · 파일 · 텍스트도 넣을 수 있어요.'],
  },
  {
    target: '[data-tour="tab-select"]',
    title: '선별 · 요약',
    body: ['담은 자료는 원문 기반으로 요약돼요. 문장마다 근거 번호가 붙고, 「AI 보충」은 따로 표시돼요.', '폴더로 묶고, 오른쪽 「보고서」 칸에서 초안을 만들어요.'],
  },
  {
    target: '[data-tour="tab-reports"]',
    title: '④ 내 보고서',
    body: ['만든 보고서는 4:3 한 장 + 유첨이에요. 미리 보고 PPT로 내려받아요.', '지우면 휴지통으로 가고, 휴지통에서 되살릴 수 있어요.'],
  },
  {
    target: '[data-tour="guide"]',
    title: '다시 보려면',
    body: ['이 안내는 언제든 위 「사용 안내」에서 다시 볼 수 있어요.'],
  },
]

export default function GuideTour({ open, onClose, steps = TOUR_STEPS }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const nextRef = useRef(null)
  const step = steps[i]
  const last = i === steps.length - 1

  // 가리킬 요소 자리 (스크롤 · 창 크기 바뀌면 다시)
  const measure = useCallback(() => {
    const el = step?.target ? document.querySelector(step.target) : null
    if (!el) return setRect(null)
    const r = el.getBoundingClientRect()
    const z = pageZoom() // 작은 노트북 배율 (utils.js): 화면 픽셀 → CSS 픽셀
    setRect(r.width && r.height ? { x: r.left / z, y: r.top / z, w: r.width / z, h: r.height / z } : null)
  }, [step])
  useLayoutEffect(() => {
    if (!open) return undefined
    const el = step?.target ? document.querySelector(step.target) : null
    if (el) {
      // 휴대폰: 카드를 화면 아래에 붙이므로 밝힐 요소는 위쪽(고정 상단바 아래)으로
      if (window.innerWidth < 600) {
        const r = el.getBoundingClientRect()
        const sticky = getComputedStyle(el.closest('.topbar') ?? document.body).position === 'sticky'
        if (!sticky) window.scrollTo({ top: Math.max(0, window.scrollY + r.top - 140), behavior: 'instant' })
      } else el.scrollIntoView({ block: 'center', behavior: 'instant' })
    }
    const t = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(t)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, step, measure])
  useEffect(() => {
    if (open) nextRef.current?.focus()
  }, [open, i])
  useEffect(() => {
    if (!open) return undefined
    const key = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setI((n) => Math.min(steps.length - 1, n + 1))
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, onClose, steps.length])
  if (!open || !step) return null

  // 카드 자리: 밝힌 요소 아래(자리가 없으면 위), 화면 안으로. 요소가 없으면 가운데
  const vw = window.innerWidth / pageZoom()
  const vh = window.innerHeight / pageZoom()
  const cw = Math.min(380, vw - 32)
  let style = { width: cw }
  const phone = vw < 600
  if (phone) style = { left: 16, right: 16, bottom: 16 } // 휴대폰: 카드는 화면 아래 (11/15 390px 실측: 위치 계산으로는 버튼이 잘렸음)
  else if (rect) {
    const below = rect.y + rect.h + 14
    const top = below + 230 < vh ? below : Math.max(16, rect.y - 14 - 230)
    style = { ...style, left: Math.max(16, Math.min(vw - cw - 16, rect.x + rect.w / 2 - cw / 2)), top }
  }
  const pad = 6
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect ? <div className="tour-hole" style={{ left: rect.x - pad, top: rect.y - pad, width: rect.w + pad * 2, height: rect.h + pad * 2 }} aria-hidden="true" /> : <div className="tour-dim" aria-hidden="true" />}
      <section className={phone ? 'tour-card bottom' : rect ? 'tour-card' : 'tour-card center'} style={style}>
        <p className="tour-count">
          {i + 1} / {steps.length}
        </p>
        <h2 id="tour-title">{step.title}</h2>
        {step.body.map((t) => (
          <p key={t}>{t}</p>
        ))}
        <div className="tour-dots" aria-hidden="true">
          {steps.map((s, k) => (
            <span key={s.title} className={k === i ? 'on' : ''} />
          ))}
        </div>
        <div className="tour-foot">
          {last ? (
            <span />
          ) : (
            <button type="button" className="btn-text" onClick={onClose}>
              건너뛰기
            </button>
          )}
          <span className="tour-nav">
            {i > 0 && (
              <button type="button" className="btn" onClick={() => setI(i - 1)}>
                이전
              </button>
            )}
            <button ref={nextRef} type="button" className="btn primary" onClick={() => (last ? onClose() : setI(i + 1))}>
              {last ? '시작하기' : '다음 →'}
            </button>
          </span>
        </div>
      </section>
    </div>
  )
}
