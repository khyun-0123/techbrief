// 관련도 (13 문서 F4 · 11 문서 「관련도 규칙」). AI 없이 규칙으로만 정한다
// 네이버 검색은 본문 어딘가에 단어가 한 번만 나와도 결과로 준다. 그래서 "키워드가 있다"가 아니라
// "글에서 키워드 이야기가 얼마나 차지하나(언급 비중)"로 본다.
//
// 1. 발췌(원문이 저장돼 있으면 원문)를 문장으로 나눈다
// 2. 키워드가 나오는 문장 + 그 뒤에 이어서 키워드를 설명하는 문장을 "키워드 이야기"로 센다
//    - 이어지는 문장: '이는·해당·이 기술·회사는…'처럼 앞 문장을 가리키거나, 패널·수율 같은 디스플레이 용어가 있는 문장
//    - 둘 다 없는 문장에서 끊는다
// 3. 언급 비중 = 키워드 이야기 글자 수 ÷ 전체 글자 수
// 4. 제목 신호(키워드 · 주제 밖 말 · 모음 기사)와 합쳐 high / mid / low
import { hasKeyword } from './aliases.js'

// ── 기준값 (11/07 DB 표본 1,407건으로 맞춤, 11 문서) ──
export const THRESHOLDS = {
  titleHigh: 0.3, // 제목에 키워드 + 비중 30% 이상 → 높음 (아니면 중간)
  bodyMid: 0.35, // 제목에 키워드 없음 + 비중 35% 이상 → 중간 (아니면 낮음)
  offTopicMid: 0.5, // 제목이 주제 밖(주식·쇼핑 등) + 비중 50% 이상이고 설명 문장이 있음 → 중간 + 「○○ 기사 속 기술 정보」
}

// 디스플레이 분야 용어 (설명 문장 판단). 관심 기술·경쟁사 목록도 함께 쓴다
const DOMAIN = new RegExp(
  [
    '패널', '화소', '휘도', '수율', '증착', '발광', '탠덤', '기판', '픽셀', '해상도', '\\d+\\s*인치', '\\d+(\\.\\d+)?\\s*세대',
    '(?<![가-힣])공정(?!거래|위|성|한|하)', '양산', '(?<![온이드타])라인(?!업)', '디스플레이', '올레드', '유기발광', '퀀텀닷',
    '백플레인', '웨이퍼', '소자', '광원', '색재현', '명암비', '주사율', '시야각', '폴더블', '롤러블', '봉지', '잉크젯',
    '출하', '점유율', '백라이트', '구동\\s*ic', '드라이버\\s*ic', '\\bddi\\b', '미니\\s*led', '설비투자', '증설', '검사장비', '모듈', '화면',
    'nits?\\b', 'ppi\\b', '\\bhz\\b', 'oled', 'lcd', '\\bled', '\\bqd', '\\btft', 'ltpo', 'display', 'panel', 'pixel', 'capex',
  ].join('|'),
  'i',
)

// 앞 문장을 가리키는 말 (문장 처음)
const ANAPHORA_START =
  /^(이|이는|이를|이에|이와|이로|이로써|이번|이같은|이 같은|해당|같은|그|그는|그러나|또|또한|특히|아울러|다만|회사는|회사 측은|동사|양사|이 회사|이 기술|이 제품|this|it|these|they|the company)(?=[\s,]|$)/i
// 문장 어디서든 앞 내용을 가리키는 말
const ANAPHORA_ANY = /(이 기술|이 제품|해당 기술|해당 제품|동사는|양사는|회사 측은)/

// 모음 기사(브리핑) 말머리
const ROUNDUP = /^\s*\[(데일리픽|마켓\s*24시|투데이온|오늘의[^\]]*|모닝[^\]]*|이브닝[^\]]*|[^\]]*브리핑|[^\]]*풍향계|[^\]]*픽|[^\]]*24시|[^\]]*종합|주간[^\]]*|위클리[^\]]*|IT[^\]]*톺아보기)\]|外|\s외\s*\d*건?\s*$/

