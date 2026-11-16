// 한 RSS 출처를 날짜 기준(14일) 없이 한 번 채운다 (11/17 조장)
// 쓰는 때: SID 논문집(Display Week)처럼 1년에 한 번 한꺼번에 올라오는 출처를 수집 전에 놓쳤을 때
// 실행: node --env-file=.env.local scripts/import-feed.mjs sid-digest
// 이미 있는 글은 건너뛴다. 공용 DB에 쓰므로 조장 확인 뒤에 돌린다
import { importFeedAll } from '../server/collector/index.js'

const id = process.argv[2]
if (!id) {
  console.error('출처 id를 적어 주세요. 예: node --env-file=.env.local scripts/import-feed.mjs sid-digest')
  process.exit(1)
}
const r = await importFeedAll(id)
console.log(`${id}: 받은 글 ${r.fetched}건 · 새로 넣음 ${r.added}건`)
process.exit(0)
