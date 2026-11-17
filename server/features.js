// 실험 기능 켜기·끄기 (관리자 화면 「실험 기능」). 기능마다 세 단계:
// - off: 아무 데도 안 보임
// - test: 관리자 테스트 페이지(/admin/test)에서만
// - all: 일반 화면까지 모두에게
// 새 실험 기능은 FEATURES에 한 줄 추가하고, 화면에서는 useFeature('키')로 확인한다 (src/features.js)
import { getSetting, setSetting } from './db/store.js'

// 11/17: 긍정·중립·부정 표시(sentiment)는 뺌 — 담당자 「크게 도움 안 됨」(14 문서), 기사 목록의 「자사 위협 · 기회 기술」 표시로 대신
export const FEATURES = [
  {
    key: 'collectPanel',
    label: '자료 현황의 「수집 설정」 칸',
    desc: '자료 현황 오른쪽에 자동 수집 키워드·자동 최신화 상태·회사/관심 기술을 보기 전용으로',
    default: 'test',
  },
  // 키워드 추이('trends')는 11/07 팀 회의에서 기본 기능으로 정함 → 대시보드에 항상 보임
  {
    key: 'refreshButton',
    label: '「지금 최신화」 버튼',
    desc: '자료 현황 위에 「지금 최신화」 버튼 (일반 사용자는 10분에 한 번)',
    default: 'all', // 11/07: 기능은 메인에, 고민되는 것만 테스트 (CLAUDE.md 결정)
  },
]
// 11/17 (39 문서 5장 B2): 자료 현황을 한 쪽씩 서버에서 받기. 데모(11/21) 전 버그 위험이 있어 처음은 테스트 페이지에서만
// 켜면 첫 화면이 7일치 전체(약 4MB) 대신 오늘 숫자 · 중요 30건만 받는다. 끄면 예전 그대로 (server/articlePages.js)
FEATURES.push({
  key: 'articlesPaging',
  label: '자료 현황 한 쪽씩 받기',
  desc: '첫 화면이 자료 전체(약 4MB) 대신 오늘 숫자 · 중요 자료만 받고, 자료 현황은 서버에서 한 쪽씩 받아요. 거르기 · 찾기 규칙은 예전과 같아요',
  default: 'test',
})
export const FEATURE_STATES = ['off', 'test', 'all']
const KEY = 'features'

export async function getFeatures() {
  const saved = await getSetting(KEY, {})
  return Object.fromEntries(FEATURES.map((f) => [f.key, FEATURE_STATES.includes(saved[f.key]) ? saved[f.key] : f.default]))
}

export async function saveFeatures(input = {}) {
  const now = await getFeatures()
  for (const f of FEATURES) if (FEATURE_STATES.includes(input[f.key])) now[f.key] = input[f.key]
  await setSetting(KEY, now)
  return now
}

export function featureList() {
  return FEATURES.map(({ key, label, desc }) => ({ key, label, desc }))
}