// 제목 주제 (섹션 값이 비어 있을 때 대신 본다). 제목에 기술 내용이 없으면 관련도를 낮춘다
// 앞에 있는 주제부터 본다 (생활·행사·쇼핑은 제목에 OLED가 있어도 주제 밖)
const OFF_TOPICS = [
  ['생활·행사', /점심|식단|메뉴|맛집|김장|봉사|기부|나눔|축제|마라톤|[[(]포토[\])]|[[(]인사[\])]|인사 풍향계|부고/],
  ['쇼핑', /할인|특가|블프|블랙프라이데이|세일|쇼핑|최저가|캐시백|사은품|경품|이벤트|프로모션|쇼핑몰|라이브커머스/],
  ['주식', /주가|특징주|목표가|목표주가|증시|코스피|코스닥|\bPER\b|저평가|주주환원|시총|시가총액|ETF|수혜주|투자의견|상한가|하한가|공모주/],
  ['실적', /실적|영업이익|영업익|영업손실|순이익|매출|흑자|적자|컨콜|어닝/],
  ['자동차', /시승기|시승/],
  ['정책·정치', /상속세|증여세|부동산|아파트|분양|선거|국회의원|도지사|군수|구청장|시의회|도의회/],
]
// 실적·주식 제목이지만 제목 자체에 기술 내용이 있는지 (있으면 주제 밖으로 보지 않음)
const STRONG_TOPICS = new Set(['생활·행사', '쇼핑'])
const TITLE_TECH = /패널|화소|휘도|수율|증착|탠덤|기판|해상도|양산|공정|올레드|유기발광|퀀텀닷|마이크로\s*led|oled|lcd|qd|디스플레이/i

const OFF_TOPIC_SECTIONS = new Set(['100', '102', '103', '104']) // 정치·사회·생활·세계 (네이버 섹션)

