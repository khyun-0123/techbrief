// Kiwi 형태소 분석 모델 받기 (11/15, server/kiwi.js): GitHub 배포본 kiwi_model_v0.24.1_base.tgz(약 88MB, 풀면 105MB)를
// 프로젝트 폴더 밖(KIWI_MODEL_DIR의 위, 기본 ~/techbrief-data/kiwi)에 풀어 둔다. 이미 있으면 건너뜀. 받은 뒤 서버를 다시 켜면 쓰기 시작
// 사용: npm run kiwi-model
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const VERSION = '0.24.1' // package.json의 kiwi-nlp와 같은 판
const URL = `https://github.com/bab2min/Kiwi/releases/download/v${VERSION}/kiwi_model_v${VERSION}_base.tgz`
const modelDir = process.env.KIWI_MODEL_DIR || path.join(os.homedir(), 'techbrief-data', 'kiwi', 'models', 'cong', 'base')
const root = path.resolve(modelDir, '..', '..', '..') // …/kiwi (tgz 안이 models/cong/base)

if (fs.existsSync(path.join(modelDir, 'sj.morph'))) {
  console.log(`이미 있어요: ${modelDir}`)
  process.exit(0)
}
fs.mkdirSync(root, { recursive: true })
const tgz = path.join(root, 'model.tgz')
console.log(`받는 중: ${URL}`)
const res = await fetch(URL)
if (!res.ok) throw new Error(`받지 못했어요 (${res.status})`)
fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
execFileSync('tar', ['xzf', tgz, '-C', root])
fs.rmSync(tgz)
console.log(fs.existsSync(path.join(modelDir, 'sj.morph')) ? `완료: ${modelDir}` : `풀었지만 ${modelDir}에 sj.morph가 없어요 — KIWI_MODEL_DIR를 확인하세요`)
