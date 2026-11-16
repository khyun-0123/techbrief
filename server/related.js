// 연관 키워드 (11/10, 대시보드 「키워드 분석」 맵의 재료): 키워드와 같은 기사에 함께 나온 말을 규칙으로 센다 (AI 안 씀)
// - 워드클라우드팀 맵이 들어오기 전 임시 재료. 워드클라우드팀 맵과 같은 성격(뉴스에서 함께 나온 한글 단어)으로 맞췄다 (32 문서)
// - 재료: 네이버 정확도순 100건(1번) + 우리가 모은 기사 중 그 키워드가 든 것(11/15: 기간 제한 없이 최근 1,000건, 1·2차 출처 포함) + 그 기사의 AI 요약 문장
// - 낱말 뽑기 (11/15): 한글은 형태소 분석기 Kiwi로 명사만(server/kiwi.js, 붙어 있던 조각은 이음), 모델이 없으면 예전 규칙(조사 · 어미 떼기)
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
import { isException, isStop, subcatsOf } from './wordFilter.js'
import { loadKiwi, nounsOf } from './kiwi.js'

const TTL = 6 * 3600_000 // 맵 점의 기사(wordArticles)
const MAP_TTL = 24 * 3600_000 // 맵 (11/17: 6시간 → 24시간, 미리 분석 작업이 6시간마다 대상 맵을 만들어 둔다 · 37 문서 P3)
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

// Kiwi 명사 중 뉴스에 흔하고 뜻이 약한 말 (11/15 실측: 3단계에 자주 나옴). 「하다 · 되다」가 붙은 쓰임은 kiwi.js가 이미 뺌 — 여기는 명사로 쓰인 경우
const KIWI_STOP = new Set('얘기 인터뷰 향상 증가 감소 개선 도입 부분 의심 언론 평균 전화 관련 이용 사용 경우 정도 가능성 필요성 측면 상태 내용 사실 생각 모습 이야기 질문 답변 발언 설명 보도 취재 기사 매체 업계 관계자'.split(' '))

