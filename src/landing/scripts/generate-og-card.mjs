/**
 * Regenerates public/og-card.jpg -- the link-preview image for every page.
 *
 * The card is a checked-in binary, so without this script it drifts silently
 * from the brand: the previous one still showed a headline ("Turn game film
 * into highlight reels") that no longer existed anywhere on the site. Run this
 * whenever TAGLINE changes.
 *
 *   node scripts/generate-og-card.mjs
 *
 * Playwright comes from src/frontend (the landing site has no browser dep of
 * its own, and adding one just to render a static asset is not worth it).
 *
 * Design constraints, learned from how these actually get consumed:
 *  - 1200x630 is the OG spec, but Slack/iMessage/Discord scale it down hard.
 *    Everything must survive being read at roughly a third of that, so the
 *    tagline is set enormous and nothing competes with it.
 *  - Logo + tagline ONLY. A sub-headline and a URL were what forced the old
 *    card's type down to an unreadable size.
 */
import { chromium } from '../../frontend/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../public/og-card.jpg')

// Read the copy out of site.ts rather than restating it. This script runs
// outside Astro so it cannot import the .ts module, but a second hardcoded
// copy of the tagline is exactly how the card drifted out of sync last time.
// Parsing keeps site.ts the single source of truth; a rename there fails here
// loudly instead of silently baking stale words into the image.
const siteTs = readFileSync(resolve(HERE, '../src/site.ts'), 'utf8')
const readConst = (name) => {
  const match = siteTs.match(new RegExp(`export const ${name} = (["'])(.*?)\\1`))
  if (!match) throw new Error(`[og-card] could not read ${name} from site.ts`)
  return match[2]
}
const TAGLINE = readConst('TAGLINE')
const BRAND = readConst('BRAND')

const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 54px;
    /* Same near-black indigo the site's hero sits on. */
    background: radial-gradient(ellipse at 50% 0%, #1e1b4b 0%, #0f0f23 55%, #0a0a18 100%);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .lockup { display: flex; align-items: center; gap: 26px; }
  .wordmark {
    font-size: 68px; font-weight: 700; color: #fff;
    letter-spacing: -0.02em; line-height: 1;
  }
  .tagline {
    font-size: 106px; font-weight: 800; line-height: 1.08;
    text-align: center; letter-spacing: -0.03em;
    max-width: 1060px;
    background: linear-gradient(105deg, #fff 0%, #fff 55%, #c4b5fd 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  }
  /* A single accent bar under the tagline, to stop the lower half reading as
     dead space now that the sub-headline is gone. */
  .rule {
    width: 200px; height: 7px; border-radius: 999px;
    background: linear-gradient(90deg, #a855f7, #6366f1);
  }
</style></head>
<body>
  <div class="lockup">
    <svg width="104" height="104" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="22" stroke="url(#g)" stroke-width="3" fill="none"/>
      <circle cx="24" cy="4" r="2" fill="#a855f7"/>
      <circle cx="24" cy="44" r="2" fill="#a855f7"/>
      <circle cx="4" cy="24" r="2" fill="#a855f7"/>
      <circle cx="44" cy="24" r="2" fill="#a855f7"/>
      <path d="M20 16 L20 32 L34 24 Z" fill="#fff" opacity="0.95"/>
      <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#a855f7"/><stop offset="100%" stop-color="#6366f1"/>
      </linearGradient></defs>
    </svg>
    <div class="wordmark">${BRAND}</div>
  </div>
  <div class="tagline">${TAGLINE}</div>
  <div class="rule"></div>
</body>
</html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 })
await page.setContent(html, { waitUntil: 'load' })
await page.screenshot({ path: OUT, type: 'jpeg', quality: 92, scale: 'css' })
await browser.close()
console.log(`wrote ${OUT}`)
