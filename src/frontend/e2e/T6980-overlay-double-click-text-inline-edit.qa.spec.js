import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T6980 -- REAL BROWSER (chromium) proof that double-click (desktop) /
 * double-tap (touch, <=300ms two-tap) on an editable Overlay text element
 * enters INLINE canvas edit + syncs live with the Text-tab panel input,
 * through the ONE existing debounced `update_text_spec` write path -- per
 * the approved design (docs/plans/tasks/T6980-design.md).
 *
 * Verified against the REAL <TextOverlayPreview> + REAL <TextManagementPanel>
 * + REAL useTextOverlays hook via the dev-only /textpreviewdiag.html harness
 * (same harness T6720/T6880 use), extended for T6980 with:
 *  - `inlineEditingElementId`/`beginInlineEdit`/`endInlineEdit` read off the
 *    real hook and exposed via `data-inline-editing` on the status div,
 *  - the REAL `<TextManagementPanel>` mounted alongside the canvas (not a
 *    stand-in input) -- this is load-bearing: a stub input here would not
 *    exercise the panel's real focus/scroll/expand effect, which is exactly
 *    where a canvas-vs-panel focus race lived (reviewer round 1 finding;
 *    fixed by making the panel yield focus to an already-focused input).
 *
 * jsdom gives false confidence for pointer/focus/dblclick timing (T5380
 * precedent); this is the required real-browser proof.
 *
 * Run: cd src/frontend && npx playwright test e2e/T6980-overlay-double-click-text-inline-edit.qa.spec.js
 */

const HARNESS = '/textpreviewdiag.html';
const STATUS = '[data-testid="status"]';
const ELEMENT = '[data-testid^="text-preview-element-"]';
const FRAME = '[data-testid^="text-drag-frame-"]';
const PANEL_INPUT = '[data-testid="text-spec-text-input"]';
// T6980 design §3.4: the transparent canvas <input> the implementor adds,
// rendered when inlineEditingElementId === element.id. Not yet in
// TextOverlayPreview.jsx -- selector is the CONTRACT the implementor's
// render must satisfy (keyed by element id, same convention as
// text-preview-element-{id} / text-drag-frame-{id}).
const canvasEditInput = (id) => `[data-testid="text-inline-edit-${id}"]`;

async function readStatus(page) {
  const el = page.locator(STATUS);
  const text = await el.textContent();
  const idMatch = text.match(/selectedId=(\S+)/);
  return {
    selectedId: idMatch ? idMatch[1] : null,
    inlineEditing: await el.getAttribute('data-inline-editing'),
  };
}

async function waitForElements(page) {
  await expect(page.locator(ELEMENT)).toHaveCount(2);
}

