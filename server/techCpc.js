// 기술 ↔ CPC 연결표 (11/21): 특허 제목에 그 말이 드문 기술(탠덤 OLED · QD-OLED · LTPO 등)도 특허로 센다
// - 왜: 특허 제목은 「Display device」처럼 넓게 쓰는 일이 많아, 제목만 세면 「특허 제목에 드묾」으로 판정에 못 쓰는 기술이 생긴다
//   (34 문서 판정표: QD-OLED · 탠덤 OLED · LTPO). 디스플레이 특허 DB에는 세부 기술 분류(CPC)가 이미 들어 있다 (patentDb.js)
// - 센다: 그 기술 특허 = 제목에 그 말 OR 그 기술의 CPC (+ 꼭 함께 있어야 하는 CPC · 제목) − 빼는 제목(태양전지 등)
// - 위협 · 기회도 넓은 분류(OLED 소자 전체) 대신 그 기술 특허 안에서 회사별로 비교한다 (keywordBundle.js techCompetitors)
// - 켜는 것은 확인한 기술만: CPC를 잘못 고르면 엉뚱한 특허가 섞여 판정이 틀어진다
//   (11/21 실측: QD-OLED를 색변환층 CPC 하나로 세면 WOLED + 컬러필터까지 2,600건이 섞임 · 「perovskite」 제목의 51%가 태양전지)
// - 관리 페이지에서 켜고 끄고 CPC를 고친다 (app_settings 'tech_cpc'). 바꾸면 버전이 바뀌어 기억해 둔 계산을 다시 한다
import { createHash } from 'node:crypto'
import { dbEnabled, query } from './db/index.js'
import { getSetting, setSetting } from './db/store.js'
import { serverFlag } from './features.js'

const KEY = 'tech_cpc'
const HISTORY = 'tech_cpc_history'
const TTL = 60_000

// 태양전지 · 광검출기 · 엑스선 검출기: 디스플레이 기술과 같은 재료 · 구조 말(perovskite · tandem)을 쓰지만 다른 분야
export const NON_DISPLAY_TITLE = 'solar|photovolt|photodetector|x-ray|scintillat'

// 11/26 W34: 연결표 밖 기술(제목으로만 세는 기술)에도 태양전지 · 광검출기 제목을 뺀다 — 관리 페이지 「실험 기능」 patentSolarExclude
// 중국 공보 번역은 태양전지를 「perovskite battery」(钙钛矿电池)로 써서 battery도 뺀다 (11/26 로컬 특허 DB: 2020년~ 「perovskite」 제목 7,982건 중
// solar 등 3,910건 + battery 596건 — 표본 12건 모두 태양전지), 「perovskite-silicon tandem cells」 같은 태양전지 탠덤도.
// 검색어가 이 말들 자체(예: 「태양전지」)면 빼지 않는다. 꺼짐이면 null → 예전처럼 제목 그대로
export const NON_DISPLAY_WIDE = `${NON_DISPLAY_TITLE}|batter|tandem cell|perovskite cell`
export async function titleExclude(pattern) {
  if (!(await serverFlag('patentSolarExclude').catch(() => false))) return null
  if (new RegExp(NON_DISPLAY_WIDE, 'i').test(String(pattern ?? ''))) return null
  return NON_DISPLAY_WIDE
}

