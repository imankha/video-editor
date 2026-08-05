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
 * saveEvidence() is written per criterion; responsiveSweep() covers the panel.
 * Skips HONESTLY (never a vacuous pass) when Overlay isn't reachable in this env.
 *
 * Run: bash scripts/dev-verify.sh e2e/T6510-preview-image-frame-choice.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';
import { probeOverlayDrafts } from './helpers/overlayDraft.js';
import { waitForRealVideoReady } from './helpers/videoRoute.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

/**
 * Open a streamable In-Overlay draft and gate on the real overlay ready-signal.
 * Local variant of the shared `openLoadableOverlayDraft` that ALSO handles the
 * T6180 ready-to-publish tile, whose "Open in Overlay" lives in a kebab menu
 * (the shared helper only knows the hover-rail button, so it hangs on a
 * ready-to-publish loadable draft — an env-data drift, not a code bug here).
 */
async function openOverlayDraft(page, { minReadyState = 3 } = {}) {
  const { loadable, dangling } = await probeOverlayDrafts(page);
  if (loadable.length === 0) {
    return { ok: false, reason: `no streamable In-Overlay draft: ${dangling.join('; ') || '(none)'}` };
  }
  const targetId = loadable[0];

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Reel Drafts' }).click();
  const overlayFilter = page.getByText(/^In Overlay \(\d+\)$/);
  if ((await overlayFilter.count()) > 0) await overlayFilter.first().click();

  const card = page
    .locator('[data-testid="project-card"]')
    .filter({ has: page.locator(`img[src*="/projects/${targetId}/poster"]`) })
    .first();
  await card.waitFor({ timeout: 30000 });
  await card.scrollIntoViewIfNeeded();
  await card.hover();

  // Prefer the hover-rail icon button; fall back to the ready-state kebab menu.
  const hoverBtn = card.getByRole('button', { name: 'Open in Overlay' });
  if (await hoverBtn.count() > 0) {
    await hoverBtn.first().click();
  } else {
    await card.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('button', { name: 'Open in Overlay' }).first().click();
  }

  const stage = page.getByTestId('overlay-video-stage').first();
  await stage.waitFor({ timeout: 60000 });
  const verdict = await waitForRealVideoReady(page, { requireAspectRatio: true, minReadyState });
  if (verdict.ready) return { ok: true, projectId: targetId };
  return { ok: false, reason: `overlay draft ${targetId} never hydrated: ${verdict.reason}` };
}

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
});
