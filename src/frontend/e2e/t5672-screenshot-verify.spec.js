import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T5672 visual verification: clip-count chip on multi-clip drafts, no chip on
 * single-clip drafts. The real account's current drafts are all auto-created
 * (single-clip by construction), so this overrides the in-memory projectsStore
 * state (same in-page-store-import pattern the suite already uses for store
 * inspection) with one synthetic multi-clip entry alongside the real
 * single-clip ones, to render both states side by side. No backend/DB writes
 * occur. The injection and assertions run back-to-back (no fixed sleep) to
 * beat any background refetch that would otherwise overwrite the synthetic
 * entry.
 */
test('T5672 clip-count badge visual verification (both states)', async ({ context, page }) => {
  skipOnDeployedTarget(test, 'injects a synthetic draft via an in-page import of /src/stores/projectsStore.js; that Vite-dev path 404s on a deployed BUILD');
  await loginAsRealUser(context, 'imankh@gmail.com');
  await page.setViewportSize({ width: 1315, height: 800 });
  await page.goto('/');
  // The rendered project-card IS the proof fetchProjects() resolved (the cards come
  // FROM it), so it already satisfies the "let the initial fetch settle" intent. A
  // `networkidle` settle used to follow and is banned -- it never fires against a CDN
  // (helpers/appReady.js), which hung this test to the 60s deployed-target timeout.
  await page.waitForSelector('[data-testid="project-card"]', { timeout: 10000 });

  await page.evaluate(async () => {
    const { useProjectsStore } = await import('/src/stores/projectsStore.js');
    const current = useProjectsStore.getState().projects;
    // Pick a not-yet-complete single-clip draft as the base so the synthetic
    // multi-clip entry doesn't also carry the Ready-to-publish badge, which
    // shares the same top-left corner (z-30, above the clip-count chip's z-20)
    // and would visually hide the chip we're trying to screenshot.
    const singleClip = current.find((p) => p.clip_count === 1 && !p.has_final_video);
    const multiClip = { ...singleClip, id: 999999, name: 'Multi-Clip Test Draft', clip_count: 3 };
    useProjectsStore.setState({ projects: [multiClip, ...current] });
  });

  await page.waitForSelector('text=Multi-Clip Test Draft', { timeout: 3000 });
  await page.locator('text=Multi-Clip Test Draft').scrollIntoViewIfNeeded();

  const clipCountChips = await page.locator('[aria-label*="Contains"][aria-label*="clips"]').all();
  const autoChips = await page.locator('[aria-label*="Auto-created"]').count();
  console.log(`Clip-count chips found: ${clipCountChips.length}`);
  console.log(`Auto-created chips found (should be 0): ${autoChips}`);

  expect(clipCountChips.length).toBeGreaterThan(0);
  expect(autoChips).toBe(0);

  const firstChipTitle = await clipCountChips[0].getAttribute('title');
  console.log(`First clip-count chip title: ${firstChipTitle}`);
  expect(firstChipTitle).toBe('Contains 3 clips');

  await page.screenshot({ path: '/tmp/t5672-clip-count-badge.png' });
  console.log('Screenshot saved to /tmp/t5672-clip-count-badge.png');
});
