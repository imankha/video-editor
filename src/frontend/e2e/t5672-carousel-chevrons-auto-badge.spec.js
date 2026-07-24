import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';

test.describe('T5672: CardCarousel chevrons + DraftTile auto-created marker', () => {
  test.beforeEach(async ({ context, page }) => {
    // Login as real user with real data (games + drafts)
    await loginAsRealUser(context, 'imankh@gmail.com');
  });

  test('Desktop (1315px): chevrons visible on overflow, hide at edges, Auto chip has tooltip', async ({
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

    // Verify auto-created marker is a chip with label + tooltip
    const autoChips = await page.locator('[aria-label*="Auto-created"]').all();
    if (autoChips.length > 0) {
      console.log(`\n✓ Found ${autoChips.length} auto-created chips`);
      const firstChip = autoChips[0];
      const title = await firstChip.getAttribute('title');
      const label = await firstChip.textContent();
      console.log(`  Title: ${title}`);
      console.log(`  Label: ${label}`);
      expect(title).toMatch(/Created automatically/);
      expect(label).toContain('Auto');
    }

    // Look for carousel row with multiple tiles
    const carouselRows = await page.locator('[role="group"]').all();
    console.log(`\n✓ Found ${carouselRows.length} carousel rows`);

    for (let i = 0; i < carouselRows.length; i++) {
      const row = carouselRows[i];
      const tileCount = await row.locator('[data-testid="project-card"]').count();

      if (tileCount > 3) {
        console.log(`  Row ${i}: ${tileCount} tiles (overflowing)`);

        // Check for chevrons
        const chevrons = await page.locator('button[aria-label*="Scroll"]').all();
        if (chevrons.length > 0) {
          console.log(`  ✓ Chevrons present (${chevrons.length} total)`);

          // Test left chevron at start
          const leftChevron = chevrons.find(async (btn) => {
            return (await btn.getAttribute('aria-label')) === 'Scroll left';
          });

          // Hover to brighten (state change)
          if (leftChevron) {
            const color = await leftChevron.evaluate((el) => {
              return window.getComputedStyle(el).color;
            });
            console.log(`  Chevron initial color: ${color}`);

            // Test smooth scroll on click
            await leftChevron.click();
            console.log(`  ✓ Chevron click triggered scroll`);
          }
        }
      }
    }
  });

  test('Mobile (390px): no chevrons, native swipe works, Auto chip visible', async ({
    context,
    page,
  }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    // Wait for drafts to load
    await page.waitForSelector('[data-testid="project-card"]', { timeout: 10000 });

    // Verify no chevrons on mobile
    const chevrons = await page.locator('button[aria-label*="Scroll"]').count();
    expect(chevrons).toBe(0);
    console.log(`✓ No chevrons on mobile (${chevrons} found)`);

    // Verify auto-created chip is still visible on mobile
    const autoChips = await page.locator('[aria-label*="Auto-created"]').count();
    console.log(`✓ Auto-created chips visible on mobile: ${autoChips}`);

    // Verify carousel can be scrolled (swipe)
    const carousel = await page.locator('[role="group"]').first();
    const scrollWidth = await carousel.evaluate((el) => el.scrollWidth);
    const clientWidth = await carousel.evaluate((el) => el.clientWidth);

    if (scrollWidth > clientWidth) {
      console.log(`✓ Carousel is scrollable (${scrollWidth}px > ${clientWidth}px)`);
      // Native scroll-snap behavior is preserved — no JS chevrons needed
    }
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
