import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发时 /api 代理到后端；生产构建为静态文件由 Express 托管
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8080',
        changeOrigin: true
      }
    }
  }
});
