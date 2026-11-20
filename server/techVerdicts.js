// 자료 목록의 「자사 위협 기술 · 자사 기회 기술」 표시 (11/17, 긍정·중립·부정 표시를 대신함 — 담당자 14 문서 「크게 도움 안 됨」)
// - 기사 한 건의 내용을 판정하지 않는다. 기사가 다루는 **기술**의 판정(특허 비교, 규칙)을 보여 준다
//   판정은 「요즘 뜨는 기술」 옆 표시와 같은 함수(keywordBundle.js termVerdict): 그 말 특허가 가장 많은 세부 분류에서 경쟁사 · 자사 특허 증가 비교
// - 대상 말: 자동 수집 키워드 + 요즘 뜨는 기술 종합 상위 20 (미리 분석 대상과 거의 같아 기억해 둔 값으로 바로 나옴)
// - AI를 쓰지 않아 네이버 기사에도 붙일 수 있다 (약관: 네이버 문장을 AI에 넣지 않음)
// - 1시간 기억. 다시 계산하는 동안에는 예전 값을 보낸다
import { getKeywords } from './db/store.js'
import { termVerdict } from './keywordBundle.js'
import { judgeRule } from './judgeSettings.js'
import { getTechTrends } from './techtrends.js'

const TTL = 3600_000
const TOP_TRENDS = 20
const state = (globalThis.__techVerdictsV2 ??= { value: null, at: 0, running: null })

async function compute() {
  const keywords = await getKeywords().catch(() => [])
  const trends = await getTechTrends({ period: 'week' }).catch(() => null)
  const terms = [...new Set([...keywords, ...(trends?.composite ?? []).slice(0, TOP_TRENDS).map((r) => r.name)].map((t) => String(t ?? '').trim()).filter(Boolean))]
  const items = []
  // 한 번에 4개씩 (특허 DB 질의가 몰리지 않게)
  for (let i = 0; i < terms.length; i += 4) {
    const part = await Promise.all(terms.slice(i, i + 4).map((t) => termVerdict(t).catch(() => null)))
    part.forEach((v, j) => {
      if (!v?.verdict) return
      const c = v.competitors
      const own = c.companies.find((x) => x.own)
      const fastest = c.companies.filter((x) => !x.own && !x.unsure && x.ratio != null).sort((a, b) => b.ratio - a.ratio)[0]
      items.push({
        term: terms[i + j],
        verdict: v.verdict,
        category: v.category.name,
        patents: v.category.patents,
        share: v.category.share,
        years: c.years,
        field: c.field.ratio,
        own: own?.ratio ?? null,
        fastest: fastest ? { name: fastest.name, ratio: fastest.ratio } : null,
      })
    })
  }
  return { items, checked: terms.length, rule: `위협: 경쟁사 중 하나가 분야 증가의 ${judgeRule().threatFactor}배 이상 · 자사는 분야보다 느림 / 기회: 자사가 경쟁사 모두보다 빠르고 분야 이상`, at: new Date().toISOString() }
}

// 판정 기준 · 회사 특허 이름을 바꾸면 다음 요청 때 다시 계산 (그동안은 예전 값, 11/20)
export function staleTechVerdicts() {
  state.at = 0
}

export async function techVerdicts() {
  const fresh = state.value && Date.now() - state.at < TTL
  if (!fresh && !state.running) {
    state.running = compute()
      .then((v) => {
        state.value = v
        state.at = Date.now()
        return v
      })
      .finally(() => {
        state.running = null
      })
  }
  // 예전 값이 있으면 기다리지 않음
  return state.value ?? (await state.running)
}
