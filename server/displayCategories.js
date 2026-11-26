// 디스플레이 세부 기술 카테고리 (11/12, 교수님 의견 R11 · 35 문서): 디스플레이를 큰 틀이 아니라 들어가는 기술로 나눠 본다
// 특허는 CPC 분류로 나눈다 (제목에 기대지 않음 — 기업 특허 제목은 「Display device」처럼 일반적이라, 33 문서 W21)
// 묶음은 CPC 분류표 정의를 따랐고, 어떤 코드를 어느 카테고리에 넣을지는 [우리 판단] — 전문가 확인 필요 (33 문서)
// 11/26: 9개 분류는 관리 페이지 「세부 설정 › 세부 기술 분류」에서 고친다 (server/tunables.js DEFAULT_CATEGORIES가 예전 목록 그대로)
// 쓰는 곳은 displayCategories()로 그때그때 읽는다. 바꾸면 categoriesVersion()이 기억해 둔 계산의 열쇠에 붙어 다시 센다
export { categoriesVersion, displayCategories } from './tunables.js'

// 특허 출원인 이름 (Google 정리 이름, 대문자) → 화면 이름. 목록에 없는 이름은 법인 꼬리(CO LTD · INC …)를 떼고 보여 준다
// 같은 회사의 다른 이름 묶기는 아직 일부만 (33 문서 W25: CSOT 이름 변경 가능성)
const OWNER_ALIAS = [
  [/^SAMSUNG DISPLAY/, '삼성디스플레이'],
  [/^SAMSUNG ELECTRONICS/, '삼성전자'],
  [/^LG DISPLAY/, 'LG디스플레이'],
  [/^LG ELECTRONICS/, 'LG전자'],
  [/^LG CHEM/, 'LG화학'],
  [/^BOE TECHNOLOGY|^BEIJING BOE|^CHENGDU BOE|^HEFEI BOE|^ORDOS YUANSHENG|^CHONGQING BOE/, 'BOE'],
  [/CHINA STAR OPTOELECTRONICS/, 'CSOT'],
  [/^TIANMA|^SHANGHAI TIANMA|^WUHAN TIANMA|^XIAMEN TIANMA/, '티엔마'],
  [/^VISIONOX|^KUNSHAN GO VISIONOX|^YUNGU/, '비전옥스'],
  [/^SHARP/, '샤프'],
  [/^JAPAN DISPLAY/, 'JDI'],
  [/^SONY/, '소니'],
  [/^APPLE/, '애플'],
  [/^JADE BIRD DISPLAY/, 'JBD'],
  [/^PLAYNITRIDE/, 'PlayNitride'],
  [/^UNIVERSAL DISPLAY/, 'UDC'],
  [/^MERCK PATENT/, '머크'],
  [/^IDEMITSU/, '이데미쓰'],
  [/^DUK SAN|^DUKSAN/, '덕산네오룩스'],
  [/^SEMICONDUCTOR ENERGY LAB/, 'SEL'],
  [/^AU OPTRONICS/, 'AUO'],
  [/^INNOLUX/, 'Innolux'],
  [/^SAMSUNG SDI/, '삼성SDI'],
  [/^SAMSUNG( \(|$)/, '삼성'],
  [/^LG( \(|$)/, 'LG'],
]
export function ownerName(raw) {
  const s = String(raw ?? '').toUpperCase().trim()
  for (const [re, name] of OWNER_ALIAS) if (re.test(s)) return name
  return s
    .replace(/\b(CO|CORP|CORPORATION|INC|LTD|LIMITED|LLC|GMBH|AG|SA|KK|PLC|COMPANY|HOLDINGS?)\b\.?/g, '')
    .replace(/[,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
}