// 한 글에서 후보 낱말 (겹치지 않게). kiwi가 있으면 한글은 Kiwi 명사로 (11/15)
export function wordsOf(text, kiwi = null) {
  const out = new Set()
  const t = cleanText(text)
  // 영문 · 숫자 용어: QD-OLED, OLED, 240Hz, 4K, HKC
  for (const m of t.matchAll(/\b(?:\d{2,4}\s?(?:Hz|hz|인치)|[A-Za-z][A-Za-z0-9]*(?:[-+][A-Za-z0-9]+)*)\b/g)) {
    const w = m[0].replace(/\s+/g, '')
    if (w.length < 2 || /^\d+$/.test(w) || EN_STOP.has(w.toLowerCase())) continue
    if (!isException(w) && isStop(w)) continue // 워드클라우드팀 불용어 · 예외 (11/14, wordFilter.js)
    out.add(/^[a-z]+$/.test(w) && w.length <= 3 ? w.toUpperCase() : w)
  }
  // 한글 — Kiwi 명사 (영문만인 조각은 위에서 이미 셈). 예외어는 다른 거르기를 건너뜀
  const nouns = nounsOf(kiwi, t)
  if (nouns) {
    for (const raw of nouns) {
      if (!/[가-힣]/.test(raw)) continue
      const w = raw
      if (w.length >= 2 && w.length <= 14 && isException(w)) {
        out.add(w)
        continue
      }
      if (w.length < 2 || w.length > 14 || STOP.has(w) || KIWI_STOP.has(w) || isStop(w)) continue
      if (/^[A-Z가-힣]{1,2}씨$/.test(w) || /^\d[\d.,]*(점|명|건|곳|개|원|%)$/.test(w)) continue // 「A씨 · 한씨」(익명) · 「30.18점 · 100점」(숫자) — 11/15 3단계 실측
      out.add(w)
    }
    return out
  }
  // (Kiwi가 없을 때) 한글 (영문이 붙은 말 포함: LG디스플레이, OLED패널)
  for (const m of t.matchAll(/[A-Za-z0-9]*[가-힣]+[A-Za-z0-9가-힣]*/g)) {
    let w = stripJosa(m[0])
    // 디스플레이 · 반도체 예외어(응답속도 · 양자점 …)는 다른 거르기를 건너뛴다 (11/14, 워드클라우드팀 예외 v3)
    if (w.length >= 2 && w.length <= 12 && isException(w)) {
      out.add(w)
      continue
    }
    if (VERB_END.test(w) || (w.length >= 3 && /[혔했됐었였렸켰웠졌봤왔갔냈썼섰났쳤]다$|[가-힣]다$/.test(w) && !TECH_WORD.test(w))) continue // 「밝혔다」 같은 서술어
    w = w.replace(/(들|적|화)$/, (x) => (w.length > 3 ? '' : x))
    if (w.length < 2 || w.length > 12 || STOP.has(w) || isStop(w)) continue // + 워드클라우드팀 불용어 v3 (1차 검수본)
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
  // 11/15: 기간 제한(60일 · 300건)을 풀고 최근 1,000건 + 그 기사의 AI 요약 문장(개념 · 원리 · 효과 …)을 같이 센다
  const { rows } = await query(
    `SELECT coalesce(a.full_title, a.title) AS title,
            coalesce(a.description, '') || ' ' || coalesce((SELECT string_agg(v->>'text', ' ') FROM jsonb_each(s.content->'items') AS e(key, v)), '') AS description
       FROM articles a
       LEFT JOIN summaries s ON s.article_id = a.id
      WHERE lower(regexp_replace(coalesce(a.full_title, a.title) || ' ' || coalesce(a.description, '') || ' ' || coalesce(s.content::text, ''), '\\s+', '', 'g')) LIKE $1
      ORDER BY a.published_at DESC LIMIT 1000`,
    [k],
  )
  return rows
}

// 교차선 · 2단계 (11/14 통합, 워드클라우드팀 맵 v2의 규칙을 서버로):
// - 교차선: 1단계 말 둘이 함께 나온 이슈 3개 이상이고 NPMI 0.15 초과 (팀 규칙 그대로)
// - 2단계: 1단계 말(상위 14개)마다, 그 말이 든 이슈에서 함께 나온 다른 말 상위 5개 (2개 이슈 이상, 키워드 · 1단계 말 제외)
const CHILD_FOR = 14
const CHILD_MAX = 5
const GRAND_MAX = 4 // 3단계 (11/15): 2단계 말마다, 그 말이 든 이슈에서 함께 나온 다른 말 상위 4개 (2개 이슈 이상, 키워드 · 1단계 · 부모 · 형제 제외)
function linksOf(nodes, issueWords, merged) {
  const N = issueWords.length
  const lows = nodes.map((n) => n.word.toLowerCase())
  const has = lows.map((w) => issueWords.map((s) => s.has(w)))
  const edges = []
  for (let i = 0; i < lows.length; i++)
    for (let j = i + 1; j < lows.length; j++) {
      let both = 0
      for (let k = 0; k < N; k++) if (has[i][k] && has[j][k]) both++
      if (both < 3) continue
      const pa = nodes[i].score / N
      const pb = nodes[j].score / N
      const pab = both / N
      const npmi = pab >= 1 ? 1 : Math.log(pab / (pa * pb)) / -Math.log(pab)
      if (npmi > 0.15) edges.push({ a: nodes[i].word, b: nodes[j].word, n: both, npmi: Math.round(npmi * 100) / 100 })
    }
  const first = new Set(lows)
  const children = {}
  nodes.slice(0, CHILD_FOR).forEach((node, i) => {
    const c = new Map()
    issueWords.forEach((s, k) => {
      if (!has[i][k]) return
      for (const w of s) if (!first.has(w)) c.set(w, (c.get(w) ?? 0) + 1)
    })
    children[node.word] = [...c]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, CHILD_MAX)
      .map(([w, n]) => ({ word: merged.get(w)?.w ?? w, score: n, subcats: subcatsOf(merged.get(w)?.w ?? w) }))
  })
  // 3단계: children 열쇠에 2단계 말도 넣는다 (화면은 같은 branches[말]로 다음 단계를 찾음)
  for (const [parent, kids] of Object.entries(children)) {
    const skip = new Set([...first, parent.toLowerCase(), ...kids.map((k) => k.word.toLowerCase())])
    for (const kid of kids) {
      const kw = kid.word.toLowerCase()
      if (children[kid.word]) continue
      const c = new Map()
      for (const s of issueWords) {
        if (!s.has(kw)) continue
        for (const w of s) if (!skip.has(w) && w !== kw) c.set(w, (c.get(w) ?? 0) + 1)
      }
      const list = [...c]
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, GRAND_MAX)
        .map(([w, n]) => ({ word: merged.get(w)?.w ?? w, score: n, subcats: subcatsOf(merged.get(w)?.w ?? w) }))
      if (list.length) children[kid.word] = list
    }
  }
  return { edges, children }
}

