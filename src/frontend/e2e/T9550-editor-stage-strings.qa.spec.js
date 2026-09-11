/**
 * T9550 — Editor-stage inner strings (Shared Vocabulary epic, N16-N32).
 *
 * Live-drives BOTH editor stages as the seeded real account and asserts the
 * renamed, parent-facing vocabulary is what actually renders (task acceptance
 * criteria 1-4), saving a screenshot per criterion to /workspace/qa.
 *
 * What it pins:
 *  - Focus (AI Focus mode name UNCHANGED) → Settings tab → the aspect-ratio row
 *    reads "Portrait (9:16)" / "Landscape (16:9)" (N32: word alongside the ratio).
 *  - Overlay (Spotlight mode name UNCHANGED) → Spotlight tab → "Spotlight color"
 *    (N29, was "Highlight Color"); when a spotlight is enabled, "Outline
 *    thickness" / "Spotlight fill" / "Dim background" (N30).
 *  - Overlay → the third settings tab is labelled "Cover image" (N31, was
 *    "Thumbnail"); its panel copy is cover-image language.
 *  - The mode names "AI Focus" and "Spotlight" still appear (override held).
 *
 * NON-MUTATING: opens drafts, switches settings tabs, screenshots. Never exports,
 * never clicks a CTA. Skips loudly (repo honest-skip convention) when the account
 * lacks a Focus-/Overlay-openable draft.
 *
 * REAL-BROWSER ONLY (Playwright). Target: local dev stack (scripts/dev-verify.sh)
 * or deployed staging (playwright.config.js). Run:
 *   bash scripts/dev-verify.sh e2e/T9550-editor-stage-strings.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { openFramingDraft } from './helpers/framingDraft.js';
import { openLoadableOverlayDraft } from './helpers/overlayDraft.js';
import { saveEvidence } from './helpers/qa.js';

const AUDIT_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const AUDIT_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';

test.describe('T9550 editor-stage vocabulary (desktop)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
  });

  test('Focus Settings tab: aspect ratio shows the descriptive word alongside the number (N32); AI Focus name held', async ({ page }) => {
    let opened = true;
    try { await openFramingDraft(page); }
    catch (e) { opened = false; test.skip(true, `no Focus-openable draft: ${e.message}`); }
    if (!opened) return;

    // AI Focus mode name is unchanged (override) — it labels the mode switcher.
    await expect(page.getByText('AI Focus', { exact: false }).first()).toBeVisible();

    await page.getByTestId('settings-tab-settings').click();
    const panel = page.getByTestId('settings-panel-settings');
    await expect(panel).toBeVisible();

    // N32: "Portrait (9:16)" or "Landscape (16:9)" — word AND number, never bare.
    await expect(panel.getByText(/(Portrait|Landscape) \((9:16|16:9)\)/).first()).toBeVisible();
    await saveEvidence(page, 'T9550-focus-aspect-ratio-portrait-landscape');
  });

  test('Overlay Spotlight tab: styling controls read in plain words (N29/N30); Spotlight name held', async ({ page }) => {
    const res = await openLoadableOverlayDraft(page);
    test.skip(!res?.ok, `no Overlay-openable draft: ${res?.reason || 'unknown'}`);

    // Spotlight mode name is unchanged (override).
    await expect(page.getByText('Spotlight', { exact: false }).first()).toBeVisible();

    await page.getByTestId('settings-tab-overlay').click();
    const panel = page.getByTestId('settings-panel-overlay');
    await expect(panel).toBeVisible();

    // N29: "Spotlight color" replaced "Highlight Color"; the brand/generic mix is gone.
    await expect(panel.getByText('Spotlight color', { exact: false }).first()).toBeVisible();
    await expect(panel.getByText('Highlight Color', { exact: false })).toHaveCount(0);
    // N30 styling sliders only render when a spotlight is enabled on the timeline.
    if (await panel.getByText('Outline thickness', { exact: false }).count()) {
      await expect(panel.getByText('Outline thickness', { exact: false }).first()).toBeVisible();
      await expect(panel.getByText('Spotlight fill', { exact: false }).first()).toBeVisible();
      await expect(panel.getByText('Dim background', { exact: false }).first()).toBeVisible();
      await expect(panel.getByText('Stroke Width', { exact: false })).toHaveCount(0);
      await expect(panel.getByText('Outside Dim', { exact: false })).toHaveCount(0);
    }
    await saveEvidence(page, 'T9550-overlay-spotlight-styling');
  });

  test('Overlay Cover image tab (N31): the tab is "Cover image", the panel uses cover-image language', async ({ page }) => {
    const res = await openLoadableOverlayDraft(page);
    test.skip(!res?.ok, `no Overlay-openable draft: ${res?.reason || 'unknown'}`);

    const coverTab = page.getByTestId('settings-tab-thumbnail'); // id stays internal
    await expect(coverTab).toContainText('Cover image');
    await coverTab.click();
    const panel = page.getByTestId('settings-panel-thumbnail');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Cover image', { exact: false }).first()).toBeVisible();
    await expect(panel.getByText(/cover frame/i).first()).toBeVisible();
    // "Thumbnail" is gone from the parent-facing copy on this panel.
    await expect(panel.getByText('Thumbnail', { exact: false })).toHaveCount(0);
    await saveEvidence(page, 'T9550-overlay-cover-image-tab');
  });
});
