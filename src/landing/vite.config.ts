import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Share the editor's store-free player leaves (VideoControls, useStandaloneVideo,
      // timeFormat) so the landing player stays DRY with the app. Only import
      // store-free modules through this alias — anything touching Zustand/backend
      // would drag the editor's graph into this bundle.
      '@editor': fileURLToPath(new URL('../frontend/src', import.meta.url)),
    },
    // The @editor files live under src/frontend and import bare deps (react,
    // lucide-react). Node resolves those relative to the importer, i.e. from
    // src/frontend/node_modules — which does NOT exist in CI (only src/landing
    // gets `npm ci`). Dedupe forces them to resolve from THIS app's node_modules
    // regardless of importer location, so the shared player builds in CI.
    dedupe: ['react', 'react-dom', 'lucide-react'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 3001,
    fs: {
      // Allow importing the shared editor sources that live outside this app's root.
      allow: [fileURLToPath(new URL('../..', import.meta.url))],
    },
  },
})
