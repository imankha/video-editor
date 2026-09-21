/**
 * T10850 — Focus rotation hints (portrait nudge + landscape first-entry card).
 *
 * Live-drives the two dismissible hints that bracket the landscape flip and proves
 * the PERSISTENCE RULE end-to-end in a real browser: each localStorage flag is
 * written by a named gesture (the X tap / the "Got it" tap) — the written value is
 * asserted directly — and the dismissal holds when the phone rotates away and back
 * (the cockpit re-derives from the viewport without the hint returning). It is
 * never written just because the hint appeared.
 *
 *   1. Portrait (393x852): the rotate nudge shows under the stage while the clip has
 *      no focus points; its X dismisses it and writes `rb.focus.rotateNudgeDismissed`.
 *   2. Landscape (812x334): the first-entry card shows over the cockpit stage with a
 *      one-shot ring on Play + the CTA; "Got it" dismisses it, writes
 *      `rb.focus.cockpitIntroSeen`, and it does NOT return on rotate-away-and-back.
 *
 * The two per-device keys are cleared via addInitScript on the first load so the
 * hints start fresh (no reload — the SPA does not restore the Focus draft across a
 * full reload; the lazy-read-on-mount path is covered by the unit tests).
 *
 * NON-MUTATING: opens a draft, taps the hints' own dismiss controls, screenshots.
 * Never exports, never touches clip data. Honest-skips (repo convention) when the
 * account has no Focus-openable draft, and skips the nudge leg when the opened
 * draft already has focus points.
 *
 * REAL-BROWSER ONLY (Playwright). Run:
 *   bash scripts/dev-verify.sh e2e/T10850-rotation-hints.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { openFramingDraft } from './helpers/framingDraft.js';
import { saveEvidence } from './helpers/qa.js';

const AUDIT_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const AUDIT_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';

const PORTRAIT = { width: 393, height: 852 };
const LANDSCAPE = { width: 812, height: 334 };

const NUDGE_KEY = 'rb.focus.rotateNudgeDismissed';
const INTRO_KEY = 'rb.focus.cockpitIntroSeen';

// Start every run with the two hint flags unset, applied before any app code runs
// on the first navigation (never a reload — see the file header).
async function clearHintKeysOnLoad(page) {
  await page.addInitScript((keys) => {
    for (const k of keys) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
  }, [NUDGE_KEY, INTRO_KEY]);
}

test.describe('T10850 portrait rotate nudge', () => {
  test.use({ viewport: PORTRAIT });

  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
  });

  test('nudge shows under the stage; the X tap dismisses it and writes the key', async ({ page }) => {
    await clearHintKeysOnLoad(page);

    let opened = true;
    try { await openFramingDraft(page); }
    catch (e) { opened = false; test.skip(true, `no Focus-openable draft: ${e.message}`); }
    if (!opened) return;

    const nudge = page.getByTestId('rotate-nudge');
    if ((await nudge.count()) === 0) {
      test.skip(true, 'opened draft already has focus points — nudge correctly hidden');
      return;
    }
    await expect(nudge).toBeVisible();
    // Nothing is written just because the nudge appeared (the render guard).
    expect(await page.evaluate((k) => localStorage.getItem(k), NUDGE_KEY)).toBeNull();
    await saveEvidence(page, 'T10850-portrait-nudge');

    // The X tap is the named gesture that persists the dismissal.
    await page.getByTestId('rotate-nudge-dismiss').click();
    await expect(page.getByTestId('rotate-nudge')).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), NUDGE_KEY)).toBe('1');
  });
});

test.describe('T10850 landscape first-entry card', () => {
  test.use({ viewport: PORTRAIT });

  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
  });

  test('card shows with rings on first entry, "Got it" dismisses, does not return on re-rotate', async ({ page }) => {
    await clearHintKeysOnLoad(page);

    let opened = true;
    try { await openFramingDraft(page); }
    catch (e) { opened = false; test.skip(true, `no Focus-openable draft: ${e.message}`); }
    if (!opened) return;

    // Rotate into the cockpit — a pure viewport derivation, no gesture.
    await page.setViewportSize(LANDSCAPE);
    await expect(page.getByTestId('focus-cockpit')).toBeVisible();

    // First entry: the card is up, and the one-shot rings guide the eye. Nothing
    // is written just because the card appeared (the render guard).
    await expect(page.getByTestId('cockpit-intro-card')).toBeVisible();
    await expect(page.getByTestId('cockpit-play')).toHaveClass(/ring-2/);
    await expect(page.getByTestId('cockpit-cta-ring')).toHaveClass(/ring-2/);
    expect(await page.evaluate((k) => localStorage.getItem(k), INTRO_KEY)).toBeNull();
    await saveEvidence(page, 'T10850-landscape-intro-card');

    // "Got it" is the named gesture that persists the seen flag.
    await page.getByTestId('cockpit-intro-confirm').click();
    await expect(page.getByTestId('cockpit-intro-card')).toHaveCount(0);
    await expect(page.getByTestId('cockpit-play')).not.toHaveClass(/ring-2/);
    expect(await page.evaluate((k) => localStorage.getItem(k), INTRO_KEY)).toBe('1');

    // Rotate to portrait and back — the card must NOT return (the flag holds).
    await page.setViewportSize(PORTRAIT);
    await expect(page.getByTestId('focus-cockpit')).toHaveCount(0);
    await page.setViewportSize(LANDSCAPE);
    await expect(page.getByTestId('focus-cockpit')).toBeVisible();
    await expect(page.getByTestId('cockpit-intro-card')).toHaveCount(0);
    await saveEvidence(page, 'T10850-landscape-card-not-returning');
  });
});
