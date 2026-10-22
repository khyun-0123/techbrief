import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 화면에서 /api로 부르면 요약 API 서버(npm run server)로 넘긴다
    proxy: {
      '/api': `http://127.0.0.1:${process.env.API_PORT ?? 3001}`,
    },
  },
})
