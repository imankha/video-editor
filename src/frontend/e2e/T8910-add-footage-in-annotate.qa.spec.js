import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T8910 — Add footage from inside Annotate: real-browser QA.
 *
 * Drives the DETERMINISTIC entry points against a real account's real game:
 *   1. the "Add footage" button lives WITH the timeline (not UnifiedHeader) and
 *      opens the universal picker in attachMode, with the "Add to this game"
 *      primary button + a display-only credit cost line;
 *   2. a window-level file drag surfaces ONE dashed drop target over the whole
 *      Annotate surface (drop point never decides placement).
 *
 * The upload + three landing-feedback variants (angle / main-track / amber
 * no-timestamp) and the amber-bar → Fix-timing tap are covered by the unit +
 * component suites (footageLanding.test, AnnotateTimeline.angleStrip.test,
 * uploadManager.attachFootage.test) — a real upload here would need credits + a
 * large real file + R2 and be non-deterministic, so it is deliberately NOT
 * asserted end-to-end (test-scope policy: curated set, CI is the full sweep).
 *
 * Run: bash scripts/dev-verify.sh e2e/T8910-add-footage-in-annotate.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE;
const API_BASE = process.env.E2E_API_BASE || '/api';

test.use({ viewport: { width: 1280, height: 800 } });

test.describe('T8910 — Add footage entry points in Annotate', () => {
  test.beforeEach(async ({ context, page }) => {
    test.setTimeout(120000);
    await loginAsRealUser(context, REAL_EMAIL, PROFILE);

    const res = await context.request.get(
      `${API_BASE}/games`,
      PROFILE ? { headers: { 'X-Profile-ID': PROFILE } } : undefined,
    );
    expect(res.ok(), `GET ${API_BASE}/games (${res.status()})`).toBeTruthy();
    const games = (await res.json()).games || [];
    // list_games' storage_status can lag /load (a reclaimed source still lists
    // 'active'); add-footage is DISABLED when /load reports the source expired.
    // Open candidate active games until one yields an ENABLED button (the state
    // this feature needs), so the spec never silently runs against an expired
    // game. Skip loudly if none — never a fixture-shaped false pass (CLAUDE.md).
    const candidates = games.filter((g) => g.storage_status === 'active').slice(0, 6);
    const btn = page.getByTestId('add-footage-button');
    let opened = null;
    for (const g of candidates) {
      await openGameInAnnotate(page, g.id);
      await expect(btn).toBeVisible({ timeout: 30000 });
      if (await btn.isEnabled()) { opened = g; break; }
      console.log(`[T8910] game id=${g.id} (${g.opponent_name}) source expired -> add-footage disabled; trying next`);
    }
    if (!opened) console.log('[T8910][SKIP] no active game with a loadable source (all expired)');
    test.skip(!opened, '[T8910] no active game with a loadable source available');
    console.log(`[T8910] driving game id=${opened.id} (${opened.opponent_name})`);
  });

  test('button opens the attach picker with cost + "Add to this game" @gate-a', async ({ page }) => {
    await saveEvidence(page, 'T8910-1-button-visible');

    await page.getByTestId('add-footage-button').click();

    // The universal picker (attachMode) mounts in its empty state.
    await expect(page.getByTestId('footage-picker-empty')).toBeVisible({ timeout: 10000 });
    // Primary CTA is present and disabled until a file is picked (display-only cost).
    const submit = page.getByTestId('add-footage-submit');
    await expect(submit).toBeVisible();
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText(/Add to this game/i);
    await expect(page.getByText(/keeps this footage for 30 days/i)).toBeVisible();
    await saveEvidence(page, 'T8910-2-attach-modal-open');

    // Close cleanly.
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('footage-picker-empty')).toHaveCount(0);
  });

  test('a window-level file drag shows one dashed drop target @gate-a', async ({ page }) => {
    // Simulate an OS file drag entering the window (Playwright can't drive a real
    // OS file drag, so dispatch the HTML5 dragenter with a Files dataTransfer).
    await page.evaluate(() => {
      // Populate dataTransfer.types with 'Files' NATIVELY via items.add (Chromium
      // drops a dataTransfer passed to the DragEvent constructor), then attach it
      // to a plain Event dispatched on window — the surface the handler listens on.
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'clip.mp4', { type: 'video/mp4' }));
      const fire = (type) => {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'dataTransfer', { value: dt });
        window.dispatchEvent(ev);
      };
      fire('dragenter');
      fire('dragover');
    });

    await expect(page.getByTestId('add-footage-drop-target')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/We'll place it by when it was filmed/i)).toBeVisible();
    await saveEvidence(page, 'T8910-3-drop-target');
  });
});
