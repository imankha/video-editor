import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { waitForAppReady } from './helpers/appReady.js';

/**
 * Derisk sweep: branded end card on share surfaces (T3950) + copy-link dedup
 * (share POST in-flight dedup + toast dedupKey). T5400 de-hardcoded.
 *
 * Drives the REAL app as the SEEDED FIXTURE account (imankh@gmail.com / profile
 * 9fa7378c, per e2e/FIXTURE-CONTRACT.md — env-overridable via E2E_REAL_EMAIL /
 * E2E_REAL_PROFILE). The share tokens are DISCOVERED from the account's own data
 * (mint an idempotent public reel share from /api/downloads; a collection share
 * from /api/collections/summary) — NO baked GUID tokens. Each test SKIPS LOUDLY
 * (never a silent green pass) when the fixture lacks the required data.
 *
 * Run:
 *   E2E_BASE_URL=https://reel-ballers-staging.pages.dev \
 *   E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api \
 *   E2E_REAL_EMAIL=imankh@gmail.com E2E_REAL_PROFILE=9fa7378c \
 *   npx playwright test e2e/derisk-staging-endcard-copylink.qa.spec.js
 */

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:8000/api';
const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';
const EVID = 'test-results/derisk-evidence';

async function apiGet(context, path) {
  const res = await context.request.get(`${API_BASE}${path}`, {
    headers: { 'X-Test-Mode': 'true' },
  });
  return res.ok() ? res.json() : { __status: res.status() };
}

async function apiPost(context, path, data) {
  const res = await context.request.post(`${API_BASE}${path}`, {
    data,
    headers: { 'X-Test-Mode': 'true' },
  });
  return res.ok() ? res.json() : { __status: res.status() };
}

/** Escape a discovered string for safe use inside a RegExp locator. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** First game collection that has at least one reel in some aspect ratio. */
function firstNonEmptyGameCollection(summary) {
  const games = summary?.games || [];
  for (const g of games) {
    const ratio = Object.entries(g.ratio_counts || {}).find(([, n]) => n > 0)?.[0];
    if (ratio) return { game: g, ratio };
  }
  return null;
}

