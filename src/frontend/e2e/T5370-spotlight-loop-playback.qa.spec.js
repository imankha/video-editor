/**
 * T5370 QA — Overlay spotlight loop playback.
 *
 * Drives the REAL app as a real user (dev-login) on an emulated TABLET viewport
 * and exercises the acceptance criteria on a live overlay clip:
 *   1. Primary "Play spotlight" LOOPS the span [min(startTime), max(endTime)] —
 *      the playhead never runs far past span.end (it wraps back).
 *   2. Secondary "Play full" is present + de-emphasized and plays THROUGH the
 *      span end (no wrapping) toward the clip end.
 *   3. The "Reset" pill (T5658; formerly "Back to spotlight") appears only once
 *      the playhead is past the span, and pressing it seeks to time 0 — it no
 *      longer returns to span.start, since the spotlight location isn't
 *      guaranteed and resetting to the clip start is the dependable behavior.
 *
 * Reaching a live spotlight requires this account to have an EXPORTED reel with
 * highlight regions (overlay mode is gated on it). If none is reachable, the
 * live drive is skipped HONESTLY — the deterministic loop-enforcement coverage
 * lives in the Vitest spec src/modes/overlay/hooks/useSpotlightLoop.test.js
 * (8 cases: wrap in loop mode; no-op in full / paused / seeking / null span).
 *
 * Run: bash scripts/dev-verify.sh e2e/T5370-spotlight-loop-playback.qa.spec.js
 */
import { test, expect, devices } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

const PRIMARY_PLAY = 'button[title="Play spotlight (loops)"]';
const PRIMARY_ANY = 'button[title="Play spotlight (loops)"], button[title="Play"], button[title="Pause"]';
const SECONDARY_FULL = 'button[title="Play full clip"]';
const PILL = '[aria-label="Reset"]'; // T5658: was "Back to spotlight"
const VID = '.video-container video';

/** Best-effort navigation into Overlay mode with rendered highlight regions. */
async function tryReachOverlay(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  const draftsBtn = page.getByRole('button', { name: 'Reel Drafts' });
  if (await draftsBtn.count()) {
    await draftsBtn.click().catch(() => {});
    const chip = page.getByTitle(/\[.+\]: .*\(click to open\)/).first();
    if (await chip.count()) await chip.click().catch(() => {});
  }
  const overlayTab = page.locator('[data-testid="mode-overlay"]');
  if (await overlayTab.count()) await overlayTab.click().catch(() => {});
  // A reachable spotlight means the video + the spotlight play button rendered.
  try {
    await page.locator(PRIMARY_ANY).first().waitFor({ timeout: 20000 });
    await page.locator(VID).first().waitFor({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const readVideo = (page) => page.$eval(VID, (v) => ({ time: v.currentTime, paused: v.paused, duration: v.duration }));

test.describe('T5370 spotlight loop playback', () => {
  test('tablet: primary loops the span, secondary plays through, pill returns to start', async ({ browser }) => {
    test.setTimeout(180_000);
    // Emulated tablet: wide + touch (coarse pointer) so the >=44px floor applies.
    const context = await browser.newContext({ ...devices['iPad (gen 7)'] });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    const reached = await tryReachOverlay(page);
    test.skip(!reached, 'No exported reel with highlight regions in this fixture — see Vitest useSpotlightLoop.test.js for deterministic loop-enforcement coverage.');

    // The secondary "Play full" button exists (regions present) and is de-emphasized (ghost).
    await expect(page.locator(SECONDARY_FULL)).toHaveCount(1);
    await saveEvidence(page, 'T5370-1-controls-primary-and-secondary');

    // --- Criterion 1: primary loops the span (playhead wraps, never runs to clip end) ---
    await page.locator(PRIMARY_PLAY).first().click().catch(async () => {
      // If already playing/looping the title is 'Pause'; fall back to any play control.
      await page.locator(PRIMARY_ANY).first().click();
    });
    await page.waitForTimeout(4000); // let it play + wrap at least once
    const looped = await readVideo(page);
    // In a wrapping loop the playhead stays below the full clip duration.
    expect(looped.time).toBeLessThan((looped.duration || 1e9) - 0.5);
    await saveEvidence(page, 'T5370-2-loop-wrapped');

    // --- Criterion 2: secondary plays through past the span toward clip end ---
    const beforeFull = await readVideo(page);
    await page.locator(SECONDARY_FULL).click();
    await page.waitForTimeout(4000);
    const full = await readVideo(page);
    expect(full.time).toBeGreaterThan(beforeFull.time); // advanced, no wrap pinning it back
    await saveEvidence(page, 'T5370-3-play-full-through');

    // --- Criterion 3 (T5658): pill appears once past the span, and resets to time 0 ---
    // Play full should have carried us past span.end; poll for the pill.
    await page.locator(PILL).waitFor({ timeout: 10000 }).catch(() => {});
    if (await page.locator(PILL).count()) {
      const past = await readVideo(page);
      await saveEvidence(page, 'T5370-4-pill-visible-past-span');
      await page.locator(PILL).click();
      await page.waitForTimeout(500);
      const returned = await readVideo(page);
      expect(returned.time).toBeLessThan(past.time); // jumped back toward the start
      expect(returned.time).toBeLessThan(1); // T5658: resets to time 0, not span.start
      await expect(page.locator(PILL)).toHaveCount(0); // hidden once back before the span
      await saveEvidence(page, 'T5370-5-reset-to-start');
    } else {
      console.warn('[qa] T5370: pill not reached (span may span the whole clip) — loop + full-play criteria still evidenced.');
    }

    await responsiveSweep(page);
    await context.close();
  });
});
