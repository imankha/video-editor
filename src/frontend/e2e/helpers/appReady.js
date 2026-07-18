/**
 * appReady — a deterministic "the app is ready" wait for the E2E suite (T5400).
 *
 * REPLACES `await page.waitForLoadState('networkidle')` after a goto/reload.
 *
 * Why networkidle is banned on a deployed target: `networkidle` waits for the
 * network to go quiet for 500ms. Against a live CDN (staging CF Pages) analytics
 * beacons, font/media fetches and any client polling keep the socket busy, so it
 * NEVER settles and the spec hangs to the per-test timeout. It is a local-dev-only
 * ready-signal that does not translate to a deployed target — the single biggest
 * source of staging flake (see T5400 / the 2026-07-18 derisk pass).
 *
 * The deterministic replacement is: wait for the navigation to commit
 * (`domcontentloaded`) + wait for a REAL rendered element the screen is about to
 * use. Callers that already assert a concrete locator on the very next line don't
 * need this helper at all — they just switch `networkidle` -> `domcontentloaded`
 * and let that existing wait be the ready-signal. Use THIS helper when nothing
 * concrete follows: pass the screen's ready element, or rely on the default
 * (React has mounted the app shell into #root).
 *
 * Usage:
 *   import { waitForAppReady } from './helpers/appReady.js';
 *   await page.goto('/');
 *   await waitForAppReady(page, { ready: page.getByRole('button', { name: 'Games' }) });
 *   // or, when the next line already waits on a concrete locator:
 *   await page.goto('/');
 *   await page.waitForLoadState('domcontentloaded');
 *   await expect(page.getByRole('button', { name: 'Games' })).toBeVisible();
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [opts]
 * @param {import('@playwright/test').Locator} [opts.ready] the screen's real ready
 *   element (a rendered card/control). Defaults to the app shell mounted in #root
 *   (`#root > *`), which is a strictly-stronger, deterministic signal than
 *   networkidle and works identically on local and deployed targets.
 * @param {number} [opts.timeout] max wait for the ready element (default 30000ms).
 */
export async function waitForAppReady(page, opts = {}) {
  const { ready, timeout = 30000 } = opts;
  await page.waitForLoadState('domcontentloaded');
  // Default: React has mounted the SPA shell into #root (the index.html preloader
  // is a SIBLING of #root, so #root having a child means the app itself rendered).
  const readyLocator = ready || page.locator('#root > *');
  await readyLocator.first().waitFor({ state: 'visible', timeout });
}
