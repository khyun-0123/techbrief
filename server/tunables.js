// 관리 페이지 「세부 설정」 (11/26, notes/admin-review-1120 S5 · S7~S12): 코드에만 있던 숫자 · 낱말 목록을 관리 페이지에서 바꾼다
// - 기본값 = 지금까지 코드에 있던 값 그대로. 아무도 안 바꾸면 동작이 같다
// - 저장은 app_settings 'tunables' (바꾼 칸만), 기록은 'tunables_history' 30건 + 변경 기록. 저장 방식은 judgeSettings.js와 같다
// - 계산 중에는 동기 값(tune · tuneList · displayCategories)을 쓴다. 켤 때 loadTunables()로 읽고, 1분이 지나면 뒤에서 다시 읽는다
import { createHash } from 'node:crypto'
import { getSetting, setSetting } from './db/store.js'

const KEY = 'tunables'
const HISTORY = 'tunables_history'
const TTL = 60_000

const envNum = (name, d) => {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : d
}

export const GROUPS = [
  { id: 'report', title: '보고서 한도', note: '다음 보고서부터' },
  { id: 'precompute', title: '미리 분석', note: '다음 미리 분석부터 (주기는 지금 도는 차례가 끝난 뒤)' },
  { id: 'dedupe', title: '같은 소식 묶기', note: '새로 묶는 기사부터 · 자료 현황은 다시 계산한 뒤' },
  { id: 'keep', title: '보관 기간', note: '줄이면 다음 정리(하루 한 번) 때 지난 것이 지워져 되돌릴 수 없어요' },
  { id: 'map', title: '연관 키워드 맵', note: '새로 만드는 맵부터 (만들어 둔 맵은 최대 24시간 그대로)' },
  { id: 'words', title: '중요도 낱말 목록', note: '자료 현황 점수를 다시 계산해요 (끝날 때까지는 기존 점수)' },
  { id: 'categories', title: '세부 기술 분류', note: '새로 계산하는 특허 비교 · 분류 추이부터' },
]

// [키, 묶음, 이름, 설명, 기본값, 최소, 최대, 단계]
export const NUM_FIELDS = [
  ['reportArticles', 'report', '한 번에 넣는 자료 수', '이보다 많으면 「중요도 높은 N건만」 또는 나눠 쓰고 합치기 중에서 고름 (맥미니 문맥 크기 기준)', 10, 5, 20, 1],
  ['newSummaries', 'report', '보충 요약 최대', '보고서를 만들며 요약이 없는 자료를 새로 요약하는 최대 건수', 6, 0, 12, 1],
  ['evidenceOverlap', 'report', '근거 확인 기준', '문장과 근거 글의 글자 겹침이 이 값 이상이면 「근거 있음」 (낮추면 AI 보충 문장이 사실로 보일 수 있음)', envNum('EVIDENCE_MIN_OVERLAP', 0.35), 0.2, 0.6, 0.01],
  ['precomputeHours', 'precompute', '주기 (시간)', '기술 시계열 · 맵 · 보고서 묶음을 미리 만드는 간격', 6, 1, 48, 1],
  ['frequentLimit', 'precompute', '많이 찾은 말 수', '최근 14일 많이 찾은 말 중 미리 분석할 수 (자동 수집 키워드는 늘 포함)', 20, 0, 50, 1],
  ['trendingLimit', 'precompute', '요즘 뜨는 기술 수', '요즘 뜨는 기술 종합 순위에서 미리 분석할 수', 10, 0, 20, 1],
  ['dedupeSimilarity', 'dedupe', '비슷한 정도', '제목 글자 조각이 이만큼 겹치면 같은 소식 (높이면 덜 묶고, 낮추면 다른 소식까지 묶임)', envNum('DEDUPE_SIMILARITY', 0.35), 0.2, 0.8, 0.01],
  ['dedupeHours', 'dedupe', '묶는 기간 (시간)', '이 시간 안에 나온 기사끼리만 묶음. 이보다 앞선 비슷한 제목은 「재탕」(첫 소식 아님)', 48, 6, 168, 1],
  ['textKeepDays', 'keep', '기사 원문 (일)', '선별한 기사의 원문 본문 보관 (23 문서 보관 조건)', 90, 7, 365, 1],
  ['usageKeepDays', 'keep', '사용 기록 (일)', '사용 현황 원본 기록 보관', 90, 7, 365, 1],
  ['paperHigh', 'keep', '논문 「중요」 점수', '논문 점수가 이 값 이상이면 「중요」 (기사 「중요」 기준과 따로)', 60, 30, 90, 1],
  ['edgeMin', 'map', '최소 함께 나온 수', '두 말이 이만큼의 이슈에 함께 나와야 맵에 선을 그음', 3, 1, 10, 1],
  ['mapNodes', 'map', '점 개수', '맵 1단계에 두는 말의 최대 수', 24, 8, 32, 1],
]

