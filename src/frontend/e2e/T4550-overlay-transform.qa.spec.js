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
import { waitForRealVideoReady } from './helpers/videoRoute.js';
import { openLoadableOverlayDraft } from './helpers/overlayDraft.js';

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

test.describe('T4550 unified overlay transform @staging-gate', () => {
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

    // Gate on the REAL ready-signal before measuring (T6110). The crop box is VISIBLE
    // off `videoMetadata` while the <video> is still buffering — T6100 measured the crop
    // placeholder rendering at ~6.4s but the display rect only settling at ~7.37s, over a
    // stage still reading "Loading... / Connecting to server...". A drag in that window
    // maps through `videoToScreen` against a DEGENERATE rect and measures ~0. So wait
    // until the video can actually seek+play (readyState>=3 + seekable) => the display
    // rect is established. This is the fix for "acted on a placeholder"; it is NOT a
    // longer timeout (a ready video reaches this in a couple seconds), and if the video
    // never hydrates we SKIP LOUDLY naming hydration rather than assert a bogus drag.
    const framingReady = await waitForRealVideoReady(page, { minReadyState: 3 });
    test.skip(!framingReady.ready,
      `Framing video never hydrated, so the crop cannot be measured against a real display ` +
      `rect — this is a hydration gap, NOT a drag-accuracy failure: ${framingReady.reason}`);

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
    // Drag TOWARD the video center so the move always has headroom. A blind fixed
    // direction (the old hard-coded -40,-30) lands on `constrainCrop`'s clamp when the
    // fixture crop sits near an edge — the box can't move past the frame, so the axis
    // measures 0 and reads as a false "moved 0" failure (FIXTURE-CONTRACT T5320: the
    // seed does NOT promise a centered crop). Sign each axis inward from the box center.
    const videoBox = await page.locator('.video-container video').boundingBox();
    const vCenter = { x: videoBox.x + videoBox.width / 2, y: videoBox.y + videoBox.height / 2 };
    const dx = (cx > vCenter.x ? -1 : 1) * 40;
    const dy = (cy > vCenter.y ? -1 : 1) * 30;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 4 });
    await page.mouse.move(cx + dx, cy + dy, { steps: 4 });
    await page.mouse.up();

    const box2 = await cropBox.boundingBox();
    const movedX = box2.x - box1.x;
    const movedY = box2.y - box1.y;

    // T5380 first-drag guard, made HONEST (T6110). We only reach here AFTER the ready-gate
    // above, which rules out the "acted on a not-yet-hydrated placeholder" cause of a 0,0
    // measurement — that is what actually regressed on staging (2026-07-27) and sent triage
    // chasing a T5380 ghost, because the OLD comment claimed a 0,0 move meant the T5380
    // first-drag race had regressed. It had not: `attachDragListeners` is still called
    // synchronously from pointer-down on master. So a 0,0 first drag NOW, with a ready video,
    // is the genuine T5380 regression (window move/up listeners not attached synchronously on
    // pointer-down, dropping the very first down->move). Distinguish the two causes explicitly
    // so the failure message can never again point at the wrong one:
    const firstDragDropped = Math.abs(movedX) < 1 && Math.abs(movedY) < 1;
    expect(firstDragDropped,
      'first crop drag moved 0,0 despite a READY video (readyState>=3, seekable) — this is the ' +
      'T5380 first-drag regression (attachDragListeners not called synchronously from pointer-down), ' +
      'NOT a not-yet-hydrated stage (the ready-gate above already ruled that out)').toBe(false);

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

    // Open a draft that has reached Overlay AND whose working video actually STREAMS,
    // then gate on the real overlay ready-signal (T6110). The old path (open the framing
    // draft, switch to the overlay tab, click "Add Spotlight") had two defects on staging:
    // it could land on a draft whose working_video ref is dangling (playback-url 200 but the
    // R2 GET 404s, per T6100), so the stage never hydrated; and "Add Spotlight" is the overlay
    // EXPORT button (fires a real, costly render on the real account) — never click it. The
    // helper probes for a streamable draft and opens it deterministically, or hands back a
    // loud hydration reason so we skip (never assert geometry on a placeholder).
    const opened = await openLoadableOverlayDraft(page, { minReadyState: 3 });
    test.skip(!opened.ok, opened.reason);

    // HighlightOverlay geometry. On a real tracking-ON draft `editable` is false, so the
    // draggable body ellipse carries NO `.cursor-move` class — selecting on it hangs (the
    // T5676 lesson). The spotlight MASK ellipse (`svg defs mask ellipse`) is always rendered
    // from restored highlight-region data, so use it for the alignment/finite-geometry check.
    const ellipse = page.locator('svg defs mask ellipse').first();
    await ellipse.waitFor({ state: 'attached', timeout: 30000 });
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
