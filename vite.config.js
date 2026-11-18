import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// 요약 API(/api)를 Vite 서버 안에서 같이 연다 → 포트 하나
// - 개발 모드(npm run serve · dev): 화면을 그때그때 만들어 보냄 (공용 서버 3038)
// - 운영 모드(npm run build 뒤 vite preview, 11/18 외부 배포): 빌드한 dist만 보냄 — 파일이 적어 멀리서도 빠르고, 프로젝트 파일이 주소로 열릴 일이 없다
// - 접속 코드 문(ACCESS_CODE가 있을 때만, server/accessGate.js)은 화면 · API 모두 앞에 선다
async function attachApi(middlewares) {
  const { handleApi, startScheduler } = await import('./server/index.js')
  const { accessGate } = await import('./server/accessGate.js')
  startScheduler() // 자동 최신화 예약 확인 (설정이 '꺼짐'이면 아무것도 안 함)
  middlewares.use((req, res, next) => {
    accessGate(req, res, next).catch(next)
  })
  middlewares.use((req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next()
    handleApi(req, res)
  })
}
function summaryApi() {
  return {
    name: 'summary-api',
    configureServer: (server) => attachApi(server.middlewares),
    configurePreviewServer: (server) => attachApi(server.middlewares),
  }
}

// 바깥 주소로 들어오는 요청 허용 (11/18, 43 문서): Vite는 모르는 주소(Host)로 온 요청을 「Blocked request」로 막는다
// - 기본: Tailscale Funnel(*.ts.net) · Railway 기본 주소(*.up.railway.app). 회사 도메인 등은 ALLOWED_HOSTS=a.com,b.com 으로 더한다
// - localhost · 127.0.0.1은 Vite가 늘 허용 (공용 서버 포트 포워딩은 그대로)
const allowedHosts = () => ['.ts.net', '.up.railway.app', ...String(process.env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean)]

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // .env.local의 값(접속 키 포함)을 서버 쪽에서만 쓰도록 process.env에 넣는다. 브라우저 코드로는 가지 않는다
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    process.env[key] ??= value
  }
  return {
    plugins: [react(), summaryApi()],
    // 운영 모드(vite preview): 같은 PORT. 기본은 이 컴퓨터 안에서만 받음 — 밖에서는 Tailscale Funnel이 들여보냄 (43 문서)
    // Railway처럼 앞단 프록시가 다른 컴퓨터면 HOST=0.0.0.0 (그곳은 PORT도 Railway가 정해 줌)
    preview: {
      port: Number(process.env.PORT ?? 4173),
      strictPort: true,
      host: process.env.HOST || '127.0.0.1',
      allowedHosts: allowedHosts(),
    },
    server: {
      // 공용 서버에서는 계정마다 배정된 PORT를 쓴다 (예: user38 → 3038)
      port: Number(process.env.PORT ?? 5173),
      strictPort: true,
      allowedHosts: allowedHosts(),
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
