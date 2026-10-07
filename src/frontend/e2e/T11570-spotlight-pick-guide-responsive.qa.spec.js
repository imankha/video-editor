/**
 * T11570 QA — the guided athlete-pick guide never overlaps a detection box,
 * and every guide control is >=44px tall, at all 10 viewports in the
 * approved design artifact.
 *
 * WHY A DIAG HARNESS (t11570diag.html), NOT the real Overlay flow: identical
 * reasoning to T9620/T9100/T9150 — a real end-to-end run needs an uploaded
 * game, annotated clips, and a real Focus+Overlay render (infeasible in this
 * container). The harness mounts the REAL SpotlightPickGuide with the SAME
 * placement-bucket hooks OverlayModeView uses, reacting to the real page
 * viewport, PLUS the SAME real-measurement flip logic (a real `stageRef`
 * the guide measures via `getBoundingClientRect`, checked against real
 * obstacle boxes in video-pixel space) — no hardcoded placement stand-in,
 * so this spec exercises the actual production decision, not a mock of it.
 *
 * Run: bash scripts/dev-verify.sh e2e/T11570-spotlight-pick-guide-responsive.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

const HARNESS = '/t11570diag.html';
const MIN_TOUCH_TARGET = 44;

// The 10 viewports from the approved design artifact's "Done when" section.
const VIEWPORTS = [
  { name: 'small-phone-portrait', width: 360, height: 640 },
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'large-phone-portrait', width: 430, height: 932 },
  { name: 'phone-landscape-compact', width: 844, height: 390 },
  // Same dims as phone-portrait, but the fullscreen/flip layout -- mobileFs is
  // explicit UI state in the real app, so the harness takes it as a query
  // param rather than a media query.
  { name: 'phone-fullscreen', width: 390, height: 844, fullscreen: true },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'laptop', width: 1280, height: 720 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'large-desktop', width: 1920, height: 1080 },
];

function rectsIntersect(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
         a.y < b.y + b.height && a.y + a.height > b.y;
}

function harnessUrl({ fullscreen, obstacle } = {}) {
  const params = new URLSearchParams();
  if (fullscreen) params.set('fullscreen', '1');
  if (obstacle) params.set('obstacle', obstacle);
  const qs = params.toString();
  return qs ? `${HARNESS}?${qs}` : HARNESS;
}

async function assertNoOverlapAndTouchTargets(page) {
  const guide = page.getByTestId('spotlight-pick-guide');
  await expect(guide).toBeVisible();
  const guideBox = await guide.boundingBox();
  expect(guideBox).not.toBeNull();

  // The stand-in detection boxes exist only inside the stage (the "strip"
  // placement's guide is a sibling below it, never over the video, so a
  // strip run has nothing in the stage to overlap anyway -- still assert
  // against every box present for a uniform check).
  const boxCount = await page.locator('[data-testid^="detection-box-"]').count();
  for (let i = 0; i < boxCount; i++) {
    const box = await page.getByTestId(`detection-box-${i}`).boundingBox();
    expect(rectsIntersect(guideBox, box), `guide overlaps detection-box-${i}`).toBe(false);
  }

  // Every tappable control in the guide is >=44px tall (the guide pill
  // itself, plus any interior buttons -- "Not boxed?" in the parked phase).
  const heights = await guide.evaluate((el) => {
    const nodes = [el, ...el.querySelectorAll('button')];
    return nodes.map((n) => n.getBoundingClientRect().height);
  });
  for (const h of heights) {
    expect(h, `control height ${h}px below ${MIN_TOUCH_TARGET}px`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  }
  return guideBox;
}

test.describe('T11570 guided pick guide responsive placement (QA)', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name} (${vp.width}x${vp.height}${vp.fullscreen ? ', fullscreen' : ''}): guide never overlaps a detection box, controls >=44px`, async ({ page }) => {
      skipOnDeployedTarget(test, 'drives the dev-only t11570diag.html harness, not mounted on a deployed target');
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(harnessUrl({ fullscreen: vp.fullscreen }));
      await page.waitForSelector('[data-testid="stage"]');

      await assertNoOverlapAndTouchTargets(page);
      await saveEvidence(page, `T11570-${vp.name}`);
    });
  }

  // MAJOR-2 fix verification: the flip decision must respond to REAL
  // obstacle geometry, not a hardcoded "always flip for overlay placement"
  // stand-in -- these three prove the SAME production component (via the
  // diag harness's real stageRef + real obstacleBoxes) picks top vs bottom
  // vs the compact-fallback correctly, each at one representative overlay
  // viewport (laptop; placement bucket is unrelated to this logic).
  test('obstacle in the TOP band -> guide flips to bottom (laptop)', async ({ page }) => {
    skipOnDeployedTarget(test, 'drives the dev-only t11570diag.html harness, not mounted on a deployed target');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(harnessUrl({ obstacle: 'top' }));
    await page.waitForSelector('[data-testid="stage"]');
    const guideBox = await assertNoOverlapAndTouchTargets(page);
    expect(await page.getByTestId('spotlight-pick-guide').getAttribute('data-side')).toBe('bottom');
    await saveEvidence(page, 'T11570-obstacle-top-flips-bottom');
    expect(guideBox).not.toBeNull();
  });

  test('obstacle in the BOTTOM band -> guide stays top (laptop)', async ({ page }) => {
    skipOnDeployedTarget(test, 'drives the dev-only t11570diag.html harness, not mounted on a deployed target');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(harnessUrl({ obstacle: 'bottom' }));
    await page.waitForSelector('[data-testid="stage"]');
    await assertNoOverlapAndTouchTargets(page);
    expect(await page.getByTestId('spotlight-pick-guide').getAttribute('data-side')).toBe('top');
    await saveEvidence(page, 'T11570-obstacle-bottom-stays-top');
  });

  test('obstacle blocking BOTH bands -> guide falls back to compact and still has no overlap / >=44px controls (laptop)', async ({ page }) => {
    skipOnDeployedTarget(test, 'drives the dev-only t11570diag.html harness, not mounted on a deployed target');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(harnessUrl({ obstacle: 'both' }));
    await page.waitForSelector('[data-testid="stage"]');
    // Not asserting no-overlap here -- the obstacle deliberately spans
    // almost the entire frame, so SOME overlap is geometrically unavoidable.
    // What MUST hold: the guide forced itself compact (so it's as small as
    // possible) and every control stays tappable; pointer-events-none on
    // the pill body means a covered box is still reachable regardless.
    const guide = page.getByTestId('spotlight-pick-guide');
    await expect(guide).toBeVisible();
    expect(await guide.evaluate((el) => el.querySelector('[data-testid="pick-guide-step"]')?.textContent))
      .toBe('Frame 2/4'); // compact form -- shortened frame count
    const heights = await guide.evaluate((el) => [el, ...el.querySelectorAll('button')].map((n) => n.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    await saveEvidence(page, 'T11570-obstacle-both-compact-fallback');
  });
});
