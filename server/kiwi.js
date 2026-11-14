// 형태소 분석기 Kiwi (11/15 조장: 「불용어 처리 — 형태소 분석기 검토 · 활용」): 기사 문장에서 명사만 뽑는다. 서버 안에서 돌아 글이 밖으로 나가지 않음
// - 엔진: npm kiwi-nlp 0.24.1 (Apache-2.0, 웹어셈블리). 모델: GitHub 배포본 kiwi_model_v0.24.1_base (약 105MB, `npm run kiwi-model`로 받음)
// - 모델 위치는 프로젝트 폴더 밖 (KIWI_MODEL_DIR, 기본 ~/techbrief-data/kiwi/models/cong/base) — 특허 제목 파일과 같은 이유(개발 서버가 내려 주지 않게)
// - 모델이 없거나 못 불러오면 null → related.js가 예전 규칙(조사 · 어미 떼기)으로 돈다
// - 첫 호출에 약 2.3초 · 메모리 약 1GB. 문장 하나 약 2.5ms (11/15 실측)
// 뽑는 규칙: 명사(NNG · NNP) · 외국어(SL) · 한자(SH) · 어근(XR)이 든 조각. 원문에서 띄어 쓰지 않고 붙어 있던 명사 · 숫자 · 접두 · 접미 조각은 다시 잇는다
//   바로 뒤에 「하다 · 되다」(XSV · XSA)가 붙어 동사로 쓰인 명사는 세지 않음 (증가했다 · 향상됐다 · 제기했다 — 11/15 3단계에 이런 말이 많았음)
//   「~적」(기술적)으로 끝나는 말은 빼고, 복수 「~들」은 떼어 냄
//   예: 「부정행위」 = 부정 + 행위, 「초격차」 = 초 + 격차, 「1600니트」, 「8.6세대」 (숫자 + 단위만 있는 말도 남기고 불용어 규칙이 거른다)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { userDictWords } from './wordFilter.js'

export const kiwiModelDir = () => process.env.KIWI_MODEL_DIR || path.join(os.homedir(), 'techbrief-data', 'kiwi', 'models', 'cong', 'base')
const WASM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'kiwi-nlp', 'dist', 'kiwi-wasm.wasm')

const G = (globalThis.__techbriefKiwi ??= { promise: null, status: 'idle', error: null }) // 서버 코드를 다시 불러와도 한 번만 올림
export const kiwiStatus = () => ({ status: G.status, error: G.error, dir: kiwiModelDir() })

export function loadKiwi() {
  if (G.promise) return G.promise
  G.promise = (async () => {
    const dir = kiwiModelDir()
    if (!fs.existsSync(path.join(dir, 'sj.morph'))) {
      G.status = 'missing'
      console.warn(`[kiwi] 모델이 없어 예전 규칙으로 낱말을 뽑아요 (${dir}, npm run kiwi-model)`)
      return null
    }
    try {
      G.status = 'loading'
      const { KiwiBuilder } = await import('kiwi-nlp')
      const builder = await KiwiBuilder.create(WASM)
      const modelFiles = Object.fromEntries(fs.readdirSync(dir).map((f) => [f, new Uint8Array(fs.readFileSync(path.join(dir, f)))]))
      const userWords = userDictWords().map((word) => ({ word, tag: 'NNP', score: 0 }))
      const kiwi = await builder.build({ modelFiles, modelType: 'cong', userWords, loadTypoDict: false })
      G.status = 'ready'
      return kiwi
    } catch (err) {
      G.status = 'error'
      G.error = err.message
      console.warn(`[kiwi] 못 불러옴 — 예전 규칙으로: ${err.message}`)
      return null
    }
  })()
  return G.promise
}

const PIECE = /^(NN|SL|SH|SN|XR|XPN|XSN)/ // 이어 붙일 수 있는 조각
const VERBAL = /^(XSV|XSA)/ // 붙으면 동사 · 형용사 (하다 · 되다 · 스럽다)
const CORE = /^(NN[GP]|SL|SH|XR)/ // 조각 안에 이것이 하나는 있어야 낱말로 침
// 한 글에서 명사 낱말 (겹치지 않게). kiwi가 없으면 null
export function nounsOf(kiwi, text) {
  if (!kiwi || !text) return null
  const out = []
  let cur = null
  const flush = () => {
    if (cur && !cur.verbal && !/적$/.test(cur.str) && (cur.tags.some((t) => CORE.test(t)) || (cur.tags.includes('SN') && cur.tags.includes('NNB')))) out.push(cur.str)
    cur = null
  }
  for (const t of kiwi.analyze(String(text).slice(0, 4000)).tokens) {
    if (cur && VERBAL.test(t.tag) && t.position === cur.end) cur.verbal = true
    if (t.tag === 'XSN' && t.str === '들') {
      flush() // 복수 「들」은 붙이지 않고 끊음 (수험생들 → 수험생)
      continue
    }
    if (!PIECE.test(t.tag)) {
      flush()
      continue
    }
    if (cur && t.position === cur.end) {
      cur.str += t.str
      cur.end = t.position + t.length
      cur.tags.push(t.tag)
    } else {
      flush()
      cur = { str: t.str, end: t.position + t.length, tags: [t.tag] }
    }
  }
  flush()
  return out
}
