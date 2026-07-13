import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';

/**
 * Derisk sweep (2026-07-12): branded end card on share surfaces (T3950) +
 * copy-link dedup (share POST in-flight dedup + toast dedupKey).
 *
 * Run:
 *   E2E_BASE_URL=https://reel-ballers-staging.pages.dev \
 *   E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api \
 *   E2E_REAL_EMAIL=e2e@test.local \
 *   npx playwright test e2e/derisk-staging-endcard-copylink.qa.spec.js
 */

const REEL_TOKEN = process.env.DERISK_REEL_TOKEN || 'b904abab-38ec-4ec0-bd3e-cb292cb85780';
const COLLECTION_TOKEN = process.env.DERISK_COLLECTION_TOKEN || 'a194a306-cdcf-4bc4-8d3b-36fc62f5ddb5';
const EMAIL = process.env.E2E_REAL_EMAIL || 'e2e@test.local';
const EVID = 'test-results/derisk-evidence';

async function retryLogin(context) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try { await loginAsRealUser(context, EMAIL); return; }
    catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 2000)); }
  }
  throw lastErr;
}

test('T3950: end card appears at end of a shared REEL with UTM CTA', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/shared/${REEL_TOKEN}`);
  const video = page.locator('video').first();
  await video.waitFor({ timeout: 30000 });
  // start playback (muted so autoplay policy allows it), then jump near the end
  await video.evaluate(async (v) => {
    v.muted = true;
    await v.play().catch(() => {});
    v.currentTime = Math.max(0, v.duration - 0.4);
  });
  const cta = page.getByText('Make your own reel at www.reelballers.com');
  await expect(cta).toBeVisible({ timeout: 15000 });
  const href = await page.locator('a', { hasText: 'Make your own reel' }).first().getAttribute('href');
  expect(href).toContain('utm_source=share_endcard');
  await page.screenshot({ path: `${EVID}/endcard-reel.png` });
});

test('T3950: end card appears ABOVE the player on a shared COLLECTION', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(`/shared/collection/${COLLECTION_TOKEN}`);
  // collection page lists reels; start the first video
  const playCta = page.getByRole('button', { name: /play|watch/i }).first();
  if (await playCta.count()) await playCta.click().catch(() => {});
  const video = page.locator('video').first();
  await video.waitFor({ timeout: 30000 });
  // The collection end card shows when the PLAYLIST ends; fast-forward each
  // reel to its end until the card appears (bounded at 12 advances).
  const cta = page.getByText('Make your own reel at www.reelballers.com');
  for (let i = 0; i < 12; i++) {
    if (await cta.isVisible().catch(() => false)) break;
    await video.evaluate(async (v) => {
      v.muted = true;
      await v.play().catch(() => {});
      if (Number.isFinite(v.duration)) v.currentTime = Math.max(0, v.duration - 0.3);
    }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  await expect(cta).toBeVisible({ timeout: 20000 });
  // z-order regression check: the card must actually be hit-able (not covered
  // by the fullscreen player) — trial click performs actionability checks only.
  await page.locator('a', { hasText: 'Make your own reel' }).first()
    .click({ trial: true, timeout: 5000 });
  await page.screenshot({ path: `${EVID}/endcard-collection.png` });
});

test('copy-link 5x fast: one toast, deduped share POSTs', async ({ context, page }) => {
  test.setTimeout(120_000);
  await retryLogin(context);

  const sharePosts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/api\/gallery\/\d+\/share/.test(req.url())) {
      sharePosts.push(req.url());
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: /My Reels/ }).first().click({ timeout: 30000 });
  // The reel lives inside a collapsed game group — expand it first. The group
  // header is a button named after the game; exclude the home-screen
  // "continue" card (its name carries "clips annotated").
  const group = page.getByRole('button', { name: /^Vs Derisk FC Jul 12(?!.*annotated)/ }).last();
  await group.waitFor({ timeout: 30000 });
  await page.keyboard.press('Escape'); // dismiss any overlay backdrop
  await page.waitForTimeout(500);
  await group.click({ force: true });
  await page.waitForTimeout(800);
  const copyBtn = page.getByTitle('Copy link').first();
  await copyBtn.waitFor({ state: 'attached', timeout: 30000 });
  // The card action row is hover-revealed; hover the card then force the
  // rapid clicks (we are testing handler-level dedup, not hover ergonomics).
  await copyBtn.hover({ force: true }).catch(() => {});
  for (let i = 0; i < 5; i++) {
    await copyBtn.click({ force: true, delay: 10 });
  }
  await page.waitForTimeout(2500);

  const toasts = page.getByText('Link copied to clipboard');
  const toastCount = await toasts.count();
  console.log(`[derisk] share POSTs: ${sharePosts.length}, visible toasts: ${toastCount}`);
  await page.screenshot({ path: `${EVID}/copylink-toasts.png` });
  expect(toastCount, 'exactly one visible copy-link toast').toBe(1);
  expect(sharePosts.length, 'share POST deduped (not 5)').toBeLessThanOrEqual(2);
});
