// 관리 페이지 「저장하지 않은 변경」 모음 (11/26 조장: 「수집 출처에서 고치고 새로고침해도 그냥 돼 버린다 — 알려 줘야 하지 않나, 이런 곳 더 점검」)
// 카드마다 자기 「저장 · 적용」 단추를 가진 곳(수집 출처 · 세부 설정 · 중요도 · 판정 · 보고서 양식 · 운영 등)은
// 바꾼 값이 그 카드 안에만 있어서, 새로고침 · 다른 메뉴 · 로그아웃 때 아무 말 없이 사라졌다.
// 카드가 <Unsaved id label when={바뀜} />을 두면 여기 모이고, AdminApp이 떠나기 경고 · 확인 창 · 저장 막대에 함께 쓴다.
import { useEffect, useState } from 'react'

const items = new Map() // id → 이름
const subs = new Set()
const emit = () => subs.forEach((f) => f())

export function Unsaved({ id, label, when }) {
  useEffect(() => {
    if (!when) return undefined
    items.set(id, label)
    emit()
    return () => {
      items.delete(id)
      emit()
    }
  }, [id, label, when])
  return null
}

export function useUnsavedList() {
  const [, setN] = useState(0)
  useEffect(() => {
    const f = () => setN((n) => n + 1)
    subs.add(f)
    return () => subs.delete(f)
  }, [])
  return [...items.values()]
}
