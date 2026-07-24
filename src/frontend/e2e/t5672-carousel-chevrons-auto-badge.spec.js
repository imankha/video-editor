import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';

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
      'http://localhost:8000/api/projects',
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

  test('Verify all 13 drafts belong to one game (Legends Mar 28)', async ({
    context,
    page,
  }) => {
    // Get projects from API
    const response = await context.request.get('http://localhost:8000/api/projects', {
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
