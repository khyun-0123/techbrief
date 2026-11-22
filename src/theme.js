// 화면 테마 라이트 · 다크 (11/21 팀 회의: 「설정에서 라이트 · 다크 모드 전환」)
// - 고른 값은 이 브라우저에 기억한다 (localStorage 'tb-theme'). 고른 적이 없으면 컴퓨터 설정(prefers-color-scheme)을 따른다
// - <html data-theme="dark"> 하나로 바뀐다. 색은 tokens.css의 --tb-* 토큰만 바꾸므로 화면 코드는 그대로
// - 관리 페이지(/admin)는 라이트 그대로 (일반 화면만, index.html 첫 스크립트와 같은 규칙)
// - 보고서 쪽(4:3 슬라이드 · 인쇄)은 종이라 다크에서도 흰 바탕 그대로
import { useSyncExternalStore } from 'react'

const KEY = 'tb-theme'
const listeners = new Set()

function stored() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'light' ? v : null
  } catch {
    return null
  }
}
const systemDark = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches

export function currentTheme() {
  return stored() ?? (systemDark() ? 'dark' : 'light')
}

export function applyTheme(theme = currentTheme()) {
  if (typeof document === 'undefined' || location.pathname.startsWith('/admin')) return
  document.documentElement.dataset.theme = theme
}

export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // 저장 공간을 못 쓰면 이번 화면에서만
  }
  applyTheme(theme)
  listeners.forEach((fn) => fn())
}

// 컴퓨터 설정이 바뀌면 (고른 적이 없을 때만) 따라간다
if (typeof window !== 'undefined') {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (stored()) return
    applyTheme()
    listeners.forEach((fn) => fn())
  })
}

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
// 테마가 바뀌면 다시 그리는 화면(맵 · 그래프처럼 색을 한 번 읽어 쓰는 곳)용
export const useTheme = () => useSyncExternalStore(subscribe, currentTheme, () => 'light')
