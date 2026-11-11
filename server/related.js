// 연관 키워드 (11/10, 대시보드 「키워드 분석」 맵의 재료): 키워드와 같은 기사에 함께 나온 말을 규칙으로 센다 (AI 안 씀)
// - 워드클라우드팀 맵이 들어오기 전 임시 재료. 워드클라우드팀 맵과 같은 성격(뉴스에서 함께 나온 한글 단어)으로 맞췄다 (32 문서)
// - 재료: 네이버 정확도순 100건(1번) + 우리가 모은 기사 중 그 키워드가 든 것(최근 60일, 1·2차 출처 포함)
//   네이버 결과는 제목 · 요약에서 낱말 수만 세고 저장하지 않는다 (약관 23 문서: 저장 · AI 입력 아님)
// - 같은 소식(제목이 비슷한 기사)은 한 번만 센다 → 「함께 나온 이슈 수」. 기사 수가 아니라 이슈 수라 보도량에 덜 휘둘린다
// - 종류: 회사(경쟁사 · 자사 목록, 알려진 회사 이름) / 기술(영문 · 숫자 용어, 기술 낱말이 든 말, 관심 기술) / 일반(나머지)
//   레버의 자동 고르기는 「일반」을 건너뛴다 (예: 구매, 게이머)
import { dbEnabled, query } from './db/index.js'
import { similarity } from './collector/dedupe.js'
import { getLists } from './collector/lists.js'
import { searchNews } from './collector/naver.js'
import { cleanText } from './collector/normalize.js'
import { cacheGet, cachePut } from './papers/index.js'
import { queryKey } from './queryTerms.js'

const TTL = 6 * 3600_000
const MAX_NODES = 24

