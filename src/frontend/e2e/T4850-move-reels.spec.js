import { test, expect } from '@playwright/test';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T4850 — Transfer reels between profiles (multi-athlete accounts).
 *
 * Drives the REAL My Reels UI against the live stack (no R2 needed: media objects
 * are per-user; the move is a profile-DB row move). Uses the X-User-ID isolation
 * bypass + the /api/test/seed-final-video seam to create movable published reels
 * without the full upload->annotate->frame->export->publish pipeline.
 *
 * Acceptance criteria evidenced here:
 *   - c6: single-profile accounts never see the Move affordance
 *   - c1: a reel moves A->B via an explicit card gesture; appears in B, gone from A
 *   - c2: multiple reels move in one bulk gesture
 *   - c3: source no longer lists moved reels (summary count drops)
 */

const API_PORT = 8000;
const API_BASE = process.env.E2E_API_BASE || `http://localhost:${API_PORT}/api`;
const USER = `e2e_t4850_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function hdr(profileId) {
  return {
    'X-User-ID': USER,
    'X-Profile-ID': profileId,
    'X-Test-Mode': 'true',
    'Content-Type': 'application/json',
  };
}

async function seedReel(request, profileId, name) {
  const res = await request.post(`${API_BASE}/test/seed-final-video`, {
    headers: hdr(profileId),
    data: { name },
  });
  expect(res.ok(), `seed ${name}`).toBeTruthy();
  return (await res.json()).id;
}

async function reelCount(request, profileId) {
  const res = await request.get(`${API_BASE}/downloads/count`, { headers: hdr(profileId) });
  return (await res.json()).count;
}

async function bootAs(page, profileId) {
  await page.setExtraHTTPHeaders({
    'X-User-ID': USER, 'X-Profile-ID': profileId, 'X-Test-Mode': 'true',
  });
  await page.goto('/');
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
  });
  await page.waitForLoadState('networkidle');
  // Force the stores to reflect the current profile + open My Reels.
  await page.evaluate(async () => {
    const { useProfileStore } = await import('/src/stores/profileStore.js');
    await useProfileStore.getState().fetchProfiles({ force: true });
    const { useGalleryStore } = await import('/src/stores/galleryStore.js');
    useGalleryStore.getState().open();
  });
  await page.waitForTimeout(600);
}

let defaultProfile;
let secondProfile;

test.describe.configure({ mode: 'serial' });

test.describe('T4850 move reels between profiles', () => {
  test.beforeAll(async ({ request }) => {
    for (let i = 0; i < 15; i++) {
      try { if ((await request.get(`${API_BASE}/health`)).ok()) break; } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    const init = await request.post(`${API_BASE}/auth/init`, { headers: { 'X-User-ID': USER } });
    defaultProfile = (await init.json()).profile_id;
  });

  test('c6: single-profile account never sees the Move affordance', async ({ page, request }) => {
    await seedReel(request, defaultProfile, 'Solo Reel');
    await bootAs(page, defaultProfile);

    // The panel is open; with only ONE profile there is no Select toggle.
    await expect(page.getByRole('button', { name: 'Select' })).toHaveCount(0);
    await saveEvidence(page, 'criterion-6-single-profile-no-affordance');
  });

  test('affordance appears once a 2nd profile exists', async ({ page, request }) => {
    const res = await request.post(`${API_BASE}/profiles`, {
      headers: hdr(defaultProfile),
      data: { name: 'Athlete B', color: '#10B981' },
    });
    secondProfile = (await res.json()).id;
    // Switch back to the default (source) profile.
    await request.put(`${API_BASE}/profiles/current`, {
      headers: hdr(defaultProfile), data: { profileId: defaultProfile },
    });

    await bootAs(page, defaultProfile);
    await expect(page.getByRole('button', { name: 'Select' })).toBeVisible();
    await saveEvidence(page, 'criterion-6-two-profiles-affordance-visible');
  });

  test('c1: single reel moves A->B via the card overflow menu', async ({ page, request }) => {
    const before = await reelCount(request, defaultProfile);
    expect(before).toBeGreaterThanOrEqual(1);
    const bBefore = await reelCount(request, secondProfile);

    await bootAs(page, defaultProfile);

    // The Mixes group is default-expanded when there are no game groups, so the
    // seeded single-clip reels render without a manual expand. Wait for a card.
    await expect(page.getByTitle('More actions').first()).toBeVisible();

    // Open the first reel card's overflow menu -> Move to profile...
    await page.getByTitle('More actions').first().click();
    await page.getByRole('button', { name: /Move to profile/ }).click();
    await saveEvidence(page, 'criterion-1-move-modal');
    // Pick the sibling profile in the picker.
    await page.getByRole('button', { name: 'Athlete B' }).click();
    await page.waitForTimeout(1200);

    // Source lost exactly one reel; target gained exactly one.
    expect(await reelCount(request, defaultProfile)).toBe(before - 1);
    expect(await reelCount(request, secondProfile)).toBe(bBefore + 1);
    await saveEvidence(page, 'criterion-1-after-single-move');
  });

  test('c2+c3: bulk-select moves several reels in one gesture', async ({ page, request }) => {
    // Seed 2 more so the source has >= 2 to bulk-move.
    await seedReel(request, defaultProfile, 'Bulk One');
    await seedReel(request, defaultProfile, 'Bulk Two');
    const before = await reelCount(request, defaultProfile);
    const bBefore = await reelCount(request, secondProfile);

    await bootAs(page, defaultProfile);

    // Enter select mode, responsive sweep the select UI, then select all visible.
    await page.getByRole('button', { name: 'Select' }).click();
    await page.waitForTimeout(400);

    // Tap the reel cards (whole card toggles selection in select mode).
    const cards = page.locator('div.cursor-pointer').filter({ hasText: 'Bulk' });
    const n = await cards.count();
    for (let i = 0; i < n; i++) await cards.nth(i).click();
    await saveEvidence(page, 'criterion-2-bulk-selected');
    await responsiveSweep(page);

    await page.getByRole('button', { name: /Move to profile/ }).click();
    await page.getByRole('button', { name: 'Athlete B' }).click();
    await page.waitForTimeout(1500);

    const moved = before - (await reelCount(request, defaultProfile));
    expect(moved).toBeGreaterThanOrEqual(2);
    expect(await reelCount(request, secondProfile)).toBe(bBefore + moved);
    await saveEvidence(page, 'criterion-3-source-after-bulk-move');
  });

  test('moved reels are listed in the target profile', async ({ request }) => {
    const res = await request.get(`${API_BASE}/downloads?mixes=true`, { headers: hdr(secondProfile) });
    const data = await res.json();
    expect(data.downloads.length).toBeGreaterThanOrEqual(3);
  });
});
