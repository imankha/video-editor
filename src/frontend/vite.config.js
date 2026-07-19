import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// API port configuration
// - Default: 8000 for manual development
// - E2E tests: Set VITE_API_PORT=8001 for test isolation
const API_PORT = process.env.VITE_API_PORT || '8000';

// https://vitejs.dev/config/
const commitHash = execSync('git rev-parse --short HEAD').toString().trim();

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt': a new SW waits until the user accepts the update gate (see
      // utils/pwaUpdate.js + components/UpdateGateModal.jsx) — the gate's
      // "Update now" click drives a barriered flush -> updateSW(true) ->
      // reload (T5070), so activation is controlled, never silent/early.
      registerType: 'prompt',
      manifest: {
        name: 'Reel Ballers',
        short_name: 'ReelBallers',
        description: 'AI-Powered Sports Video Editor',
        start_url: '/',
        display: 'standalone',
        background_color: '#111827',
        theme_color: '#7c3aed',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        related_applications: [{ platform: 'webapp', url: '/manifest.webmanifest' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/storage/],
        // T5070: set explicitly rather than relying on the Workbox default —
        // cleanupOutdatedCaches deletes precache entries from prior SW
        // revisions on activate; clientsClaim lets the newly-activated SW
        // take control of already-open clients immediately, so the
        // update-gate's post-reload page is served by the NEW SW, not the
        // old one. skipWaiting is still driven explicitly by updateSW(true)
        // (registerType: 'prompt' below), not set globally here — activation
        // must wait for the gate's barriered flush, never fire early.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/lh3\.googleusercontent\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-avatars',
              expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-stripe': ['@stripe/stripe-js', '@stripe/react-stripe-js'],
        },
      },
    },
  },
  // Strip console.log in production builds (keep console.error and console.warn for debugging)
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['debugger'] : [],
    pure: process.env.NODE_ENV === 'production' ? ['console.log'] : [],
  },
  server: {
    port: 5173,
    headers: {
      // Required for Google Sign-In: allows OAuth popup to postMessage back to the opener.
      // 'same-origin-allow-popups' is correct — 'same-origin' blocks the popup fallback flow.
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        // No timeout - exports can run for extended periods (Modal GPU or local processing)
        // Frontend handles staleness detection via WebSocket heartbeats
        timeout: 0,
        proxyTimeout: 0,
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
        // No timeout - WebSocket connections persist for duration of exports
        timeout: 0,
        proxyTimeout: 0,
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['**/node_modules/**', '**/e2e/**', '**/tests/perf/**'],
    // src/version.json is gitignored/build-generated (generate-version.js runs
    // pre-dev/build) and absent on a clean CI checkout. Redirect the import to a
    // committed stub so tests don't depend on that build step having run.
    alias: [
      { find: /^\.\.\/\.\.\/\.\.\/version\.json$/, replacement: resolve(__dirname, 'src/version.stub.json') },
    ]
  }
})
