import { expect } from '@playwright/test';
import { openGameInAnnotate } from './realAuth.js';

/**
 * annotateClips — shared Annotate-screen clip helpers for the real-account QA
 * specs (T5700-team, T5700-two-lanes, T5725, T6400, T7540).
 *
 * These were copy-pasted (byte-identical or near) across those five specs;
 * consolidated here per the 2026-08-25 Playwright redundancy survey (Cluster A).
 * The canonical `openAddClipForm` is T7540's HARDENED gap-scanning version — it
 * waits for the <video> to become seekable, then scans candidate seek times until
 * the playhead lands in a clip-free gap and the "Add Clip" button actually shows
 * (the older specs' hardcoded seek offset was the root cause of the stray-clip
 * failures). The old `ensureAddClipVisible(page, seekTime)` seek-offset approach
 * is intentionally NOT preserved.
 *
 * All values come from env with the same defaults every spec used:
 *   E2E_PROFILE_ID (9fa7378c), E2E_GAME_ID (6), E2E_API_BASE (/api).
 */

const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 6);
const apiBase = process.env.E2E_API_BASE || '/api';

/** Open the game in Annotate and wait for the first clip marker to mount. */
export async function gotoGame(page) {
  await openGameInAnnotate(page, GAME_ID);
  await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 30000 });
}

// Game 6's source is a large / long MP4 that buffers slowly in-container;
// video.currentTime assignments are ignored until the element is seekable, which
// leaves the playhead pinned at 0 (inside Clip 1) so the Add button never shows.
// Wait until the <video> can actually seek before driving it.
async function waitForVideoSeekable(page) {
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return !!v && v.readyState >= 2 && v.seekable.length > 0 && v.duration > 0;
  }, undefined, { timeout: 120000 });
}

// Default gap-scan candidates (early gaps are already buffered near the start;
// Clip 1 is 0:00-0:03). Callers needing a SECOND distinct clip can pass their own
// list so two created clips land in different gaps rather than colliding.
const DEFAULT_GAP_CANDIDATES = [10, 15, 8, 12, 20, 25, 45, 90];

/**
 * HARDENED (T7540): the non-fullscreen "Add Clip" control renders ONLY when no
 * clip is selected (NONE state); when the playhead sits inside a clip the sidebar
 * edits it and the Add button is hidden. Game 6 is densely clipped, so scan
 * candidate seek times until the playhead lands in a gap and the Add button shows,
 * then click it and return the visible add-clip form.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{candidates?: number[]}} [opts] override the gap-scan candidate times
 * @returns {Promise<import('@playwright/test').Locator>} the visible [data-add-clip-form]
 */
export async function openAddClipForm(page, { candidates = DEFAULT_GAP_CANDIDATES } = {}) {
  await waitForVideoSeekable(page);
  // Desktop renders a labeled "Add Clip" button (hidden sm:flex); below the `sm`
  // breakpoint AnnotateControls swaps in an icon-only twin with the same title
  // (flex sm:hidden) — match on title + :visible so either width works.
  const addBtn = page.locator('button[title="Add play ending at current time (A)"]:visible').first();
  for (const t of candidates) {
    const landed = await page.locator('video').first().evaluate((v, tt) => {
      v.currentTime = tt;
      if (!v.paused) v.pause();
      return v.currentTime;
    }, t);
    // If the seek was clamped back to ~0 (range not buffered yet), skip this time.
    if (Math.abs(landed - t) > 2) { await page.waitForTimeout(400); continue; }
    await page.waitForTimeout(700); // let auto-select re-evaluate (deselects in a gap)
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click();
      // The desktop ClipsSidePanel stays mounted (`hidden sm:flex`) even on a
      // mobile viewport, so its own inline add-clip form also renders — scope to
      // the VISIBLE [data-add-clip-form] only (mobile's inline form, or desktop's).
      const form = page.locator('[data-add-clip-form]:visible');
      await expect(form).toBeVisible({ timeout: 5000 });
      return form;
    }
  }
  throw new Error('[annotateClips] could not find a clip-free gap to open the Add Clip form');
}

/** Save the open add-clip form; returns the created raw_clip_id. */
export async function saveClipForm(page, form) {
  const [saveResp] = await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/clips/raw/save') && res.request().method() === 'POST'),
    form.locator('button.bg-green-600:has-text("Save")').click(),
  ]);
  return (await saveResp.json()).raw_clip_id;
}

/**
 * Open the add-clip form, optionally set the clip's layer, Save. Returns the
 * created raw_clip_id.
 *
 * T6400: the "New clips go to" mode toggle is gone — a clip's layer is chosen on
 * the clip itself. Pass `layerName` ('My Athlete layer' | 'Team layer') to set it
 * in the add-clip form's Layer control before saving (idempotent: skip the click
 * if the inherited default already matches). Omit it to accept whatever the game
 * seeded / the previous clip set.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [layerName]
 * @param {{candidates?: number[]}} [opts] override the gap-scan candidate times so
 *   multiple clips created in one test land in DISTINCT gaps
 */
export async function createClipViaUI(page, layerName, opts = {}) {
  const form = await openAddClipForm(page, opts);
  if (layerName) {
    const radio = form.getByRole('radio', { name: layerName });
    if ((await radio.getAttribute('aria-checked')) !== 'true') await radio.click();
    await expect(radio).toHaveAttribute('aria-checked', 'true');
  }
  return saveClipForm(page, form);
}

/**
 * Delete a test clip via context.request — the SAME cookie jar as loginAsRealUser,
 * never the bare `request` fixture (which is a separate, unauthenticated context
 * and silently 401s on cleanup, leaving stray clips in the real account). A failed
 * cleanup THROWS (loud, not swallowed) so a stray test clip never lingers.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {number|string} rawClipId
 */
export async function deleteClip(context, rawClipId) {
  if (!rawClipId) return;
  const res = await context.request.delete(`${apiBase}/clips/raw/${rawClipId}`, { headers: { 'X-Profile-ID': PROFILE_ID } });
  if (!res.ok()) {
    throw new Error(`[annotateClips cleanup] FAILED to delete test clip ${rawClipId} (${res.status()}) — a stray clip may remain in the real account. Delete it manually: DELETE /api/clips/raw/${rawClipId}`);
  }
}