// 낱말 목록 (한 줄에 하나). '첫 '처럼 끝 띄어쓰기도 낱말에 들어간다
export const LIST_FIELDS = [
  ['newWords', 'words', '새 소식 낱말', '제목에 있으면 신규성 (1개 6점 · 2개 이상 10점)', ['최초', '세계 첫', '첫 ', '신기술', '개발', '공개', '상용화', '시연', '신제품', '출시', '양산', '특허', '표준', '시제품', '선보', 'first', 'unveil', 'launch', 'develop', 'breakthrough', 'prototype', 'demonstrat', 'introduc', 'record'], 1],
  ['bizWords', 'words', '사업 사건 낱말', '제목에 있으면 사업 연관성 5점', ['수주', '공급', '투자', '인수', '합병', '협력', '계약', '증설', '수율', '공정', '라인', '점유율', 'supply', 'invest', 'acquir', 'partner', 'contract', 'capacity', 'yield'], 1],
  ['noiseWords', 'words', '잡음 낱말', '제목에 있으면 점수 × 0.3 (사진 · 인사 · 홍보 · 시황)', ['[포토]', '[사진]', '[인사]', '[부고]', '할인', '이벤트', '모집', '강좌', '특강', '경진대회', '[공시]', '마감시황', '코스피', '코스닥', '주가'], 1],
  ['mapStop', 'map', '더 빼는 말', '코드 · 워드클라우드팀 불용어 위에 더 뺄 말 (특정 사건 말 등, 33 문서 W30)', [], 0],
]

// 세부 기술 분류 기본값 (11/12, displayCategories.js에서 옮김)
export const DEFAULT_CATEGORIES = Object.freeze([
  { id: 'oled', name: 'OLED 소자', cpc: '^(H10K5|H01L51/5|H01L27/32|H05B33)' },
  { id: 'material', name: '발광 재료 · 양자점', cpc: '^(C09K11|H10K85)' },
  { id: 'led', name: '마이크로 · 미니 LED', cpc: '^(H01L33|H10H|H01L25/075|H01L27/15)' },
  { id: 'tft', name: 'TFT 백플레인', cpc: '^(H01L27/12|H01L29/786|H10D86|H10D30/67)' },
  { id: 'drive', name: '구동 · 회로', cpc: '^G09G' },
  { id: 'lcd', name: '액정', cpc: '^G02F1/13' },
  { id: 'form', name: '폴더블 · 기기 구조', cpc: '^(G09F9|G06F1/1652|H04M1/0268)' },
  { id: 'touch', name: '터치 일체형', cpc: '^G06F3/0412' },
  { id: 'xr', name: 'AR · VR 광학', cpc: '^(G02B27/01|G02B30|G03H1)' },
])

export const DEFAULTS = Object.freeze({
  ...Object.fromEntries(NUM_FIELDS.map(([k, , , , d]) => [k, d])),
  ...Object.fromEntries(LIST_FIELDS.map(([k, , , , d]) => [k, d])),
  categories: DEFAULT_CATEGORIES,
})

