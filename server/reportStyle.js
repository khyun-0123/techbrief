// 보고서 양식 설정 (11/20, 관리자 인수인계): 글꼴 · 글자 크기 · 강조색 · 여백 · 줄 간격
// 예전에는 src/reportSlides.js · scripts/report-template.mjs에 숫자로 박혀 있어 바꾸려면 코드를 고쳐야 했다
// - 처음 값 = 1차 인터뷰 사내 규칙(한글 LG 스마트체 · 영문 Arial Narrow, 18/14/11/10pt) + 지금 화면 값
// - 화면 미리보기 · PDF · PPT(화면 것)는 모두 이 값으로 그린다. 담당자 양식 PPT(칸 이름 붙은 것)는 글꼴 · 강조색만 따른다 (칸 자리가 고정)
// - 저장 · 기록 방식은 importanceRule.js · judgeSettings.js와 같다 (app_settings, 최근 20건)
import { getSetting, setSetting } from './db/store.js'

const KEY = 'report_style'
const HISTORY_KEY = 'report_style_history'
const HISTORY_MAX = 20

export const DEFAULT_STYLE = {
  fonts: { ea: 'LG 스마트체', latin: 'Arial Narrow' },
  sizes: { title: 18, sub: 14, body: 11, note: 10 },
  accent: 'A50034',
  margin: 0.5,
  lineGap: 1.35,
}

// [키, 이름, 설명, 최소, 최대, 간격]
export const SIZE_FIELDS = [
  ['title', '제목 · 헤드라인', '쪽 제목과 1페이지 헤드라인', 14, 28, 1],
  ['sub', '소주제', '「핵심 사실과 근거」 같은 칸 제목', 11, 22, 1],
  ['body', '본문', '글머리 문장', 8, 14, 0.5],
  ['note', '주석 · 출처', '출처 · 근거 번호 · 쪽 번호 · 표', 7, 12, 0.5],
]
export const LAYOUT_FIELDS = [
  ['margin', '쪽 여백', '쪽 가장자리에서 내용까지 (인치, 4:3 쪽 너비 10인치)', 0.3, 0.8, 0.05],
  ['lineGap', '줄 간격', '글자 크기의 몇 배 (1.35 = 지금)', 1.15, 1.6, 0.05],
]

const FONT_RE = /^[^"'<>&;{}\\]{1,40}$/
const num = (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v)

export function checkReportStyle(input) {
  const s = input ?? {}
  const out = { fonts: {}, sizes: {}, accent: null, margin: null, lineGap: null }
  for (const k of ['ea', 'latin']) {
    const v = String(s.fonts?.[k] ?? '').trim()
    if (!FONT_RE.test(v)) throw Object.assign(new Error(`${k === 'ea' ? '한글' : '영문'} 글꼴 이름을 1~40자로 넣어 주세요 (따옴표 · 꺾쇠 없이)`), { status: 400 })
    out.fonts[k] = v
  }
  for (const [k, label, , min, max] of SIZE_FIELDS) {
    const v = num(s.sizes?.[k])
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw Object.assign(new Error(`${label} 글자 크기는 ${min}~${max}pt로 넣어 주세요`), { status: 400 })
    out.sizes[k] = Math.round(v * 2) / 2
  }
  const { title, sub, body, note } = out.sizes
  if (!(title >= sub && sub >= body && body >= note)) throw Object.assign(new Error('글자 크기는 제목 ≥ 소주제 ≥ 본문 ≥ 주석 순서여야 해요'), { status: 400 })
  const accent = String(s.accent ?? '').replace(/^#/, '').toUpperCase()
  if (!/^[0-9A-F]{6}$/.test(accent)) throw Object.assign(new Error('강조색은 #A50034처럼 6자리 색 값으로 넣어 주세요'), { status: 400 })
  out.accent = accent
  for (const [k, label, , min, max] of LAYOUT_FIELDS) {
    const v = num(s[k])
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw Object.assign(new Error(`${label}은 ${min}~${max} 사이로 넣어 주세요`), { status: 400 })
    out[k] = Math.round(v * 100) / 100
  }
  return out
}

const cache = (globalThis.__reportStyle ??= { value: null, at: 0 })
const TTL = 60_000

export async function getReportStyle() {
  if (cache.value && Date.now() - cache.at < TTL) return cache.value
  const saved = await getSetting(KEY, null).catch(() => null)
  let value = DEFAULT_STYLE
  if (saved) {
    try {
      value = checkReportStyle({ ...DEFAULT_STYLE, ...saved, fonts: { ...DEFAULT_STYLE.fonts, ...saved.fonts }, sizes: { ...DEFAULT_STYLE.sizes, ...saved.sizes } })
    } catch {
      value = DEFAULT_STYLE // 저장값이 깨졌으면 처음 값
    }
  }
  cache.value = value
  cache.at = Date.now()
  return value
}

export async function saveReportStyle(input, admin) {
  const style = checkReportStyle(input)
  await setSetting(KEY, style)
  const history = await getSetting(HISTORY_KEY, []).catch(() => [])
  const next = [{ at: new Date().toISOString(), name: admin?.name ?? '관리자', style }, ...(Array.isArray(history) ? history : [])].slice(0, HISTORY_MAX)
  await setSetting(HISTORY_KEY, next)
  cache.value = style
  cache.at = Date.now()
  return { style, history: next }
}

export const reportStyleHistory = () => getSetting(HISTORY_KEY, []).catch(() => [])

// 변경 기록 한 줄: 처음 값과 다른 것만
export function describeStyle(s) {
  const d = DEFAULT_STYLE
  const parts = []
  if (s.fonts.ea !== d.fonts.ea) parts.push(`한글 ${s.fonts.ea}`)
  if (s.fonts.latin !== d.fonts.latin) parts.push(`영문 ${s.fonts.latin}`)
  for (const [k, label] of SIZE_FIELDS) if (s.sizes[k] !== d.sizes[k]) parts.push(`${label} ${s.sizes[k]}pt`)
  if (s.accent !== d.accent) parts.push(`강조색 #${s.accent}`)
  for (const [k, label] of LAYOUT_FIELDS) if (s[k] !== d[k]) parts.push(`${label} ${s[k]}`)
  return parts.join(' · ') || '모두 처음 값'
}
