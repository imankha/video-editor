/**
 * T8510 QA — the unframed-clip export guard (Option A, reverses T3700 P0), the
 * inline reason copy, and (T11700/T11720) the Set focus point unlock + phone
 * compact locked band, live-driven at the viewports the walkthrough used.
 *
 * With a Focus draft whose clip has zero user crop keyframes (an un-started draft):
 *   - the Generate Highlight button is DISABLED (no zero-effort credit burn);
 *   - at sm+ (desktop/tablet) the reason caption renders AT the button;
 *   - BELOW sm (phone) the band collapses to the T11720 compact row (an unlock
 *     caption + a disabled Generate pill) so the timeline/Trim controls stay on
 *     screen — the full band (real CTA + caption) is `hidden sm:flex`, so at 390
 *     we assert the COMPACT row, NOT the full-band caption/CTA.
 *
 * The disabled/caption/compact matrix is proven deterministically in
 * ExportButtonView.test.jsx + ActionBand.test.jsx; this spec proves the WIRING on
 * a real account. Each test CREATES its own fresh unframed draft (clip-save write
 * path, deleted in afterEach) rather than hoping the shared account has one — the
 * old skip-guard keyed on a tile label the UI never renders (T8470 relabeled
 * NOT_STARTED to the bare "Draft"), so it skipped unconditionally and hid the
 * behavior. dev-login is dev-only, so this spec runs against the dev stack.
 * T11700-frame-unlock.qa.spec.js is the broader cross-viewport counterpart.
 *
 * Run: bash scripts/dev-verify.sh e2e/T8510-export-guard.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { createUnframedDraft, deleteClip } from './helpers/annotateClips.js';
import { saveEvidence } from './helpers/qa.js';

// House standard for real-account QA specs that need seeded fixture data
// (T10780/T10810/T10820): the reference_dev_fixture_account. dev-login is dev-only.
const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const CAPTION = '[data-testid="export-unframed-caption"]';
// T11700/T11720: the framing CTA is "Generate Highlight" (EXPORT_JOBS.framing.action);
// the old "Generate Framing" locator was stale (T10640) and never matched.
const EXPORT_BUTTON = 'button:has-text("Generate Highlight")';
const SET_FOCUS_POINT = '[data-testid="set-focus-point-button"]';
const COMPACT = '[data-testid="action-band-compact"]';
const LOCKED_PILL = '[data-testid="generate-locked-pill"]';

// Each test creates its OWN unframed draft (deleted in afterEach) rather than
// depending on the shared account happening to have one. The earlier skip-guard
// looked for a tile reading "Not started" — a string the UI NEVER renders (T8470
// relabeled the NOT_STARTED stage to the bare "Draft"), so it skipped
// unconditionally and hid the real behavior. createUnframedDraft hits the same
// clip-save write path the Annotate "Save clip" gesture uses (an acceptable dev
// write), deterministic in-container.
let createdClipId = null;

test.afterEach(async ({ context }) => {
  if (createdClipId) {
    await deleteClip(context, createdClipId);
    createdClipId = null;
  }
});

async function openFreshUnframedDraft(context, page) {
  const { rawClipId, name } = await createUnframedDraft(context, { profileId: REAL_PROFILE });
  createdClipId = rawClipId;
  await page.goto('/');
  const card = page.locator('[data-testid="project-card"]', { hasText: name }).first();
  await card.waitFor({ timeout: 20000 });
  await card.click();
  await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });
}

test('T8510: unframed clip on a PHONE (390) shows the compact locked band, not the full CTA/caption', async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
  await openFreshUnframedDraft(context, page);

  // T11720: below sm the full band (real CTA + export-unframed-caption) is
  // `hidden sm:flex`; the visible locked state is the compact row.
  const compact = page.locator(COMPACT);
  await expect(compact, 'compact locked row visible at 390').toBeVisible();
  await expect(compact, 'compact row names the unlock action').toContainText(/Set a focus point to unlock Generate/);
  await expect(compact, 'compact row in-viewport at 390x844').toBeInViewport();
  const box = await compact.boundingBox();
  expect(box.height, `compact band <=56px (T11720 AC1), got ${box.height}`).toBeLessThanOrEqual(56);
  await expect(page.locator(LOCKED_PILL), 'disabled Generate pill').toHaveAttribute('aria-disabled', 'true');
  // The full-band caption/CTA exist in the DOM (for sm+) but are NOT visible at 390.
  await expect(page.locator(CAPTION), 'full-band caption hidden below sm').toBeHidden();

  await saveEvidence(page, 'T8510-compact-locked-band-390x844');
});

test('T8510: unframed clip on DESKTOP (1440) disables Generate with the reason caption', async ({ context, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
  await openFreshUnframedDraft(context, page);

  const exportBtn = page.locator(EXPORT_BUTTON).first();
  await exportBtn.waitFor({ timeout: 30000 });
  await expect(exportBtn, 'Generate disabled while unframed (T3700 reversal)').toBeDisabled();
  // At sm+ the compact row stays in the DOM (compactLocked is viewport-independent)
  // but is `sm:hidden`; the reason caption renders at the button instead.
  await expect(page.locator(COMPACT), 'compact row hidden at sm+').toBeHidden();
  const caption = page.locator(CAPTION).first();
  await expect(caption, 'reason caption rendered under the disabled button').toBeVisible();
  expect((await caption.textContent()) || '', 'caption explains the fix, not just the block')
    .toMatch(/Move the box onto your player/);

  await saveEvidence(page, 'T8510-guard-disabled-caption-1440x900');
});

// T11700: one tap on "Set focus point" (no drag) frames the clip and enables Generate.
// At 390 the locked compact band is replaced by the full enabled band; at 1440 the
// disabled CTA/caption become the enabled CTA.
for (const vp of [{ w: 390, h: 844 }, { w: 1440, h: 900 }]) {
  test(`T11700: tap Set focus point unlocks Generate at ${vp.w}x${vp.h}`, async ({ context, page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
    await openFreshUnframedDraft(context, page);

    if (vp.w < 640) {
      await expect(page.locator(COMPACT), 'locked compact row before the first point').toBeVisible();
    } else {
      await expect(page.locator(EXPORT_BUTTON).first(), 'disabled CTA before the first point').toBeDisabled();
    }

    const setBtn = page.locator(`${SET_FOCUS_POINT}:visible`).first();
    await setBtn.waitFor({ timeout: 10000 });
    await setBtn.scrollIntoViewIfNeeded();
    await expect(setBtn, 'amber Set focus point at 0 focus points').toContainText(/Set focus point/i);

    await setBtn.click();

    // One tap, no drag -> clip is framed (clipIsFramed true) -> Generate enables and
    // the locked affordances disappear.
    await expect(page.locator(COMPACT), 'compact locked row gone after the first point').toHaveCount(0);
    const enabledCta = page.locator(EXPORT_BUTTON).first();
    await expect(enabledCta, 'real Generate CTA enabled after one tap').toBeVisible();
    await expect(enabledCta, 'real Generate CTA enabled after one tap').toBeEnabled();
    // Restore the original 390 in-viewport guarantee: once unlocked the real CTA
    // must sit ON-SCREEN (the sticky band keeps it reachable), not scrolled far
    // below as the pre-T8510 amber banner did. (Dropped only for the LOCKED state,
    // where the CTA is intentionally `hidden sm:flex`.)
    await expect(enabledCta, `unlocked Generate CTA in viewport @${vp.w}`).toBeInViewport();

    await saveEvidence(page, `T11700-set-focus-point-unlocks-${vp.w}x${vp.h}`);
  });
}
