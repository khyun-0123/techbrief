// 디스플레이 세부 기술 카테고리 (11/12, 교수님 의견 R11 · 35 문서): 디스플레이를 큰 틀이 아니라 들어가는 기술로 나눠 본다
// 특허는 CPC 분류로 나눈다 (제목에 기대지 않음 — 기업 특허 제목은 「Display device」처럼 일반적이라, 33 문서 W21)
// 묶음은 CPC 분류표 정의를 따랐고, 어떤 코드를 어느 카테고리에 넣을지는 [우리 판단] — 전문가 확인 필요 (33 문서)
export const DISPLAY_CATEGORIES = [
  { id: 'oled', name: 'OLED 소자', cpc: '^(H10K5|H01L51/5|H01L27/32|H05B33)' },
  { id: 'material', name: '발광 재료 · 양자점', cpc: '^(C09K11|H10K85)' },
  { id: 'led', name: '마이크로 · 미니 LED', cpc: '^(H01L33|H10H|H01L25/075|H01L27/15)' },
  { id: 'tft', name: 'TFT 백플레인', cpc: '^(H01L27/12|H01L29/786|H10D86|H10D30/67)' },
  { id: 'drive', name: '구동 · 회로', cpc: '^G09G' },
  { id: 'lcd', name: '액정', cpc: '^G02F1/13' },
  { id: 'form', name: '폴더블 · 기기 구조', cpc: '^(G09F9|G06F1/1652|H04M1/0268)' },
  { id: 'touch', name: '터치 일체형', cpc: '^G06F3/0412' },
  { id: 'xr', name: 'AR · VR 광학', cpc: '^(G02B27/01|G02B30|G03H1)' },
]

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
