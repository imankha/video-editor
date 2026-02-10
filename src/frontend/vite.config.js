import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// API port configuration
// - Default: 8000 for manual development
// - E2E tests: Set VITE_API_PORT=8001 for test isolation
const API_PORT = process.env.VITE_API_PORT || '8000';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Strip console.log in production builds (keep console.error and console.warn for debugging)
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['debugger'] : [],
    pure: process.env.NODE_ENV === 'production' ? ['console.log'] : [],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        // Long timeout for AI upscaling exports (can take 30+ minutes for multi-clip)
        // Exports should only timeout if no progress for 2+ minutes (handled by frontend)
        timeout: 1800000, // 30 minutes
        proxyTimeout: 1800000, // 30 minutes
      },
      '/storage': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        // Presigned URL generation is fast, no need for long timeout
      },
      '/ws': {
        target: `http://localhost:${API_PORT}`,
        ws: true,
        changeOrigin: true,
        // Long timeout for WebSocket connections during AI exports
        timeout: 1800000, // 30 minutes
        proxyTimeout: 1800000, // 30 minutes
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['**/node_modules/**', '**/e2e/**']
  }
})