test('T3950: end card appears at end of a shared REEL with UTM CTA @staging-gate', async ({ context, page }) => {
  test.setTimeout(120_000);
  await loginAsRealUser(context, EMAIL, PROFILE);

  // Discover a published reel and mint an idempotent PUBLIC share link (the same
  // path "Copy link" uses) — no baked token.
  const dl = await apiGet(context, '/downloads');
  const reels = dl.downloads || [];
  if (!reels.length) {
    console.log('[T5400][SKIP] fixture has no published reel to share; seed imankh per FIXTURE-CONTRACT');
  }
  test.skip(!reels.length, '[T5400] fixture has no published reel; seed imankh per FIXTURE-CONTRACT');
  // Same body the app's "Copy link" sends (createShareUrl in useWebShare.js):
  // recipient_emails is REQUIRED by ShareCreateRequest (empty => idempotent public link).
  const share = await apiPost(context, `/gallery/${reels[0].id}/share`, { recipient_emails: [], is_public: true });
  const token = share?.shares?.[0]?.share_token;
  if (!token) {
    console.log(`[T5400][SKIP] could not mint a public reel share (resp ${JSON.stringify(share)})`);
  }
  test.skip(!token, '[T5400] could not mint a public reel share token');
  console.log(`[derisk] shared reel token: ${token} (reel id ${reels[0].id})`);

  await page.goto(`/shared/${token}`);
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

test('T3950: end card appears ABOVE the player on a shared COLLECTION @staging-gate', async ({ context, page }) => {
  test.setTimeout(120_000);
  await loginAsRealUser(context, EMAIL, PROFILE);

  // Discover a non-empty game collection and mint a PUBLIC collection share link.
  const summary = await apiGet(context, '/collections/summary');
  const pick = firstNonEmptyGameCollection(summary);
  if (!pick) {
    console.log('[T5400][SKIP] fixture has no non-empty game collection to share; seed imankh per FIXTURE-CONTRACT');
  }
  test.skip(!pick, '[T5400] fixture has no shareable collection; seed imankh per FIXTURE-CONTRACT');
  const shareResp = await apiPost(context, '/collections/share', {
    definition: { scope: { type: 'game', game_id: pick.game.game_id }, aspect_ratio: pick.ratio },
    is_public: true,
  });
  const token = shareResp?.shares?.[0]?.share_token;
  if (!token) {
    console.log(`[T5400][SKIP] could not mint a public collection share (resp ${JSON.stringify(shareResp)})`);
  }
  test.skip(!token, '[T5400] could not mint a public collection share token');
  console.log(`[derisk] shared collection token: ${token} (game ${pick.game.game_id}, ${pick.ratio})`);

  await page.goto(`/shared/collection/${token}`);
  const video = page.locator('video').first();
  await video.waitFor({ timeout: 30000 });
  // The collection end card shows when the story player's PLAYLIST ends: the last
  // reel's native 'ended' event fires onAllEnded -> BrandedEndCard (SharedCollectionView
  // + useStoryPlayback). Real-time playback of every reel is slow AND flaky on a deployed
  // target (presigned URLs load at network speed, seek-near-end may not reach 'ended'
  // within a fixed wait), so drive the player to its end DETERMINISTICALLY: dispatch a
  // native 'ended' per reel — exactly the event the story player advances on. Bounded by
  // the discovered reel count (+ margin) so a broken advance can't loop forever.
  const reelCount = pick.game.ratio_counts?.[pick.ratio] || 1;
  const cta = page.getByText('Make your own reel at www.reelballers.com');
  for (let i = 0; i < reelCount + 3; i++) {
    if (await cta.isVisible().catch(() => false)) break;
    await video.evaluate((v) => { v.muted = true; v.dispatchEvent(new Event('ended')); }).catch(() => {});
    await page.waitForTimeout(500);
  }
  await expect(cta).toBeVisible({ timeout: 20000 });
  // z-order regression check: the card must actually be hit-able (not covered
  // by the fullscreen player) — trial click performs actionability checks only.
  await page.locator('a', { hasText: 'Make your own reel' }).first()
    .click({ trial: true, timeout: 5000 });
  await page.screenshot({ path: `${EVID}/endcard-collection.png` });
});

test('copy-link 5x fast: one toast, deduped share POSTs @staging-gate', async ({ context, page }) => {
  test.setTimeout(120_000);
  await loginAsRealUser(context, EMAIL, PROFILE);

  // Discover the game group to expand (its header text is the game name) — no
  // hardcoded "Vs Derisk FC Jul 12".
  const summary = await apiGet(context, '/collections/summary');
  const pick = firstNonEmptyGameCollection(summary);
  if (!pick) {
    console.log('[T5400][SKIP] fixture has no reel group in My Reels; seed imankh per FIXTURE-CONTRACT');
  }
  test.skip(!pick, '[T5400] fixture has no reel group in My Reels; seed imankh per FIXTURE-CONTRACT');
  console.log(`[derisk] expanding My Reels group: ${JSON.stringify(pick.game.game_name)}`);

  const sharePosts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/api\/gallery\/\d+\/share/.test(req.url())) {
      sharePosts.push(req.url());
    }
  });

  await page.goto('/');
  await waitForAppReady(page, { ready: page.getByRole('button', { name: /My Reels/ }) });
  await page.getByRole('button', { name: /My Reels/ }).first().click({ timeout: 30000 });
  // Expand the DISCOVERED game group so its reel cards render. There are TWO buttons
  // whose name contains the game name (the Games-tab group + the My Reels group); the
  // My Reels CollapsibleGroup header is the LAST one, and its reel cards load LAZILY on
  // toggle-open (T5420 verified). A single force-click is brittle — it can land while the
  // group is mid-render, or the group may already be open — so TOGGLE UNTIL a reel card
  // actually appears rather than assuming one click expands it.
  const group = page.getByRole('button', { name: new RegExp(escapeRegExp(pick.game.game_name)) }).last();
  await group.waitFor({ timeout: 30000 });
  await page.keyboard.press('Escape'); // dismiss any stray overlay/modal backdrop
  await page.waitForTimeout(300);
  // Scope to a REEL card's copy link (posts /api/gallery/{id}/share) — NOT the
  // group-level collection copy link (which posts /api/collections/share and would
  // leave sharePosts at 0). The action row is hover-revealed; attach + force-click.
  const reelCard = page.locator('[data-testid="reel-card"]').first();
  for (let i = 0; i < 4; i++) {
    if (await reelCard.isVisible().catch(() => false)) break;
    await group.click({ force: true });
    if (await reelCard.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false)) break;
  }
  await reelCard.waitFor({ state: 'visible', timeout: 15000 });
  const copyBtn = reelCard.getByTitle('Copy link').first();
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
