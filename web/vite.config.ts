import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 제품 API는 같은 PC의 서버로 넘긴다. 다른 PC 브라우저도 이 개발 서버를 거쳐 같은 서버를 쓴다. (06회차 #21)
// 서버 포트를 바꿨다면 STUDIO_BRIDGE_API_TARGET으로 지정한다. (VITE_ 변수가 아니라 브라우저 코드에 들어가지 않는다)
const apiTarget = process.env.STUDIO_BRIDGE_API_TARGET ?? 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': apiTarget },
  },
})
