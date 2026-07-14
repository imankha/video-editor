import { test, expect } from '@playwright/test';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T4850 — Transfer reels between profiles (multi-athlete accounts).
 *
 * Drives the REAL My Reels UI + API against the live stack (R2 ENABLED in the
 * container .env), using POST /api/test/seed-final-video which uploads a real tiny
 * MP4 under the current profile's per-profile R2 prefix. This proves the fix for
 * the production bug: R2 media is PER-PROFILE, so a move must server-side copy the
 * object to the target prefix or playback/download 404s in the target profile.
 *
 * Evidence map (acceptance criteria + user QA mandate a-g):
 *   c6  single-profile accounts never see the Move affordance
 *   c1  reel moves A->B via a card gesture; appears in B, gone from A
 *   c2  multiple reels move in one bulk gesture
 *   c3  source no longer lists moved reels
 *   4a  moved video PLAYS in target (currentTime advances)
 *   4b  Download works in target (200 + bytes)
 *   4c  Share-link creation from target works
 *   4d  Delete in target removes the row
 *   4f  "Open as Draft" is HIDDEN for moved reels (lineage stayed in source)
 *   4g  moving the reel BACK to the original profile works (round-trip)
 */

const API_PORT = 8000;
const API_BASE = process.env.E2E_API_BASE || `http://localhost:${API_PORT}/api`;
const USER = `e2e_t4850_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function hdr(profileId) {
  return {
    'X-User-ID': USER, 'X-Profile-ID': profileId,
    'X-Test-Mode': 'true', 'Content-Type': 'application/json',
  };
}

async function seedReel(request, profileId, name) {
  const res = await request.post(`${API_BASE}/test/seed-final-video`, {
    headers: hdr(profileId), data: { name },
  });
  expect(res.ok(), `seed ${name}`).toBeTruthy();
  const body = await res.json();
  expect(body.media_uploaded, 'seed uploaded real media to R2').toBeTruthy();
  return body; // {id, filename, media_uploaded}
}

async function reelCount(request, profileId) {
  const res = await request.get(`${API_BASE}/downloads/count`, { headers: hdr(profileId) });
  return (await res.json()).count;
}

async function listMixes(request, profileId) {
  const res = await request.get(`${API_BASE}/downloads?mixes=true`, { headers: hdr(profileId) });
  return (await res.json()).downloads;
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
  await page.evaluate(async () => {
    const { useProfileStore } = await import('/src/stores/profileStore.js');
    await useProfileStore.getState().fetchProfiles({ force: true });
    const { useGalleryStore } = await import('/src/stores/galleryStore.js');
    useGalleryStore.getState().open();
  });
  await page.waitForTimeout(600);
}

let A; // default profile (source)
let B; // second profile (target)

test.describe.configure({ mode: 'serial' });

test.describe('T4850 move reels between profiles', () => {
  test.beforeAll(async ({ request }) => {
    for (let i = 0; i < 15; i++) {
      try { if ((await request.get(`${API_BASE}/health`)).ok()) break; } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
    A = (await (await request.post(`${API_BASE}/auth/init`, { headers: { 'X-User-ID': USER } })).json()).profile_id;
    // Register the isolated user in Postgres so Postgres-FK features (sharing) work.
    await request.post(`${API_BASE}/test/ensure-pg-user`, { headers: hdr(A) });
  });

  test('c6: single-profile account never sees the Move affordance', async ({ page, request }) => {
    await seedReel(request, A, 'Solo Reel');
    await bootAs(page, A);
    await expect(page.getByRole('button', { name: 'Select' })).toHaveCount(0);
    await saveEvidence(page, 'criterion-6-single-profile-no-affordance');
  });

  test('affordance appears once a 2nd profile exists', async ({ page, request }) => {
    B = (await (await request.post(`${API_BASE}/profiles`, {
      headers: hdr(A), data: { name: 'Athlete B', color: '#10B981' },
    })).json()).id;
    await request.put(`${API_BASE}/profiles/current`, { headers: hdr(A), data: { profileId: A } });
    await bootAs(page, A);
    await expect(page.getByRole('button', { name: 'Select' })).toBeVisible();
    await saveEvidence(page, 'criterion-6-two-profiles-affordance-visible');
  });

  test('c1+4b: single reel moves A->B via the card menu; media follows (download 200)', async ({ page, request }) => {
    const seeded = await seedReel(request, A, 'Wonder Goal');
    const before = await reelCount(request, A);
    const bBefore = await reelCount(request, B);

    // Media currently resolves under A (source), NOT yet under B.
    expect((await request.get(`${API_BASE}/downloads/${seeded.id}/stream`, { headers: hdr(A) })).status()).toBeLessThan(400);

    await bootAs(page, A);
    await expect(page.getByTitle('More actions').first()).toBeVisible();
    await page.getByTitle('More actions').first().click();
    await page.getByRole('button', { name: /Move to profile/ }).click();
    await saveEvidence(page, 'criterion-1-move-modal');
    await page.getByRole('button', { name: 'Athlete B' }).click();
    await page.waitForTimeout(1500);

    expect(await reelCount(request, A)).toBe(before - 1);
    expect(await reelCount(request, B)).toBe(bBefore + 1);

    // The moved reel now lives in B. Its media MUST resolve under the B prefix.
    const bReels = await listMixes(request, B);
    const moved = bReels.find((r) => r.filename === seeded.filename);
    expect(moved, 'moved reel present in target list').toBeTruthy();

    const stream = await request.get(`${API_BASE}/downloads/${moved.id}/stream`, { headers: hdr(B) });
    expect(stream.status(), '4a: stream resolves under target prefix (was 404 pre-fix)').toBeLessThan(400);

    const dl = await request.get(`${API_BASE}/downloads/${moved.id}/file`, { headers: hdr(B) });
    expect(dl.status(), '4b: download 200').toBe(200);
    expect((await dl.body()).length, '4b: non-empty bytes').toBeGreaterThan(0);
    await saveEvidence(page, 'criterion-1-after-single-move');
  });

  test('4a+4f: moved reel PLAYS in target and has no "Open as Draft"', async ({ page, request }) => {
    const bReels = await listMixes(request, B);
    expect(bReels.length).toBeGreaterThanOrEqual(1);

    await bootAs(page, B);
    // Overflow menu on the moved reel must NOT offer "Open as Draft" (project_id NULL
    // -> canOpenSource false; editing lineage stayed in the source profile).
    await page.getByTitle('More actions').first().click();
    await expect(page.getByRole('button', { name: /Open as Draft/ })).toHaveCount(0);
    await saveEvidence(page, 'criterion-4f-no-open-as-draft');
    await page.keyboard.press('Escape');

    // Play the reel and assert the <video> actually advances.
    await page.getByTitle('Play video').first().click();
    await page.waitForTimeout(500);
    const video = page.locator('video').first();
    await expect(video).toBeVisible();
    await page.waitForTimeout(1500);
    const t = await video.evaluate((v) => v.currentTime);
    expect(t, '4a: playback advanced currentTime').toBeGreaterThan(0);
    await saveEvidence(page, 'criterion-4a-plays-in-target');
  });

  test('4c: share-link creation from the target profile works', async ({ request }) => {
    const moved = (await listMixes(request, B))[0];
    const res = await request.post(`${API_BASE}/gallery/${moved.id}/share`, {
      headers: hdr(B), data: { is_public: true, recipient_emails: [] },
    });
    expect(res.ok(), '4c: share created from target profile').toBeTruthy();
    const data = await res.json();
    const token = data.shares?.[0]?.share_token || data.share_token;
    expect(token, '4c: got a share token').toBeTruthy();

    // The public share must resolve the moved reel's media (same per-profile presign
    // path as playback) -> proves a shared moved reel is watchable from the target.
    const resolved = await request.get(`${API_BASE}/shared/${token}`);
    expect(resolved.status(), '4c: public share resolves').toBeLessThan(400);
  });

  test('c2+c3: bulk-select moves several reels in one gesture', async ({ page, request }) => {
    await seedReel(request, A, 'Bulk One');
    await seedReel(request, A, 'Bulk Two');
    const before = await reelCount(request, A);
    const bBefore = await reelCount(request, B);

    await bootAs(page, A);
    await page.getByRole('button', { name: 'Select' }).click();
    await page.waitForTimeout(400);
    // Stable hook on the selectable card root (T5010). The old
    // `div.cursor-pointer` locator also matched ancestor wrappers with no
    // onClick, so clicks landed on nothing and the test timed out on the
    // disabled Move button. getByTestId targets only the real card.
    const cards = page.getByTestId('reel-card').filter({ hasText: 'Bulk' });
    const n = await cards.count();
    expect(n).toBeGreaterThanOrEqual(2);
    // Assert the "N selected" counter after each click: fail fast on the first
    // non-registering click instead of waiting 300s on the Move button.
    for (let i = 0; i < n; i++) {
      await cards.nth(i).click();
      await expect(page.getByText(`${i + 1} selected`)).toBeVisible();
    }
    await saveEvidence(page, 'criterion-2-bulk-selected');
    await responsiveSweep(page);

    await page.getByRole('button', { name: /Move to profile/ }).click();
    await page.getByRole('button', { name: 'Athlete B' }).click();
    await page.waitForTimeout(1800);

    const moved = before - (await reelCount(request, A));
    expect(moved).toBeGreaterThanOrEqual(2);
    expect(await reelCount(request, B)).toBe(bBefore + moved);
    await saveEvidence(page, 'criterion-3-source-after-bulk-move');
  });

  test('4d: delete a moved reel in the target profile removes the row', async ({ request }) => {
    const before = await reelCount(request, B);
    const victim = (await listMixes(request, B))[0];
    const del = await request.delete(`${API_BASE}/downloads/${victim.id}`, { headers: hdr(B) });
    expect(del.ok(), '4d: delete ok').toBeTruthy();
    expect(await reelCount(request, B)).toBe(before - 1);
    const after = await listMixes(request, B);
    expect(after.find((r) => r.id === victim.id), '4d: row gone').toBeFalsy();
  });

  test('4g: moving a reel BACK to the original profile round-trips', async ({ request }) => {
    const moved = (await listMixes(request, B))[0];
    const aBefore = await reelCount(request, A);

    const res = await request.post(`${API_BASE}/downloads/move-to-profile`, {
      headers: hdr(B), data: { video_ids: [moved.id], target_profile_id: A },
    });
    expect(res.ok(), '4g: move back ok').toBeTruthy();
    expect(await reelCount(request, A)).toBe(aBefore + 1);

    // The reel is in A again and its media resolves under the A prefix.
    const aReels = await listMixes(request, A);
    const back = aReels.find((r) => r.filename === moved.filename);
    expect(back, '4g: reel present in original profile').toBeTruthy();
    const stream = await request.get(`${API_BASE}/downloads/${back.id}/stream`, { headers: hdr(A) });
    expect(stream.status(), '4g: plays back in original profile').toBeLessThan(400);
  });
});