// 조사 · 어미 (낱말 끝에서 뗀다). 긴 것부터
const JOSA = ['으로부터', '에서는', '에서도', '으로는', '으로도', '에게서', '까지는', '보다는', '이라는', '라는', '에서', '으로', '에게', '까지', '부터', '보다', '처럼', '마다', '이나', '에는', '에도', '와의', '과의', '하고', '이며', '이고', '은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '도', '로', '만', '며']
// 뜻이 약한 말 (뉴스 문장에 흔한 말). 끝이 「했다 · 한다 · 하는 …」인 말은 아래 규칙으로 뺀다
const STOP = new Set(
  `기자 뉴스 사진 제공 관련 경우 이번 지난 올해 내년 최근 현재 당시 이후 이전 가운데 특히 또한 한편 이를 다만 위한 위해 대한 대해 통해 따라 따른 대비 기준 수준 이상 이하 정도 가장 매우 더욱 모두 함께 직접 다시 이미 아직 바로 계속 처음 마지막
  국내 해외 글로벌 세계 시장 업계 업체 기업 회사 제품 기술 산업 분야 사업 부문 전략 계획 예정 전망 목표 성장 확대 강화 개발 출시 공개 발표 진행 추진 기록 차지 규모 가능 필요 중요 주요 대표 다양 새로운 신규 최대 최고 최초 세대 차세대 이날 오는 위치 일부 전체 대상 방식 활용 적용 제공 지원 구축 운영 확보 선보 판매 공급 생산 투자 협력
  기존 기반 시스템 화면 구조 신제품 브랜드 현지 공략 인터넷 카페 모델 제품군 라인업 버전 시리즈 성능 가격 소비자 고객 사용자 이용자 업그레이드 서비스 솔루션 플랫폼 콘텐츠 행사 전시 전시회 부스 참가 관계자 설명 설명했다 강조 의미 분석 평가 결과 이유 상황 문제 영향 효과 변화 수요 실적 매출 영업이익 분기 상반기 하반기 연간 점유율 경쟁 경쟁력 우위 선도 주도 본격 가속 해당 각각 다른 여러 일반 기본 추가 별도 동시 자체 독자 신규 기능 장점 단점
  있는 있다 없는 없다 같은 등의 등을 등이 및 또 더 약 각 총 첫 전 후 중 내 간 측 시 개 대 명 건 곳 번 년 월 일 점 원 달러 억 조 만`
    .split(/\s+/)
    .filter(Boolean),
)
const VERB_END = /(했다|한다|하는|했던|된다|됐다|되는|됐던|하며|하고|해야|하기|해서|했고|했으며|이다|였다|입니다|합니다|겠다|않는|않다|라며|이라며|이라고|라고|에서의|으로써|로써|이었다|있으며|있어|있고|없이)$/
const TECH_WORD = /(디스플레이|패널|모니터|기판|소자|공정|소재|반도체|발광|주사율|해상도|화질|밝기|명암|번인|광원|픽셀|화소|렌즈|칩|메모리|배터리|센서|증착|잉크젯|탠덤|양자점|올레드|마이크로|미니|폴더블|롤러블|투명|플렉서블|게이밍|노트북|스마트폰|태블릿|TV|헤르츠|인치|광학|전력|효율|수명|구동|백라이트|컬러|색재현|편광|유리|레이저|웨이퍼|파운드리|패키징|AI)/i
// 영어 기능어 (11/11 실측: 「SEM」 맵에 THE · AND · with가 「기술」로 잡혀 자동으로 골라짐). 대소문자 상관없이 뺀다
const EN_STOP = new Set(
  `a an the and or but nor so yet of in on at to for from by with without into onto over under about above below after before between among through during via per vs versus as is are was were be been being am do does did done have has had having will would shall should can could may might must not no yes it its this that these those there here than then also just only very more most less least such same other any each every all both few many much some own new our we you your they their them he she his her i me my us what which who whom whose when where why how if else up down out off again once`
    .split(/\s+/)
    .filter(Boolean),
)
const COMPANY = /^(삼성|삼성전자|삼성디스플레이|LG|LG전자|LG디스플레이|SK|SK하이닉스|BOE|CSOT|TCL|HKC|AOC|티엔마|비전옥스|샤프|JDI|소니|애플|구글|메타|마이크로소프트|엔비디아|인텔|AMD|퀄컴|TSMC|샤오미|화웨이|레노버|에이수스|ASUS|MSI|델|HP|기가바이트|에이서|알파스캔|한성컴퓨터|벤큐|뷰소닉|필립스|파나소닉|하이센스|스카이워스|UDC|머크|이데미쓰|덕산네오룩스|솔루스첨단소재|주성엔지니어링|AP시스템|선익시스템|원익IPS|PI첨단소재|코닝|니치아|오스람|플레이나이트라이드)$/i

// 외래어 끝의 「이」는 조사가 아니다 (디스플레이 · 플레이 · 스카이 · 바이 …, 11/10 실측: 「디스플레」로 잘림)
const LOAN_I = /(레이|플레이|카이|바이|데이|파이|라이|케이|에이|오이|이이|웨이|트레이|베이|게이|메이|세이|키이)$/
function stripJosa(w) {
  for (const j of JOSA) {
    if (!(w.length > j.length && w.endsWith(j))) continue
    if (j === '이' && LOAN_I.test(w)) continue
    return w.slice(0, -j.length)
  }
  return w
}

// 한 글에서 후보 낱말 (겹치지 않게)
export function wordsOf(text) {
  const out = new Set()
  const t = cleanText(text)
  // 영문 · 숫자 용어: QD-OLED, OLED, 240Hz, 4K, HKC
  for (const m of t.matchAll(/\b(?:\d{2,4}\s?(?:Hz|hz|인치)|[A-Za-z][A-Za-z0-9]*(?:[-+][A-Za-z0-9]+)*)\b/g)) {
    const w = m[0].replace(/\s+/g, '')
    if (w.length < 2 || /^\d+$/.test(w) || EN_STOP.has(w.toLowerCase())) continue
    out.add(/^[a-z]+$/.test(w) && w.length <= 3 ? w.toUpperCase() : w)
  }
  // 한글 (영문이 붙은 말 포함: LG디스플레이, OLED패널)
  for (const m of t.matchAll(/[A-Za-z0-9]*[가-힣]+[A-Za-z0-9가-힣]*/g)) {
    let w = stripJosa(m[0])
    if (VERB_END.test(w) || (w.length >= 3 && /[혔했됐었였렸켰웠졌봤왔갔냈썼섰났쳤]다$|[가-힣]다$/.test(w) && !TECH_WORD.test(w))) continue // 「밝혔다」 같은 서술어
    w = w.replace(/(들|적|화)$/, (x) => (w.length > 3 ? '' : x))
    if (w.length < 2 || w.length > 12 || STOP.has(w)) continue
    out.add(w)
  }
  return out
}

// 같은 뜻 말 합치기 (기사가 번갈아 쓰는 말, 11/10 실측: 「유기발광다이오드」가 OLED와 따로 잡힘)
const SAME = { 유기발광다이오드: 'OLED', 올레드: 'OLED', 유기발광: 'OLED', 발광다이오드: 'LED', 양자점: 'QD', 액정표시장치: 'LCD', 마이크로엘이디: '마이크로LED', LGD: 'LG디스플레이', 삼성디: '삼성디스플레이' }
// 레버 자동 고르기에서 빼는 말: 두 글자 영문(PC · TV · AI · LG …)처럼 너무 넓은 말 — 직접 누르면 들어간다
// 「디스플레이 · 패널 · 화면」은 우리 분야에선 거의 모든 글에 나와 범위를 좁히지 못한다
const BROAD_WORDS = new Set(['디스플레이', '패널', '화면', '반도체', '기술', '제품'])
export const tooBroad = (w) => /^[A-Za-z]{1,2}$/.test(w) || BROAD_WORDS.has(w)

const kindOf = (w, lists) => {
  const low = w.toLowerCase()
  if (COMPANY.test(w) || [...(lists.competitors ?? []), ...(lists.own ?? [])].some((n) => n.toLowerCase() === low)) return 'company'
  if ((lists.interests ?? []).some((n) => n.toLowerCase() === low)) return 'tech'
  if (/^[A-Za-z0-9][A-Za-z0-9+-]*$/.test(w) || TECH_WORD.test(w)) return 'tech'
  return 'general'
}

async function collectedDocs(center) {
  if (!dbEnabled()) return []
  const k = `%${center.toLowerCase().replace(/\s+/g, '').replace(/[%_\\]/g, '\\$&')}%`
  const { rows } = await query(
    `SELECT coalesce(full_title, title) AS title, coalesce(description, '') AS description FROM articles
      WHERE published_at > now() - interval '60 days'
        AND lower(regexp_replace(coalesce(full_title, title) || ' ' || coalesce(description, ''), '\\s+', '', 'g')) LIKE $1
      ORDER BY published_at DESC LIMIT 300`,
    [k],
  )
  return rows
}

// 돌려주는 값: { center, docs, issues, nodes: [{ word, kind, score(함께 나온 이슈 수), share }] }
export async function relatedWords(rawCenter, { refresh = false } = {}) {
  const center = String(rawCenter ?? '').trim().slice(0, 50)
  if (!center) throw Object.assign(new Error('키워드를 입력해 주세요.'), { status: 400 })
  const key = `related:v2:${queryKey(center)}` // v2: 영어 기능어를 빼기 전(11/11) 기억한 값은 쓰지 않는다
  if (!refresh) {
    const hit = await cacheGet(key).catch(() => null)
    if (hit) return { ...hit, cached: true }
  }
  const [naver, mine, lists] = await Promise.all([
    searchNews(center, { sort: 'sim' }).catch(() => []),
    collectedDocs(center).catch(() => []),
    getLists(),
  ])
  const docs = [...naver.map((i) => ({ title: cleanText(i.title), description: cleanText(i.description) })), ...mine]
  // 같은 소식 한 번만: 제목이 많이 비슷하면 같은 이슈
  const issues = []
  for (const d of docs) {
    if (!d.title) continue
    const same = issues.find((x) => similarity(x.title, d.title) >= 0.5)
    if (same) same.text += ` ${d.description}`
    else issues.push({ title: d.title, text: `${d.title} ${d.description}` })
  }
  const own = wordsOf(center)
  const ownSquash = center.toLowerCase().replace(/\s+/g, '')
  const count = new Map()
  for (const is of issues) for (const raw of new Set([...wordsOf(is.text)].map((x) => SAME[x] ?? x))) {
    const w = raw
    const low = w.toLowerCase()
    if (own.has(w) || ownSquash.includes(low) || low.includes(ownSquash)) continue // 키워드 자신과 그 조각
    count.set(w, (count.get(w) ?? 0) + 1)
  }
  // 대소문자만 다른 영문은 합친다 (OLED · oled)
  const merged = new Map()
  for (const [w, n] of count) {
    const k = w.toLowerCase()
    const e = merged.get(k)
    if (!e || n > e.n) merged.set(k, { w, n: n + (e?.n ?? 0) })
    else e.n += n
  }
  const min = Math.max(2, Math.ceil(issues.length * 0.03))
  const nodes = [...merged.values()]
    .filter((x) => x.n >= min && x.n < issues.length * 0.9) // 너무 드문 말 · 거의 모든 글에 나오는 말은 뺀다
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_NODES)
    .map((x) => ({ word: x.w, kind: kindOf(x.w, lists), score: x.n, share: Math.round((x.n / Math.max(1, issues.length)) * 100) / 100, broad: tooBroad(x.w) }))
  const out = { center, docs: docs.length, issues: issues.length, nodes, at: new Date().toISOString() }
  await cachePut(key, out, TTL).catch(() => {})
  return { ...out, cached: false }
}
