// 상용화 시점 문장 찾기 (11/12, 교수님 의견 R7 · 35 문서): 「그 기술이 1~2년 안에 양산 가능한가」의 근거 문장
// 규칙으로만 찾는다 (AI 아님): 모은 기사 제목 · 요약에서 「연도 · 내년 · 하반기 … + 양산 · 상용화 · 출시 …」가 가까이 나온 문장
// 「판단」이 아니라 「근거 문장」이다. 화면 · 보고서에 원문 그대로 출처와 함께 보인다
// 네이버 기사 문장은 약관상 AI에 넣지 않는다 → aiOk: false (화면에만). 1·2차 출처(RSS, section 'feed:…')만 aiOk
import { dbEnabled, query } from './db/index.js'

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

// terms: 키워드와 영문 검색어. 최근 1년 모은 기사에서 찾는다
export async function commercialQuotes(terms, { limit = 6 } = {}) {
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
      if (!(KO.test(s) || EN.test(s))) continue
      const key = s.slice(0, 40)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ text: s.slice(0, 220), year: yearOf(s), source: r.source, url: r.url, publishedAt: r.published_at, aiOk: r.section.startsWith('feed:') })
      break // 기사 하나에 한 문장
    }
    if (out.length >= limit * 2) break
  }
  // 1·2차 출처 문장을 앞에 (보고서 근거로 쓸 수 있는 것), 그다음 최신순
  return out.sort((a, b) => Number(b.aiOk) - Number(a.aiOk) || new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, limit)
}
