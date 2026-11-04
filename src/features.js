// 실험 기능 (관리자 화면 「실험 기능」, server/features.js). 기능마다 꺼짐 / 테스트에서만 / 모두에게
// 일반 화면(/)은 '모두에게'만, 테스트 페이지(/admin/test)는 '테스트에서만'까지 켠다
import { createContext, useContext } from 'react'

export const FeaturesContext = createContext(new Set())

// 이 화면에서 켜진 기능 키 모음
export function enabledFeatures(states = {}, mode = 'normal') {
  return new Set(Object.entries(states).filter(([, s]) => s === 'all' || (mode === 'test' && s === 'test')).map(([k]) => k))
}

export function useFeature(key) {
  return useContext(FeaturesContext).has(key)
}