// 자동으로 고를 수 있는 말 (11/15): 너무 넓지 않고, 기술 · 회사이거나 「일반」이라도 주제어 이슈의 15% 이상에 나오는 말
// (「ai 안경」의 시험 · 부정행위처럼 주제와 직결된 말을 「일반」이라 건너뛰고 8위 아래 영문 논문 말을 고르던 문제). 화면 레버도 이 표시를 씀
const AUTO_SHARE = 0.15
const autoOk = (n) => !n.broad && (n.kind !== 'general' || n.share >= AUTO_SHARE)
// 자동 개수 (11/15 조장: 「골라 주는 개수 자체도 자동으로」): 화면 레버와 같은 순서(auto 표시 말, 연관도 순)로 하나씩 더하며
// 주제어 이슈 중 고른 말이 하나라도 든 이슈의 몫(덮는 비율)을 센다. 새로 덮는 몫이 5% 미만이면 멈춤. 1 ~ 6개
// 돌려주는 값: { n, coverage(0~1), steps: [{ word, coverage }] } — AI 안 씀
const PICK_GAIN = 0.05
const PICK_MAX = 6
function suggestCount(nodes, issueWords) {
  const N = issueWords.length
  const order = nodes.filter((n) => n.auto)
  if (!N || !order.length) return { n: 0, coverage: 0, steps: [] }
  const covered = new Array(N).fill(false)
  let count = 0
  const steps = []
  for (const node of order.slice(0, PICK_MAX)) {
    const w = node.word.toLowerCase()
    let gain = 0
    issueWords.forEach((s, k) => {
      if (!covered[k] && s.has(w)) {
        covered[k] = true
        gain++
      }
    })
    count += gain
    steps.push({ word: node.word, coverage: Math.round((count / N) * 100) / 100, gain: Math.round((gain / N) * 100) / 100 })
  }
  let n = 1
  while (n < steps.length && steps[n].gain >= PICK_GAIN) n++
  return { n, coverage: steps[n - 1].coverage, steps }
}

