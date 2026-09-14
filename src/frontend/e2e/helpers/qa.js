/**
 * qa — evidence artifacts + responsive checks for the mandatory QA phase.
 *
 * Every acceptance criterion needs concrete evidence (spawn-worker step 4).
 * These helpers make that mechanical:
 *
 *   import { saveEvidence, assertNoHorizontalOverflow, responsiveSweep } from './helpers/qa.js';
 *
 *   await saveEvidence(page, 'criterion-1-expired-panel');   // screenshot -> <repo>/qa/
 *   await responsiveSweep(page);                             // 375px + desktop, overflow + screenshots
 *
 * Artifacts land in <repo-root>/qa/ (gitignored). On a /dotask container the
 * checkout is bind-mounted, so the supervisor and user can open them directly
 * from C:\work\tasks\<slug>\qa\ without any copying.
 */
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// e2e/helpers -> e2e -> frontend -> src -> repo root
export const QA_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'qa');

/** Full-page screenshot named after the acceptance criterion it evidences. */
export async function saveEvidence(page, name) {
  fs.mkdirSync(QA_DIR, { recursive: true });
  const file = path.join(QA_DIR, `${name.replace(/[^a-z0-9._-]/gi, '_')}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`[qa] evidence saved: ${file}`);
  return file;
}

/**
 * Fails if the page scrolls horizontally (the classic mobile-breakage signal).
 *
 * T9920: the app shell is `h-dvh overflow-hidden` (App.jsx) with ALL scrolling
 * delegated to inner `flex-1 overflow-auto` panes, so `document.scrollingElement`
 * can NEVER report horizontal overflow — the old check here failed open, which is
 * why 13+ Branch CI runs missed the parked-drawer and fixed-panel overflow bugs.
 * We now measure the actual scrolling ancestors: any LARGE scroll container (one
 * filling most of the viewport — i.e. a main content pane, not a small by-design
 * horizontal strip like a timeline) whose scrollWidth exceeds its clientWidth is a
 * real leak. `overflow-x: clip` containers are not scrollable, so a properly
 * clipped offender is correctly not flagged.
 */
export async function assertNoHorizontalOverflow(page) {
  const m = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const offenders = [];
    for (const el of document.querySelectorAll('*')) {
      const ox = getComputedStyle(el).overflowX;
      if (ox !== 'auto' && ox !== 'scroll') continue;
      // Only the main content pane(s): big enough to be a primary scroll region,
      // never a short horizontal widget (timeline scrubber) that scrolls by design.
      const big = el.clientWidth >= vw * 0.5 && el.clientHeight >= vh * 0.5;
      if (!big) continue;
      const overflow = el.scrollWidth - el.clientWidth;
      if (overflow > 1) {
        offenders.push({
          overflow,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          label:
            el.getAttribute('data-testid') ||
            `${el.tagName}.${String(el.className).slice(0, 40)}`,
        });
      }
    }
    // The document root can still overflow on some screens — check it too.
    const doc = document.scrollingElement || document.documentElement;
    const docOverflow = doc.scrollWidth - vw;
    return { offenders, docOverflow, vw, docScrollWidth: doc.scrollWidth };
  });
  if (m.docOverflow > 1) {
    throw new Error(
      `[qa] horizontal overflow on document: scrollWidth ${m.docScrollWidth} > viewport ${m.vw}`
    );
  }
  if (m.offenders.length) {
    const o = m.offenders.sort((a, b) => b.overflow - a.overflow)[0];
    throw new Error(
      `[qa] horizontal overflow on <${o.label}>: scrollWidth ${o.scrollWidth} > clientWidth ${o.clientWidth} (by ${o.overflow}px)`
    );
  }
}

/**
 * Viewport matrix: mobile-first phone widths, the narrow-desktop dead zone that
 * T9920 targets (699/768), and the desktop breakpoints (1024/1440).
 */
export const VIEWPORTS = [
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'narrow-699', width: 699, height: 900 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1024', width: 1024, height: 800 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

/**
 * Run the current page through the viewport matrix: assert no horizontal
 * overflow and save a screenshot at each size. Optional `assertions(vp)`
 * callback runs per viewport for screen-specific checks.
 */
export async function responsiveSweep(page, assertions) {
  const original = page.viewportSize();
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(250); // let responsive layout settle
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, `responsive-${vp.name}`);
    if (assertions) await assertions(vp);
  }
  if (original) await page.setViewportSize(original);
}

/**
 * T8550 phone-width matrix for the mobile CTA-visibility sweep: the tightest
 * heights first so the below-fold case clips earliest. 320x568 is the iPhone
 * SE1-class floor; 428x926 the biggest current phone. These are pure width x
 * height assertion boxes (no touch/UA emulation) — the sweep measures geometry
 * ("does the primary CTA sit above the fold"), not pointer behavior.
 */
export const CTA_VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '428x926', width: 428, height: 926 },
];

/**
 * Assert a primary CTA is fully visible in the viewport WITHOUT scrolling.
 * Call it immediately after the surface renders, BEFORE any programmatic scroll —
 * "above the fold" means reachable on first paint, not after a scroll-into-view.
 *
 * keyboardOpen simulates an on-screen soft keyboard: Playwright cannot open a
 * real one, so we treat the bottom ~40% of the viewport as unavailable and
 * assert the CTA fits within the reduced usable box. Use it for surfaces with a
 * focused text input (Add Play name/notes, Add Game opponent).
 */
export async function assertCtaInViewport(page, locator, { keyboardOpen = false } = {}) {
  const box = await locator.boundingBox();
  const vp = page.viewportSize();
  const usableHeight = keyboardOpen ? Math.floor(vp.height * 0.6) : vp.height;
  expect(box, 'CTA not rendered').toBeTruthy();
  expect(box.y + box.height, 'CTA below the fold').toBeLessThanOrEqual(usableHeight);
  expect(box.y, 'CTA above the viewport').toBeGreaterThanOrEqual(0);
  expect(box.x >= 0 && box.x + box.width <= vp.width, 'CTA horizontally clipped').toBe(true);
}