// match: 키워드나 영문 검색어에 걸리는 말 (소문자) · cpc: 그 기술 CPC (PostgreSQL 정규식, 코드 앞부분)
// with: 그 CPC만으로는 넓을 때 함께 있어야 하는 CPC · withTitle: 또는 제목에 이 말 · exclude: 빼는 제목
// note: 근거 (CPC 정의 · 11/21 데이터 확인). on: 판정에 쓰는지
export const DEFAULT_TECHS = [
  { id: 'tandem-oled', name: '탠덤 OLED', match: '탠덤|tandem', cpc: '^(H10K50/19|H01L51/5278)', exclude: NON_DISPLAY_TITLE, on: true,
    note: 'CPC 정의 「Tandem OLEDs」(H10K50/19) · 예전 코드 H01L51/5278(여러 발광 단위를 겹친 소자). 11/21: 2020~22년 448 → 2023~25년 764건, 표본 제목 모두 OLED 소자' },
  { id: 'qd-oled', name: 'QD-OLED', match: 'qd[ -]?oled|퀀텀닷 ?oled|quantum[ -]dot organic', cpc: '^H10K59/38', with: '^(H10K50/115|C09K11)', withTitle: 'quantum[ -]?dot', exclude: NON_DISPLAY_TITLE, on: false,
    note: '색변환층(H10K59/38)만 쓰면 WOLED + 컬러필터까지 섞임 → 양자점(H10K50/115 · C09K11 · 제목)과 함께일 때만. 11/21: 475 → 403건, 표본에 양자점 아닌 것이 남아 확인 필요' },
  { id: 'ltpo', name: 'LTPO', match: 'ltpo|저온 ?다결정 ?산화', cpc: '^H10D86/425', exclude: NON_DISPLAY_TITLE, on: false,
    note: 'LTPO 제목 특허에 H10D86/425(서로 다른 반도체의 TFT를 함께)가 다른 분류보다 874배 몰림. 2025년 새 코드라 예전 코드를 더 찾아야 함 (11/21: 101 → 59건은 코드 변경 탓일 수 있음)' },
  { id: 'mini-led', name: '미니 LED', match: '미니 ?led|mini[ -]?led', cpc: '^(G02F1/133603|G02F1/133609|G09G3/342)', withTitle: 'mini|local dimming|backlight', exclude: NON_DISPLAY_TITLE, on: false,
    note: '직하형 백라이트(G02F1/133603 · 133609) · 로컬 디밍(G09G3/342)이 미니 LED 제목 특허에 26~28배 몰림. 일반 LED 백라이트와 나누는 기준 확인 필요' },
  { id: 'perovskite-led', name: '페로브스카이트 LED', match: '페로브스카이트|perovskite', cpc: '^H10K85/50', with: '^(H10K50|H10K59|H01L33|H10H)', exclude: NON_DISPLAY_TITLE, on: false,
    note: '페로브스카이트 재료 코드(H10K85/50)는 태양전지에도 붙음 → 발광 소자 코드와 함께일 때만, 태양전지 제목은 뺌' },
]

const G = (globalThis.__techbriefTechCpc ??= { list: DEFAULT_TECHS, at: 0 })

// 정규식 검사: PostgreSQL에서 쓸 말이라 길이 · 문자를 제한한다 (관리 페이지 입력)
const SAFE = /^[\p{L}\p{N}\s|()[\]^$.?*+\-/\\]{1,200}$/u
function checkRe(v, label, { optional = true } = {}) {
  const s = String(v ?? '').trim()
  if (!s) {
    if (optional) return ''
    throw Object.assign(new Error(`${label}이(가) 비었어요.`), { status: 400 })
  }
  if (!SAFE.test(s)) throw Object.assign(new Error(`${label}에 쓸 수 없는 글자가 있어요.`), { status: 400 })
  try {
    new RegExp(s)
  } catch {
    throw Object.assign(new Error(`${label} 정규식이 맞지 않아요.`), { status: 400 })
  }
  return s
}
export function checkTech(t) {
  const id = String(t?.id ?? '').trim().toLowerCase()
  if (!/^[a-z0-9-]{2,40}$/.test(id)) throw Object.assign(new Error('기술 id는 영어 소문자 · 숫자 · - 로 2~40자예요.'), { status: 400 })
  return {
    id,
    name: String(t.name ?? id).trim().slice(0, 40) || id,
    match: checkRe(t.match, '찾는 말', { optional: false }),
    cpc: checkRe(t.cpc, 'CPC', { optional: false }),
    with: checkRe(t.with, '함께 있어야 하는 CPC'),
    withTitle: checkRe(t.withTitle, '함께 있어야 하는 제목'),
    exclude: checkRe(t.exclude, '빼는 제목'),
    on: Boolean(t.on),
    note: String(t.note ?? '').slice(0, 400),
  }
}

export async function loadTechCpc({ fresh = false } = {}) {
  if (!fresh && Date.now() - G.at < TTL) return G.list
  try {
    const saved = await getSetting(KEY, null)
    G.list = Array.isArray(saved) && saved.length ? saved.map(checkTech) : DEFAULT_TECHS
  } catch {
    G.list = DEFAULT_TECHS
  }
  G.at = Date.now()
  return G.list
}
export const techCpcList = () => G.list
export const techCpcVersion = () => createHash('sha1').update(JSON.stringify(G.list.filter((t) => t.on))).digest('hex').slice(0, 8)

