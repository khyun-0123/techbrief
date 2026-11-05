// npm run serve: 앱(npm run dev와 같은 화면 + 요약 API)을 켜고, 관리 페이지 「서버 다시 켜기」로 꺼지면 다시 켠다
// - 「다시 켜기」는 서버가 종료 코드 75로 끝나는 것 → 1초 뒤 다시 켬 (.env.local · 서버 코드 변경도 이때 반영)
// - 그 밖의 종료(Ctrl+C, 오류로 죽음)는 다시 켜지 않고 같이 끝난다 (같은 오류로 계속 도는 것 방지)
// - 뒤에 붙인 값은 vite에 그대로 넘긴다: npm run serve -- --port 3038
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const RESTART_EXIT_CODE = 75
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const args = process.argv.slice(2)

let child = null
let stopping = false

function start() {
  child = spawn(process.execPath, [vite, ...args], {
    stdio: 'inherit',
    env: { ...process.env, TECHBRIEF_SUPERVISED: '1' },
  })
  child.on('exit', (code, signal) => {
    child = null
    if (!stopping && code === RESTART_EXIT_CODE) {
      console.log('\n[serve] 관리 페이지에서 다시 켜기 → 1초 뒤 다시 켭니다\n')
      setTimeout(start, 1000)
      return
    }
    process.exit(code ?? (signal ? 1 : 0))
  })
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true
    if (child) child.kill(sig)
    else process.exit(0)
  })
}

start()
