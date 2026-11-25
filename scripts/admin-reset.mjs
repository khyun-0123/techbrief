// 관리 페이지에서 바꾼 값을 지운다 (11/20). 서버 설정 파일(.env.local · Railway 변수) 값으로 돌아간다
// 쓰는 때: 관리 페이지 비밀번호를 잊어 로그인할 수 없을 때 · 사이트에서 넣은 AI 키가 꼬였을 때 (암호 열쇠 TB_SECRET_KEY가 바뀐 경우 등)
// 서버에서: npm run admin-reset -- password | access-code | ai-connections
//   공용 서버 3038: SSH로 들어가 ~/team_project에서 · Railway: `railway ssh`로 들어가 앱 폴더에서 (관리 안내 「잊었을 때」)
// 값은 출력하지 않는다. 적용: 1분 안에 (서버가 1분마다 다시 읽음) — 바로 쓰려면 서버 다시 켜기
import { setSetting } from '../server/db/store.js'
import { dbEnabled } from '../server/db/index.js'

const what = process.argv[2]
const KEYS = { password: 'admin_password_hash', 'access-code': 'access_code_token', 'ai-connections': 'llm_connections' }
const LABEL = { password: '관리자 비밀번호', 'access-code': '접속 코드', 'ai-connections': 'AI 연결(사이트에서 넣은 주소 · API 키 · 새 연결)' }
if (!KEYS[what]) {
  console.log('사용법: npm run admin-reset -- password | access-code | ai-connections')
  process.exit(1)
}
if (!dbEnabled()) {
  console.log('DATABASE_URL이 없어 지울 것이 없어요 (DB 없이 돌면 서버를 다시 켜면 사라짐)')
  process.exit(0)
}
await setSetting(KEYS[what], null)
console.log(`${LABEL[what]}: 관리 페이지에서 바꾼 값을 지웠어요. 설정 파일 값으로 돌아가요 (${what === 'ai-connections' ? '서버 다시 켜기 뒤 적용' : '1분 안에 적용'}).`)
process.exit(0)