export async function saveTechCpc(list, who = '관리자') {
  if (!Array.isArray(list) || list.length > 50) throw Object.assign(new Error('목록이 맞지 않아요.'), { status: 400 })
  const clean = list.map(checkTech)
  if (new Set(clean.map((t) => t.id)).size !== clean.length) throw Object.assign(new Error('같은 id가 두 번 있어요.'), { status: 400 })
  await setSetting(KEY, clean)
  const history = await getSetting(HISTORY, []).catch(() => [])
  history.unshift({ at: new Date().toISOString(), name: who, on: clean.filter((t) => t.on).map((t) => t.id) })
  await setSetting(HISTORY, history.slice(0, 30))
  G.list = clean
  G.at = Date.now()
  return clean
}
export async function resetTechCpc(who = '관리자') {
  return saveTechCpc(DEFAULT_TECHS, who)
}

// 키워드 · 영문 검색어 중 하나라도 켜진 기술의 match에 걸리면 그 기술 (먼저 적힌 것)
export async function techRuleFor(texts) {
  await loadTechCpc()
  const words = (Array.isArray(texts) ? texts : [texts]).map((t) => String(t ?? '').toLowerCase()).filter(Boolean)
  return G.list.find((t) => t.on && words.some((w) => new RegExp(t.match, 'i').test(w))) ?? null
}

// SQL 조건: display_patents 한 줄이 그 기술 특허인지. at = 이 조건의 첫 자리표시자 번호
// 돌려줌: { sql, params } — 제목 패턴(titleSql, 이미 있는 자리표시자)과 OR로 묶는다
export function techWhere(rule, at, titleSql = null) {
  const params = [rule.cpc]
  let cpcPart = `EXISTS (SELECT 1 FROM unnest(cpc) x WHERE x ~ $${at})`
  if (rule.with || rule.withTitle) {
    const also = []
    if (rule.with) {
      params.push(rule.with)
      also.push(`EXISTS (SELECT 1 FROM unnest(cpc) x WHERE x ~ $${at + params.length - 1})`)
    }
    if (rule.withTitle) {
      params.push(rule.withTitle)
      also.push(`lower(title) ~ $${at + params.length - 1}`)
    }
    cpcPart = `(${cpcPart} AND (${also.join(' OR ')}))`
  }
  let sql = titleSql ? `(${titleSql} OR ${cpcPart})` : cpcPart
  if (rule.exclude) {
    params.push(rule.exclude)
    sql = `(${sql} AND NOT lower(title) ~ $${at + params.length - 1})`
  }
  return { sql, params }
}

// 관리 페이지 「켜기 전 확인」: 제목과 상관없이 그 CPC 조건만으로 몇 건이 잡히고 어떤 특허인지 (최근 표본 8건)
// 앞 · 뒤 기간은 판정과 같게 (지난해 기준 앞 3년 · 뒤 3년)
export async function previewTech(input) {
  const rule = checkTech({ ...input, id: input?.id || 'preview' })
  if (!dbEnabled()) throw Object.assign(new Error('DB가 없어요.'), { status: 503 })
  const last = new Date().getFullYear() - 1
  const [a, b, c] = [(last - 5) * 10000, (last - 2) * 10000, (last + 1) * 10000]
  const w = techWhere(rule, 4)
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE pub >= $1 AND pub < $2)::int AS before, count(*) FILTER (WHERE pub >= $2 AND pub < $3)::int AS now
       FROM display_patents WHERE pub >= $1 AND pub < $3 AND ${w.sql}`,
    [a, b, c, ...w.params],
  )
  const ws = techWhere(rule, 3)
  const sample = await query(
    `SELECT title, pub, owners[1] AS owner FROM display_patents WHERE pub >= $1 AND pub < $2 AND ${ws.sql} ORDER BY md5(family) LIMIT 8`,
    [b, c, ...ws.params],
  )
  return { years: `${last - 5}~${last - 3} → ${last - 2}~${last}`, before: rows[0].before, now: rows[0].now, sample: sample.rows.map((r) => ({ title: r.title, year: Math.floor(r.pub / 10000), owner: r.owner ?? '' })) }
}
