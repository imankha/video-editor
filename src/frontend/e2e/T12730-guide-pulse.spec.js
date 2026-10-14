/**
 * T12730 characterization: with Guidance ON the control a guide sentence names carries
 * `coach-target-pulse`; with Guidance OFF nothing on the screen pulses. One test per screen.
 * Written against today's per-screen pulse code and kept green while the pulse moves onto
 * GuideScope (T12740/T12750), so it pins WHICH control pulses, not how the class is applied.
 *
 * Cannot prove: exact visuals (keyframes, ring colour, reduced-motion look) or timing.
 * Live-driven on the dev-fixture account; Home uses a fresh empty profile.
 *
 * Run: bash scripts/dev-verify.sh e2e/T12730-guide-pulse.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { gotoGame, createUnframedDraft, deleteClip } from './helpers/annotateClips.js';
import { openLoadableOverlayDraft } from './helpers/overlayDraft.js';

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const PULSE = /coach-target-pulse/;
const ANY_PULSE = '.coach-target-pulse';

async function setGuidance(page, on) {
  const toggle = page.getByTestId('guidance-toggle');
  await toggle.waitFor({ timeout: 20000 });
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(on));
}

async function expectNothingPulsesWhenGuidanceOff(page) {
  await setGuidance(page, false);
  await expect(page.locator(ANY_PULSE)).toHaveCount(0);
  await setGuidance(page, true);
}

test('Home: empty Games tab pulses Upload game (AC5)', async ({ page }) => {
  test.setTimeout(120_000);
  // Empty-session account (test-login, no games): the Games tab shows the empty-state guide.
  const userId = `t12730_home_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await page.setExtraHTTPHeaders({ 'X-User-ID': userId, 'X-Test-Mode': 'true' });
  await page.goto('/');
  const login = await page.evaluate(async (headers) => {
    const res = await fetch('/api/auth/test-login', { method: 'POST', credentials: 'include', headers });
    return res.ok;
  }, { 'Content-Type': 'application/json', 'X-User-ID': userId, 'X-Test-Mode': 'true' });
  expect(login).toBe(true);
  await page.reload();
  const upload = page.getByTestId('home-upload-game');
  await upload.waitFor({ timeout: 30000 });
  await setGuidance(page, true);
  await expect(upload).toHaveClass(PULSE);
  await expectNothingPulsesWhenGuidanceOff(page);
});

test('Annotate: nothing marked pulses Mark play', async ({ context, page }) => {
  test.setTimeout(180_000);
  await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
  await gotoGame(page);
  await setGuidance(page, true);
  const mark = page.getByTestId('annotate-mark-play-button');
  await expect(mark).toHaveClass(PULSE);
  await expectNothingPulsesWhenGuidanceOff(page);
});

test('Focus: crop box pulses, then Play after one drag', async ({ context, page }) => {
  test.setTimeout(180_000);
  await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
  const { rawClipId, name } = await createUnframedDraft(context, { profileId: REAL_PROFILE });
  try {
    await page.goto('/');
    await page.getByText(name.slice(0, 18), { exact: false }).first().click();
    await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });
    await setGuidance(page, true);

    const box = page.locator('[data-testid="focus-video-stage"] .cursor-move').first();
    await expect(box).toHaveClass(PULSE);
    await expectNothingPulsesWhenGuidanceOff(page);

    const b = await box.boundingBox();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 25, cy + 10, { steps: 6 });
    await page.mouse.up();

    await expect(page.getByTestId('play-button').first()).toHaveClass(PULSE);
    await expect(box).not.toHaveClass(PULSE);
    await expectNothingPulsesWhenGuidanceOff(page);
  } finally {
    await deleteClip(context, rawClipId);
  }
});

test('Overlay: pick walk parked on a moment pulses the athlete boxes', async ({ context, page }) => {
  test.setTimeout(240_000);
  await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
  const opened = await openLoadableOverlayDraft(page);
  test.skip(!opened.ok, opened.reason);
  await setGuidance(page, true);
  const halos = page.getByTestId('pick-box-pulse');
  // The pick walk only starts for a draft with detections; skip loudly when this draft has none.
  const walking = await halos.first().waitFor({ timeout: 30000 }).then(() => true, () => false);
  test.skip(!walking, 'Opened Overlay draft is not in a pick walk with detected boxes (no pick-box-pulse rendered)');
  expect(await halos.count()).toBeGreaterThan(0);
  await expectNothingPulsesWhenGuidanceOff(page);
  await expect(halos).toHaveCount(0);
});

test('Finished: Get link pulses on a highlight that has no link yet (T12760)', async ({ page }) => {
  test.setTimeout(120_000);
  const userId = `t12760_finished_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await page.setExtraHTTPHeaders({ 'X-User-ID': userId, 'X-Test-Mode': 'true' });
  await page.goto('/');
  await page.evaluate(async (headers) => {
    await fetch('/api/auth/test-login', { method: 'POST', credentials: 'include', headers });
  }, { 'Content-Type': 'application/json', 'X-User-ID': userId, 'X-Test-Mode': 'true' });
  await page.reload();
  await page.getByTestId('guidance-toggle').waitFor({ timeout: 30000 });
  await setGuidance(page, true);
  // Only the network boundary is mocked (stream/poster); the viewer is the real DraftReelPreview.
  await page.route('**/api/downloads/*/stream**', (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from([]) }));
  await page.route('**/api/downloads/*/poster.jpg**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }));
  await page.evaluate(async () => {
    const { openFinishedReel } = await import('/src/utils/finishedReelNav.js');
    openFinishedReel(
      { id: 42, final_video_id: 912760, name: 'Brilliant Dribble', aspect_ratio: '9:16', clip_count: 1, game_names: ['Lakers'], clip_game_start_time: 750, game_ids: [55] },
      { alreadyPublished: true },
    );
  });
  await expect(page.getByTestId('finished-get-link')).toHaveClass(PULSE, { timeout: 20000 });
});
