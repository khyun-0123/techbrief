// 상용화 시점 문장 찾기 (11/12, 교수님 의견 R7 · 35 문서): 「그 기술이 1~2년 안에 양산 가능한가」의 근거 문장
// 규칙으로만 찾는다 (AI 아님): 모은 기사 제목 · 요약에서 「연도 · 내년 · 하반기 … + 양산 · 상용화 · 출시 …」가 가까이 나온 문장
// 「판단」이 아니라 「근거 문장」이다. 화면 · 보고서에 원문 그대로 출처와 함께 보인다
// 네이버 기사 문장은 약관상 AI에 넣지 않는다 → aiOk: false (화면에만). 1·2차 출처(RSS, section 'feed:…')만 aiOk
import { dbEnabled, query } from './db/index.js'
import { serverFlag } from './features.js'

const KO = /(20\d{2}년|내년|올해|연내|하반기|상반기|[1-4]분기).{0,25}?(양산|상용화|출시|공급|적용|채택|탑재)|(양산|상용화|출시|공급 개시).{0,15}?(20\d{2}년|내년|올해|연내|하반기|상반기)/
const EN = /\b(mass[- ]?produc\w*|commerciali[sz]\w*|volume production|launch\w*|ship(?:ping|ments?)?)\b.{0,40}?\b(20\d{2}|next year|this year|[12]H|H[12])\b|\b(20\d{2}|next year)\b.{0,40}?\b(mass[- ]?produc\w*|commerciali[sz]\w*|volume production)\b/i
const sentences = (t) => String(t ?? '').split(/(?<=[.!?。]|다\.)\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 12)
const yearOf = (s) => {
  const y = s.match(/20(\d{2})년|\b20(\d{2})\b/)
  if (y) return 2000 + Number(y[1] ?? y[2])
  if (/내년|next year/i.test(s)) return new Date().getFullYear() + 1
  if (/올해|연내|this year/i.test(s)) return new Date().getFullYear()
  return null
}

// ── 고르기 강화 (11/26, 33 문서 W27 · 스위치 commercialYearStrict, 꺼지면 위 규칙 그대로) ──
// 11/26 로컬 DB 12개 키워드로 본 잘못 걸린 문장: ① 지난 일(「2019년 탠덤 OLED를 상용화한 데 이어」 6건 모두 · 「2025년 출시한 아이폰」)
// ② 증권 · 실적 문장(「DS투자증권 연구원 … 공급 … 실적」 · 「반도체 업황 … HBM4E 양산」) ③ 「탑재 · 적용 · 채택」(「M6 칩을 탑재」처럼 제품 사양)
// ④ 공급 계약 금액 공시. 그래서: 양산 · 상용화 · 출시 · 공급(시작)만, 연도는 올해 이후만, 지난 일 꼴(~한 · ~했다 · ~된 · 이후 · 데 이어)과
// 증권 · 실적 · 공시 낱말이 있으면 뺀다. 연도 없이 「내년 · 하반기」만 있는 문장은 그대로 둔다
const KO_STRICT = /(20\d{2}년|내년|올해|연내|하반기|상반기|[1-4]분기).{0,25}?(양산|상용화|출시|공급)|(양산|상용화|출시|공급 개시).{0,15}?(20\d{2}년|내년|올해|연내|하반기|상반기)/
const PAST = /(양산|상용화|출시|공급|생산)(을|를)?\s?(한|했|된|됐|해 ?왔|에 성공|을 시작했|를 시작했|에 들어갔|에 들어간|에 돌입했|에 돌입한)|(한|된|간) (데 이어|이후|뒤)|\b(launched|commerciali[sz]ed|shipped|began (mass )?production)\b(?!.{0,15}\b(in|by) 20\d{2})/i
const FINANCE = /증권|연구원|애널리스트|실적|매출|영업이익|순이익|주가|목표가|투자의견|업황|공시|계약 (금액|규모)|수주액|\b(revenue|earnings|shares|stock|analyst|guidance)\b/i
export function strictOk(s, now = new Date().getFullYear()) {
  if (!(KO_STRICT.test(s) || EN.test(s))) return false
  // 영문은 「expects … to be commercialized around 2029」처럼 과거분사가 앞날을 말하기도 해서, 앞날 말이 있으면 지난 일로 보지 않음
  const future = /\b(expect\w*|plan\w*|aim\w*|target\w*|will|to be|set to|slated)\b/i.test(s)
  if ((PAST.test(s) && !(future && !/[가-힣]/.test(s))) || FINANCE.test(s)) return false
  const years = [...s.matchAll(/20(\d{2})년|\b20(\d{2})\b/g)].map((m) => 2000 + Number(m[1] ?? m[2]))
  if (years.length && Math.max(...years) < now) return false // 지난 해만 나오는 문장
  return true
}

// 강화 규칙의 연도: 문장에 나온 가장 늦은 해 (「2029~2030년」 · 「2024년 … 2027년 양산」에서 앞 해를 고르던 것)
function yearOfStrict(s) {
  const years = [...s.matchAll(/20(\d{2})년|\b20(\d{2})\b/g)].map((m) => 2000 + Number(m[1] ?? m[2]))
  return years.length ? Math.max(...years) : yearOf(s)
}

// terms: 키워드와 영문 검색어. 최근 1년 모은 기사에서 찾는다
// strict: 고르기 강화(W27) — 없으면 관리 페이지 스위치(commercialYearStrict)를 따른다
export async function commercialQuotes(terms, { limit = 6, strict } = {}) {
  strict ??= await serverFlag('commercialYearStrict').catch(() => false)
  if (!dbEnabled()) return []
  const words = [...new Set(terms.map((t) => String(t).toLowerCase().replace(/\s+/g, '')).filter((t) => t.length >= 2))].slice(0, 6)
  if (!words.length) return []
  const like = words.map((w) => `%${w.replace(/[%_\\]/g, '\\$&')}%`)
  const { rows } = await query(
    `SELECT coalesce(full_title, title) AS title, coalesce(description, '') AS description, source, url, published_at, coalesce(section, '') AS section
       FROM articles
      WHERE published_at > now() - interval '365 days'
        AND lower(regexp_replace(coalesce(full_title, title) || ' ' || coalesce(description, ''), '\\s+', '', 'g')) LIKE ANY($1)
      ORDER BY published_at DESC LIMIT 400`,
    [like],
  )
  const out = []
  const seen = new Set()
  for (const r of rows) {
    for (const s of [r.title, ...sentences(r.description)]) {
      // 문장 자체에 그 기술 말이 있어야 한다 (11/12 실측: QD-OLED 기사 속 「HBM 공급」 문장이 걸림)
      const flat = s.toLowerCase().replace(/\s+/g, '')
      if (!words.some((w) => flat.includes(w))) continue
      if (strict ? !strictOk(s) : !(KO.test(s) || EN.test(s))) continue
      const key = s.slice(0, 40)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ text: s.slice(0, 220), year: strict ? yearOfStrict(s) : yearOf(s), source: r.source, url: r.url, publishedAt: r.published_at, aiOk: r.section.startsWith('feed:') })
      break // 기사 하나에 한 문장
    }
    if (out.length >= limit * 2) break
  }
  // 1·2차 출처 문장을 앞에 (보고서 근거로 쓸 수 있는 것), 그다음 최신순
  return out.sort((a, b) => Number(b.aiOk) - Number(a.aiOk) || new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, limit)
}
