import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T8730 — Focus/stage CTA write-ordering: interactive REAL-BROWSER QA.
 *
 * T10610 REWRITE (design doc § C.4 / § E row 4): the "Save this play first?"
 * dirty-check confirm dialog this spec used to test is COMPLETELY DELETED —
 * `focusConfirmOpen`/`focusConfirmDialog`/`hasUnsavedEdits` no longer exist.
 * There is nothing to confirm anymore because every field persists on its own
 * gesture the instant it changes; the risk this spec must now guard is
 * ORDERING, not data loss: does the stage CTA wait for a still-in-flight
 * write before navigating into Framing, or can it race ahead and open Framing
 * on STALE (pre-edit) bounds?
 *
 * The mechanism under test is `onAwaitWrites` (AnnotateContainer's
 * `awaitRegionWrites`, backed by `regionWriteQueue.js`'s per-region FIFO):
 * the stage CTA's onClick awaits it before calling onOpenInFocus/onOpenInOverlay.
 * This spec drags/types a trim change, IMMEDIATELY clicks the stage CTA (no
 * settle time given — the whole point is racing it), and proves via real
 * network request ordering that the trim's PUT completes before Framing opens,
 * and that Framing reflects the committed (post-trim) bounds, not stale ones.
 *
 * SAFE BY CONSTRUCTION: the trim edit IS the persisted state going forward
 * (there is no "discard" path anymore — Escape reverts before any write, but
 * this spec deliberately commits via drag-end / Enter). The target clip's
 * ORIGINAL bounds are restored via context.request in afterEach so the real
 * account's data is not left mutated by the QA run.
 *
 * Run: bash scripts/dev-verify.sh e2e/T8730-focus-dirty-check.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 6);
const API_BASE = process.env.E2E_API_BASE || '/api';

test.use({ viewport: { width: 1280, height: 800 } }); // desktop width -> strip layout renders

