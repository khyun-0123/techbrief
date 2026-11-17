// 자사·자회사, 경쟁사, 관심 기술 목록 (13 문서 F6). 사용자가 화면에서 고치고 팀이 같이 쓴다 (DB app_settings)
import { getKeywords, getSetting, setSetting } from '../db/store.js'
import { DEFAULT_SUPPLIERS } from '../suppliers.js'

const KEY = 'org_lists'
const MAX = 40

// 고객사는 LG디스플레이. 자사 기사 제외는 LG 계열 전체로 본다
export const DEFAULT_LISTS = {
  // 자사 = 고객사(LG디스플레이)만 (11/11: 「LG」 전체로 보면 LG전자 사이니지 앱 · 정수기 기사까지 자사 점수를 받았다)
  own: ['LG디스플레이', 'LGD', '엘지디스플레이', 'LG Display'],
  competitors: (process.env.COMPETITORS ?? '삼성디스플레이,BOE,CSOT,티엔마,샤프,JDI').split(','),
  interests: [],
  // 소부장 기업 (11/17 R10, server/suppliers.js): 특허 출원인 · 기사 언급 표시. 중요도 점수에는 안 씀
  suppliers: DEFAULT_SUPPLIERS,
}

function cleanList(list) {
  if (!Array.isArray(list)) return []
  return [...new Set(list.map((w) => String(w).trim()).filter(Boolean))].slice(0, MAX)
}

function normalize(input = {}) {
  return {
    own: cleanList(input.own ?? DEFAULT_LISTS.own),
    competitors: cleanList(input.competitors ?? DEFAULT_LISTS.competitors),
    interests: cleanList(input.interests ?? DEFAULT_LISTS.interests),
    suppliers: cleanList(input.suppliers ?? DEFAULT_LISTS.suppliers),
  }
}

// 관심 기술 = 자동 수집 키워드 (11/17 조장: 둘 다 「회사가 관심을 두는 기술」이라 하나로 합침, 37 문서 Q4)
// 예전엔 관리 페이지에서 따로 적었고 값도 수집 키워드와 같았다. 저장해 둔 예전 interests 값은 읽지 않는다 (DB가 없을 때만 씀)
export async function getLists() {
  const lists = normalize((await getSetting(KEY, null)) ?? DEFAULT_LISTS)
  const keywords = await getKeywords().catch(() => null)
  return keywords?.length ? { ...lists, interests: cleanList(keywords) } : lists
}

export async function saveLists(input) {
  const saved = (await getSetting(KEY, null)) ?? {}
  const lists = normalize({ ...input, interests: saved.interests ?? [] }) // 관심 기술은 자동 수집 키워드로 바꾸므로 그대로 둔다
  await setSetting(KEY, lists)
  return getLists()
}

// 글에 목록의 이름이 나오면 처음 찾은 이름을 돌려준다 (영문은 대소문자 무시)
export function findMention(text, names) {
  const t = String(text).toLowerCase()
  return names.find((n) => t.includes(n.toLowerCase())) ?? null
}
