import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T5205 — REAL BROWSER (chromium) proof of the intro card editor's pre-contract
 * surface: the pointer/visual behaviour jsdom passes falsely (photo drag + zoom,
 * aspect preview toggle, slot selection, live composition, treatment
 * independence).
 *
 * Driven through a dev-only harness (/introcarddiag.html) that mounts the REAL
 * IntroCardEditorContainer + Stage + Rail + shared TextSpecEditor on the REAL
 * Zustand stores with only network actions stubbed (no backend in the sandbox —
 * same constraint + precedent as T5643/T5610). See src/introcarddiag/main.jsx.
 *
 * A full loginAsRealUser live-drive was NOT possible here (no backend/Postgres in
 * the container); this harness is the codebase's established substitute and
 * exercises the real components with real Tailwind + real geometry.
 *
 * Acceptance-criterion map (task doc T5205), buildable-now subset:
 *   AC "no template picker; ticking facts re-composes live"      -> test 2
 *   AC "treatment changes look, NOT composition; 3rd fact vice versa" -> test 2
 *   AC "removing photo -> title-only; re-adding restores"        -> test 2
 *   AC "ticked-but-unfilled fact prompts inline"                 -> test 3
 *   AC "photo drag + zoom; same setting frames 9:16 AND 16:9"    -> test 4
 *   AC "select a slot and change font/size/colour/align live"    -> test 5
 * (slot geometry + motion preview await the T5210 contract and are out of scope.)
 *
 * Run: cd src/frontend && npx playwright test e2e/T5205-card-editor.qa.spec.js
 */

const HARNESS = '/introcarddiag.html';

const PREVIEW = '[data-composition]';
const COMP_LABEL = '[data-testid="composition-label"]';
const DRAG = '[data-testid="intro-photo-drag"]';

test.describe('T5205 intro card editor (real browser)', () => {
  skipOnDeployedTarget(test, 'harness imports Vite-dev source; local only');

  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS);
    await page.waitForSelector(PREVIEW);
  });

  test('1: renders the editor stage + rail (happy path)', async ({ page }) => {
    await expect(page.locator(PREVIEW)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Motion preview' })).toBeVisible();
    await expect(page.getByText('Anyone with the share link can see this card')).toBeVisible();
    await saveEvidence(page, 'T5205-01-happy-path');
  });

  test('2: ticking facts re-composes live; treatment is independent', async ({ page }) => {
    const label = page.locator(COMP_LABEL);
    // photo + 1 fact (position) -> hero
    await expect(label).toHaveText('hero');

    // + team -> broadcast, + class -> recruiting (live, no template picker)
    await page.locator('label', { hasText: 'Team' }).locator('input[type=checkbox]').check();
    await expect(label).toHaveText('broadcast');
    await page.locator('label', { hasText: 'Class' }).locator('input[type=checkbox]').check();
    await expect(label).toHaveText('recruiting');
    await saveEvidence(page, 'T5205-02a-recruiting');

    // Treatment changes the LOOK but not the composition (3rd fact stayed put).
    await page.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-treatment', 'dark');
    await expect(label).toHaveText('recruiting'); // unchanged by treatment

    // Untick back to one fact -> hero (look unchanged: still dark).
    await page.locator('label', { hasText: 'Team' }).locator('input[type=checkbox]').uncheck();
    await page.locator('label', { hasText: 'Class' }).locator('input[type=checkbox]').uncheck();
    await expect(label).toHaveText('hero');
    await expect(page.locator(PREVIEW)).toHaveAttribute('data-treatment', 'dark');

    // Remove the photo -> title-only; re-add -> fact-driven composition returns.
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(label).toHaveText('title-only');
    await page.getByRole('button', { name: 'Use profile photo' }).click();
    await expect(label).toHaveText('hero');
    await saveEvidence(page, 'T5205-02b-photo-toggle');
  });

  test('3: a ticked-but-unfilled fact prompts inline (never a silent gap)', async ({ page }) => {
    // "class" is empty on the mock profile. Ticking it must surface a prompt.
    await page.locator('label', { hasText: 'Class' }).locator('input[type=checkbox]').check();
    await expect(page.getByText('Add it').first()).toBeVisible();
    await saveEvidence(page, 'T5205-03-unfilled-prompt');
  });

  test('4: photo drag + zoom; one stored setting frames BOTH aspects', async ({ page }) => {
    const img = page.locator(`${PREVIEW} img`);
    const before = await img.evaluate((el) => el.style.objectPosition);
    expect(before).toBe('50% 50%');

    // Drag the photo RIGHT -> reveals more of its LEFT -> focal x decreases.
    const box = await page.locator(DRAG).boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const dx = 60;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy, { steps: 10 });
    await page.mouse.up();

    const afterDragPortrait = await img.evaluate((el) => el.style.objectPosition);
    const xPct = parseFloat(afterDragPortrait.split('%')[0]);
    // Expected from the REAL box width (never hard-coded page coords).
    const expected = (0.5 - dx / box.width) * 100;
    expect(xPct).toBeLessThan(50);
    expect(Math.abs(xPct - expected)).toBeLessThan(3);
    await saveEvidence(page, 'T5205-04a-drag-portrait');

    // The SAME stored focal must frame the 16:9 preview identically (the whole
    // point of a focal point over a crop rect).
    await page.getByRole('button', { name: '16:9' }).click();
    await page.waitForTimeout(50);
    const landscapePos = await page.locator(`${PREVIEW} img`).evaluate((el) => el.style.objectPosition);
    expect(landscapePos).toBe(afterDragPortrait);
    await saveEvidence(page, 'T5205-04b-same-focal-landscape');

    // Zoom in and release -> the image scales.
    await page.getByRole('button', { name: '9:16' }).click();
    const zoom = page.getByLabel('Zoom');
    await zoom.focus();
    await zoom.fill('2');
    await zoom.dispatchEvent('pointerup');
    const transform = await page.locator(`${PREVIEW} img`).evaluate((el) => el.style.transform);
    expect(transform).toContain('scale(2');
    await saveEvidence(page, 'T5205-04c-zoom');
  });

  test('5: selecting a slot and restyling it updates live', async ({ page }) => {
    // Title slot is selected by default; XL size preset reads active after click.
    const xl = page.getByLabel('Size XL');
    await xl.click();
    await expect(xl).toHaveAttribute('aria-pressed', 'true');

    // Show a fact, select its slot, and confirm the slot button is selected.
    await page.locator('label', { hasText: 'Team' }).locator('input[type=checkbox]').check();
    const teamSlot = page.getByRole('button', { name: 'Team', exact: true });
    await teamSlot.click();
    await expect(teamSlot).toHaveAttribute('aria-pressed', 'true');

    // A colour swatch applies to the selected slot.
    await page.getByLabel('Color #FFD66B').click();
    await expect(page.getByLabel('Color #FFD66B')).toHaveAttribute('aria-pressed', 'true');
    await saveEvidence(page, 'T5205-05-slot-styling');
  });
});
