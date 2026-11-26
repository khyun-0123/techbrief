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
// ── 판단 규칙 바꾸기 스위치 (11/26, 33 문서 6장 W2 · W34 · W27 · W25) ──
// 서버 계산(중요도 · 특허 세기 · 상용화 문장)을 바꾼 것들. 배포 없이 관리 페이지 「실험 기능」에서 되돌린다.
// - 「모두에게」 = 새 규칙, 「꺼짐」 = 예전 규칙 그대로 (예전 코드는 지우지 않고 남겨 둠)
// - 서버 계산은 사람마다 나눌 수 없어 「테스트에서만」도 예전 규칙(꺼짐과 같음)
// - 바꾸면 자료 현황 목록 · 중요도를 다시 계산한다 (server/index.js PUT /api/features → onRuleFlagChange)
FEATURES.push(
  {
    key: 'rerunWeighted',
    server: true,
    label: '[판단 규칙] 「첫 소식」 재탕 판정 보강 (W2)',
    desc: '며칠 뒤 다른 말로 다시 쓴 같은 소식도 재탕으로 봐요(드문 낱말 무게 · 같은 이슈 기사 제목까지). 끄면 예전 판정(글자 조각 0.35, 대표 기사만). 바꾸면 중요도를 다시 계산해요',
    default: 'all',
  },
  {
    key: 'patentSolarExclude',
    server: true,
    label: '[판단 규칙] 특허 셀 때 태양전지 · 광검출기 제목 빼기 (W34)',
    desc: '제목으로 세는 모든 기술에서 태양전지 · 광검출기 · 엑스선 검출기 특허를 빼요(검색어가 그 말이면 빼지 않음). 끄면 예전처럼 「기술 ↔ CPC 연결표」 기술에만',
    default: 'all',
  },
  {
    key: 'commercialYearStrict',
    server: true,
    label: '[판단 규칙] 상용화 시점 문장 고르기 강화 (W27)',
    desc: '투자 · 실적 · 주가 · 과거 일 문장을 빼고, 연도 바로 뒤에 양산 · 출시 말이 오는 문장만 골라요. 끄면 예전 규칙(연도 + 양산 · 출시 낱말)',
    default: 'all',
  },
  {
    key: 'applicantAlias',
    server: true,
    label: '[판단 규칙] 특허 출원인 이름 묶기 (W25)',
    desc: '같은 회사의 여러 이름(BOE 계열사 · CSOT/TCL · 삼성디스플레이 · LG디스플레이 등)을 한 회사로 묶어 세요. 끄면 예전처럼 이름 글자 그대로',
    default: 'all',
  },
)
export const FEATURE_STATES = ['off', 'test', 'all']
const KEY = 'features'

// 판단 규칙 스위치 값 (10초 기억 — 점수 · 특허를 셀 때마다 DB를 읽지 않게). 바꾸면 바로 비움
let flagCache = { at: 0, value: null }
export async function getFeatures() {
  const saved = await getSetting(KEY, {})
  return Object.fromEntries(FEATURES.map((f) => [f.key, FEATURE_STATES.includes(saved[f.key]) ? saved[f.key] : f.default]))
}
export async function serverFlag(key) {
  if (!flagCache.value || Date.now() - flagCache.at > 10_000) {
    try {
      flagCache = { at: Date.now(), value: await getFeatures() }
    } catch {
      flagCache = { at: Date.now(), value: Object.fromEntries(FEATURES.map((f) => [f.key, f.default])) }
    }
  }
  return flagCache.value[key] === 'all'
}
export const RULE_FLAGS = FEATURES.filter((f) => f.server).map((f) => f.key)
// 기억해 둔 계산(키워드 묶음 등)의 열쇠에 붙이는 값: 판단 규칙 스위치를 바꾸면 새로 계산, 되돌리면 예전 기억을 다시 씀
export async function ruleSig() {
  const on = await Promise.all(RULE_FLAGS.map((k) => serverFlag(k).catch(() => false)))
  return on.map((b) => (b ? '1' : '0')).join('')
}

export async function saveFeatures(input = {}) {
  const now = await getFeatures()
  for (const f of FEATURES) if (FEATURE_STATES.includes(input[f.key])) now[f.key] = input[f.key]
  await setSetting(KEY, now)
  flagCache = { at: 0, value: null }
  return now
}

export function featureList() {
  return FEATURES.map(({ key, label, desc }) => ({ key, label, desc }))
}
