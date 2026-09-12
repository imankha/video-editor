import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T9580 QA — live-drive the persistent first-clip invitation (N41), against a
 * real account's real data, as a first-timer would experience it: mark a play
 * with an editable clip, then confirm the persistent invitation, reuse-not-
 * duplicate, and a playhead-safe dismiss.
 *
 * Criteria evidenced live:
 *   1. Save play persists the marker and SAYS WHICH OBJECT it created (toast).
 *   2. The invitation PERSISTS in the still-open editor (Frame this clip / Keep
 *      marking plays), not a disappearing toast.
 *   3. One marked play creates exactly one clip (no duplicate).
 *   4. "Keep marking plays" dismisses WITHOUT moving the playhead or forcing
 *      navigation.
 *
 * Note: this creates ONE draft clip on the account (a draft only — no GPU/credit
 * spend until it is framed). The existing clips in the target game were already
 * past the FOCUS stage, so a fresh play is required to reach the invitation.
 *
 * Run: bash scripts/dev-verify.sh e2e/T9580-first-clip-invitation-qa.spec.js --reporter=line
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE;
const API_BASE = process.env.E2E_API_BASE || '/api';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('T9580 — persistent first-clip invitation: live QA', () => {
  test.beforeEach(async ({ context, page }) => {
    test.setTimeout(120000);
    await loginAsRealUser(context, REAL_EMAIL, PROFILE);

    const res = await context.request.get(
      `${API_BASE}/games`,
      PROFILE ? { headers: { 'X-Profile-ID': PROFILE } } : undefined,
    );
    expect(res.ok(), `GET ${API_BASE}/games (${res.status()})`).toBeTruthy();
    const games = (await res.json()).games || [];
    const target = games.find((g) => g.storage_status === 'active');
    test.skip(!target, '[T9580] no active game available');
    console.log(`[T9580] driving active game id=${target.id} (${target.opponent_name})`);

    await openGameInAnnotate(page, target.id);
    await expect(page.locator('video').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1500);
  });

  test('mark a play -> persistent invitation, one clip, playhead-safe dismiss @gate-a', async ({ page }) => {
    const markersBefore = await page.locator('.clip-marker').count();
    console.log(`[T9580] clip markers before: ${markersBefore}`);

    // Reach the "Mark play" state: the primary CTA flips to "Edit play" whenever
    // the playhead sits over an existing clip (playhead-driven auto-select).
    // Seek to an empty stretch (past the early clips) so no clip is selected.
    const primaryCta = page.locator('[data-testid="annotate-primary-cta"]');
    await expect(primaryCta).toBeVisible({ timeout: 8000 });
    // The app's auto-deselect keys off effectiveCurrentTime, which only advances
    // from timeupdate events — so seek to an empty stretch, then PLAY briefly to
    // fire timeupdate and let the playhead-driven deselect flip Edit play ->
    // Mark play (a paused raw currentTime set alone does not update it).
    for (const frac of [0.62, 0.82, 0.45, 0.95]) {
      await page.locator('video').first().evaluate((v, f) => { v.currentTime = (v.duration || 90) * f; }, frac);
      const playBtn = page.locator('button[title="Play"]:visible').first();
      if (await playBtn.count()) {
        await playBtn.click();
        await page.waitForTimeout(1300);
        const pauseBtn = page.locator('button[title="Pause"]:visible').first();
        if (await pauseBtn.count()) await pauseBtn.click();
      }
      await page.waitForTimeout(500);
      if (/Mark play/i.test((await primaryCta.textContent()) || '')) break;
    }
    await expect(primaryCta, 'need an empty stretch so the CTA reads "Mark play"').toHaveText(/Mark play/i, { timeout: 5000 });
    await primaryCta.click();

    const strip = page.locator('[data-testid="annotate-editor-strip"]');
    await expect(strip).toBeVisible({ timeout: 10000 });

    // Rate it (valid play) and ensure the "Create an editable clip" toggle is ON.
    await page.locator('button[title="5 stars"]').first().click();
    const createToggle = strip.getByRole('button', { name: /Create an editable clip|Just save this play/ });
    if ((await createToggle.count()) && (await createToggle.getAttribute('aria-pressed')) === 'false') {
      await createToggle.click();
    }
    await saveEvidence(page, 'T9580-0-create-strip-before-save');

    // --- Save: persists the marker + creates the clip ---
    const saveBtn = strip.getByRole('button', { name: /Save play and create clip/ });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Criterion 1: a toast names the object it created ("... is now in Clips").
    await expect(page.getByText(/is now in Clips/i)).toBeVisible({ timeout: 15000 });
    await saveEvidence(page, 'T9580-1-save-says-which-object-created');

    // Criterion 2: the editor STAYS OPEN with the persistent invitation. The
    // stage CTA + "Keep marking plays" render as SIBLINGS after the strip's own
    // closing div (same fragment, not nested inside data-testid="annotate-editor-strip") —
    // so query at page scope, matching how the other CTA suites query it.
    await expect(strip).toBeVisible();
    const frameCta = page.getByRole('button', { name: 'Frame this clip' });
    const keepMarking = page.getByRole('button', { name: 'Keep marking plays' });
    await expect(frameCta).toBeVisible({ timeout: 15000 });
    await expect(keepMarking).toBeVisible();
    await saveEvidence(page, 'T9580-2-persistent-invitation-frame-and-keep');

    // Criterion 4: "Keep marking plays" dismisses without moving the playhead or
    // forcing navigation. Dismiss FIRST — the strip editor replaces the timeline
    // (T8600) so .clip-marker elements don't exist in the DOM while it's open;
    // closing it restores the timeline for the criterion-3 count below.
    const t0 = await page.locator('video').first().evaluate((v) => v.currentTime);
    await keepMarking.click();
    await expect(strip).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('[data-testid="annotate-primary-cta"]')).toBeVisible({ timeout: 5000 });
    const t1 = await page.locator('video').first().evaluate((v) => v.currentTime);
    console.log(`[T9580] playhead before dismiss=${t0.toFixed(3)} after=${t1.toFixed(3)}`);
    expect(Math.abs(t1 - t0), 'dismiss must preserve the playhead').toBeLessThan(0.75);
    await saveEvidence(page, 'T9580-4-dismiss-preserves-playhead-no-nav');

    // Criterion 3: exactly one clip was created for this one marked play.
    const markersAfter = await page.locator('.clip-marker').count();
    console.log(`[T9580] clip markers after: ${markersAfter}`);
    expect(markersAfter, 'one marked play must create exactly one clip').toBe(markersBefore + 1);
  });
});
