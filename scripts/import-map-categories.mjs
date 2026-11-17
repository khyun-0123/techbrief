// 맵팀이 채운 「분류 없는 기술 말」 CSV를 맵 목록에 옮긴다 (11/17, 41 문서 S1-1 · 38 문서 4장)
//
//   node scripts/import-map-categories.mjs [CSV]              → 미리 보기만 (무엇이 들어갈지)
//   node scripts/import-map-categories.mjs [CSV] --write      → server/data/subcategories.csv · stopwords.csv에 넣음
//   --suggested : 맵팀 칸이 비어 있으면 「우리 제안」을 씀 (맵팀이 「제안대로」라고 답했을 때)
//
// CSV 기본값: docs/38_map_uncategorized_tech_words_1117.csv
// 「분류(맵팀이 채움)」 칸 값에 따라:
//   사업 6분류 중 하나 → subcategories.csv 한 줄 (분류 뜻은 그 분류의 기존 뜻)
//   「불용어」가 든 값 → stopwords.csv 한 줄 (정확히 같을 때만 빼기)
//   그 밖(넓은 말 · 회사 · 제품 · 확인 필요 · 빈칸) → 넣지 않음. 회사 · 제품은 맵에서 「종류: 회사」로 쓰므로 빼지 않는다
// 이미 목록에 있는 말은 건너뛴다. 넣은 뒤 맵을 새로 만들려면 저장 열쇠(related:vN)를 올리거나 하루(24시간) 기다린다
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const write = args.includes('--write')
const suggested = args.includes('--suggested')
const src = resolve(ROOT, args.find((a) => !a.startsWith('--')) ?? 'docs/38_map_uncategorized_tech_words_1117.csv')
const SUB = resolve(ROOT, 'server/data/subcategories.csv')
const STOP = resolve(ROOT, 'server/data/stopwords.csv')

// 따옴표 · 쉼표 · 줄바꿈이 든 칸까지 읽는 CSV (BOM 제거)
function parse(text) {
  const rows = []
  let row = []
  let cell = ''
  let q = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) rows.push([...row, cell])
  const [head, ...body] = rows.filter((r) => r.some((x) => x !== ''))
  return { head, body: body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()]))) }
}
const esc = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
const line = (cells) => cells.map(esc).join(',')
const squash = (w) => String(w ?? '').toLowerCase().replace(/\s+/g, '')

const sub = parse(readFileSync(SUB, 'utf8'))
const stop = parse(readFileSync(STOP, 'utf8'))
const CATS = new Map(sub.body.filter((r) => r['분류'] && !r['분류'].startsWith('(')).map((r) => [r['분류'], r['분류 뜻']]))
const known = new Set([...sub.body.flatMap((r) => [r['키워드'], ...String(r['다른 표기 · 영문'] ?? '').split(',')]), ...stop.body.map((r) => r['불용어'])].map(squash).filter(Boolean))

const today = (() => {
  const d = new Date(Date.now() + 9 * 3600_000)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
})()
const toSub = []
const toStop = []
const skipped = []
for (const r of parse(readFileSync(src, 'utf8')).body) {
  const word = r['말']
  const pick = r['분류(맵팀이 채움)'] || (suggested ? r['우리 제안'] : '')
  if (!word || !pick) continue
  if (known.has(squash(word))) {
    skipped.push(`${word} (이미 있음)`)
    continue
  }
  const cat = [...CATS.keys()].find((c) => c === pick || c.replace(/\s*기술$/, '') === pick.replace(/\s*기술$/, ''))
  if (cat) toSub.push({ word, cat, memo: r['메모'] })
  else if (/불용어/.test(pick)) toStop.push({ word, why: pick.replace(/[()]/g, '').trim() })
  else skipped.push(`${word} (${pick})`)
}

console.log(`읽은 파일: ${src}${suggested ? ' · 빈 칸은 우리 제안으로' : ''}`)
console.log(`\n분류에 넣을 말 ${toSub.length}개`)
for (const c of CATS.keys()) {
  const ws = toSub.filter((x) => x.cat === c).map((x) => x.word)
  if (ws.length) console.log(`  ${c}: ${ws.join(', ')}`)
}
console.log(`\n불용어로 넣을 말 ${toStop.length}개: ${toStop.map((x) => x.word).join(', ')}`)
console.log(`\n넣지 않는 말 ${skipped.length}개: ${skipped.slice(0, 30).join(', ')}${skipped.length > 30 ? ' …' : ''}`)

if (!write) {
  console.log('\n미리 보기만 했어요. 넣으려면 --write')
  process.exit(0)
}
const src38 = `맵팀 (${today})`
const subText = readFileSync(SUB, 'utf8').replace(/\s*$/, '\n')
writeFileSync(SUB, subText + toSub.map((x) => line([x.cat, CATS.get(x.cat) ?? '', x.word, '', '', '', src38, x.memo ?? ''])).join('\n') + (toSub.length ? '\n' : ''))
const stopText = readFileSync(STOP, 'utf8').replace(/\s*$/, '\n')
writeFileSync(STOP, stopText + toStop.map((x) => line([x.word, x.why, src38, '정확히 같을 때만', ''])).join('\n') + (toStop.length ? '\n' : ''))
console.log(`\n넣음: subcategories.csv ${toSub.length}줄 · stopwords.csv ${toStop.length}줄. 서버 코드가 아니라 자료라 서버를 다시 켜면 반영 (관리 페이지 「서버 다시 켜기」)`)
