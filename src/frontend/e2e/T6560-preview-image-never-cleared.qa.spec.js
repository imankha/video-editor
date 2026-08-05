/**
 * T6560 QA — the preview image can be MOVED but never CLEARED / turned off.
 *
 * Drives the REAL app as a real user in the Overlay editor and proves, in a real
 * browser (jsdom would pass a toggle a real click still fires), that NONE of the
 * marker interactions the staging report named can leave the reel with no preview
 * frame:
 *
 *   - click the marker once
 *   - click it again at the same position
 *   - keyboard-activate it (Enter / Space)
 *   - drag it and release IN PLACE (sub-threshold jitter)
 *   - reload + re-open
 *
 * After EACH: a preview frame is still resolved and SHOWN (the <canvas> grab is
 * ready), the store's posterMarkerTime is UNCHANGED, and no /poster-time write
 * fired to change it. Then a DELIBERATE drag proves the marker still MOVES.
 *
 * Enforcement is two-layer (T6560):
 *   - persistence/API: POST /poster-time rejects a null/missing/non-finite time
 *     (422), so "none" is structurally unreachable at the write boundary. Asserted
 *     directly against the running backend here.
 *   - interaction: a pointerdown+up with no real drag commits nothing.
 *
 * Run: bash scripts/dev-verify.sh e2e/T6560-preview-image-never-cleared.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence } from './helpers/qa.js';
import { probeOverlayDrafts } from './helpers/overlayDraft.js';
import { waitForRealVideoReady } from './helpers/videoRoute.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

async function openOverlayDraft(page, { minReadyState = 3 } = {}) {
  const { loadable, dangling } = await probeOverlayDrafts(page);
  if (loadable.length === 0) return { ok: false, reason: dangling.join('; ') || '(none)' };
  const targetId = loadable[0];
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Reel Drafts' }).click();
  const overlayFilter = page.getByText(/^In Overlay \(\d+\)$/);
  if ((await overlayFilter.count()) > 0) await overlayFilter.first().click();
  const card = page.locator('[data-testid="project-card"]')
    .filter({ has: page.locator(`img[src*="/projects/${targetId}/poster"]`) }).first();
  await card.waitFor({ timeout: 30000 });
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  const hoverBtn = card.getByRole('button', { name: 'Open in Overlay' });
  if (await hoverBtn.count() > 0) await hoverBtn.first().click();
  else { await card.getByRole('button', { name: 'More actions' }).click(); await page.getByRole('button', { name: 'Open in Overlay' }).first().click(); }
  await page.getByTestId('overlay-video-stage').first().waitFor({ timeout: 60000 });
  const verdict = await waitForRealVideoReady(page, { requireAspectRatio: true, minReadyState });
  return verdict.ready ? { ok: true, projectId: targetId } : { ok: false, reason: verdict.reason };
}

/** The poster marker (the layout renders a desktop + a mobile-drawer copy; the
 *  drag helper below uses this exact target, so the whole spec is consistent). */
function visibleMarker(page) {
  return page.getByTestId('poster-marker').first();
}

/** Deliberately DRAG the marker to `fraction` of the timeline width (0..1) and
 *  await the surgical /poster-time write it fires -- the proven T6510 pattern. */
async function dragMarkerTo(page, fraction) {
  const marker = visibleMarker(page);
  await marker.scrollIntoViewIfNeeded();
  const box = await marker.boundingBox();
  const cbox = await page.locator('.timeline-scroll-container').first().boundingBox();
  const startX = box.x + box.width / 2, startY = box.y + box.height / 2;
  const targetX = cbox.x + cbox.width * fraction;
  const wrote = page.waitForResponse(
    (r) => r.url().includes('/poster-time') && r.request().method() === 'POST',
    { timeout: 15000 },
  );
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move((startX + targetX) / 2, startY, { steps: 5 });
  await page.mouse.move(targetX, startY, { steps: 5 });
  await page.mouse.up();
  const resp = await wrote;
  expect(resp.status(), 'a deliberate drag must persist (2xx)').toBeLessThan(300);
}

async function posterMarkerTime(page) {
  return page.evaluate(async () => {
    const { useOverlayStore } = await import('/src/stores/overlayStore.js');
    return useOverlayStore.getState().posterMarkerTime;
  });
}

/** A preview frame is resolved AND shown: some poster-frame canvas grabbed a still. */
async function expectFrameShown(page) {
  await expect(async () => {
    const ok = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="poster-frame-canvas"]')]
        .some((c) => c.width > 0 && c.height > 0 && getComputedStyle(c).opacity === '1'));
    expect(ok).toBe(true);
  }).toPass({ timeout: 20000 });
}

