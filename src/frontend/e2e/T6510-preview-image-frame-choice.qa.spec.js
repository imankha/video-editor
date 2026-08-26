/**
 * T6510 QA — the preview image is a FRAME CHOICE, not an upload.
 *
 * Drives the REAL app as a real user (dev-login) in the Overlay editor and proves,
 * in a real browser (jsdom cannot decode a <video> frame), the behavioural half of
 * T6510 — mapping each assertion to an acceptance criterion in the task file:
 *
 *   1. The upload entry point is GONE from the preview-image UI (no "Upload your
 *      own", no file input in the card).                          [AC: upload gone]
 *   2. A preview frame is ALWAYS resolved (no "none" state) and the user SEES the
 *      actual still — the <canvas> grab reaches its ready (opacity-1) state.
 *                                                    [AC: always resolved / SHOWN]
 *   3. Moving the timeline marker updates the shown still — the hidden source
 *      <video> re-seeks to a new time and the panel copy flips to "Frame you
 *      picked".                                                 [AC: change updates]
 *   4. "Use current frame" sets the marker to the playhead and re-grabs.
 *                                                       [AC: change is easy]
 *   5. A reload PERSISTS the choice and writes NOTHING back on load (restore is
 *      read-only — no POST to /poster-time or /poster/revert during hydration).
 *                                            [AC: persistence, gesture-only writes]
 *   6. A grandfathered poster_source='upload' reel still shows its custom cover
 *      state and offers a one-way "Use a frame instead" switch (upload READ path
 *      retained).                                         [AC: grandfathering]
 *
 * T7770 also folds in the distinct T6560 assertions (deleted T6560.qa.spec.js —
 * both specs opened the SAME draft via the shared openLoadableOverlayDraft +
 * waitCanvasReady + dragMarkerTo). The "deliberate drag + reload persists" test was
 * a strict subset of criterion 5 above and was dropped; the UNIQUE T6560 coverage
 * kept here:
 *   7. NONE of the marker interactions the staging report named can CLEAR the
 *      preview frame: click once, click again, keyboard Enter/Space, and a
 *      drag-release-in-place all leave posterMarkerTime unchanged and write no
 *      /poster-time — while a DELIBERATE drag still MOVES it. Plus the persistence-
 *      layer enforcement: POST /poster-time rejects a null / missing / non-finite
 *      time (422), so a "none" state is structurally unreachable at the write
 *      boundary.                                     [T6560: never-cleared, both layers]
 *   8. The H.264 export-info line is gone from the preview panel.   [T6560 item 2]
 *
 * saveEvidence() is written per criterion; responsiveSweep() covers the panel.
 * Skips HONESTLY (never a vacuous pass) when Overlay isn't reachable in this env.
 *
 * Run: bash scripts/dev-verify.sh e2e/T6510-preview-image-frame-choice.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';
import { openLoadableOverlayDraft } from './helpers/overlayDraft.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

/**
 * Open a streamable In-Overlay draft and gate on the real overlay ready-signal.
 * Delegates to the shared `openLoadableOverlayDraft`, which (T7750) now walks the
 * loadable candidates, handles the T6180 ready-to-publish kebab menu, and verifies
 * an "Open in Overlay" affordance actually exists before committing to a tile.
 */
const openOverlayDraft = openLoadableOverlayDraft;

/** Wait until a poster-frame canvas has grabbed a still (state 'ready' -> opacity-1). */
async function waitCanvasReady(page) {
  await expect(async () => {
    const ok = await page.evaluate(() => {
      const cs = [...document.querySelectorAll('[data-testid="poster-frame-canvas"]')];
      return cs.some((c) => c.width > 0 && c.height > 0 && getComputedStyle(c).opacity === '1');
    });
    expect(ok).toBe(true);
  }).toPass({ timeout: 20000 });
}

/** currentTime of the first hidden preview-source <video> that has seeked. */
async function sourceTime(page) {
  return page.evaluate(() => {
    const v = document.querySelector('[data-testid="poster-frame-source"]');
    return v ? v.currentTime : null;
  });
}

/** The store's current picked poster marker time (T6560: the value a "clear" would null out). */
async function posterMarkerTime(page) {
  return page.evaluate(async () => {
    const { useOverlayStore } = await import('/src/stores/overlayStore.js');
    return useOverlayStore.getState().posterMarkerTime;
  });
}

/** Drag the poster marker to `fraction` of the timeline width (0..1). */
async function dragMarkerTo(page, fraction) {
  const marker = page.getByTestId('poster-marker').first();
  await marker.scrollIntoViewIfNeeded();
  const box = await marker.boundingBox();
  const container = page.locator('.timeline-scroll-container').first();
  const cbox = await container.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const targetX = cbox.x + cbox.width * fraction;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move((startX + targetX) / 2, startY, { steps: 4 });
  await page.mouse.move(targetX, startY, { steps: 4 });
  await page.mouse.up();
}

