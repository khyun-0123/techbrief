// 논문 미리 모으기 — 처음 · 성장기까지 (11/26, 39 문서 3장 D2 1 · 2번 「기간 전체」, 「발표 뒤」 앞당김)
// - 11/17 D2 반영(papers/keywordStore.js)은 「찾을 때 받은 최근 3년 논문을 저장」까지였다. 디스플레이 밖 말(ai 안경 · HBM 등)은
//   디스플레이 논문 DB(papers, 연도 제한 없음)에 없어서 그 기술이 처음 나온 때 · 커 온 때 논문이 어디에도 없었다
// - 대상: 미리 분석 대상(자동 수집 키워드 · 많이 찾은 말 · 요즘 뜨는 기술 상위, timelineJobs.js) 중 디스플레이 논문 DB에 15편 미만인 말.
//   미리 못 모은 말은 사람이 키워드 분석을 열 때 받는다(요청 때 받기, 뒤에서 · 화면은 기다리지 않음)
// - 시기 셋(처음 ~2017 · 성장 2018~2021 · 최근 2022~)마다 OpenAlex 인용 많은 순 40편 → keyword_papers에 provider 'prefetch'로 쌓음.
//   발행일로 정리할 때 지우지 않는다. 한 말 30일에 한 번
// - 비용: 한 말에 OpenAlex 3번(약 $0.003) + 초록 빈 논문은 Semantic Scholar(무료). 미리 분석 한 번(6시간)에 최대 PER_RUN개 말
// - 실험 기능 「papersPrefetch」(server/features.js)가 「끄기」면 하지 않음 (처음 값 끄기)
// - 특허는 하지 않는다: 디스플레이 밖 특허는 전 세계 특허 제목 파일 · BigQuery(돈이 듦)라 조장 승인 뒤 (39 문서 3-1 4번 · P11)
import { cacheGet, cachePut } from './index.js'
import { corpusReady, searchCorpus } from './corpus.js'
import { keywordPapers } from './journals.js'
import { saveKeywordPapers } from './keywordStore.js'
import { englishTerms, openAlexQuery, queryKey } from '../queryTerms.js'
import { getFeatures } from '../features.js'

export const PER_RUN = 2
const PER_WINDOW = 40
const CORPUS_MIN = 15
const DONE_TTL = 30 * 86_400_000
const DONE_KEY = 'paper-prefetch:v1:'

export function prefetchWindows(now = new Date()) {
  return [
    { id: 'early', label: '처음 (~2017)', from: '1990-01-01', to: '2017-12-31' },
    { id: 'growth', label: '성장 (2018~2021)', from: '2018-01-01', to: '2021-12-31' },
    { id: 'recent', label: '최근 (2022~)', from: '2022-01-01', to: now.toISOString().slice(0, 10) },
  ]
}

export async function prefetchOn() {
  return ((await getFeatures().catch(() => ({}))).papersPrefetch ?? 'off') !== 'off'
}

// 돌려주는 값: { query, status: 'done' | 'skip', reason?, windows?: [{ id, n }] }
// dryRun: 받기만 하고 저장 · 완료 표시는 하지 않음 (시험용, 받은 수만)
export async function prefetchPeriods(rawQuery, { dryRun = false, force = false } = {}) {
  const q = String(rawQuery ?? '').trim()
  const k = queryKey(q)
  if (!k) return { query: q, status: 'skip', reason: '빈 말' }
  if (!force && !dryRun && (await cacheGet(`${DONE_KEY}${k}`).catch(() => null))) return { query: q, status: 'skip', reason: '30일 안에 받음' }
  const t = await englishTerms(q, { waitMs: 0 })
  if (!t.terms.length) return { query: q, status: 'skip', reason: t.pending ? '영문 검색어 만드는 중' : '영문 검색어 없음' }
  // 디스플레이 논문 DB가 이미 기간 전체를 갖고 있는 말은 받지 않음
  if (await corpusReady().catch(() => false)) {
    const rows = await searchCorpus(t.terms, { from: '1990-01-01', to: new Date().toISOString().slice(0, 10), limit: CORPUS_MIN }).catch(() => [])
    if (rows.length >= CORPUS_MIN) {
      if (!dryRun) await cachePut(`${DONE_KEY}${k}`, { at: new Date().toISOString(), reason: 'corpus' }, DONE_TTL).catch(() => {})
      return { query: q, status: 'skip', reason: '디스플레이 논문 DB에 있음' }
    }
  }
  const en = openAlexQuery(t.terms)
  const windows = []
  for (const w of prefetchWindows()) {
    const { works } = await keywordPapers(en, { from: w.from, to: w.to, limit: PER_WINDOW, sort: 'cited' })
    const list = works.filter((x) => !x.retracted).map((x) => ({ ...x, prefetch: w.id }))
    if (!dryRun && list.length) await saveKeywordPapers(q, list, 'prefetch')
    windows.push({ id: w.id, n: list.length, years: list.map((x) => Number(String(x.date ?? '').slice(0, 4))).filter(Boolean) })
  }
  const summary = windows.map(({ id, n, years }) => ({ id, n, from: years.length ? Math.min(...years) : null, to: years.length ? Math.max(...years) : null }))
  if (!dryRun) await cachePut(`${DONE_KEY}${k}`, { at: new Date().toISOString(), windows: summary }, DONE_TTL).catch(() => {})
  return { query: q, status: 'done', windows: summary }
}

// 요청 때 받기: 사람이 연 말을 뒤에서 (화면은 기다리지 않음). 실험 기능이 꺼져 있으면 아무것도 안 함
const inflight = new Set()
export function prefetchLater(rawQuery) {
  const k = queryKey(rawQuery)
  if (!k || inflight.has(k)) return
  inflight.add(k)
  prefetchOn()
    .then((on) => (on ? prefetchPeriods(rawQuery) : null))
    .catch((err) => console.warn(`[paper-prefetch] ${rawQuery}: ${err.message}`))
    .finally(() => inflight.delete(k))
}
