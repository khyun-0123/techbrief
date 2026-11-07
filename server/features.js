// 실험 기능 켜기·끄기 (관리자 화면 「실험 기능」). 기능마다 세 단계:
// - off: 아무 데도 안 보임
// - test: 관리자 테스트 페이지(/admin/test)에서만
// - all: 일반 화면까지 모두에게
// 새 실험 기능은 FEATURES에 한 줄 추가하고, 화면에서는 useFeature('키')로 확인한다 (src/features.js)
import { getSetting, setSetting } from './db/store.js'

export const FEATURES = [
  {
    key: 'sentiment',
    label: '긍정·중립·부정 표시',
    // 13 F5. 담당자님 "크게 도움 안 됨"(14 문서) → 기본은 테스트에서만
    desc: '기사 제목 옆 ○ △ ✕ 표시와 「긍정만」 같은 거르기',
    default: 'test',
  },
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
    default: 'test',
  },
]
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
