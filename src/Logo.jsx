// 테크브리프 로고 마크: 길이가 줄어드는 세 줄(여러 기사를 짧게 요약) + 레드 점(새 기술 신호)
// LG 테마(20 문서): 검정 바탕 + Active Red 점 — 레드는 작은 강조에만
// public/favicon.svg와 같은 모양. 그라데이션 id가 겹치지 않게 useId를 쓴다
import { useId } from 'react'

function LogoMark({ size = 32, className }) {
  const id = useId()
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3d3d3d" />
          <stop offset="1" stopColor="#1a1a1a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      <rect x="14" y="19" width="36" height="6" rx="3" fill="#fff" />
      <rect x="14" y="30" width="27" height="6" rx="3" fill="#fff" fillOpacity="0.85" />
      <rect x="14" y="41" width="17" height="6" rx="3" fill="#fff" fillOpacity="0.7" />
      <circle cx="45" cy="44" r="5" fill="#ea1917" />
    </svg>
  )
}

export default LogoMark
