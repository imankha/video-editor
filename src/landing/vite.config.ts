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
