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
 * viewport, plus two stand-in detection boxes (one near the top of the frame
 * to exercise the flip-to-bottom rule) so the acceptance criterion is proven
 * with real Tailwind layout in a real browser.
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

test.describe('T11570 guided pick guide responsive placement (QA)', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name} (${vp.width}x${vp.height}${vp.fullscreen ? ', fullscreen' : ''}): guide never overlaps a detection box, controls >=44px`, async ({ page }) => {
      skipOnDeployedTarget(test, 'drives the dev-only t11570diag.html harness, not mounted on a deployed target');
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const url = vp.fullscreen ? `${HARNESS}?fullscreen=1` : HARNESS;
      await page.goto(url);
      await page.waitForSelector('[data-testid="stage"]');

      const guide = page.getByTestId('spotlight-pick-guide');
      await expect(guide).toBeVisible();
      const guideBox = await guide.boundingBox();
      expect(guideBox).not.toBeNull();

      // The two stand-in detection boxes exist only inside the stage (the
      // "strip" placement's guide is a sibling below it, never over the
      // video, so a strip run has nothing in the stage to overlap anyway --
      // still assert against both boxes for a uniform check).
      const boxTop = await page.getByTestId('detection-box-top').boundingBox();
      const boxMid = await page.getByTestId('detection-box-mid').boundingBox();

      expect(rectsIntersect(guideBox, boxTop), 'guide overlaps the top detection box').toBe(false);
      expect(rectsIntersect(guideBox, boxMid), 'guide overlaps the mid detection box').toBe(false);

      // Every tappable control in the guide is >=44px tall (the guide pill
      // itself, plus any interior buttons -- "Not boxed?" in the parked phase).
      const heights = await guide.evaluate((el) => {
        const nodes = [el, ...el.querySelectorAll('button')];
        return nodes.map((n) => n.getBoundingClientRect().height);
      });
      for (const h of heights) {
        expect(h, `control height ${h}px below ${MIN_TOUCH_TARGET}px`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      }

      await saveEvidence(page, `T11570-${vp.name}`);
    });
  }
});
