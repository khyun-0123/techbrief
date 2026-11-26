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
// 11/26 (39 문서 3장 D2 · 「발표 뒤」 앞당김): 디스플레이 논문 DB에 없는 말의 처음 · 성장기 논문을 OpenAlex에서 미리 받아 쌓기 (server/papers/prefetch.js)
// 화면이 아니라 서버 일이라 「테스트에서만」 · 「모두」 둘 다 켜짐. 비용(한 말 약 $0.003, 6시간에 최대 2개 말 + 사람이 연 말)이 있어 처음은 끄기
FEATURES.push({
  key: 'papersPrefetch',
  label: '논문 미리 모으기 (처음 · 성장기)',
  desc: '디스플레이 논문 DB에 없는 키워드의 2017년까지 · 2018~2021 · 2022~ 논문을 시기마다 40편씩 받아 둬요. 미리 분석 때 2개씩, 키워드 분석을 열 때 그 말. 「테스트에서만」이나 「모두」면 켜짐 (OpenAlex 한 말 약 $0.003)',
  default: 'off',
})
// 11/26 (31 문서 6-4 · 33 문서 W9): 기술 시계열 「인용 모멘텀(참고)」 줄. 문제가 생기면 배포 없이 「끄기」로 — 끄면 OpenAlex도 부르지 않고 화면 · 보고서 묶음에서 빠짐
FEATURES.push({
  key: 'citationMomentum',
  label: '인용 모멘텀 (기술 시계열 참고 줄)',
  desc: '키워드 분석의 기술 시계열에 최근 2년 논문의 FWCI 평균 · 분야 상위 10% 인용 비율을 참고로 보여 줘요 (단계 판정에는 안 씀, 키워드마다 OpenAlex 1번 · 7일 기억). 「끄기」면 계산도 하지 않아요',
  default: 'all',
})
// 11/26 (45 문서 8장 「모든 출처에 검색」): 자료 현황 「출처」 칸 맨 위 검색칸. 끄면 예전처럼 목록만 (배포 없이 관리 페이지에서 되돌리기)
FEATURES.push({
  key: 'sourceSearch',
  label: '「출처」 칸 안 검색',
  desc: '자료 현황 「출처」(모든 출처) 칸을 열면 맨 위 검색칸으로 출처 이름을 찾아 골라요. 끄면 예전처럼 목록만 보여요',
  default: 'all',
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
