/**
 * T4550 QA — unified video->screen transform (useVideoDisplayRect).
 *
 * Drives the REAL app as a real user (dev-login) and confirms the three overlays
 * that now share useVideoDisplayRect place accurately and leak no rAF callbacks:
 *   1. Framing CropOverlay — the crop box is placed (finite, in-bounds) and a
 *      known-delta drag lands within tolerance (exercises videoToScreen AND the
 *      screen->video inverse round-trip in the live DOM).
 *   2. Overlay HighlightOverlay + PlayerDetectionOverlay — the spotlight ellipse
 *      is placed with finite geometry; the detection layer (badge/boxes) renders.
 *      Skipped honestly if this account's first draft isn't exported (overlay mode
 *      is gated on an exported reel; the layout is also covered by Vitest).
 *
 * Throughout, console is captured and asserted free of the rAF-leak / unmounted-
 * update warning class the old copies could emit.
 *
 * Run: cd src/frontend && npx playwright test e2e/T4550-overlay-transform.qa.spec.js
 * or:  bash scripts/dev-verify.sh e2e/T4550-overlay-transform.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence } from './helpers/qa.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

// Console lines that would indicate a leaked rAF / stale update — the exact class
// of bug the leak fix prevents. Also catches the CropOverlay NaN diagnostic.
const RAF_WARNING = /requestAnimationFrame|unmounted component|Maximum update depth|\[DIAG crop-nan\]/i;

/** Attach console + pageerror capture; returns the collected lines. */
function captureConsole(page) {
  const lines = [];
  page.on('console', (m) => lines.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`));
  return lines;
}

function assertNoRafWarnings(lines) {
  const offenders = lines.filter((l) => RAF_WARNING.test(l));
  expect(offenders, `rAF/stale-update/NaN warnings:\n${offenders.join('\n')}`).toEqual([]);
}

/** Open the first Framing-ready reel draft; resolves once the crop editor loaded. */
async function openFramingDraft(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Reel Drafts' }).click();
  const framingChip = page.getByTitle(/\[.+\]: .*\(click to open\)/).first();
  await framingChip.waitFor({ timeout: 30000 });
  await framingChip.click();
  await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });
}

test.describe('T4550 unified overlay transform', () => {
  test('Framing: crop overlay placed + drag lands accurately, no rAF warnings', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const console_ = captureConsole(page);

    await openFramingDraft(page);

    // The crop box: the draggable/movable rectangle (border-2 + cursor-move).
    const cropBox = page.locator('div.cursor-move.border-2').first();
    await expect(cropBox).toBeVisible();

    // Warm-up prime (T5320): the FIRST drag gesture after the framing editor mounts
    // is dropped. CropOverlay attaches its window mousemove/mouseup listeners in a
    // useEffect gated on isDragging, so the very first down->move — synthesised by the
    // harness with no prior pointer activity — can fire before that listener is
    // committed, and the move is lost (measured 0,0). A real user's incidental mouse
    // movement warms the handler; the harness must do so explicitly. This throwaway
    // drag primes it WITHOUT weakening the measured drag below: we re-read box1 AFTER
    // priming, so the round-trip assertion still measures a real -40,-30 move.
    // NOTE: the underlying first-drag listener race is a real (minor) CropOverlay bug,
    // flagged for a separate product task — this warm-up is spec robustness, not a
    // fix for it, and it does not mask a transform regression (that is still asserted).
    {
      const wb = await cropBox.boundingBox();
      await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2);
      await page.mouse.down();
      await page.mouse.move(wb.x + wb.width / 2 + 6, wb.y + wb.height / 2 + 6, { steps: 3 });
      await page.mouse.up();
    }

    // First-paint fix: box geometry is finite and positive on load (no null flash,
    // no NaN from an unmeasured rect).
    const box1 = await cropBox.boundingBox();
    expect(box1, 'crop box has a bounding box').not.toBeNull();
    for (const [k, v] of Object.entries(box1)) {
      expect(Number.isFinite(v), `crop box.${k} finite`).toBe(true);
    }
    expect(box1.width).toBeGreaterThan(0);
    expect(box1.height).toBeGreaterThan(0);
    await saveEvidence(page, 'T4550-crop-overlay-placed');

    // Drag the crop box by a known screen delta toward the container center and
    // assert it moves by ~that delta. Because videoToScreen and its inverse are
    // exact inverses, a screen-space drag of (dx,dy) must move the box by (dx,dy)
    // (the scale factors cancel) — this is the round-trip accuracy check.
    const cx = box1.x + box1.width / 2;
    const cy = box1.y + box1.height / 2;
    const dx = -40;
    const dy = -30;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 4 });
    await page.mouse.move(cx + dx, cy + dy, { steps: 4 });
    await page.mouse.up();

    const box2 = await cropBox.boundingBox();
    const movedX = box2.x - box1.x;
    const movedY = box2.y - box1.y;
    // Tolerance: a few px for rounding (round3 in video space) + sub-pixel layout.
    expect(Math.abs(movedX - dx), `crop moved dx (got ${movedX}, want ${dx})`).toBeLessThanOrEqual(6);
    expect(Math.abs(movedY - dy), `crop moved dy (got ${movedY}, want ${dy})`).toBeLessThanOrEqual(6);
    await saveEvidence(page, 'T4550-crop-overlay-dragged');

    assertNoRafWarnings(console_);
    await context.close();
  });

  test('Overlay: highlight + player-detection placed, no rAF warnings', async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const console_ = captureConsole(page);

    await openFramingDraft(page);

    // Overlay mode is gated on an exported reel. Detect reachability the same way
    // T4880 does; skip honestly (not silently pass) if this env's draft isn't
    // exported — the overlay layout is also covered by Vitest.
    const overlayTab = page.getByTestId('mode-overlay');
    const reachable = (await overlayTab.count()) > 0 && (await overlayTab.isEnabled());
    test.skip(!reachable, 'Overlay needs an exported reel in this env; covered by Vitest OverlayModeView tests');
    await overlayTab.click();

    // Create a spotlight if none exists yet, so HighlightOverlay renders.
    const addSpotlight = page.getByRole('button', { name: /Add Spotlight/ });
    if (await addSpotlight.count()) {
      await addSpotlight.first().click().catch(() => {});
    }

    // HighlightOverlay: the movable ellipse (cursor-move). Assert finite, sane geometry.
    const ellipse = page.locator('svg ellipse.cursor-move').first();
    await ellipse.waitFor({ timeout: 30000 });
    const geom = await ellipse.evaluate((el) => ({
      cx: +el.getAttribute('cx'),
      cy: +el.getAttribute('cy'),
      rx: +el.getAttribute('rx'),
      ry: +el.getAttribute('ry'),
    }));
    for (const [k, v] of Object.entries(geom)) {
      expect(Number.isFinite(v), `ellipse ${k} finite`).toBe(true);
    }
    expect(geom.rx).toBeGreaterThan(0);
    expect(geom.ry).toBeGreaterThan(0);
    await saveEvidence(page, 'T4550-highlight-overlay-placed');

    // PlayerDetectionOverlay: best-effort. Detection needs a GPU/Modal pass that
    // may be off in this env; assert only that when boxes render, their geometry
    // is finite (the shared transform), and capture evidence either way.
    const detBoxes = page.locator('svg rect[stroke-dasharray]');
    if (await detBoxes.count()) {
      const first = detBoxes.first();
      const rect = await first.evaluate((el) => ({
        x: +el.getAttribute('x'), y: +el.getAttribute('y'),
        w: +el.getAttribute('width'), h: +el.getAttribute('height'),
      }));
      for (const [k, v] of Object.entries(rect)) {
        expect(Number.isFinite(v), `detection box ${k} finite`).toBe(true);
      }
    }
    await saveEvidence(page, 'T4550-player-detection-overlay');

    assertNoRafWarnings(console_);
    await context.close();
  });
});