test.describe('T6560 preview image is never cleared', () => {
  test('no marker interaction clears the preview frame; a deliberate drag still moves it', async ({ context, page }) => {
    const clears = [];
    await loginAsRealUser(context, EMAIL, PROFILE);
    // Bring this profile's SQLite to HEAD (the v032 poster_marker_time column),
    // reproducing what an admin migrate does in prod before any gesture runs.
    const mig = await page.request.post('/api/test/migrate-current-profile', { headers: { 'X-Test-Mode': 'true' } });
    expect(mig.ok(), `profile migrate seam failed: ${mig.status()}`).toBe(true);

    const verdict = await openOverlayDraft(page);
    test.skip(!verdict.ok, `overlay not reachable: ${verdict.reason}`);
    const projectId = verdict.projectId;

    // The reel opens with SOME resolved preview frame (auto default or a picked one).
    await expectFrameShown(page);

    // Ensure a concrete picked frame so "cleared" would be an OBSERVABLE regression
    // (auto default midpoint could coincidentally equal a clicked position).
    await dragMarkerTo(page, 0.4);
    await expect(page.getByText(/Frame you picked/).first()).toBeVisible({ timeout: 10000 });
    await expectFrameShown(page);
    const pickedTime = await posterMarkerTime(page);
    expect(pickedTime, 'a concrete frame is picked before the no-op interactions').not.toBeNull();

    // From here, ANY write that changes the marker away from `pickedTime` is a clear/move
    // we did not intend. Record them.
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/poster-time')) clears.push(req.postData());
    });

    const assertUnchanged = async (label) => {
      await expectFrameShown(page);
      const now = await posterMarkerTime(page);
      expect(now, `${label}: preview frame must not change (was ${pickedTime}, got ${now})`).toBeCloseTo(pickedTime, 5);
    };

    const markerCenter = async () => {
      const b = await visibleMarker(page).boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
    };

    // 1. Click once, no movement.
    let c = await markerCenter();
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(400);
    await assertUnchanged('click once');

    // 2. Click again at the same position.
    c = await markerCenter();
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(400);
    await assertUnchanged('click again (same position)');

    // 3. Keyboard-activate (Enter / Space are activations, not moves).
    await visibleMarker(page).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    await assertUnchanged('keyboard Enter/Space');

    // 4. Drag and release IN PLACE (jitter under the drag threshold).
    c = await markerCenter();
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + 3, c.y, { steps: 2 });
    await page.mouse.move(c.x, c.y, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await assertUnchanged('drag release-in-place');

    expect(clears, `no no-op interaction may write poster-time, but saw: ${clears.join(', ')}`).toEqual([]);

    // 5. A DELIBERATE drag STILL moves the marker (moved-not-frozen) -- the fix
    // suppresses clicks, not real drags.
    await dragMarkerTo(page, 0.75);
    await expect(async () => {
      const moved = await posterMarkerTime(page);
      expect(Math.abs(moved - pickedTime)).toBeGreaterThan(0.1);
    }).toPass({ timeout: 10000 });
    await expectFrameShown(page);
    const movedTime = await posterMarkerTime(page);

    // 6. Reload + re-open: the moved frame persists and is shown again (a real
    // round-trip, not a local echo -- restore stays read-only).
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const reopened = await openOverlayDraft(page);
    expect(reopened.ok, `re-open after reload failed: ${reopened.reason}`).toBe(true);
    await expect(page.getByText(/Frame you picked/).first()).toBeVisible({ timeout: 20000 });
    await expectFrameShown(page);
    const afterReload = await posterMarkerTime(page);
    expect(afterReload, 'the moved frame persists across reload').toBeCloseTo(movedTime, 5);

    await saveEvidence(page, 'T6560-marker-move-not-clear');

    // Persistence-layer enforcement: the backend refuses a null/missing/non-finite
    // clear, so "none" is unreachable no matter what any UI path sends.
    const nullResp = await page.request.post(`/api/export/projects/${projectId}/poster-time`, { data: { time: null } });
    expect(nullResp.status(), 'POST /poster-time {time:null} must be rejected (422)').toBe(422);
    const missingResp = await page.request.post(`/api/export/projects/${projectId}/poster-time`, { data: {} });
    expect(missingResp.status(), 'POST /poster-time {} must be rejected (422)').toBe(422);
    const okResp = await page.request.post(`/api/export/projects/${projectId}/poster-time`, { data: { time: movedTime } });
    expect(okResp.status(), 'a concrete time is still accepted').toBeLessThan(300);
  });

  test('the H.264 export-info line is gone (item 2)', async ({ context, page }) => {
    await loginAsRealUser(context, EMAIL, PROFILE);
    await page.request.post('/api/test/migrate-current-profile', { headers: { 'X-Test-Mode': 'true' } });
    const verdict = await openOverlayDraft(page, { minReadyState: 2 });
    test.skip(!verdict.ok, `overlay not reachable: ${verdict.reason}`);
    await expect(page.getByText('Preview image').first()).toBeVisible();
    await expect(page.getByText(/Applies highlight overlay/)).toHaveCount(0);
    await expect(page.getByText(/H\.264/)).toHaveCount(0);
  });
});
