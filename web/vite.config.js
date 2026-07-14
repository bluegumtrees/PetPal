import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // web/.env.local 里设 PETPAL_DEV_PROXY=http://114.55.95.6 可让本地前端直连生产 API 调试
  const target = env.PETPAL_DEV_PROXY || 'http://127.0.0.1:8000'
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      // 允许 ngrok 临时分享域名访问（开发环境给朋友试用用）
      // 生产部署到 HF Spaces 时这条不影响（Vite dev server 不参与生产）
      allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.io'],
      proxy: {
        '/api': { target, changeOrigin: true },
        '/static': { target, changeOrigin: true },
      },
    },
  }
})
