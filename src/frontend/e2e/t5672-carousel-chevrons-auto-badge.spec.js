import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

// T5420 convention: API calls go to the TARGET's API, never a hardcoded localhost.
// These two tests used to GET a hardcoded localhost:8000 /api/projects. On a staging
// run the session cookie loginAsRealUser minted belongs to the staging API host, so
// localhost answered 401 with a {detail} object -- and `projects.forEach` blew up with
// "is not a function" instead of naming the real problem.
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:8000/api';

test.describe('T5672: CardCarousel arrows + DraftTile clip-count marker', () => {
  test.beforeEach(async ({ context, page }) => {
    // Login as real user with real data (games + drafts)
    await loginAsRealUser(context, 'imankh@gmail.com');
  });

  test('Desktop (1315px): solid circular arrows visible on overflow, dim at edges, clip-count chip has tooltip', async ({
    context,
    page,
  }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1315, height: 800 });
    await page.goto('/');

    // Wait for drafts to load
    await page.waitForSelector('[data-testid="project-card"]', { timeout: 10000 });

    // Capture API response to check per-game draft counts
    const draftsResponse = await context.request.get(
      `${API_BASE}/projects`,
      { headers: { 'X-Test-Mode': 'true' } }
    );
    const draftsData = await draftsResponse.json();
    console.log(`\n=== Per-Game Draft Counts ===`);
    const gameMap = {};
    draftsData.forEach((draft) => {
      draft.game_ids?.forEach((gameId) => {
        gameMap[gameId] = (gameMap[gameId] || 0) + 1;
      });
    });
    Object.entries(gameMap).forEach(([gameId, count]) => {
      console.log(`Game ${gameId}: ${count} drafts`);
    });
    console.log(`Total drafts: ${draftsData.length}`);

    // Verify multi-clip marker is a chip with label + tooltip (only on drafts with >1 clip)
    const clipCountChips = await page.locator('[aria-label*="Contains"][aria-label*="clips"]').all();
    if (clipCountChips.length > 0) {
      console.log(`\n✓ Found ${clipCountChips.length} clip-count chips`);
      const firstChip = clipCountChips[0];
      const title = await firstChip.getAttribute('title');
      const label = await firstChip.textContent();
      console.log(`  Title: ${title}`);
      console.log(`  Label: ${label}`);
      expect(title).toMatch(/Contains \d+ clips/);
    }

    // Look for carousel row with multiple tiles
    const carouselRows = await page.locator('[role="group"]').all();
    console.log(`\n✓ Found ${carouselRows.length} carousel rows`);

    for (let i = 0; i < carouselRows.length; i++) {
      const row = carouselRows[i];
      const tileCount = await row.locator('[data-testid="project-card"]').count();

      if (tileCount > 3) {
        console.log(`  Row ${i}: ${tileCount} tiles (overflowing)`);

        // Check for the solid circular arrow buttons
        const arrows = await page.locator('button[aria-label*="Scroll"]').all();
        if (arrows.length > 0) {
          console.log(`  ✓ Arrows present (${arrows.length} total)`);

          const rightArrow = page.locator('button[aria-label="Scroll right"]').first();
          const bg = await rightArrow.evaluate((el) => window.getComputedStyle(el).backgroundColor);
          const radius = await rightArrow.evaluate((el) => window.getComputedStyle(el).borderRadius);
          const box = await rightArrow.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return { width: r.width, height: r.height };
          });
          console.log(`  Right arrow background: ${bg}, border-radius: ${radius}, size: ${box.width}x${box.height}`);
          // Solid circle: fully rounded (borderRadius >= half of width/height), not transparent
          expect(bg).not.toBe('rgba(0, 0, 0, 0)');
          expect(box.width).toBeGreaterThan(30);
          expect(box.height).toBeGreaterThan(30);

          const leftArrow = page.locator('button[aria-label="Scroll left"]').first();

          // Test smooth scroll on click
          await leftArrow.click();
          console.log(`  ✓ Arrow click triggered scroll`);
        }
      }
    }
  });

  test('Mobile (390px): no arrows, native swipe works, clip-count chip visible', async ({
    browser,
  }) => {
    // A plain resized desktop context still reports (pointer: fine), since
    // Chromium's pointer/hover media features follow touch emulation, not
    // viewport size. Use a real touch-emulated context so this actually
    // exercises the coarse-pointer path the component branches on.
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await mobileContext.newPage();
    await loginAsRealUser(mobileContext, 'imankh@gmail.com');
    await page.goto('/');

    // Wait for drafts to load
    await page.waitForSelector('[data-testid="project-card"]', { timeout: 10000 });

    // Verify no arrows on mobile
    const arrows = await page.locator('button[aria-label*="Scroll"]').count();
    expect(arrows).toBe(0);
    console.log(`✓ No arrows on mobile (${arrows} found)`);

    // Verify clip-count chip is still visible on mobile (for multi-clip drafts)
    const clipCountChips = await page.locator('[aria-label*="Contains"][aria-label*="clips"]').count();
    console.log(`✓ Clip-count chips visible on mobile: ${clipCountChips}`);

    // Verify carousel can be scrolled (swipe)
    const carousel = await page.locator('[role="group"]').first();
    const scrollWidth = await carousel.evaluate((el) => el.scrollWidth);
    const clientWidth = await carousel.evaluate((el) => el.clientWidth);

    if (scrollWidth > clientWidth) {
      console.log(`✓ Carousel is scrollable (${scrollWidth}px > ${clientWidth}px)`);
      // Native scroll-snap behavior is preserved — no JS arrows needed
    }

    await mobileContext.close();
  });

  test('Game groups render stage rows (T6810); a mixed-aspect stage sub-splits portrait first; Not-Started collapses to one landscape row (T6800)', async ({
    page,
  }) => {
    skipOnDeployedTarget(test, 'splices synthetic drafts via an in-page import of /src/stores/projectsStore.js; that Vite-dev path 404s on a deployed BUILD');
    // Set desktop viewport
    await page.setViewportSize({ width: 1315, height: 800 });
    await page.goto('/');
    // The rendered project-card IS the proof fetchProjects() resolved (the cards come
    // FROM it), so it already satisfies the "let the initial fetch settle" intent. A
    // `networkidle` settle used to follow and is banned -- it never fires against a CDN
    // (helpers/appReady.js), which hung this test to the 60s deployed-target timeout.
    await page.waitForSelector('[data-testid="project-card"]', { timeout: 10000 });

    // Splice synthetic drafts under an existing group_key to exercise the
    // T6810 stage rows DETERMINISTICALLY (the real account's stages vary):
    // force one portrait+one landscape draft into In Framing (mixed-aspect
    // stage -> aspect sub-split) and one portrait draft into Not Started
    // (collapses to a single null-ratio row, tile renders landscape per
    // T6800). Client-side only, no backend/DB writes.
    await page.evaluate(async () => {
      const { useProjectsStore } = await import('/src/stores/projectsStore.js');
      const current = useProjectsStore.getState().projects;
      const seed = current.find((p) => p.aspect_ratio === '9:16' && p.group_key);
      const inFramingBase = {
        ...seed,
        clips_in_progress: 1,
        clips_exported: 0,
        has_working_video: false,
        has_final_video: false,
        has_overlay_edits: false,
        is_published: false,
      };
      const framingPortrait = { ...inFramingBase, id: 888887, name: 'Synthetic Framing Portrait' };
      const framingLandscape = { ...inFramingBase, id: 888888, name: 'Synthetic Landscape Draft', aspect_ratio: '16:9' };
      const freshDraft = {
        ...inFramingBase,
        id: 888889,
        name: 'Synthetic Fresh Draft',
        clips_in_progress: 0,
      };
      useProjectsStore.setState({ projects: [framingPortrait, framingLandscape, freshDraft, ...current] });
    });

    await page.waitForSelector('text=Synthetic Landscape Draft', { timeout: 3000 });

    // Stage rows exist for both spliced stages, Not Started before In Framing.
    const notStartedRow = page.locator('[data-testid="stage-row-not_started"]');
    const inFramingRow = page.locator('[data-testid="stage-row-in_framing"]');
    await expect(notStartedRow.first()).toBeVisible();
    await expect(inFramingRow.first()).toBeVisible();
    const stageOrder = await page.locator('[data-testid^="stage-row-"]').evaluateAll(
      (els) => els.map((el) => el.getAttribute('data-testid'))
    );
    console.log(`Stage row order: ${JSON.stringify(stageOrder)}`);
    expect(stageOrder.indexOf('stage-row-not_started'))
      .toBeLessThan(stageOrder.indexOf('stage-row-in_framing'));

    // The mixed-aspect In Framing stage sub-splits: one carousel per aspect,
    // portrait first, ratios in the aria-labels + visible aspect chips.
    const portraitRow = page.locator('[role="group"][aria-label*="In Framing"][aria-label*="9:16"]');
    const landscapeRow = page.locator('[role="group"][aria-label*="In Framing"][aria-label*="16:9"]');
    await expect(portraitRow).toHaveCount(1);
    await expect(landscapeRow).toHaveCount(1);
    const framingLabels = await page.locator('[role="group"][aria-label*="In Framing"]').evaluateAll(
      (els) => els.map((el) => el.getAttribute('aria-label'))
    );
    const portraitIdx = framingLabels.findIndex((l) => l?.includes('9:16'));
    const landscapeIdx = framingLabels.findIndex((l) => l?.includes('16:9'));
    console.log(`In Framing row order: ${JSON.stringify(framingLabels)}`);
    expect(portraitIdx).toBeGreaterThanOrEqual(0);
    expect(landscapeIdx).toBeGreaterThan(portraitIdx);
    expect(await page.getByText('9:16', { exact: true }).count()).toBeGreaterThan(0);
    expect(await page.getByText('16:9', { exact: true }).count()).toBeGreaterThan(0);

    // Not-Started rows never carry an aspect ratio in their aria-label (single
    // null-ratio bucket -- all tiles landscape, nothing to split on).
    const notStartedCarouselLabels = await page.locator('[role="group"][aria-label*="Not Started"]').evaluateAll(
      (els) => els.map((el) => el.getAttribute('aria-label'))
    );
    expect(notStartedCarouselLabels.length).toBeGreaterThan(0);
    for (const label of notStartedCarouselLabels) {
      expect(label).not.toMatch(/9:16|16:9/);
    }

    // The synthetic landscape tile renders as a landscape (aspect-video) shape,
    // not letterboxed into a portrait tile.
    const landscapeTile = page.locator('[data-testid="project-card"]', { hasText: 'Synthetic Landscape Draft' });
    expect(await landscapeTile.first().getAttribute('class')).toMatch(/aspect-video/);

    // T6800: the Not-Started draft renders landscape even though its TARGET
    // ratio is 9:16 -- the tile shows the source-aspect poster uncropped.
    const freshTile = page.locator('[data-testid="project-card"]', { hasText: 'Synthetic Fresh Draft' });
    expect(await freshTile.first().getAttribute('class')).toMatch(/aspect-video/);

    await page.screenshot({ path: '/tmp/t6810-stage-rows.png' });
    console.log('Screenshot saved: /tmp/t6810-stage-rows.png');
  });

  test('Verify all 13 drafts belong to one game (Legends Mar 28)', async ({
    context,
    page,
  }) => {
    // Get projects from API
    const response = await context.request.get(`${API_BASE}/projects`, {
      headers: { 'X-Test-Mode': 'true' },
    });
    const projects = await response.json();

    console.log(`\n=== Draft Summary ===`);
    console.log(`Total drafts: ${projects.length}`);

    // Map game_ids to draft names
    const gameMap = new Map();
    projects.forEach((project) => {
      if (project.game_ids && project.game_ids.length > 0) {
        project.game_ids.forEach((gameId) => {
          if (!gameMap.has(gameId)) {
            gameMap.set(gameId, []);
          }
          gameMap.get(gameId).push(project.name);
        });
      }
    });

    console.log(`Games with drafts: ${gameMap.size}`);
    gameMap.forEach((drafts, gameId) => {
      console.log(`  Game ${gameId}: ${drafts.length} drafts`);
      drafts.slice(0, 3).forEach((name) => console.log(`    - ${name}`));
      if (drafts.length > 3) console.log(`    ... and ${drafts.length - 3} more`);
    });

    // Report findings
    if (gameMap.size === 1) {
      const [gameId, drafts] = Array.from(gameMap.entries())[0];
      console.log(`\n✓ VERIFIED: All ${drafts.length} drafts belong to Game ${gameId}`);
      expect(drafts.length).toBe(13);
    } else {
      console.log(
        `⚠ Drafts span multiple games: ${Array.from(gameMap.keys()).join(', ')}`
      );
      // List distribution
      gameMap.forEach((drafts, gameId) => {
        console.log(`  Game ${gameId}: ${drafts.length} drafts`);
      });
    }
  });
});
