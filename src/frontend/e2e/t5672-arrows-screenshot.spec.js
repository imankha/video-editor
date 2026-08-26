import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T5672 visual verification: solid circular arrow buttons must be clearly
 * visible at a glance over bright poster images (the prior gradient-chevron
 * design was reported invisible). Screenshots at 1315px and 1795px.
 */
async function verifyArrows(context, page, width) {
  await loginAsRealUser(context, 'imankh@gmail.com');
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  // The rendered project-card above IS the ready signal. A `networkidle` settle used
  // to follow it and hung both tests to the 60s timeout on a deployed target: against
  // a live CDN the network never goes quiet for 500ms, so it never fires. It is banned
  // for exactly this reason -- see helpers/appReady.js and e2e/STAGING-GATE.md.
  await page.waitForSelector('[data-testid="project-card"]', { timeout: 10000 });

  // T6810 split drafts into many small per-stage/per-aspect rows, so the real
  // account's rows rarely overflow anymore and the "Scroll right" arrow (rendered
  // only on an overflowing carousel) no longer appears deterministically. Splice a
  // deep row of same-stage/same-aspect synthetic drafts into projectsStore so ONE
  // row overflows regardless of the account's current data (client-side only, no
  // backend/DB writes) — the same in-page seeding sibling t5672 specs use.
  await page.evaluate(async () => {
    const { useProjectsStore } = await import('/src/stores/projectsStore.js');
    const current = useProjectsStore.getState().projects;
    const seed = current.find((p) => p.group_key) || current[0] || {};
    // 15 portrait In-Framing drafts under the SAME group so they land in one stage
    // row; at ~168px/tile that is ~2520px, wider than either test viewport.
    const overflowRow = Array.from({ length: 15 }, (_, i) => ({
      ...seed,
      id: 900000 + i,
      name: `Synthetic Overflow Draft ${i + 1}`,
      aspect_ratio: '9:16', // explicit — never derive it (see T7750)
      clips_in_progress: 1,
      clips_exported: 0,
      has_working_video: false,
      has_final_video: false,
      has_overlay_edits: false,
      is_published: false,
    }));
    useProjectsStore.setState({ projects: [...overflowRow, ...current] });
  });
  await page.waitForSelector('text=Synthetic Overflow Draft 1', { timeout: 3000 });

  const rightArrow = page.locator('button[aria-label="Scroll right"]').first();
  await expect(rightArrow).toBeVisible({ timeout: 5000 });

  const box = await rightArrow.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      width: r.width,
      height: r.height,
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      color: style.color,
    };
  });
  console.log(`[${width}px] Right arrow box:`, JSON.stringify(box));

  expect(box.width).toBeGreaterThanOrEqual(34);
  expect(box.height).toBeGreaterThanOrEqual(34);
  expect(box.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(box.boxShadow).not.toBe('none');

  await page.screenshot({ path: `/tmp/t5672-arrows-${width}.png` });
  console.log(`Screenshot saved: /tmp/t5672-arrows-${width}.png`);
}

test(`T5672 arrows visible at 1315px`, async ({ context, page }) => {
  skipOnDeployedTarget(test, 'seeds overflow via an in-page import of /src/stores/projectsStore.js; that Vite-dev path 404s on a deployed BUILD');
  await verifyArrows(context, page, 1315);
});

test(`T5672 arrows visible at 1795px`, async ({ context, page }) => {
  skipOnDeployedTarget(test, 'seeds overflow via an in-page import of /src/stores/projectsStore.js; that Vite-dev path 404s on a deployed BUILD');
  await verifyArrows(context, page, 1795);
});
