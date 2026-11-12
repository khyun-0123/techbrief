// 디스플레이 특허 DB + 전 세계 특허 제목 파일 받기 (server/patentDb.js, 33 문서 7장 D3)
// npm run patent-db → 2010년부터 전부 (분기에 한 번 — Google 공개 특허 표가 분기마다 갱신)
// BigQuery를 한 번 약 42GB 읽는다 (하루 할당량 51GiB). 같은 날 다른 특허 집계와 겹치면 하나가 실패할 수 있어 사람이 돌린다
// 결과 받기에 1시간 안팎 걸린다 (수천만 줄). 제목 파일은 PATENT_TITLES_DIR (기본 ~/techbrief-data)
// 받는 도중 끊겼으면: npm run patent-db -- --job <작업 ID> → 다시 집계하지 않고 결과만 받는다 (24시간 안, 비용 없음)
import { extractDisplayPatents } from '../server/patentDb.js'

try {
  const i = process.argv.indexOf('--job')
  await extractDisplayPatents({ jobId: i > 0 ? process.argv[i + 1] : null })
  process.exit(0)
} catch (err) {
  console.error(`[patent-db] 실패: ${err.message}`)
  process.exit(1)
}
