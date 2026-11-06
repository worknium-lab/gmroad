import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 서버: /sb → 수파베이스, /api → 관리 API 로 중계 (운영의 nginx와 같은 구조)
const SB = process.env.SB_TARGET || 'http://192.168.219.104:8000';
const API = process.env.API_TARGET || 'http://localhost:3001';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/sb': { target: SB, changeOrigin: true, ws: true, rewrite: (p) => p.replace(/^\/sb/, '') },
      '/api': { target: API, changeOrigin: true },
    },
  },
});