const G = (globalThis.__techbriefTunables ??= { saved: {}, at: 0, loading: null })

const bad = (msg) => Object.assign(new Error(msg), { status: 400 })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function checkWords(v, label, min) {
  const list = (Array.isArray(v) ? v : String(v ?? '').split('\n')).map((s) => String(s).replace(/\r/g, '').replace(/^\s+/, '')).filter((s) => s.trim())
  const uniq = [...new Set(list)]
  if (uniq.length < min) throw bad(`「${label}」에 낱말이 하나 이상 있어야 해요.`)
  if (uniq.length > 200) throw bad(`「${label}」은 200개까지예요.`)
  for (const w of uniq) if (w.length > 30) throw bad(`「${label}」: 「${w.slice(0, 30)}…」 — 낱말은 30자까지예요.`)
  return uniq
}

// 한 줄: 「id | 이름 | CPC 정규식」
export function checkCategories(v) {
  const rows = Array.isArray(v)
    ? v
    : String(v ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          // CPC 식에도 | 가 있으므로 앞 두 개만 칸 나눔으로 본다
          const [id, name, ...rest] = l.split('|')
          return { id, name, cpc: rest.join('|').replace(/\s+/g, '') }
        })
  if (rows.length < 1 || rows.length > 15) throw bad('세부 기술 분류는 1~15개여야 해요.')
  const ids = new Set()
  return rows.map((r, i) => {
    const id = String(r?.id ?? '').trim()
    const name = String(r?.name ?? '').trim()
    const cpc = String(r?.cpc ?? '').trim()
    const where = `${i + 1}번째 줄`
    if (!/^[a-z0-9-]{2,20}$/.test(id)) throw bad(`${where}: 이름표(id)는 영문 소문자 · 숫자 · - 2~20자예요 (예: oled).`)
    if (ids.has(id)) throw bad(`${where}: 이름표 「${id}」가 겹쳐요.`)
    ids.add(id)
    if (!name || name.length > 30) throw bad(`${where}: 분류 이름은 1~30자예요.`)
    if (!/^\^?[A-Z0-9/()|^]+$/.test(cpc) || cpc.length > 200) throw bad(`${where}: CPC는 영문 대문자 · 숫자 · / ( ) | ^ 로 써 주세요 (예: ^(H01L33|H10H)).`)
    try {
      new RegExp(cpc)
    } catch {
      throw bad(`${where}: CPC 식의 괄호가 맞지 않아요.`)
    }
    return { id, name, cpc }
  })
}

// 들어온 값 검사 → 기본값과 다른 칸만 남김
export function checkTunables(input) {
  const out = {}
  for (const [k, , label, , d, min, max, step] of NUM_FIELDS) {
    if (input?.[k] == null || input[k] === '') continue
    const v = Number(input[k])
    if (!Number.isFinite(v) || v < min || v > max) throw bad(`「${label}」은 ${min}~${max} 사이여야 해요.`)
    const r = step < 1 ? Math.round(v * 100) / 100 : Math.round(v)
    if (r !== d) out[k] = r
  }
  for (const [k, , label, , d, min] of LIST_FIELDS) {
    if (input?.[k] == null) continue
    const v = checkWords(input[k], label, min)
    if (!same(v, d)) out[k] = v
  }
  if (input?.categories != null) {
    const v = checkCategories(input.categories)
    if (!same(v, DEFAULT_CATEGORIES)) out.categories = v
  }
  return out
}

