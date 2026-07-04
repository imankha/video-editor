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

/** Fails if the page scrolls horizontally (the classic mobile-breakage signal). */
export async function assertNoHorizontalOverflow(page) {
  const m = await page.evaluate(() => {
    const doc = document.scrollingElement || document.documentElement;
    return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth };
  });
  if (m.scrollWidth > m.innerWidth + 1) {
    throw new Error(
      `[qa] horizontal overflow: scrollWidth ${m.scrollWidth} > viewport ${m.innerWidth}`
    );
  }
}

/** Viewport matrix per the responsiveness skill (mobile-first 360-428px). */
export const VIEWPORTS = [
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'desktop-1280', width: 1280, height: 800 },
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
