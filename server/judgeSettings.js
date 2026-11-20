// 판정 기준 · 회사 특허 이름 (11/20, 관리자 인수인계: 「코드로 바꾸던 것을 관리 페이지에서」 — notes/admin-review-1120 S1 · S2 · S3)
// 1) 판정 기준: 기술 단계(timeline.js stageOf)와 자사 위협 · 기회(keywordBundle.js)의 숫자 기준. 기본값은 지금까지 코드에 있던 값 그대로
//    - 저장하면 다음 분석부터 반영. 이미 분석해 둔 키워드는 다시 받지 않고, 열 때 새 기준으로 단계만 다시 계산 (version이 바뀌면)
// 2) 회사 특허 이름: 자사 · 경쟁사 이름 → 특허 출원인 이름(영문, % 와일드카드). 코드 사전(OWNER_DICT)에 없는 회사도 관리 페이지에서 더함
//    - 예전: 사전에 없는 경쟁사는 특허 비교에서 조용히 빠졌음
// 안전장치: 칸마다 범위 검사, 기본값으로 되돌리기, 바꾼 기록(변경 기록 + 이력 30건)
import { createHash } from 'node:crypto'
import { getSetting, setSetting } from './db/store.js'

export const RULE_FIELDS = [
  // [키, 이름, 설명, 기본값, 최소, 최대, 단계]
  ['relFast', '빠른 성장', '논문 증가가 분야 전체 증가의 몇 배 이상이면 「성장」', 1.3, 1.05, 3, 0.05],
  ['relMild', '완만한 성장', '몇 배 이상이면 「완만한 성장」', 1.15, 1, 2, 0.05],
  ['relFlat', '정체 기준', '몇 배 아래면 분야보다 느림', 0.85, 0.3, 1, 0.05],
  ['peakDrop', '감소 기준', '최근 논문이 정점의 몇 % 아래면 「감소」', 0.6, 0.2, 0.95, 0.05],
  ['communityMin', '연구 기관 수', '최근 3년 논문 낸 기관이 몇 곳 미만이면 「신생 · 탐색」', 3, 1, 20, 1],
  ['patMin', '특허 최소 건수', '최근 3년 특허가 몇 건 이상일 때만 특허로 판단', 10, 3, 100, 1],
  ['threatFactor', '위협 기준', '경쟁사 하나가 분야 증가의 몇 배 이상 빠르고 자사가 분야보다 느리면 「위협」', 1.5, 1.1, 5, 0.1],
  ['shareMin', '분야 집중 기준', '그 말 특허의 몇 % 이상이 한 세부 분야에 몰릴 때만 위협 · 기회 판정', 0.45, 0.1, 0.9, 0.05],
  ['ratioPrior', '작은 수 보정', '배수를 계산할 때 앞 · 뒤 기간에 몇 건씩 더하나 (작은 수가 부풀지 않게)', 5, 0, 50, 1],
]
export const DEFAULT_JUDGE = Object.freeze(Object.fromEntries(RULE_FIELDS.map(([k, , , d]) => [k, d])))
const RULE_KEY = 'judge_rule'
const RULE_HISTORY = 'judge_rule_history'
const OWNERS_KEY = 'patent_owners'
const TTL = 60_000

const G = (globalThis.__techbriefJudge ??= { rule: DEFAULT_JUDGE, owners: {}, at: 0 })

export function checkJudgeRule(input) {
  const out = {}
  for (const [k, label, , , min, max] of RULE_FIELDS) {
    const v = Number(input?.[k])
    if (!Number.isFinite(v) || v < min || v > max) throw Object.assign(new Error(`「${label}」은 ${min}~${max} 사이여야 해요.`), { status: 400 })
    out[k] = Math.round(v * 100) / 100
  }
  if (!(out.relFast > out.relMild && out.relMild > out.relFlat)) throw Object.assign(new Error('「빠른 성장」 > 「완만한 성장」 > 「정체 기준」 순서여야 해요.'), { status: 400 })
  return out
}

// 출원인 이름: 영문 대문자로 맞추고, %가 없으면 「그 이름으로 시작」(예전 사전과 같은 방식)
export function checkOwnerPatterns(list) {
  const pats = (Array.isArray(list) ? list : String(list ?? '').split(/[\n,]/))
    .map((s) => String(s).trim().toUpperCase().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, 8)
  for (const p of pats) {
    if (p.replace(/%/g, '').length < 2) throw Object.assign(new Error('출원인 이름은 두 글자 이상이어야 해요.'), { status: 400 })
    if (!/^[A-Z0-9 .,&'()%-]+$/.test(p)) throw Object.assign(new Error(`「${p}」: 특허 출원인 이름은 영문으로 넣어 주세요 (예: SAMSUNG DISPLAY).`), { status: 400 })
  }
  return pats.map((p) => (p.includes('%') ? p : `${p}%`))
}

// 동기 값 (계산 중에 씀). loadJudgeSettings()로 미리 읽어 둔 값
export const judgeRule = () => G.rule
export const customOwners = () => G.owners
// 기준이 바뀌었는지 알기 위한 짧은 값 (기억해 둔 계산의 열쇠에 붙임)
const versionOf = (rule) => createHash('sha1').update(JSON.stringify(rule)).digest('hex').slice(0, 8)
export const judgeVersion = () => versionOf(G.rule)
// 11/20 전에 기억해 둔 분석(judgeV 없음)은 기본값으로 계산한 것
export const DEFAULT_JUDGE_VERSION = versionOf(DEFAULT_JUDGE)
export const ownersVersion = () => createHash('sha1').update(JSON.stringify(G.owners)).digest('hex').slice(0, 8)

export async function loadJudgeSettings({ fresh = false } = {}) {
  if (!fresh && Date.now() - G.at < TTL) return G
  try {
    const saved = await getSetting(RULE_KEY, null)
    G.rule = saved ? checkJudgeRule(saved) : DEFAULT_JUDGE
  } catch {
    G.rule = DEFAULT_JUDGE
  }
  try {
    const owners = await getSetting(OWNERS_KEY, {})
    G.owners = owners && typeof owners === 'object' ? owners : {}
  } catch {
    G.owners = {}
  }
  G.at = Date.now()
  return G
}

export async function saveJudgeRule(input, who = '관리자') {
  const rule = checkJudgeRule(input)
  await setSetting(RULE_KEY, rule)
  const history = await getSetting(RULE_HISTORY, []).catch(() => [])
  history.unshift({ at: new Date().toISOString(), name: who, rule })
  await setSetting(RULE_HISTORY, history.slice(0, 30))
  G.rule = rule
  G.at = Date.now()
  return rule
}
export const judgeHistory = () => getSetting(RULE_HISTORY, []).catch(() => [])
export const describeJudge = (r) => RULE_FIELDS.filter(([k]) => r[k] !== DEFAULT_JUDGE[k]).map(([k, label]) => `${label} ${r[k]}`).join(' · ') || '모두 기본값'

// 회사 하나의 출원인 이름 저장 (빈 목록이면 지움 → 코드 사전으로 돌아감)
export async function saveOwner(name, patterns) {
  const key = String(name ?? '').trim().slice(0, 40)
  if (!key) throw Object.assign(new Error('회사 이름이 없어요.'), { status: 400 })
  const like = checkOwnerPatterns(patterns)
  const owners = { ...(await getSetting(OWNERS_KEY, {}).catch(() => ({}))) }
  if (like.length) owners[key] = { like, at: new Date().toISOString() }
  else delete owners[key]
  await setSetting(OWNERS_KEY, owners)
  G.owners = owners
  G.at = Date.now()
  return { name: key, like }
}