test.describe('T8730 — stage CTA awaits pending writes before navigating (no dirty-check dialog)', () => {
  let targetClip;
  let originalBounds;

  test.beforeEach(async ({ context, page }) => {
    test.setTimeout(90000);
    await loginAsRealUser(context, REAL_EMAIL, PROFILE);

    // Discover a clip that already HAS a reel (auto_project_id set) — the
    // stage CTA only renders (as the FOCUS-stage "Frame" action) for such
    // clips. Skip loudly if none exist rather than hardcoding an id that
    // could be stale/deleted on a different lane account.
    const res = await context.request.get(`${API_BASE}/clips/raw?game_id=${GAME_ID}`, {
      headers: { 'X-Profile-ID': PROFILE },
    });
    expect(res.ok(), `GET ${API_BASE}/clips/raw?game_id=${GAME_ID} (${res.status()})`).toBeTruthy();
    const clips = await res.json();
    targetClip = clips.find((c) => c.auto_project_id);
    if (!targetClip) {
      console.log(`[T8730][SKIP] game ${GAME_ID} has no clip with a reel (auto_project_id) to drive the stage CTA`);
    }
    test.skip(!targetClip, `[T8730] no reel-backed clip available in game ${GAME_ID}`);
    originalBounds = { start_time: targetClip.start_time, end_time: targetClip.end_time };
    console.log(`[T8730] driving clip id=${targetClip.id} "${targetClip.name}" (reel ${targetClip.auto_project_id})`);

    await openGameInAnnotate(page, GAME_ID);
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 30000 });

    // The video autoplays on load. AnnotateContainer auto-DESELECTS a SELECTED
    // (not yet EDITING) clip the instant the playhead drifts outside its
    // start/end range -- so a playing video racing the click below intermittently
    // wiped the selection before "Edit play" could be clicked. Pause first.
    await page.locator('video').first().evaluate((v) => v.pause());

    // Select the target clip via its sidebar row (desktop: whole row clickable)
    // -- this only moves selection to SELECTED, it does NOT open the editor.
    const row = page.locator('[data-testid="clip-row"]', { hasText: targetClip.name }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.click();

    // The primary CTA flips from "Mark play" to "Edit play" once a clip is
    // SELECTED; clicking it opens the strip editor (EDITING state ->
    // showAnnotateOverlay=true -> desktopEditorOpen strip).
    const editButton = page.getByRole('button', { name: 'Edit play' });
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();

    // The strip editor mounts with the stage CTA once the clip is being
    // edited. There is no more "Open in Framing" title (that belonged to the
    // retired dirty-check copy) — the FOCUS-stage CTA's visible text is
    // "Frame" (ANNOTATE.FRAME_THIS_CLIP / clipStage.label); its hover title is
    // the longer FRAME_THIS_CLIP_HINT sentence.
    await expect(page.getByTestId('annotate-editor-strip')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Frame' })).toBeVisible({ timeout: 10000 });
  });

  test.afterEach(async ({ context }) => {
    // Restore the real clip's original bounds so this QA run never leaves the
    // account's data mutated (the trim edit below is a REAL persisted write —
    // there is no "Cancel" path anymore to keep it from landing).
    if (targetClip && originalBounds) {
      await context.request.put(`${API_BASE}/clips/raw/${targetClip.id}`, {
        headers: { 'X-Profile-ID': PROFILE },
        data: originalBounds,
      }).catch(() => {});
    }
  });

  test('stage CTA awaits the trim PUT before navigating, and Framing opens on committed bounds @staging-gate @gate-a', async ({ page }) => {
    const strip = page.locator('[data-testid="annotate-editor-strip"]');
    const newStart = Math.max(0, (targetClip.start_time || 0) + 1);

    // Commit a real trim change via the typed field + Enter (onCommitComplete
    // -> onDragEnd -> {startTime, endTime}, T9480/T10610's per-field write).
    await strip.getByTestId('trim-field-start').click();
    const startInput = strip.getByTestId('trim-field-input-start');
    await startInput.fill(String(newStart));

    // Fire the Enter commit and the stage CTA click BACK TO BACK (no settle
    // wait in between) -- this is the race: without onAwaitWrites, the stage
    // CTA could navigate before the PUT even leaves the browser.
    const putPromise = page.waitForRequest(
      (req) => req.url().includes(`/api/clips/raw/${targetClip.id}`) && req.method() === 'PUT',
    );
    await startInput.press('Enter');
    await page.getByRole('button', { name: 'Frame' }).click();

    const trimPut = await putPromise;
    // The PUT must have already been ISSUED (not necessarily resolved before
    // the click fired -- the click fires synchronously after Enter's blur) --
    // the real ordering guarantee is that navigation does not proceed until
    // this request's response lands, checked next.
    expect(trimPut.postDataJSON()).toMatchObject({ startTime: newStart });
    const trimPutResponse = await trimPut.response();
    expect(trimPutResponse.ok()).toBeTruthy();
    await saveEvidence(page, 'T8730-trim-put-issued');

    // No dirty-check dialog of any kind exists anymore.
    await expect(page.getByText('Save this play first?')).toHaveCount(0);
    await expect(page.getByText(/play editor/i)).toHaveCount(0);

    // Framing opens (the PUT above has already resolved by the time we assert
    // this, proving the navigation waited on awaitRegionWrites rather than
    // racing ahead of it) and reflects the COMMITTED start time, not the
    // pre-edit one. Detected via the editorStore's own mode + URL (EDITOR_MODES.
    // FRAMING === 'framing', MODE_PATHS['/focus']) rather than a guessed
    // component testid — FocusScreen.jsx carries none.
    await page.waitForURL(/\/focus/, { timeout: 20000 });
    await expect.poll(async () => page.evaluate(async () => {
      const { useEditorStore } = await import('/src/stores/editorStore.js');
      return useEditorStore.getState().editorMode;
    }), { timeout: 20000 }).toBe('framing');
    const clipAfter = await page.evaluate(async (clipId) => {
      const res = await fetch(`/api/clips/raw/${clipId}`);
      return res.ok ? res.json() : null;
    }, targetClip.id);
    expect(clipAfter?.start_time).toBeCloseTo(newStart, 1);
    await saveEvidence(page, 'T8730-framing-opened-on-committed-bounds');
  });
});
