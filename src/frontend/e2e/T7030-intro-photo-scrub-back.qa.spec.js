/**
 * T7030 regression guard -- an intro card with a PHOTO must show the photo:
 *   (1) on first play, and
 *   (2) after scrubbing forward past the intro into the reel then BACK into the
 *       intro segment (the reported "video area goes blank" repro).
 *
 * ROOT CAUSE (see docs/plans/tasks/T7030-...md Progress Log): the visible <img>
 * in MotionPreview always loads from the browser cache preloadIntroImage warmed
 * (T6960), so it is already `complete` at attach time and the `load` event never
 * re-fires to the reveal gate -- an onLoad-only gate left `photoReady` stuck
 * false and the photo stuck at opacity-0 (only the animate-pulse skeleton), i.e.
 * blank. The fix reads img completeness directly (ref callback + a src-change
 * effect) so a cache-complete photo reveals with no load event. This hits BOTH
 * first play (preload warmed the cache) and scrub-back (remount, same cache, no
 * new request -- exactly the HAR's zero-image-request-on-scrub-back).
 *
 * jsdom can't exercise real image cache/decode, so the unit coverage
 * (MotionPreview.test.jsx) stubs completeness and is the DISCRIMINATING guard
 * (RED pre-fix, GREEN post-fix). This spec is the real-browser POSITIVE-PATH
 * proof that the visible photo actually paints on a real account in both flows.
 * NOTE: whether the original blank reproduces is browser-dependent -- headless
 * Chromium reliably fires `load` for a cache hit, so it does NOT go blank even
 * pre-fix; WebKit/Safari/mobile (where the user hit this on staging) frequently
 * do NOT re-fire `load` for a cache-complete <img>, which is the exact state the
 * fix now covers. So this spec guards against a total break, not the specific
 * event race -- the unit test owns that.
 *
 * Setup mirrors T6730: attach a PHOTO card to every reel via the supported PATCH
 * /api/downloads/{id}/intro; player scoped to the role=dialog panel so drawer
 * tile-preview media never confuses the signal. Requires a photo intro card on
 * the account (skips clearly if none).
 *
 * Repro account: imankh@gmail.com / profile 9fa7378c.
 * Run: bash scripts/dev-verify.sh e2e/T7030-intro-photo-scrub-back.qa.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const REAL_PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

async function openDrawer(page) {
  await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
  await page.goto('/');
  await page.getByRole('button', { name: /Highlight Reels/i }).first().click();
  await expect(page.getByRole('heading', { name: /Highlight Reels|Library/i }).first())
    .toBeVisible({ timeout: 15000 });
}

async function expandFirstGroup(page) {
  const alreadyShown = await page.getByTestId('reel-card').first().isVisible().catch(() => false);
  if (alreadyShown) return true;
  const headers = page.locator('.animate-slide-in-right').getByTestId('collapsible-group-header');
  await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const n = await headers.count();
  for (let i = 0; i < n; i++) {
    await headers.nth(i).click({ timeout: 3000 }).catch(() => {});
    const appeared = await page.getByTestId('reel-card').first()
      .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
    if (appeared) return true;
  }
  return false;
}

async function attachCardToAllReels(page, cardId) {
  const dl = await page.request.get('/api/downloads');
  const downloads = (await dl.json()).downloads || [];
  let ok = 0;
  for (const d of downloads) {
    const resp = await page.request.patch(`/api/downloads/${d.id}/intro`, {
      data: { intro_card_id: cardId },
      headers: { 'Content-Type': 'application/json' },
    });
    if (resp.status() < 300) ok++;
  }
  return ok;
}

// Is the intro card's photo actually painted? True == the visible <img> is
// opacity-100 (revealed) and the skeleton is gone -- the exact state the bug
// left stuck at opacity-0 + skeleton. Scoped to the live motion-preview.
async function photoPainted(page) {
  return page.evaluate(() => {
    const mp = document.querySelector('[data-testid="motion-preview"]');
    if (!mp) return { ok: false, why: 'no motion-preview' };
    const img = mp.querySelector('img');
    if (!img) return { ok: false, why: 'no <img> (card may be text-only)' };
    const skeleton = mp.querySelector('[data-testid="motion-preview-photo-skeleton"]');
    const opacity = parseFloat(getComputedStyle(img).opacity);
    return {
      ok: opacity > 0.5 && !skeleton,
      opacity,
      skeletonPresent: !!skeleton,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
    };
  });
}

test.describe('T7030 intro photo shows on play and after scrub-back (real account)', () => {
  test('photo intro: renders on first play, and re-renders after forward-then-backward scrub', async ({ page }) => {
    await openDrawer(page);
    const hasReels = await expandFirstGroup(page);
    test.skip(!hasReels, 'no published reels on this account/profile');

    const cards = (await (await page.request.get('/api/intro-cards')).json()).cards || [];
    const photoCard = cards.find((c) => c.image_key);
    test.skip(!photoCard, 'no intro card with a photo (image_key) exists on this account');
    console.log(`[T7030] using photo card ${photoCard.id} (${photoCard.name}) image_key=${photoCard.image_key}`);

    const attachedCount = await attachCardToAllReels(page, photoCard.id);
    test.skip(attachedCount === 0, 'no downloads to attach an intro card to');

    const playerVideo = page.getByRole('dialog').locator('video');
    const introSegment = page.getByRole('button', { name: 'Intro', exact: true });
    const introPlaybackResp = page.waitForResponse(
      (r) => /\/api\/downloads\/\d+\/intro-playback$/.test(r.url()), { timeout: 10000 },
    );
    await page.getByTestId('reel-card').first().click();
    const payload = await (await introPlaybackResp).json();
    test.skip(!payload.intro, 'resolver returned null intro for the first reel');
    test.skip(!payload.intro.previewUrl, 'intro payload has no previewUrl (photo not resolvable)');
    const introDurSec = payload.intro.card?.duration || 4.0;
    console.log(`[T7030] intro=${payload.intro.card?.name} dur=${introDurSec}s previewUrl=${!!payload.intro.previewUrl}`);

    await expect(introSegment).toBeVisible({ timeout: 10000 });

    // ---- SYMPTOM #1: the photo must actually paint on first play. ----
    await expect
      .poll(async () => (await photoPainted(page)).ok, {
        timeout: 10000,
        message: 'intro photo must paint on first play (opacity>0, skeleton gone)',
      })
      .toBe(true);
    console.log(`[T7030] first-play photo state: ${JSON.stringify(await photoPainted(page))}`);
    await saveEvidence(page, 'T7030-first-play-photo-visible');

    // ---- FORWARD AUTO-CONTINUE into reels (no click). ----
    await expect(playerVideo, 'forward auto-continue: player video mounts when intro clock ends')
      .toHaveCount(1, { timeout: (introDurSec * 1000) + 15000 });
    await page.waitForTimeout(1200);
    await saveEvidence(page, 'T7030-in-reels-after-auto-continue');

    // ---- SYMPTOM #2: scrub BACK into the intro with a real mouse click. ----
    const box = await introSegment.boundingBox();
    expect(box, 'intro segment must still be laid out after auto-continue').toBeTruthy();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);

    // Region returns to intro -> reel video unmounts.
    await expect(playerVideo, 'scrub-back: reel video unmounts, region returns to intro')
      .toHaveCount(0, { timeout: 8000 });

    // The photo must paint again -- NOT a blank frame (the core T7030 regression).
    await expect
      .poll(async () => (await photoPainted(page)).ok, {
        timeout: 8000,
        message: 'intro photo must re-paint after scrub-back (never blank)',
      })
      .toBe(true);
    console.log(`[T7030] scrub-back photo state: ${JSON.stringify(await photoPainted(page))}`);
    await saveEvidence(page, 'T7030-scrub-back-photo-visible');

    await page.keyboard.press('Escape').catch(() => {});
  });
});
