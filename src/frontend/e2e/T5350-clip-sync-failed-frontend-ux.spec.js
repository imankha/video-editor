import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T5350 — clip-gesture sync_failed 503 is surfaced with a clip-appropriate
 * message + a working Retry (never a silent success).
 *
 * LIVE-DRIVE of the REAL production toast-surfacing code: the spec imports the
 * hook's exported `surfaceClipSyncFailed` (the exact function `useRawClipSave`
 * runs on a 503 `{code:'sync_failed'}`) and invokes it against the running app's
 * REAL Toast store + mounted `ToastContainer`, then asserts the rendered DOM.
 *
 * The backend half of the loop — that the clip routes actually return the
 * retryable 503 under a forced sync fault — is proven by the backend suite
 * `tests/test_t4320_durable_clip_gestures.py`
 * (`test_clip_save_forced_sync_failure_returns_503_not_durable`), and the hook's
 * branch/handling by `src/hooks/__tests__/useRawClipSave.syncFailed.test.js`.
 *
 * This spec relies on the Vite dev server serving `/src/**` modules, so it is
 * local-only (a deployed target serves a built bundle without source paths).
 *
 * Evidence map (acceptance criteria):
 *   AC1  save 503 -> clip-appropriate not-saved message (NOT "your reel was not
 *        moved") + a Retry affordance.
 *   AC2  update + delete surface the same way.
 *   AC3  no silent success; Retry is a user click (gesture), re-firing the op.
 */

const GESTURES = [
  { key: 'save',   title: 'Could not save to the cloud', message: "Your clip wasn't saved. Please try again." },
  { key: 'update', title: 'Could not save to the cloud', message: "Your clip changes weren't saved. Please try again." },
  { key: 'delete', title: 'Could not save to the cloud', message: "Your clip wasn't deleted. Please try again." },
];

test('T5350: clip sync_failed surfaces a clip-appropriate not-saved toast + working Retry', async ({ page }) => {
  skipOnDeployedTarget(test, 'imports /src/hooks/** via the Vite dev server + drives the real toast (local-only)');

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#root > *', { timeout: 30000 });

  // Sanity: the exported copy is clip-appropriate at the source, never the reel/move copy.
  const copy = await page.evaluate(async () => {
    const mod = await import('/src/hooks/useRawClipSave.js');
    window.__t5350 = { retries: { save: 0, update: 0, delete: 0 } };
    return mod.CLIP_SYNC_FAILED_COPY;
  });
  for (const g of GESTURES) {
    expect(copy[g.key].title).toBe(g.title);
    expect(copy[g.key].message).toBe(g.message);
    expect(copy[g.key].message).not.toMatch(/reel was not moved/i);
  }

  for (const g of GESTURES) {
    // Drive the REAL hook code path that surfaces the failure toast on a 503.
    // The retry thunk here stands in for the hook's `() => saveClip(...)` re-fire:
    // clicking Retry MUST invoke it (a user gesture, not a reactive re-send).
    await page.evaluate(async (key) => {
      const mod = await import('/src/hooks/useRawClipSave.js');
      mod.surfaceClipSyncFailed(key, () => { window.__t5350.retries[key] += 1; });
    }, g.key);

    const toast = page.getByRole('alert').filter({ hasText: g.message });
    await expect(toast, `${g.key}: not-saved toast visible`).toBeVisible();
    await expect(toast).toContainText(g.title);
    // Clip copy, never the reel/move message.
    await expect(toast).not.toContainText(/reel was not moved/i);

    const retryBtn = toast.getByRole('button', { name: 'Retry' });
    await expect(retryBtn, `${g.key}: Retry affordance present`).toBeVisible();

    await saveEvidence(page, `T5350-${g.key}-sync-failed-toast`);

    // Retry is a gesture: clicking it fires the bound re-attempt exactly once.
    await retryBtn.click();
    const retries = await page.evaluate((key) => window.__t5350.retries[key], g.key);
    expect(retries, `${g.key}: Retry click re-fired the gesture once`).toBe(1);
    // Toast dismisses on retry so the next gesture asserts against a clean surface.
    await expect(toast).toBeHidden();
  }
});
