/**
 * T9610 — Teach framing with a visible sequence and a preview before a paid render.
 *
 * Live-drives the Focus editor as the seeded real account and pins the parent-facing
 * teaching added by this task, saving a screenshot per acceptance criterion to
 * /workspace/qa:
 *   - The three-step framing guide is visible with no hover help required, in plain
 *     language (no "keyframe"), naming the primitive "Focus point".
 *   - It collapses to a prominent "press play to preview" prompt (the movement preview
 *     is ordinary playback — the crop box already follows the interpolated path).
 *   - Aspect ratio still reads "Portrait (9:16)" / "Landscape (16:9)" (T9550, verify).
 *   - Current speed reads as a settled STATE ("Normal speed") on the timeline segment.
 *
 * NON-MUTATING: opens a draft, toggles the guide, switches the settings tab,
 * screenshots. Never exports. Skips loudly when the account lacks a Focus-openable
 * draft (repo honest-skip convention).
 *
 * REAL-BROWSER ONLY (Playwright). Run: bash scripts/dev-verify.sh e2e/T9610-teach-framing.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { openFramingDraft } from './helpers/framingDraft.js';
import { saveEvidence, QA_DIR } from './helpers/qa.js';

const AUDIT_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const AUDIT_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';

test.describe('T9610 teach framing (desktop)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
  });

  test('framing guide teaches the sequence and prompts a play-to-preview; speed reads as a state', async ({ page }) => {
    let opened = true;
    try { await openFramingDraft(page); }
    catch (e) { opened = false; test.skip(true, `no Focus-openable draft: ${e.message}`); }
    if (!opened) return;

    const guide = page.getByTestId('framing-instructions');
    const toggle = page.getByTestId('framing-instructions-toggle');
    await expect(guide).toBeVisible();

    // The guide never uses "keyframe" in its parent-facing copy.
    expect((await guide.textContent()).toLowerCase()).not.toContain('keyframe');

    // Normalize to the EXPANDED state so we can assert the taught sequence regardless
    // of how many focus points this clip already has.
    if ((await toggle.getAttribute('aria-expanded')) === 'false') {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Criterion 1: the three-step visible instruction, in plain language.
    await expect(guide.getByText(/move the box over your player/i)).toBeVisible();
    await expect(guide.getByText(/step forward in the video/i)).toBeVisible();
    await expect(guide.getByText(/move the box again to follow them/i)).toBeVisible();
    // Names the primitive with the shared "Focus point" noun.
    await expect(guide.getByText(/focus point/i).first()).toBeVisible();
    await saveEvidence(page, 'T9610-crit1-three-step-guide-expanded');

    // Criterion 2 (preview): the prompt points at ordinary playback, before export.
    await expect(page.getByTestId('framing-preview-prompt')).toContainText(/press play to preview/i);

    // Collapse it: the preview prompt stays prominent in the collapsed header.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText(/press play to preview/i);
    await saveEvidence(page, 'T9610-crit2-collapsed-preview-prompt');

    // Criterion 3 (verify T9550): descriptive aspect label stays visible.
    await page.getByTestId('settings-tab-settings').click();
    const panel = page.getByTestId('settings-panel-settings');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/(Portrait|Landscape) \((9:16|16:9)\)/).first()).toBeVisible();
    await saveEvidence(page, 'T9610-crit3-aspect-portrait-landscape');

    // Criterion 4: current speed reads as a settled STATE on the timeline segment.
    const speedState = page.getByText('Normal speed').first();
    await expect(speedState).toBeVisible();
    // The timeline sits below the video, behind the sticky export band — scroll it
    // into view and capture the segment track region so the readout is visible in the
    // evidence (a full-page shot with a sticky footer hides it).
    await speedState.scrollIntoViewIfNeeded();
    const track = page.locator('.segment-track').first();
    await track.screenshot({ path: `${QA_DIR}/T9610-crit4-speed-as-state.png` });
    console.log('[qa] evidence saved: T9610-crit4-speed-as-state.png');
  });
});
