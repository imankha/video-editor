import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T8720 — Annotate add/edit-play playhead always visible + consistent across
 * triggers: interactive REAL-BROWSER QA.
 *
 * The bug (live-testing feedback): in the add/edit-play mini-timeline (the
 * "Editing: Play N" scrub region), the playhead marker sometimes disappeared
 * when playback stopped, and behaved differently depending on whether the
 * user stopped/started via the on-screen button controls vs the spacebar.
 *
 * Root cause: the marker (`previewTime`) was set ONLY by the in-editor
 * Preview button's own RAF loop, and cleared on drag / on the main video's
 * `play` DOM event. The transport play/pause button and the spacebar both
 * drive the shared <video> via `useVideo.togglePlay` and never touched the
 * marker — two divergent play systems.
 *
 * Fix: the marker (`data-testid="scrub-playhead"`) now mirrors the video's
 * REAL current time via a single always-on RAF, so it is visible whenever the
 * real playhead is in the visible window (including while stopped) and
 * tracks playback identically no matter which control started it.
 *
 * This spec drives an ACTUAL clip editor open (Edit Play — sidebar, the real
 * non-fullscreen path: clicking a clip marker opens ClipDetailsEditor directly,
 * no separate "Edit selected play" button click — that button is intentionally
 * hidden in non-fullscreen while a clip is selected, per AnnotateControls: "Non-FS:
 * only show Add (not Edit)" / "sidebar handles editing") against a real account's
 * real game+clips, never saves, and screenshots the marker across all three
 * trigger paths:
 *   1. stopped on open (symptom 1: must be visible, not absent)
 *   2. stop/start via the TRANSPORT button
 *   3. stop/start via SPACEBAR
 * asserting the marker survives every one of these with no dead window.
 *
 * Closing without saving: the sidebar editor has no Escape/close affordance of
 * its own (that only exists on the fullscreen add/edit overlay, a separate
 * surface — AnnotateContainer's real auto-deselect gesture is currentTime moving
 * outside the selected clip's [startTime, endTime] window, see AnnotateContainer's
 * "[AutoDeselect]" effect). So this spec seeks away via the real "Restart"
 * transport button (title="Restart", jumps to t=0, well outside any clip's
 * range) to trigger that same real deselect path and confirm the marker is
 * fully gone — proving the close is a real state transition, not a saved write
 * (no PATCH/update call is made by seeking).
 *
 * Run: bash scripts/dev-verify.sh e2e/T8720-annotate-playhead-visibility-consistency.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE; // omit -> account's default profile
const API_BASE = process.env.E2E_API_BASE || '/api';

test.use({ viewport: { width: 1280, height: 800 } });

test.describe('T8720 — add/edit-play scrub playhead: always visible, consistent across triggers', () => {
  test.beforeEach(async ({ context, page }) => {
    // Cold video-source buffering under a large real MP4 can be slow in-container.
    test.setTimeout(120000);

    await loginAsRealUser(context, REAL_EMAIL, PROFILE);

    // Discover an ACTIVE game WITH clips — never hardcode an id (CLAUDE.md: no
    // silent fallback for a missing fixture; skip loudly instead).
    const res = await context.request.get(
      `${API_BASE}/games`,
      PROFILE ? { headers: { 'X-Profile-ID': PROFILE } } : undefined,
    );
    expect(res.ok(), `GET ${API_BASE}/games (${res.status()})`).toBeTruthy();
    const games = (await res.json()).games || [];
    const target = games.find((g) => g.storage_status === 'active' && (g.clip_count || 0) > 0);
    if (!target) {
      console.log('[T8720][SKIP] account has no ACTIVE game with clips to open the play editor on');
    }
    test.skip(!target, '[T8720] no active game with clips available');
    console.log(`[T8720] driving active game id=${target.id} (${target.opponent_name})`);

    await openGameInAnnotate(page, target.id);
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 30000 });
  });

  test('playhead survives stop/start on ALL trigger paths, never disappears @staging-gate @gate-a', async ({ page }) => {
    // --- Open the play editor on an EXISTING clip (Edit Play) — read-only,
    // no save needed to exercise the scrub region. Click the first clip marker:
    // in non-fullscreen this opens ClipDetailsEditor directly in the sidebar
    // (no separate "Edit selected play" button — see file header).
    await page.locator('.clip-marker').first().click();

    const playhead = page.locator('[data-testid="scrub-playhead"]');

    // Wait for the editor's scrub region to actually mount (its Preview button
    // is a stable, always-rendered anchor for the scrub region existing).
    await expect(page.locator('button[title="Preview clip"], button[title="Stop preview"]').first())
      .toBeVisible({ timeout: 10000 });

    // --- Symptom 1: visible on open, WHILE STOPPED (no play action yet). ---
    await expect(playhead).toBeVisible({ timeout: 5000 });
    await expect(playhead).toHaveCount(1);
    await saveEvidence(page, 'T8720-1-playhead-visible-stopped-on-open');

    // --- Path A: transport button start/stop. ---
    const playBtn = page.locator('button[title="Play"]:visible').first();
    const pauseBtn = page.locator('button[title="Pause"]:visible').first();

    await expect(playBtn).toBeVisible({ timeout: 5000 });
    await playBtn.click();
    await page.waitForTimeout(500); // let it actually advance a bit
    await expect(playhead).toBeVisible();
    const leftDuringButtonPlay = await playhead.evaluate((el) => el.style.left);
    await saveEvidence(page, 'T8720-2-playhead-visible-button-playing');

    await expect(pauseBtn).toBeVisible({ timeout: 5000 });
    await pauseBtn.click();
    await page.waitForTimeout(300);
    // Symptom 1, button path: marker MUST still be visible after stopping.
    await expect(playhead).toBeVisible();
    const leftAfterButtonStop = await playhead.evaluate((el) => el.style.left);
    await saveEvidence(page, 'T8720-3-playhead-visible-button-stopped');

    // --- Path B: spacebar start/stop (symptom 2: must converge with Path A). ---
    await page.keyboard.press('Space'); // start
    await page.waitForTimeout(500);
    await expect(playhead).toBeVisible();
    await saveEvidence(page, 'T8720-4-playhead-visible-spacebar-playing');

    await page.keyboard.press('Space'); // stop
    await page.waitForTimeout(300);
    // Symptom 1, spacebar path: marker MUST still be visible after stopping.
    await expect(playhead).toBeVisible();
    const leftAfterSpacebarStop = await playhead.evaluate((el) => el.style.left);
    await saveEvidence(page, 'T8720-5-playhead-visible-spacebar-stopped');

    // Symptom 2 convergence proof: the button-triggered stop and the
    // spacebar-triggered stop both leave a marker rendered at a real,
    // finite left% (not the old "absent" / stuck state) — same predicate,
    // same DOM node, no divergent visibility between the two trigger paths.
    for (const left of [leftDuringButtonPlay, leftAfterButtonStop, leftAfterSpacebarStop]) {
      const pct = parseFloat(left);
      expect(Number.isFinite(pct)).toBeTruthy();
      expect(pct).toBeGreaterThanOrEqual(0);
    }

    // --- Close WITHOUT saving: seek away via the real "Restart" transport
    // button (t=0, outside this clip's [startTime, endTime]) — the real
    // auto-deselect gesture (AnnotateContainer's "[AutoDeselect]" effect),
    // not a save/PATCH. Confirms the marker is fully gone, not just hidden. ---
    const restartBtn = page.locator('button[title="Restart"]:visible').first();
    await expect(restartBtn).toBeVisible({ timeout: 5000 });
    await restartBtn.click();
    await expect(page.locator('[data-testid="scrub-playhead"]')).toHaveCount(0, { timeout: 5000 });
  });
});
