// 단어 거르기 (11/14 통합): 워드클라우드팀(박세현) 키워드 마인드맵 v2의 불용어 v3 · 예외 v3 · 기술 하위분류 v2와 isStopword 규칙을 옮김
// - 목록은 server/data/*.csv (1차 검수본: 2글자 「들어 있으면」 → 「정확히」, 사업 · 분야 말 · 잡음 뺌, 「검수(11/14)」 칸에 이유). 사람이 다시 검수한다
// - 순서 (팀 규칙 그대로): 예외어 그 자체면 남김 → 예외어 부분을 지운 나머지로 판단 → 정확히 같음 → 3글자 이상 한글 활용형 끝말 → 숫자+단위 → 「들어 있으면」
// - related.js(연관 키워드 맵)의 기존 STOP · VERB_END 위에 덧붙인다. AI 안 씀
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
export const squash = (s) => String(s ?? '').toLowerCase().replace(/[\s\-·_]/g, '')

// 따옴표 · 쉼표가 든 칸을 읽는 작은 CSV 읽기 (첫 줄 = 머리)
function readCsv(file) {
  const text = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/^﻿/, '')
  const rows = []
  let row = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) rows.push([...row, cell])
  const [head, ...body] = rows
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

// 팀 v2 정규식 그대로 (활용형 끝말 · 숫자+단위). 8.6세대 · 83인치 · 120Hz는 NUM_RE에 걸리지 않아 남는다
const ENDING_RE =
  /(했다|한다|된다|됐다|했고|하고|하며|하는|해서|하여|하면|했던|되는|되며|되고|에서|으로|에게|까지|부터|처럼|라고|이며|였다|겠다|시킨|시켜|중이다|전망이다|계획이다|예정이다|방침이다|결정이다|것이다|셈이다|상황이다|입장이다|관측이다|수준이다|모습이다|든다|낸다|선다|간다|온다|운다|린다|졌다|났다|왔다|갔다|있다|없다|했지만|하지만|있지만|이지만|위해|위한|통해|대해|따라)$/
const NUM_RE = /^\d+(일|월|년|시간|분|초|곳|개|건|명|억|조|만|천|원|달러|위|배|차|호|층|대|주|회|종|위권)$/
// 11/14 추가 (조장 검수, 팀 규칙 밖): 관형형 · 의문형 끝말 — 「적용한 · 출시된 · 아니냐」가 맵에 남던 문제. 3글자 이상 한글만, 예외어는 앞에서 이미 남김
const ENDING_ADD_RE = /(한|된|냐)$/

let lists = null
function load() {
  if (lists) return lists
  try {
    const stop = readCsv('stopwords.csv')
    const exact = new Set()
    const contains = []
    for (const r of stop) {
      const w = squash(r['불용어'])
      if (!w) continue
      if (r['맞추는 방식'] === '정확히 같을 때만') exact.add(w)
      else if (r['맞추는 방식'] === '들어 있으면 빼기') contains.push(w)
    }
    const exceptions = [...new Set(readCsv('exceptions.csv').map((r) => squash(r['단어'])).filter(Boolean))].sort((a, b) => b.length - a.length)
    const cats = readCsv('subcategories.csv')
      .filter((r) => r['키워드'] && !String(r['분류']).startsWith('('))
      .map((r) => ({
        cat: r['분류'].replace(/\s*기술$/, ''),
        names: [r['키워드'], ...String(r['다른 표기 · 영문'] ?? '').split(',')].map(squash).filter((x) => x.length >= 2),
        not: String(r['제외어'] ?? '').split(',').map(squash).filter(Boolean),
        also: String(r['같이 들어가는 분류'] ?? '').split(',').map((x) => x.trim().replace(/\s*기술$/, '')).filter(Boolean),
      }))
    lists = { exact, contains, exceptions, exceptionSet: new Set(exceptions), cats }
  } catch (err) {
    console.warn(`[wordFilter] 목록을 못 읽음 — 거르기 없이: ${err.message}`)
    lists = { exact: new Set(), contains: [], exceptions: [], exceptionSet: new Set(), cats: [] }
  }
  return lists
}

// 예외어(디스플레이 · 반도체 용어) 그 자체인가 — 맞으면 다른 불용어 규칙을 건너뛴다
export function isException(word) {
  return load().exceptionSet.has(squash(word))
}

// 빼야 할 말인가
export function isStop(word) {
  const L = load()
  const raw = squash(word)
  if (!raw) return true
  if (L.exceptionSet.has(raw)) return false
  let rest = raw
  for (const e of L.exceptions) if (rest.includes(e)) rest = rest.split(e).join('|') // 예외어 부분은 지운 나머지만 본다 (응답속도의 「속도」)
  if (L.exact.has(raw)) return true
  if (/[가-힣]/.test(raw) && raw.length >= 3 && (ENDING_RE.test(raw) || ENDING_ADD_RE.test(raw))) return true
  if (NUM_RE.test(raw)) return true
  return L.contains.some((s) => rest.includes(s))
}

// 사업 관점 6분류 (양산·공정 · 소재·소자 · 수율·품질 관리 · 원가 절감 · 폼팩터·응용 · 차세대·경쟁 디스플레이). 팀 catMatch 규칙:
// 단어 안에 키워드나 다른 표기가 들어 있으면 그 분류, 영문 3글자 이하는 전체가 같을 때만, 제외어가 있으면 안 맞춤
export function subcatsOf(word) {
  const w = squash(word)
  const out = new Set()
  for (const c of load().cats) {
    const hit = c.names.some((n) => (/^[!-~]+$/.test(n) && n.length <= 3 ? w === n : w.includes(n)))
    if (hit && !c.not.some((x) => w.includes(x))) {
      out.add(c.cat)
      for (const a of c.also) out.add(a)
    }
  }
  return [...out]
}

export function filterStats() {
  const L = load()
  return { exact: L.exact.size, contains: L.contains.length, exceptions: L.exceptions.length, subcategoryKeywords: L.cats.length }
}