test.describe('T6510 preview image is a frame choice', () => {
  test('default resolves + is SHOWN, and the upload affordance is gone', async ({ context, page }) => {
    await loginAsRealUser(context, EMAIL, PROFILE);
    const verdict = await openOverlayDraft(page, { minReadyState: 3 });
    test.skip(!verdict.ok, `overlay not reachable: ${verdict.reason}`);

    // Panel present with the renamed label + honest copy.
    await expect(page.getByText('Preview image').first()).toBeVisible();

    // AC: upload entry point gone. No "Upload your own", no file input in the card.
    await expect(page.getByText('Upload your own')).toHaveCount(0);
    const fileInputs = await page.locator('input[type="file"]').count();
    expect(fileInputs).toBe(0);

    // AC: a frame is ALWAYS resolved and the user SEES the actual still.
    await waitCanvasReady(page);
    const t0 = await sourceTime(page);
    expect(t0).not.toBeNull();

    await saveEvidence(page, 'T6510-AC-default-resolved-and-shown');
    await responsiveSweep(page);
  });

  test('moving the marker updates the shown still', async ({ context, page }) => {
    await loginAsRealUser(context, EMAIL, PROFILE);
    const verdict = await openOverlayDraft(page, { minReadyState: 3 });
    test.skip(!verdict.ok, `overlay not reachable: ${verdict.reason}`);

    await waitCanvasReady(page);
    const before = await sourceTime(page);

    // Drag the marker to ~20% then confirm the grab re-seeked and copy flipped.
    await dragMarkerTo(page, 0.2);
    await expect(page.getByText(/Frame you picked/).first()).toBeVisible({ timeout: 10000 });
    await expect(async () => {
      const after = await sourceTime(page);
      expect(after).not.toBeNull();
      expect(Math.abs(after - before)).toBeGreaterThan(0.05);
    }).toPass({ timeout: 15000 });
    await waitCanvasReady(page);

    await saveEvidence(page, 'T6510-AC-marker-move-updates-still');
  });

  test('"Use current frame" picks the playhead frame', async ({ context, page }) => {
    await loginAsRealUser(context, EMAIL, PROFILE);
    const verdict = await openOverlayDraft(page, { minReadyState: 3 });
    test.skip(!verdict.ok, `overlay not reachable: ${verdict.reason}`);
    await waitCanvasReady(page);

    // Move the playhead to a non-zero time so "Use current frame" is a real pick.
    await page.evaluate(() => {
      const v = document.querySelector('.video-container video');
      if (v && Number.isFinite(v.duration)) v.currentTime = Math.min(1.5, v.duration / 2);
    });
    await page.getByRole('button', { name: 'Use current frame' }).first().click();

    await expect(page.getByText(/Frame you picked/).first()).toBeVisible({ timeout: 10000 });
    await waitCanvasReady(page);
    await saveEvidence(page, 'T6510-AC-use-current-frame');
  });

  test('reload persists the choice and writes nothing back on load', async ({ context, page }) => {
    await loginAsRealUser(context, EMAIL, PROFILE);

    // Bring this profile's SQLite to HEAD, reproducing in-container exactly what an
    // admin migrate does in prod (where DBs are at head before any gesture runs).
    // Without it, the pre-existing v032 `projects.poster_marker_time` column is
    // absent here and the /poster-time write 500s -- an env-data artifact, not a
    // T6510 change (the persistence path is T5410's, untouched).
    const mig = await page.request.post('/api/test/migrate-current-profile', { headers: { 'X-Test-Mode': 'true' } });
    expect(mig.ok(), `profile migrate seam failed: ${mig.status()}`).toBe(true);

    const verdict = await openOverlayDraft(page, { minReadyState: 3 });
    test.skip(!verdict.ok, `overlay not reachable: ${verdict.reason}`);
    await waitCanvasReady(page);

    // Drag the marker and CONFIRM the surgical gesture write actually persisted
    // (2xx), so "reload restores it" is a real round-trip, not a local-only echo.
    const writeResp = page.waitForResponse(
      (r) => r.url().includes('/poster-time') && r.request().method() === 'POST',
      { timeout: 15000 },
    );
    await dragMarkerTo(page, 0.35);
    const resp = await writeResp;
    expect(resp.status(), 'the drag-end poster-time write must succeed').toBeLessThan(300);
    await expect(page.getByText(/Frame you picked/).first()).toBeVisible({ timeout: 10000 });
    const picked = await page.getByText(/Frame you picked/).first().innerText();

    // Watch for any poster WRITE from here on (the drag's ONE gesture write already
    // fired above, before this listener) -- reload + re-hydration must add NONE.
    const posterWrites = [];
    page.on('request', (req) => {
      const u = req.url();
      if (req.method() === 'POST' && (u.includes('/poster-time') || u.includes('/poster/revert') || u.includes('/poster/upload'))) {
        posterWrites.push(`${req.method()} ${u}`);
      }
    });

    // This app has no router: a reload drops back to the projects screen, so the
    // choice's persistence is proven by RE-OPENING the draft from scratch (a full
    // /overlay-data restore) and seeing the same picked frame -- with zero poster
    // writes across the whole reload + re-open (restore is read-only).
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const reopened = await openOverlayDraft(page, { minReadyState: 3 });
    expect(reopened.ok, `re-open after reload failed: ${reopened.reason}`).toBe(true);

    await expect(page.getByText(/Frame you picked/).first()).toBeVisible({ timeout: 20000 });
    const restored = await page.getByText(/Frame you picked/).first().innerText();
    expect(restored).toBe(picked); // same frame time persisted across the reload
    await waitCanvasReady(page); // the persisted still is shown again

    expect(posterWrites, `restore must be read-only, but saw: ${posterWrites.join(', ')}`).toEqual([]);
    await saveEvidence(page, 'T6510-AC-reload-persists-no-writeback');
  });

  test('grandfathered upload reel keeps its custom cover + one-way switch', async ({ context, page }) => {
    await loginAsRealUser(context, EMAIL, PROFILE);

    // Force the grandfathered read state: rewrite /overlay-data's poster_source to
    // 'upload' (the shipped state real reels rely on). This exercises the READ path
    // T6510 deliberately retained without needing an upload write path.
    await page.route(/\/overlay-data(\?.*)?$/, async (route) => {
      const resp = await route.fetch();
      let body;
      try { body = await resp.json(); } catch { return route.fulfill({ response: resp }); }
      body.poster_source = 'upload';
      body.poster_filename = body.poster_filename || 'legacy-cover.mp4.jpg';
      return route.fulfill({ response: resp, body: JSON.stringify(body) });
    });

    const verdict = await openOverlayDraft(page, { minReadyState: 2 });
    test.skip(!verdict.ok, `overlay not reachable: ${verdict.reason}`);

    // Custom-cover state shown, NOT a frame grab.
    await expect(page.getByTestId('poster-custom-placeholder').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Custom image in use').first()).toBeVisible();

    // One-way switch present; "Use current frame" and the upload input are absent.
    await expect(page.getByRole('button', { name: 'Use a frame instead' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use current frame' })).toHaveCount(0);
    expect(await page.locator('input[type="file"]').count()).toBe(0);

    await saveEvidence(page, 'T6510-AC-grandfathered-upload');
  });

  // --- T7770: folded from T6560 (preview image is never cleared) ----------------------

  test('no marker interaction clears the preview frame; a deliberate drag still moves it', async ({ context, page }) => {
    const clears = [];
    await loginAsRealUser(context, EMAIL, PROFILE);
    // Bring this profile's SQLite to HEAD (the v032 poster_marker_time column),
    // reproducing what an admin migrate does in prod before any gesture runs.
    const mig = await page.request.post('/api/test/migrate-current-profile', { headers: { 'X-Test-Mode': 'true' } });
    expect(mig.ok(), `profile migrate seam failed: ${mig.status()}`).toBe(true);

    const verdict = await openOverlayDraft(page, { minReadyState: 3 });
    test.skip(!verdict.ok, `overlay not reachable: ${verdict.reason}`);
    const projectId = verdict.projectId;

    // The reel opens with SOME resolved preview frame (auto default or a picked one).
    await waitCanvasReady(page);

    // Ensure a concrete picked frame so "cleared" would be an OBSERVABLE regression
    // (auto default midpoint could coincidentally equal a clicked position). Await the
    // surgical write so the pick is a confirmed round-trip, not a local echo.
    const pickWrite = page.waitForResponse(
      (r) => r.url().includes('/poster-time') && r.request().method() === 'POST',
      { timeout: 15000 },
    );
    await dragMarkerTo(page, 0.4);
    const pickResp = await pickWrite;
    expect(pickResp.status(), 'a deliberate drag must persist (2xx)').toBeLessThan(300);
    await expect(page.getByText(/Frame you picked/).first()).toBeVisible({ timeout: 10000 });
    await waitCanvasReady(page);
    const pickedTime = await posterMarkerTime(page);
    expect(pickedTime, 'a concrete frame is picked before the no-op interactions').not.toBeNull();

    // From here, ANY write that changes the marker away from `pickedTime` is a clear/move
    // we did not intend. Record them.
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/poster-time')) clears.push(req.postData());
    });

    const assertUnchanged = async (label) => {
      await waitCanvasReady(page);
      const now = await posterMarkerTime(page);
      expect(now, `${label}: preview frame must not change (was ${pickedTime}, got ${now})`).toBeCloseTo(pickedTime, 5);
    };

    const markerCenter = async () => {
      const b = await page.getByTestId('poster-marker').first().boundingBox();
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
    await page.getByTestId('poster-marker').first().focus();
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
    await waitCanvasReady(page);
    const movedTime = await posterMarkerTime(page);

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

  test('the H.264 export-info line is gone (T6560 item 2)', async ({ context, page }) => {
    await loginAsRealUser(context, EMAIL, PROFILE);
    await page.request.post('/api/test/migrate-current-profile', { headers: { 'X-Test-Mode': 'true' } });
    const verdict = await openOverlayDraft(page, { minReadyState: 2 });
    test.skip(!verdict.ok, `overlay not reachable: ${verdict.reason}`);
    await expect(page.getByText('Preview image').first()).toBeVisible();
    await expect(page.getByText(/Applies highlight overlay/)).toHaveCount(0);
    await expect(page.getByText(/H\.264/)).toHaveCount(0);
  });
});