export async function loadTunables({ fresh = false } = {}) {
  if (!fresh && Date.now() - G.at < TTL) return current()
  G.loading ??= getSetting(KEY, {})
    .then((saved) => {
      G.err = null
      try {
        G.saved = checkTunables(saved && typeof saved === 'object' ? saved : {})
      } catch (err) {
        console.warn(`[tunables] 저장된 값이 맞지 않아 기본값으로: ${err.message}`)
        G.saved = {}
      }
    })
    .catch((err) => {
      G.err = err // 못 읽음: 그 전 값을 그대로 씀. 지우기(보관 기간)는 이때 하지 않는다 (tunablesReadFailed)
    })
    .finally(() => {
      G.at = Date.now()
      G.loading = null
    })
  await G.loading
  return current()
}

// 동기 값 (오래됐으면 뒤에서 다시 읽음)
function touch() {
  if (Date.now() - G.at > TTL && !G.loading) loadTunables().catch(() => {})
}
export function tune(key) {
  touch()
  return G.saved[key] ?? DEFAULTS[key]
}
export const tuneList = tune
export function displayCategories() {
  touch()
  return G.saved.categories ?? DEFAULT_CATEGORIES
}
// 분류를 바꿨을 때만 기억해 둔 계산의 열쇠가 바뀌게 (기본값이면 '' → 예전 열쇠 그대로)
export function categoriesVersion() {
  const c = G.saved.categories
  return c ? `:k${createHash('sha1').update(JSON.stringify(c)).digest('hex').slice(0, 8)}` : ''
}
export function mapStopSet() {
  return new Set(tune('mapStop').map((w) => w.trim().toLowerCase()))
}

export const current = () => ({ ...DEFAULTS, ...G.saved })
// 마지막 읽기가 실패했나 (보관 기간으로 지우기 전에 확인 — 늘려 둔 기간을 모른 채 기본값으로 지우지 않게)
export const tunablesReadFailed = () => Boolean(G.err)

export function describeTunables(saved) {
  const parts = []
  for (const [k, , label] of NUM_FIELDS) if (k in saved) parts.push(`${label} ${saved[k]}`)
  for (const [k, , label] of LIST_FIELDS) if (k in saved) parts.push(`${label} ${saved[k].length}개`)
  if (saved.categories) parts.push(`세부 기술 분류 ${saved.categories.length}개`)
  return parts.join(' · ') || '처음 값'
}

// 묶음 하나(group)를 저장. 그 묶음 칸만 바꾸고 다른 묶음 값은 그대로
export async function saveTunables(group, input, who = '관리자') {
  if (!GROUPS.some((g) => g.id === group)) throw bad('없는 설정 묶음이에요.')
  await loadTunables({ fresh: true })
  const inGroup = (k) => (k === 'categories' ? group === 'categories' : [...NUM_FIELDS, ...LIST_FIELDS].some(([key, g]) => key === k && g === group))
  const picked = Object.fromEntries(Object.entries(input ?? {}).filter(([k]) => inGroup(k)))
  const checked = checkTunables(picked)
  const next = Object.fromEntries(Object.entries(G.saved).filter(([k]) => !inGroup(k)))
  Object.assign(next, checked)
  const before = G.saved
  await setSetting(KEY, next)
  const history = await getSetting(HISTORY, []).catch(() => [])
  history.unshift({ at: new Date().toISOString(), name: who, group, saved: next })
  await setSetting(HISTORY, history.slice(0, 30))
  G.saved = next
  G.at = Date.now()
  const changed = Object.keys({ ...before, ...next }).filter((k) => inGroup(k) && !same(before[k], next[k]))
  return { before, after: next, changed }
}
export const tunablesHistory = () => getSetting(HISTORY, []).catch(() => [])

// 관리 화면용 (칸 목록 · 기본값 · 지금 값)
export function tunablesView() {
  return {
    groups: GROUPS,
    num: NUM_FIELDS.map(([key, group, label, desc, def, min, max, step]) => ({ key, group, label, desc, def, min, max, step })),
    lists: LIST_FIELDS.map(([key, group, label, desc, def]) => ({ key, group, label, desc, def })),
    defaultCategories: DEFAULT_CATEGORIES,
    values: current(),
    changed: Object.keys(G.saved),
  }
}
