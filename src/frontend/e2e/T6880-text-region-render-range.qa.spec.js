import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T6880 -- REAL BROWSER (chromium) proof that the SELECTED-region exception in
 * the Overlay text preview is now HONEST and NARROW.
 *
 * The reported bug: with the playhead dragged PAST a text region's end handle,
 * the preview canvas still burnt in that region's text ("blah blah") while the
 * Text side panel correctly said "No text region under the playhead" -- the two
 * surfaces disagreed, and playback showed out-of-range text across the clip
 * (preview lying about export, which burns strict windows).
 *
 * Fix (T6880 option 1): a selected region whose range does NOT contain the
 * playhead renders ONLY while the Text tab is active AND playback is PAUSED, as
 * a DIMMED editing ghost (data-ghost="true", reduced opacity) that can never be
 * mistaken for real burn-in -- and NEVER during playback. Real output (playhead
 * in range) is unchanged. Verified against the REAL <TextOverlayPreview> via the
 * dev-only /textpreviewdiag.html harness (region window [2,4]; in-range=3s,
 * out-of-range=8s).
 *
 * jsdom covers the pure render-gate logic (TextOverlayPreview.test); this is the
 * required real-browser proof for a surface known to mislead under jsdom
 * (T5380/T6730).
 *
 * Run: cd src/frontend && npx playwright test e2e/T6880-text-region-render-range.qa.spec.js
 */

const HARNESS = '/textpreviewdiag.html';
const ELEMENT = '[data-testid^="text-preview-element-"]';
const GRAB_FRAME = '[data-testid^="text-drag-frame-"]';
// The harness's region contains TWO elements (element 1 + the T6720 round-2
// "SECOND" element), both in the SAME selected region -- so both render, and
// both share the region's real-output / ghost state.
const REGION_ELEMENT_COUNT = 2;

async function ghostFlags(page) {
  return page.locator(ELEMENT).evaluateAll((els) => els.map((el) => el.getAttribute('data-ghost')));
}
async function opacities(page) {
  return page.locator(ELEMENT).evaluateAll((els) => els.map((el) => Number(el.style.opacity || '1')));
}

test.describe('T6880 -- selected out-of-range text is a paused-only editing ghost', () => {
  test.beforeEach(async ({ page }) => {
    skipOnDeployedTarget(test, 'uses the dev-only /textpreviewdiag.html harness');
    await page.goto(HARNESS);
    // Wait until the harness has created + selected its region's elements (real
    // output at the default in-range playhead of 3s).
    await expect(page.locator(ELEMENT)).toHaveCount(REGION_ELEMENT_COUNT);
  });

  test('AC1: playhead IN range -> real burn-in output (full opacity, not a ghost)', async ({ page }) => {
    expect(await ghostFlags(page)).toEqual([null, null]); // neither element is a ghost
    expect(await opacities(page)).toEqual([1, 1]);
    await saveEvidence(page, 'T6880-AC1-inrange-real-output');
  });

  test('AC2: selected + out-of-range + PAUSED on Text tab -> dimmed editing ghost, still draggable', async ({ page }) => {
    await page.getByTestId('time-out').click(); // playhead -> 8s, past the region's [2,4] end
    await expect(page.locator(ELEMENT)).toHaveCount(REGION_ELEMENT_COUNT); // editing stays visible
    expect(await ghostFlags(page)).toEqual(['true', 'true']); // every element marked a ghost
    (await opacities(page)).forEach((o) => expect(o).toBeLessThan(1)); // visibly dimmed
    // T6720 interaction: the ghost must remain draggable while paused (only the
    // SELECTED element gets the grab frame).
    await expect(page.locator(GRAB_FRAME)).toHaveCount(1);
    await saveEvidence(page, 'T6880-AC2-outofrange-paused-ghost');
  });

  test('AC3: playback NEVER shows out-of-range text (the reported burn-in bug)', async ({ page }) => {
    await page.getByTestId('time-out').click();   // out of range
    await expect(page.locator(ELEMENT)).toHaveCount(REGION_ELEMENT_COUNT); // ghost while paused
    await page.getByTestId('toggle-play').click(); // press play
    await expect(page.locator(ELEMENT)).toHaveCount(0); // gone -- preview matches export
    await expect(page.locator(GRAB_FRAME)).toHaveCount(0);
    await saveEvidence(page, 'T6880-AC3-playback-hides-outofrange');
  });

  test('AC4: panel/canvas agreement -- out-of-range with the Text tab INACTIVE shows nothing', async ({ page }) => {
    await page.getByTestId('time-out').click();      // out of range
    await page.getByTestId('toggle-texttab').click(); // leave the Text tab (paused)
    // Panel would read "no text region under the playhead"; the canvas agrees --
    // no ghost when not actively editing on the Text tab.
    await expect(page.locator(ELEMENT)).toHaveCount(0);
    await saveEvidence(page, 'T6880-AC4-outofrange-tabinactive-hidden');
  });

  test('AC5: returning the playhead INTO range restores real output', async ({ page }) => {
    await page.getByTestId('time-out').click();
    await expect(page.locator(ELEMENT).first()).toHaveAttribute('data-ghost', 'true');
    await page.getByTestId('time-in').click(); // back into [2,4]
    await expect(page.locator(ELEMENT)).toHaveCount(REGION_ELEMENT_COUNT);
    expect(await ghostFlags(page)).toEqual([null, null]);
    expect(await opacities(page)).toEqual([1, 1]);
    await saveEvidence(page, 'T6880-AC5-back-in-range-real-output');
  });
});