// 문장 나누기. 네이버 발췌는 문장 조각을 '...'로 잇고, 모음 기사는 ■·▲ 같은 표시로 꼭지를 나눈다
export function splitSentences(text) {
  return String(text ?? '')
    .split(/(?<=[.!?。])\s+|\.{2,}|…|[■▲△▶●◆◇□]|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
}

export function isRoundup(title) {
  return ROUNDUP.test(String(title ?? ''))
}

export function offTopicOf(title) {
  const t = String(title ?? '')
  return OFF_TOPICS.find(([, re]) => re.test(t))?.[0] ?? null
}

// 관심 기술·경쟁사 이름도 설명 문장 단서로 쓴다
function explains(sentence, extraWords) {
  if (DOMAIN.test(sentence)) return true
  const low = sentence.toLowerCase()
  return extraWords.some((w) => w && low.includes(w.toLowerCase()))
}

function refersBack(sentence) {
  return ANAPHORA_START.test(sentence) || ANAPHORA_ANY.test(sentence)
}

// 언급 비중. titleHit이면 제목을 첫 키워드 문장으로 보고 이어지는 설명 문장을 센다
export function mentionWeight(text, keyword, { extraWords = [], titleHit = false } = {}) {
  const sentences = splitSentences(text)
  const total = sentences.reduce((n, s) => n + s.length, 0)
  if (total === 0) return { weight: 0, hits: 0, explained: false, focus: [] }
  let attached = 0
  let hits = 0
  let explained = false // 키워드 문장이나 이어진 문장에 디스플레이 용어가 있었는지
  let chain = titleHit // 지금 키워드 이야기가 이어지는 중인지
  const focus = []
  for (const s of sentences) {
    if (hasKeyword(s, keyword)) {
      hits += 1
      chain = true
      attached += s.length
      focus.push(s)
      // 키워드 말고도 분야 용어가 있으면 '설명이 있는 언급'
      if (explains(stripKeyword(s, keyword), extraWords)) explained = true
    } else if (chain && (refersBack(s) || explains(s, extraWords))) {
      attached += s.length
      focus.push(s)
      if (explains(s, extraWords)) explained = true
    } else {
      chain = false
    }
  }
  return { weight: attached / total, hits, explained, focus }
}

// 키워드 자체(OLED 등)와 '디스플레이·LCD' 같은 이름만으로는 설명으로 보지 않는다 (지운 뒤 설명 용어를 본다)
const GENERIC = /oled|올레드|유기발광\s*다이오드|유기발광|디스플레이|display|lcd|액정\s*표시\s*장치|액정|표시\s*장치|마이크로\s*led|led|발광\s*다이오드/gi
function stripKeyword(sentence, keyword) {
  const words = String(keyword).split(/\s+/).filter(Boolean)
  let out = sentence
  for (const w of words) out = out.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ')
  return out.replace(GENERIC, ' ')
}

const FOCUS_MAX = 160

// 기사 1건의 관련도
// article: { title, description, keyword, section, body? }  body: DB에 저장된 원문 (선별한 기사만)
// lists: { interests, competitors } → 설명 문장 단서
// 돌려주는 값: { level, weight, roundup, topic, focus }
//   topic: 제목이 주제 밖인데 기술 정보가 있어 남긴 기사의 주제 (예: '주식' → 화면에 「주식 기사 속 기술 정보」)
//   focus: 키워드 이야기 문장 (모음 기사·주제 밖 기사에서 발췌 대신 보여 줌)
// ── 1·2차 출처 전체 수집 (11/09 조장: 키워드에 맞는 글만이 아니라 모두 모으고 중요도는 우리가 판단) ──
// 키워드에 안 맞은 RSS 글은 keyword = BROAD_KEYWORD로 저장하고, 관련도는 분야 용어로 정한다
// - 제목에 디스플레이 용어 → 높음 / 제목에 반도체 · AI · 분야 용어나 경쟁사 · 관심 기술 → 중간 / 발췌에만 → 중간 / 없음 → 낮음(기본 숨김)
export const BROAD_KEYWORD = '1·2차 출처'
const SEMI_AI = /반도체|파운드리|메모리|\bhbm|\bdram|\bnand|낸드|패키징|본딩|노광|\beuv|칩렛|chiplet|semiconductor|foundry|wafer|lithograph|packaging|bonding|\bchips?\b|\bgpu|\bnpu|인공지능|\bai\b|생성형|llm|데이터센터|data ?center|로봇|robot|센서|sensor|배터리|battery|xr\b|\bar\b|\bvr\b|스마트 ?글라스|smart ?glass|웨어러블|wearable/i
function broadRelevance(article, lists) {
  const title = String(article.title ?? '')
  const text = `${article.description ?? ''}`
  const names = [...(lists.interests ?? []), ...(lists.competitors ?? [])]
  const named = (s) => names.some((w) => w && s.toLowerCase().includes(w.toLowerCase()))
  const off = offTopicOf(title)
  // 회사 · 단체 이름 속 「디스플레이」는 기술 내용이 아니다 (예: 「LG디스플레이, 생물다양성 업무협약」)
  const techTitle = title.replace(/(LG|삼성|BOE|티씨엘|TCL|샤프|재팬)\s*디스플레이|디스플레이\s*(협회|산업협회)|삼성디|LGD/gi, ' ')
  let level
  if (TITLE_TECH.test(techTitle) && (!off || !STRONG_TOPICS.has(off))) level = 'high'
  else if (off && STRONG_TOPICS.has(off)) level = 'low'
  else if (SEMI_AI.test(techTitle) || DOMAIN.test(techTitle) || named(title)) level = 'mid'
  else if (TITLE_TECH.test(text) || SEMI_AI.test(text) || named(text)) level = 'mid'
  else level = 'low'
  return { level, weight: 0, roundup: false, topic: null, focus: null }
}

export function relevanceInfo(article, lists = {}) {
  if (article.keyword === BROAD_KEYWORD) return broadRelevance(article, lists)
  const keyword = article.keyword
  const title = String(article.title ?? '')
  const text = article.body || article.description || ''
  const extraWords = [...(lists.interests ?? []), ...(lists.competitors ?? [])]
  const titleHit = hasKeyword(title, keyword)
  const roundup = isRoundup(title)
  const offSection = OFF_TOPIC_SECTIONS.has(article.section)
  // 섹션이 비었거나 경제 섹션일 때 제목 주제어로 거른다. 제목에 기술 내용이 있으면 주제 밖으로 보지 않는다
  // (생활·행사·쇼핑은 제목에 OLED가 있어도 주제 밖으로 본다. 예: "오늘 점심은 OLED입니다")
  const rawTopic = offTopicOf(title)
  const topic = rawTopic && !STRONG_TOPICS.has(rawTopic) && TITLE_TECH.test(title) ? null : rawTopic
  const m = mentionWeight(text, keyword, { extraWords, titleHit })
  const { weight, explained } = m
  const T = THRESHOLDS
  let level
  let keptTopic = null
  const feed = String(article.section ?? '').startsWith('feed:') // 1·2차 출처 RSS·논문: 발췌가 짧거나 학술지 이름뿐이라 제목으로 본다
  // 제목에 키워드 말고도 분야 용어가 있으면 (예: '탠덤 OLED로 화면 바꿨다') 발췌 비중이 낮아도 제목만으로 높음
  const titleExplains = titleHit && explains(stripKeyword(title, keyword), extraWords)
  if (!text.trim() || feed) {
    level = titleHit ? (topic ? 'mid' : 'high') : hasKeyword(text, keyword) ? 'mid' : 'low'
  } else if (roundup && !titleHit && (m.hits > 0 || DOMAIN.test(text))) {
    // 모음 기사: 꼭지 하나가 키워드 이야기면 남긴다 (비중은 꼭지 수 때문에 낮게 나옴)
    // 발췌에 키워드가 없어도 디스플레이 용어가 있으면 남긴다 (네이버는 본문에서 키워드를 찾았고, 발췌는 그 근처)
    level = 'mid'
  } else if (offSection && !titleHit) {
    level = 'low' // 정치·사회·생활·세계 섹션인데 제목에 키워드 없음 (예전 규칙 그대로)
  } else if (topic) {
    // 주식·쇼핑 등: 제목·발췌 모두 기술 내용이 없을 때만 기본 숨김(low)
    // 제목에 키워드가 있으면 중간 (예: "오늘 점심은 OLED입니다"), 없으면 발췌에 기술 정보가 있을 때만 중간 + 표시
    if (titleHit) level = 'mid'
    else if (weight >= T.offTopicMid && explained) {
      level = 'mid'
      keptTopic = topic
    } else level = 'low'
  } else if (titleHit) {
    level = weight >= T.titleHigh || titleExplains ? 'high' : 'mid'
  } else {
    level = weight >= T.bodyMid && (explained || m.hits >= 2 || TITLE_TECH.test(title)) ? 'mid' : 'low'
  }
  // 모음 기사인데 발췌에 키워드가 없으면 디스플레이 용어가 있는 문장을 대신 보여 준다
  const focusText = (m.focus.length ? m.focus : roundup ? splitSentences(text).filter((x) => DOMAIN.test(x)) : []).join(' ')
  return {
    level,
    weight: Math.round(weight * 100) / 100,
    roundup,
    topic: keptTopic,
    focus: (roundup || keptTopic || (!titleHit && level !== 'low')) && focusText
      ? focusText.length > FOCUS_MAX ? `${focusText.slice(0, FOCUS_MAX)}…` : focusText
      : null,
  }
}

export function relevanceOf(article, lists) {
  return relevanceInfo(article, lists).level
}
