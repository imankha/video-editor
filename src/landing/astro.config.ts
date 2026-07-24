// @ts-check
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import mdx from '@astrojs/mdx'
import { fileURLToPath, URL } from 'node:url'
import { PUBLISHED_GUIDES } from './src/data/guides'

// Canonical origin. `www.reelballers.com` 301s to the apex, so the apex is the
// real host -- every canonical/OG/sitemap URL is built from this one constant.
const SITE = 'https://reelballers.com'

export default defineConfig({
  site: SITE,

  // 'file' emits /soccer.html (not /soccer/index.html), which Cloudflare's
  // default html_handling ("auto-trailing-slash") serves at /soccer. Combined
  // with trailingSlash:'never' that gives exactly ONE canonical URL per page --
  // no /soccer vs /soccer/ duplicate-content split.
  build: { format: 'file' },
  trailingSlash: 'never',

  integrations: [
    react(),
    mdx(),
    sitemap({
      // A sitemap must list only indexable URLs. /guides is noindex until the
      // first guide is approved and published, so it is excluded until then --
      // driven off the same data the page uses, so the two cannot disagree.
      filter: (page) => {
        if (PUBLISHED_GUIDES.length === 0 && new URL(page).pathname === '/guides') return false
        return true
      },
      serialize(item) {
        // Note: trailingSlash:'never' makes the sitemap emit the homepage as
        // `https://reelballers.com` while the canonical tag uses
        // `https://reelballers.com/`. Those are the same resource (RFC 3986
        // treats an empty path as "/") and every search engine normalises them,
        // so this is cosmetic, not a duplicate-content risk.
        item.changefreq = 'monthly'
        item.priority = item.url === `${SITE}/` ? 1.0 : 0.7
        return item
      },
    }),
  ],

  vite: {
    resolve: {
      // Share the editor's store-free player leaves (VideoControls,
      // useStandaloneVideo, timeFormat) so the landing player stays DRY with the
      // app. Only import store-free modules through this alias -- anything
      // touching Zustand/backend would drag the editor's graph into this bundle.
      alias: {
        '@editor': fileURLToPath(new URL('../frontend/src', import.meta.url)),
      },
      // The @editor files live under src/frontend and import bare deps (react,
      // lucide-react). Node resolves those relative to the importer, i.e. from
      // src/frontend/node_modules -- which does NOT exist in CI (only src/landing
      // gets `npm ci`). Dedupe forces them to resolve from THIS app's
      // node_modules regardless of importer location, so the shared player
      // builds in CI. Removing this breaks the deploy, not the local build.
      dedupe: ['react', 'react-dom', 'lucide-react'],
    },
    server: {
      fs: {
        // Allow importing the shared editor sources that live outside this root.
        allow: [fileURLToPath(new URL('../..', import.meta.url))],
      },
    },
  },

  server: { port: 3001 },
})