// 돌려주는 값: { center, docs, issues, nodes: [{ word, kind, score(함께 나온 이슈 수), share, subcats }], edges, children, autoPick }
// background: 미리 분석 작업에서 부를 때 — 네이버 하루 한도의 80%에서 멈춘다 (sourceGuard.js)
export async function relatedWords(rawCenter, { refresh = false, background = false } = {}) {
  const center = String(rawCenter ?? '').trim().slice(0, 50)
  if (!center) throw Object.assign(new Error('키워드를 입력해 주세요.'), { status: 400 })
  const key = `related:v8:${queryKey(center)}` // v2: 영어 기능어(11/11) · v3: 워드클라우드팀 불용어 · 예외 · 사업 분류 · v4: 교차선 · 2단계(11/14) · v5: 자동 개수(11/15) · v6~7: Kiwi 명사(동사로 쓰인 명사 뺌) · 전체 기간 + AI 요약 · 3단계 · auto(11/15)
  if (!refresh) {
    const hit = await cacheGet(key).catch(() => null)
    if (hit) return { ...hit, cached: true }
  }
  const [naver, mine, lists, kiwi] = await Promise.all([
    searchNews(center, { sort: 'sim', background }).catch(() => []),
    collectedDocs(center).catch(() => []),
    getLists(),
    loadKiwi(),
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
  const own = wordsOf(center, kiwi)
  const ownSquash = center.toLowerCase().replace(/\s+/g, '')
  const count = new Map()
  const issueWords = [] // 이슈마다 든 말 (소문자) — 교차선 · 2단계 계산용 (11/14)
  for (const is of issues) {
    const set = new Set()
    for (const raw of new Set([...wordsOf(is.text, kiwi)].map((x) => SAME[x] ?? x))) {
      const w = raw
      const low = w.toLowerCase()
      if (own.has(w) || ownSquash.includes(low) || low.includes(ownSquash)) continue // 키워드 자신과 그 조각
      count.set(w, (count.get(w) ?? 0) + 1)
      set.add(low)
    }
    issueWords.push(set)
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
    .map((x) => ({ word: x.w, kind: kindOf(x.w, lists), score: x.n, share: Math.round((x.n / Math.max(1, issues.length)) * 100) / 100, broad: tooBroad(x.w), subcats: subcatsOf(x.w) }))
    .map((n) => ({ ...n, auto: autoOk(n) }))
  const { edges, children } = linksOf(nodes, issueWords, merged)
  const autoPick = suggestCount(nodes, issueWords)
  const out = { center, docs: docs.length, issues: issues.length, nodes, edges, children, autoPick, words: kiwi ? 'kiwi' : 'rules', at: new Date().toISOString() }
  await cachePut(key, out, MAP_TTL).catch(() => {})
  return { ...out, cached: false }
}

// 맵 점의 관련 기사 (11/15, 마인드맵 가이드 「관련 기사 칸」): 주제어와 그 말이 함께 든 기사 3건, 최신순
// - 우리 DB(모은 기사, 1·2차 출처 포함)를 먼저 — 제목에 그 말 → 제목에 주제어 → 최신순, 모음 기사([데일리픽] 등) 뺌 — 모자라면 네이버 「주제어 말」 검색(정확도순 30건 중 두 말이 다 든 것)으로 채움 — 제목 · 링크만 보여 주고 저장 · AI 입력 안 함
// - 6시간 기억 (같은 점을 여러 번 눌러도 네이버를 한 번만)
export async function wordArticles(rawCenter, rawWord) {
  const center = String(rawCenter ?? '').trim().slice(0, 50)
  const word = String(rawWord ?? '').trim().slice(0, 50)
  if (!center || !word) throw Object.assign(new Error('주제어와 말이 필요해요.'), { status: 400 })
  const key = `word-articles:v3:${queryKey(center)}:${queryKey(word)}`
  const hit = await cacheGet(key).catch(() => null)
  if (hit) return { ...hit, cached: true }
  const sq = (s) => s.toLowerCase().replace(/\s+/g, '')
  const like = (s) => `%${sq(s).replace(/[%_\\]/g, '\\$&')}%`
  const out = []
  if (dbEnabled()) {
    // 같은 이슈(group_id)는 한 건만 — 제목에 그 말 → 제목에 주제어 → 최신 기사로 이슈마다 하나 고른 뒤 같은 순서로 3건
    const { rows } = await query(
      `WITH m AS (
         SELECT coalesce(full_title, title) AS title, source, url, published_at, coalesce(group_id, id::text) AS g,
                (lower(regexp_replace(coalesce(full_title, title), '\\s+', '', 'g')) LIKE $2) AS w_in_title,
                (lower(regexp_replace(coalesce(full_title, title), '\\s+', '', 'g')) LIKE $1) AS c_in_title
           FROM articles
          WHERE lower(regexp_replace(coalesce(full_title, title) || ' ' || coalesce(description, ''), '\\s+', '', 'g')) LIKE $1
            AND lower(regexp_replace(coalesce(full_title, title) || ' ' || coalesce(description, ''), '\\s+', '', 'g')) LIKE $2
            AND coalesce(full_title, title) !~ '^\\[(데일리|모닝|이브닝|오늘의|주간|위클리|뉴스|헤드라인)'),
       one AS (SELECT DISTINCT ON (g) * FROM m ORDER BY g, w_in_title DESC, c_in_title DESC, published_at DESC)
       SELECT title, source, url, published_at FROM one ORDER BY w_in_title DESC, c_in_title DESC, published_at DESC LIMIT 3`,
      [like(center), like(word)],
    ).catch((err) => {
      console.warn(`[word-articles] ${err.message}`)
      return { rows: [] }
    })
    for (const r of rows) out.push({ title: cleanText(r.title), source: r.source, url: r.url, publishedAt: r.published_at, from: 'db' })
  }
  if (out.length < 3) {
    const items = await searchNews(`${center} ${word}`, { sort: 'sim', display: 30 }).catch(() => [])
    const both = (it) => {
      const t = sq(cleanText(`${it.title} ${it.description}`))
      return t.includes(sq(center)) && t.includes(sq(word))
    }
    for (const it of items.filter(both).sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate))) {
      if (out.length >= 3) break
      const url = it.originallink || it.link
      if (out.some((x) => x.url === url)) continue
      out.push({ title: cleanText(it.title), source: new URL(url).hostname.replace(/^www\./, ''), url, publishedAt: new Date(it.pubDate).toISOString(), from: 'naver' })
    }
  }
  const result = { center, word, articles: out }
  await cachePut(key, result, TTL).catch(() => {})
  return result
}
