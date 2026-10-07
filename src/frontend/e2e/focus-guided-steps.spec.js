/**
 * Focus guided steps: ONE instruction at a time (drag the box -> play -> keep the
 * box on your player). Trim and SlowMo, Preview highlight and Generate stay locked
 * until the first two steps are done; Trim and SlowMo then swaps the guide.
 *
 * Live-driven on the dev-fixture account (dev-login is dev-only). Each test creates
 * its own unframed draft and deletes it afterwards.
 *
 * Run: bash scripts/dev-verify.sh e2e/focus-guided-steps.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { createUnframedDraft, deleteClip } from './helpers/annotateClips.js';
import { saveEvidence } from './helpers/qa.js';

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const GUIDE = '[data-testid="framing-guide-text"]';
const TRIM = '[data-testid="trim-slowmo-button"]';
const PREVIEW = '[data-testid="framing-preview-toggle"]';
const GENERATE = 'button:has-text("Generate Highlight")';

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
  // The draft surfaces as a "Continue where you left off" card on Home.
  const card = page.getByText(name.slice(0, 18), { exact: false }).first();
  await card.waitFor({ timeout: 20000 });
  await card.click();
  await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });
}

async function dragBox(page) {
  const box = page.locator('[data-testid="focus-video-stage"] .cursor-move').first();
  const b = await box.boundingBox();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 25, cy + 10, { steps: 6 });
  await page.mouse.up();
}

for (const vp of [{ w: 1280, h: 900 }, { w: 768, h: 1024 }, { w: 390, h: 844 }]) {
  test(`guided steps drive the Focus screen at ${vp.w}x${vp.h}`, async ({ context, page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
    await openFreshUnframedDraft(context, page);

    // Step 1: one instruction, box pulses, everything locked.
    await expect(page.locator(GUIDE)).toHaveText('Drag your box onto your player.');
    await expect(page.locator('[data-testid="focus-video-stage"] .animate-pulse').first()).toBeVisible();
    await expect(page.locator(TRIM)).toBeDisabled();
    await expect(page.locator(PREVIEW)).toBeDisabled();
    await expect(page.locator(GENERATE).first()).toBeDisabled();
    await expect(page.locator('[data-testid="set-focus-point-button"]')).toHaveCount(0);
    await saveEvidence(page, `guided-step1-${vp.w}x${vp.h}`);

    await dragBox(page);

    // Step 2: play pulses.
    await expect(page.locator(GUIDE)).toHaveText('Play the video.');
    await expect(page.locator('button[title="Play"].animate-pulse')).toBeVisible();
    await expect(page.locator(TRIM)).toBeDisabled();
    await saveEvidence(page, `guided-step2-${vp.w}x${vp.h}`);

    await page.locator('button[title="Play"]').click();

    // Step 3: keep the box on the player; all three unlock together.
    await expect(page.locator(GUIDE)).toHaveText('Keep the box around your player.');
    await expect(page.locator(TRIM)).toBeEnabled();
    await expect(page.locator(PREVIEW)).toBeEnabled();
    await expect(page.locator(GENERATE).first()).toBeEnabled();
    await saveEvidence(page, `guided-step3-${vp.w}x${vp.h}`);

    // Trim and SlowMo swaps the guide; pressing it again returns.
    await page.locator(TRIM).click();
    await expect(page.locator(GUIDE)).toContainText(/split your clip/i);
    await expect(page.locator('[data-trim-guide="split"]')).toHaveCount(1);
    await saveEvidence(page, `guided-trim-${vp.w}x${vp.h}`);
    await page.locator(TRIM).click();
    await expect(page.locator(GUIDE)).toHaveText('Keep the box around your player.');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'no horizontal overflow').toBeLessThanOrEqual(0);
  });
}
