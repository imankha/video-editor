import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// API port configuration
// - Default: 8000 for manual development
// - E2E tests: Set VITE_API_PORT=8001 for test isolation
const API_PORT = process.env.VITE_API_PORT || '8000';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `http://localhost:${API_PORT}`,
        ws: true,
        changeOrigin: true,
        // Increase timeouts for long-running WebSocket connections (AI upscaling can take 10+ minutes)
        timeout: 600000, // 10 minutes
        proxyTimeout: 600000, // 10 minutes
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['**/node_modules/**', '**/e2e/**']
  }
})