async function elementCenter(page, testid) {
  const b = await page.locator(testid).boundingBox();
  if (!b) throw new Error(`${testid} not visible`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test.describe('T6980 -- double-click / double-tap a text element enters inline edit + syncs with the panel', () => {
  test.beforeEach(async ({ page }) => {
    skipOnDeployedTarget(test, 'drives the dev-only /textpreviewdiag.html harness page, which does not exist in a production BUILD');
    await page.goto(HARNESS);
    await waitForElements(page);
  });

  test('baseline: nothing is inline-editing on load', async ({ page }) => {
    const status = await readStatus(page);
    expect(status.inlineEditing, 'no element is being inline-edited at rest').toBe('none');
  });

  // (f) single-click still only selects (no editor), drag still repositions
  // (T6720 unchanged) -- this is a REAL assertion today: T6720's existing
  // spec already proves drag; this spec adds the "single click never enters
  // inline edit" half, which is new T6980-specific behavior to pin.
  test('(f) a single click selects only -- does NOT enter inline edit', async ({ page }) => {
    const el2Id = await page.locator(STATUS).getAttribute('data-el2-id');
    const target = page.locator(`[data-testid="text-select-target-${el2Id}"]`);
    await target.click();

    const status = await readStatus(page);
    expect(status.selectedId, 'click selects the element').toBe(el2Id);
    expect(status.inlineEditing, 'a single click never starts inline edit').toBe('none');
    await expect(page.locator(canvasEditInput(el2Id)), 'no inline editor rendered for a single click').toHaveCount(0);
  });

  // (a) double-click a text element on desktop -> Text tab active (harness is
  // Text-tab-only, so that half is structural) + canvas input rendered +
  // focused. test.fixme: TextOverlayPreview has no onDoubleClick hit-test
  // yet (design §3.4) -- un-skip once it lands.
  test('(a) double-click on desktop enters inline edit: canvas input focused, inlineEditingElementId set', async ({ page }) => {
    const el2Id = await page.locator(STATUS).getAttribute('data-el2-id');
    const c = await elementCenter(page, `[data-testid="text-select-target-${el2Id}"]`);
    await page.mouse.dblclick(c.x, c.y);

    const status = await readStatus(page);
    expect(status.selectedId, 'double-click also selects the element').toBe(el2Id);
    expect(status.inlineEditing, 'double-click sets inlineEditingElementId to the target element').toBe(el2Id);

    const input = page.locator(canvasEditInput(el2Id));
    await expect(input, 'transparent canvas input rendered over the element').toBeVisible();
    await expect(input, 'canvas input is focused (caret ready)').toBeFocused();
    await saveEvidence(page, 'T6980-criterion-a-doubleclick-enters-inline-edit');
  });

  // (b) type in canvas input -> panel input value updates live (single write
  // path: onEditText -> updateElementSpec -> re-render of BOTH inputs).
  test('(b) typing in the canvas inline input live-updates the panel input', async ({ page }) => {
    const el2Id = await page.locator(STATUS).getAttribute('data-el2-id');
    const c = await elementCenter(page, `[data-testid="text-select-target-${el2Id}"]`);
    await page.mouse.dblclick(c.x, c.y);

    const canvasInput = page.locator(canvasEditInput(el2Id));
    await canvasInput.fill('');
    await canvasInput.type('HELLO');

    await expect(page.locator(PANEL_INPUT), 'panel input mirrors canvas keystrokes live').toHaveValue('HELLO');
    await saveEvidence(page, 'T6980-criterion-b-canvas-to-panel-sync');
  });

  // (c) type in panel input -> canvas RichText updates live. The panel
  // input already exists in the harness TODAY (wired to onEditText), so the
  // "panel -> RichText" half is assertable now; only gating on entering
  // inline edit via double-click first is fixme (per (a)).
  test('(c) typing in the panel input live-updates the canvas RichText', async ({ page }) => {
    const el2Id = await page.locator(STATUS).getAttribute('data-el2-id');
    const c = await elementCenter(page, `[data-testid="text-select-target-${el2Id}"]`);
    await page.mouse.dblclick(c.x, c.y);

    await page.locator(PANEL_INPUT).fill('WORLD');

    const richText = page.locator(`[data-testid="text-preview-element-${el2Id}"] span`).first();
    await expect(richText, 'canvas RichText reflects panel keystrokes live').toContainText('WORLD');
    await saveEvidence(page, 'T6980-criterion-c-panel-to-canvas-sync');
  });

  // (d) Escape ends edit and text persists (commit semantics per design
  // Decision #7: Escape COMMITS, keeps last-typed text -- no revert).
  test('(d) Escape ends inline edit and keeps the last-typed text (commits, does not revert)', async ({ page }) => {
    const el2Id = await page.locator(STATUS).getAttribute('data-el2-id');
    const c = await elementCenter(page, `[data-testid="text-select-target-${el2Id}"]`);
    await page.mouse.dblclick(c.x, c.y);

    const canvasInput = page.locator(canvasEditInput(el2Id));
    await canvasInput.fill('');
    await canvasInput.type('KEEP ME');
    await canvasInput.press('Escape');

    const status = await readStatus(page);
    expect(status.inlineEditing, 'Escape ends inline edit').toBe('none');
    await expect(page.locator(canvasEditInput(el2Id)), 'canvas input unmounts after Escape').toHaveCount(0);
    await expect(page.locator(PANEL_INPUT), 'text is KEPT, not reverted').toHaveValue('KEEP ME');
    await saveEvidence(page, 'T6980-criterion-d-escape-commits-no-revert');
  });

  // (f, continued) drag still repositions -- reruns the T6720 gesture through
  // the SAME harness after T6980's dblclick detector lands, to prove the
  // dblclick affordance and the existing drag path don't collide (design's
  // "Drag regression (T6720)" landmine). Real assertion once (a) lands;
  // fixme'd together since it depends on the same double-click entry point
  // existing without breaking a subsequent plain drag on a DIFFERENT element.
  test('(f) drag-to-reposition on the SELECTED element is unaffected by the new dblclick detector', async ({ page }) => {
    await expect(page.locator(FRAME)).toBeVisible();
    const before = await readStatus(page);
    const frameBox = await page.locator(FRAME).boundingBox();
    const c = { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 };

    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 40, c.y + 30, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(60);

    const after = await readStatus(page);
    expect(after.selectedId, 'the dragged element stays selected (T6720 unchanged)').toBe(before.selectedId);
    expect(after.inlineEditing, 'a drag alone never enters inline edit').toBe('none');
  });
});

// Touch double-tap needs a REAL touch-capable context -- `page.touchscreen` throws
// "hasTouch must be enabled" against the default desktop-chrome project. Separate
// describe block + `test.use` is the established pattern for touch specs in this
// suite (see T5644/T5225/T5647/T6610); the harness itself is a fixed-px layout
// (like regiondiag's), so the narrower viewport doesn't change its geometry.
test.describe('T6980 -- touch double-tap (coarse pointer)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

  test.beforeEach(async ({ page }) => {
    skipOnDeployedTarget(test, 'drives the dev-only /textpreviewdiag.html harness page, which does not exist in a production BUILD');
    await page.goto(HARNESS);
    await waitForElements(page);
  });

  // (e) double-tap on a touch-emulated context enters edit -- two taps on the
  // SAME element within <=300ms.
  test('(e) double-tap (touch, <=300ms) enters inline edit', async ({ page }) => {
    const el2Id = await page.locator(STATUS).getAttribute('data-el2-id');
    const c = await elementCenter(page, `[data-testid="text-select-target-${el2Id}"]`);

    // Two taps within DOUBLE_TAP_MS (~300ms per design §3.4).
    await page.touchscreen.tap(c.x, c.y);
    await page.waitForTimeout(120);
    await page.touchscreen.tap(c.x, c.y);

    const status = await readStatus(page);
    expect(status.inlineEditing, 'a fast two-tap on the same element enters inline edit').toBe(el2Id);
    await saveEvidence(page, 'T6980-criterion-e-doubletap-enters-inline-edit');
  });

  test('(e-neg) two taps SLOWER than the double-tap window do NOT enter inline edit', async ({ page }) => {
    const el2Id = await page.locator(STATUS).getAttribute('data-el2-id');
    const c = await elementCenter(page, `[data-testid="text-select-target-${el2Id}"]`);

    await page.touchscreen.tap(c.x, c.y);
    await page.waitForTimeout(500); // past the ~300ms window
    await page.touchscreen.tap(c.x, c.y);

    const status = await readStatus(page);
    expect(status.inlineEditing, 'two slow taps are two separate selects, not a double-tap').toBe('none');
  });
});
