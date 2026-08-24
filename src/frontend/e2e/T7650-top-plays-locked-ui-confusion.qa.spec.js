import { test, expect } from '@playwright/test';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';
import { skipOnDeployedTarget, assertSeamAvailable, IS_DEPLOYED_TARGET } from './helpers/targetEnv.js';

/**
 * T7650 — "Top Plays" locked meter reads as broken.
 *
 * Bug 45p: a low-footage kid profile shows several amber "locked" cards in My
 * Reels (profile-wide Ranking Progress, the Top Plays smart collection, per-game
 * Game Highlights). They share the same amber + Lock chrome and near-identical
 * copy, so the user can't tell WHY each is locked or whether it's a glitch.
 *
 * This spec seeds a genuine low-footage state (single-clip 9:16 reels totalling
 * < COLLECTION_MIN_DURATION_SEC = 30s) against the live stack and captures the
 * locked surfaces, then asserts they are now textually distinguishable (distinct
 * LockedReasonModal copy per surface).
 */

const API_PORT = 8000;
const API_BASE = process.env.E2E_API_BASE || `http://localhost:${API_PORT}/api`;
const USER = `e2e_t7650_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function hdr(profileId) {
  return {
    'X-User-ID': USER, 'X-Profile-ID': profileId,
    'X-Test-Mode': 'true', 'Content-Type': 'application/json',
  };
}

// Seed a single-clip, short 9:16 reel (each ~1s of media). Several of these stay
// well under the 30s collection threshold, so Top Plays / Ranking stay LOCKED
// while the reels themselves exist and are individually playable.
async function seedShortReel(request, profileId, name) {
  const res = await request.post(`${API_BASE}/test/seed-final-video`, {
    headers: hdr(profileId),
    data: { name, aspect_ratio: '9:16', clip_count: 1, quality_score: 6.0 },
  });
  assertSeamAvailable(res, 'seed-final-video');
  expect(res.ok(), `seed ${name}`).toBeTruthy();
  return res.json();
}

async function bootMyReels(page, profileId) {
  await page.setExtraHTTPHeaders({
    'X-User-ID': USER, 'X-Profile-ID': profileId, 'X-Test-Mode': 'true',
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
  });
  await page.waitForLoadState('domcontentloaded');
  // Let the app's own session init + bootstrap complete (the #preloader overlay
  // covers everything and would sit atop the panel otherwise).
  await page.waitForFunction(() => !document.getElementById('preloader'), null, { timeout: 20000 })
    .catch(() => { /* preloader may already be gone */ });
  await page.evaluate(async () => {
    const { useProfileStore } = await import('/src/stores/profileStore.js');
    await useProfileStore.getState().fetchProfiles({ force: true });
    const { useGalleryStore } = await import('/src/stores/galleryStore.js');
    useGalleryStore.getState().open();
  });
  await page.waitForTimeout(1000);
}

test.describe('T7650 Top Plays locked-state clarity', () => {
  skipOnDeployedTarget(test, 'uses /api/test/seed-final-video (dev/local-only seam)');

  let profileId;

  test.beforeAll(async ({ request }) => {
    if (IS_DEPLOYED_TARGET) return;
    for (let i = 0; i < 15; i++) {
      try { if ((await request.get(`${API_BASE}/health`)).ok()) break; } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    profileId = (await (await request.post(`${API_BASE}/auth/init`, {
      headers: { 'X-User-ID': USER },
    })).json()).profile_id;
    // Low footage: 4 short single-clip reels ~= 4s of 9:16 << 30s threshold.
    for (const n of ['Fast Break', 'Corner Kick', 'Header Goal', 'Solo Run']) {
      await seedShortReel(request, profileId, n);
    }
  });

  test('locked Ranking Progress + Top Plays render and are distinguishable', async ({ page }) => {
    await bootMyReels(page, profileId);

    // All three amber locked surfaces render together (the conflation the bug hit).
    await expect(page.getByText('Ranking Progress').first()).toBeVisible();
    await expect(page.getByText('Top Plays').first()).toBeVisible();
    // The smart-collection card now carries an explanatory subtitle (was blank).
    await expect(page.getByText(/top-rated reels/i).first()).toBeVisible();
    await saveEvidence(page, 'locked-surfaces-my-reels');

    // Ranking "why?" modal — ranking-specific copy (head-to-head, not collections).
    await page.getByText('Ranking Progress').first().click();
    await expect(page.getByText(/head-to-head/i).first()).toBeVisible();
    await saveEvidence(page, 'ranking-locked-reason');
    await page.getByRole('button', { name: /Got it/ }).click();

    // Top Plays "why?" modal — smart-collection copy, distinct from ranking.
    await page.getByText('Top Plays').first().click();
    await expect(page.getByText(/automatically gathers your top-rated reels/i)).toBeVisible();
    await saveEvidence(page, 'top-plays-locked-reason');
    await page.getByRole('button', { name: /Got it/ }).click();

    // Mixes "why?" modal — must NOT claim "game highlights" (the copy bug), and
    // must talk about combining reels across games.
    await page.getByText(/cross-game mixes/i).first().click();
    await expect(page.getByText(/across your games/i)).toBeVisible();
    await saveEvidence(page, 'mixes-locked-reason');
    await page.getByRole('button', { name: /Got it/ }).click();
  });

  test('responsive: locked cards hold at 375px and desktop', async ({ page }) => {
    await bootMyReels(page, profileId);
    await responsiveSweep(page);
    await saveEvidence(page, 'responsive-locked-cards');
  });
});
