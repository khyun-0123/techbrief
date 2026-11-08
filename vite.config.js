import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// 요약 API(/api)를 Vite 개발 서버 안에서 같이 연다 → npm run dev 하나, 포트 하나
function summaryApi() {
  return {
    name: 'summary-api',
    async configureServer(server) {
      const { handleApi, startScheduler } = await import('./server/index.js')
      startScheduler() // 자동 최신화 예약 확인 (설정이 '꺼짐'이면 아무것도 안 함)
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        handleApi(req, res)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // .env.local의 값(접속 키 포함)을 서버 쪽에서만 쓰도록 process.env에 넣는다. 브라우저 코드로는 가지 않는다
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    process.env[key] ??= value
  }
  return {
    plugins: [react(), summaryApi()],
    server: {
      // 공용 서버에서는 계정마다 배정된 PORT를 쓴다 (예: user38 → 3038)
      port: Number(process.env.PORT ?? 5173),
      strictPort: true,
      // 개발 서버는 프로젝트 폴더의 파일을 주소로 그대로 내려 준다 (예: /gcp-key.json → 11/08 실제로 열렸음).
      // 화면이 쓰지 않는 키 · 로그 · 서버 코드 · 문서는 막는다. 앞 6줄은 Vite 기본값 (deny를 적으면 기본값이 사라져서 같이 적음)
      fs: {
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem,key,p12,pfx,cer,der}',
          '.npmrc',
          '.yarnrc.yml',
          '**/.git/**',
          '*-key.json',
          '*.log',
          'CLAUDE.md',
          `${path.resolve('server')}/**`,
          `${path.resolve('scripts')}/**`,
          `${path.resolve('docs')}/**`,
        ],
      },
    },
  }
})
