// 관리 페이지에서 바꾼 관리자 비밀번호 · 접속 코드를 지운다 (11/20). 서버 설정 파일(.env.local) 값으로 돌아간다
// 쓰는 때: 관리 페이지 비밀번호를 잊어 로그인할 수 없을 때. 서버에서: npm run admin-reset -- password  (또는 access-code)
// 값은 출력하지 않는다. 적용: 1분 안에 (서버가 1분마다 다시 읽음) — 바로 쓰려면 서버 다시 켜기
import { setSetting } from '../server/db/store.js'
import { dbEnabled } from '../server/db/index.js'

const what = process.argv[2]
const KEYS = { password: 'admin_password_hash', 'access-code': 'access_code_token' }
if (!KEYS[what]) {
  console.log('사용법: npm run admin-reset -- password   또는   npm run admin-reset -- access-code')
  process.exit(1)
}
if (!dbEnabled()) {
  console.log('DATABASE_URL이 없어 지울 것이 없어요 (DB 없이 돌면 서버를 다시 켜면 사라짐)')
  process.exit(0)
}
await setSetting(KEYS[what], null)
console.log(`${what === 'password' ? '관리자 비밀번호' : '접속 코드'}: 관리 페이지에서 바꾼 값을 지웠어요. 설정 파일 값으로 돌아가요 (1분 안에 적용).`)
process.exit(0)
