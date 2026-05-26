/**
 * Page Load Performance Harness (T3060)
 *
 * Measures time-to-usable for every page in the app by navigating
 * through the real UI and waiting for concrete "usable" conditions.
 *
 * Run:
 *   cd src/frontend
 *   npx playwright test -c tests/perf/playwright.perf.config.js
 *
 * Targets (default: prod):
 *   PERF_TARGET=dev  PERF_USER_ID=<uuid> npx playwright test -c tests/perf/playwright.perf.config.js
 *   PERF_TARGET=staging PERF_USER_ID=<uuid> npx playwright test -c ...
 *   PERF_TARGET=prod npx playwright test -c ...  (needs setup-auth.js first)
 *
 * Auth:
 *   dev/staging: set PERF_USER_ID — uses X-User-ID header bypass (no OAuth needed)
 *   prod: run setup-auth.js to save browser state via manual Google login
 */
import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPerfCollector, formatWaterfall, formatSummaryTable } from './helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESULTS_DIR = path.join(__dirname, 'results');
const RESULTS_FILE = path.join(RESULTS_DIR, 'measurements.json');

const TARGET = process.env.PERF_TARGET || 'prod';
const USER_ID = process.env.PERF_USER_ID || null;
const USE_HEADER_AUTH = (TARGET === 'dev' || TARGET === 'staging') && USER_ID;

// Shared across serial tests within the same worker
const allResults = [];

function persistResults() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(allResults, null, 2));
}

function record(page, durationMs, waterfall, extra = {}) {
  const entry = { page, durationMs, networkWaterfall: waterfall, ...extra };
  allResults.push(entry);
  persistResults();
  return entry;
}

// ─── Page definitions ──────────────────────────────────────────────

/**
 * "Usable" conditions per page.
 * Each returns a promise that resolves when the page is usable.
 */
const USABLE = {
  async home(page) {
    // Wait for home page data to load (tab-agnostic).
    // "Continue Where You Left Off" appears after games+projects data loads.
    // Game cards or empty-state texts cover other scenarios.
    await page
      .locator(':text("Continue Where You Left Off"), [data-game-id], :text("No games yet"), :text("No reel drafts yet")')
      .first()
      .waitFor({ timeout: 30_000 });
  },

  async homeGames(page) {
    // Ensure Games tab is active and game cards are visible.
    await page.getByRole('button', { name: /^Games/i }).click();
    await page
      .locator('[data-game-id], :text("No games yet")')
      .first()
      .waitFor({ timeout: 15_000 });
  },

  async homeDrafts(page) {
    // Ensure Drafts tab is active and content is visible.
    await page.getByRole('button', { name: /Reel Drafts/i }).click();
    await page
      .locator(':text("Your Reel Drafts"), :text("No reel drafts yet")')
      .first()
      .waitFor({ timeout: 15_000 });
  },

  async annotate(page) {
    // Video element present + at least one clip rendered
    await page.waitForSelector('video', { timeout: 30_000 });
    await page
      .locator('[title*="Rating"]')
      .first()
      .waitFor({ timeout: 30_000 });
  },

  async framing(page) {
    // Video element present, sidebar loaded (no skeleton pulse)
    await page.waitForSelector('video', { timeout: 30_000 });
    await page.waitForFunction(
      () => !document.querySelector('.animate-pulse'),
      { timeout: 15_000 },
    );
  },

  async overlay(page) {
    // Video element present, no loading spinner
    await page.waitForSelector('video', { timeout: 30_000 });
    await page.waitForFunction(
      () => !document.querySelector('.animate-spin'),
      { timeout: 15_000 },
    );
  },

  async sharedVideo(page) {
    // Video player rendered
    await page.waitForSelector('video', { timeout: 30_000 });
  },
};

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Set up X-User-ID header auth for dev/staging.
 * Must be called before any navigation on a fresh page context.
 */
async function setupHeaderAuth(page) {
  if (!USE_HEADER_AUTH) return;
  await page.setExtraHTTPHeaders({
    'X-User-ID': USER_ID,
    'X-Test-Mode': 'true',
  });
  // Strip test headers from R2 presigned URL requests
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-test-mode'];
    delete headers['x-user-id'];
    await route.continue({ headers });
  });
}

async function waitForHomeReady(page) {
  await setupHeaderAuth(page);
  await page.goto('/');
  await USABLE.home(page);
}

async function openFirstProject(page) {
  // Click the first project progress segment (has "click to open" in title)
  const link = page.locator('[title*="click to open"]').first();
  const visible = await link.isVisible().catch(() => false);
  if (!visible) return false;
  await link.click();
  return true;
}

// ─── Tests ─────────────────────────────────────────────────────────

test.describe('Page Load Performance', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(() => {
    if (allResults.length === 0) return;
    console.log('\n\n========== PERFORMANCE SUMMARY ==========\n');
    console.log(formatSummaryTable(allResults));
    console.log('\n==========================================\n');
    persistResults();
  });

  // ── 1. Home (full page load) ──────────────────────────────────

  test('Home - Full Page Load', async ({ page }) => {
    await setupHeaderAuth(page);
    const collector = await createPerfCollector(page);
    collector.startCollection();
    const t0 = Date.now();

    await page.goto('/');
    await USABLE.home(page);

    const ms = Date.now() - t0;
    collector.stopCollection();
    const wf = collector.getNetworkWaterfall();
    record('Home', ms, wf);

    console.log(`\n    Home: ${ms}ms`);
    console.log(formatWaterfall(wf, { apiOnly: true }));
    await collector.dispose();
  });

  // ── 2. Reel Drafts (tab switch) ──────────────────────────────

  test('Reel Drafts - Tab Switch', async ({ page }) => {
    await waitForHomeReady(page);

    const collector = await createPerfCollector(page);
    collector.startCollection();
    const t0 = Date.now();

    await USABLE.homeDrafts(page);

    const ms = Date.now() - t0;
    collector.stopCollection();
    const wf = collector.getNetworkWaterfall();
    record('Reel Drafts', ms, wf);

    console.log(`\n    Reel Drafts: ${ms}ms`);
    console.log(formatWaterfall(wf, { apiOnly: true }));
    await collector.dispose();
  });

  // ── 3. Annotate (click game from Home) ────────────────────────

  test('Annotate - Game Load', async ({ page }) => {
    await waitForHomeReady(page);
    await USABLE.homeGames(page);

    // Wait for a clickable (non-expired) game card to appear
    const gameCard = page.locator('[data-game-id] .cursor-pointer').first();
    const hasGame = await gameCard.waitFor({ timeout: 5_000 }).then(() => true).catch(() => false);
    if (!hasGame) {
      console.log('\n    Annotate: SKIPPED (no clickable game cards)');
      record('Annotate', -1, [], { skipped: true });
      return;
    }

    const collector = await createPerfCollector(page);
    collector.startCollection();
    const t0 = Date.now();

    await gameCard.click();
    await USABLE.annotate(page);

    const ms = Date.now() - t0;
    collector.stopCollection();
    const wf = collector.getNetworkWaterfall();
    record('Annotate', ms, wf);

    console.log(`\n    Annotate: ${ms}ms`);
    console.log(formatWaterfall(wf, { apiOnly: true }));
    await collector.dispose();
  });

  // ── 4. Framing (open project from Home > Drafts) ─────────────

  test('Framing - Project Open', async ({ page }) => {
    await waitForHomeReady(page);
    await USABLE.homeDrafts(page);

    // Wait for project "click to open" links to appear
    const hasProjects = await page
      .locator('[title*="click to open"]')
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    if (!hasProjects) {
      console.log('\n    Framing: SKIPPED (no projects)');
      record('Framing', -1, [], { skipped: true });
      return;
    }

    const collector = await createPerfCollector(page);
    collector.startCollection();
    const t0 = Date.now();

    await openFirstProject(page);
    await USABLE.framing(page);

    const ms = Date.now() - t0;
    collector.stopCollection();
    const wf = collector.getNetworkWaterfall();
    record('Framing', ms, wf);

    console.log(`\n    Framing: ${ms}ms`);
    console.log(formatWaterfall(wf, { apiOnly: true }));
    await collector.dispose();
  });

  // ── 5. Overlay (mode switch from Framing) ─────────────────────

  test('Overlay - Mode Switch', async ({ page }) => {
    await waitForHomeReady(page);
    await USABLE.homeDrafts(page);

    const hasProjects = await page
      .locator('[title*="click to open"]')
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    if (!hasProjects) {
      console.log('\n    Overlay: SKIPPED (no projects)');
      record('Overlay', -1, [], { skipped: true });
      return;
    }

    // Open project and wait for Framing to load
    await openFirstProject(page);
    await USABLE.framing(page);

    // Find overlay mode button — must be both visible AND enabled (requires Framing export)
    const overlayBtn = page.getByRole('button', { name: /Overlay/i });
    const hasOverlay = await overlayBtn.isEnabled().catch(() => false);

    if (!hasOverlay) {
      console.log('\n    Overlay: SKIPPED (button disabled -- needs Framing export first)');
      record('Overlay', -1, [], { skipped: true });
      return;
    }

    const collector = await createPerfCollector(page);
    collector.startCollection();
    const t0 = Date.now();

    await overlayBtn.click();
    await USABLE.overlay(page);

    const ms = Date.now() - t0;
    collector.stopCollection();
    const wf = collector.getNetworkWaterfall();
    record('Overlay', ms, wf);

    console.log(`\n    Overlay: ${ms}ms`);
    console.log(formatWaterfall(wf, { apiOnly: true }));
    await collector.dispose();
  });

  // ── 6. My Reels / Gallery (open panel from Home) ──────────────

  test('My Reels - Gallery Open', async ({ page }) => {
    await waitForHomeReady(page);

    // The "My Reels" button has title="My Reels"
    const libraryBtn = page.locator('button[title="My Reels"]');
    const hasBtn = await libraryBtn.isVisible().catch(() => false);

    if (!hasBtn) {
      console.log('\n    My Reels: SKIPPED (library button not found)');
      record('My Reels', -1, [], { skipped: true });
      return;
    }

    const collector = await createPerfCollector(page);
    collector.startCollection();
    const t0 = Date.now();

    await libraryBtn.click();

    // Wait for gallery panel to open and finish loading.
    // Panel has: download cards (.p-3.bg-gray-700.rounded-lg) OR empty state ("No videos yet")
    await page
      .locator('.bg-gray-700.rounded-lg.border, :text("No videos yet")')
      .first()
      .waitFor({ timeout: 15_000 })
      .catch(() => {});
    // Ensure loading spinner is gone
    await page.waitForFunction(
      () => !document.querySelector('.animate-spin'),
      { timeout: 10_000 },
    ).catch(() => {});

    const ms = Date.now() - t0;
    collector.stopCollection();
    const wf = collector.getNetworkWaterfall();
    record('My Reels', ms, wf);

    console.log(`\n    My Reels: ${ms}ms`);
    console.log(formatWaterfall(wf, { apiOnly: true }));
    await collector.dispose();
  });

  // ── 7. Shared Video (full page load) ──────────────────────────

  test('Shared Video', async ({ page, request }) => {
    await setupHeaderAuth(page);
    // Discover a share token from the downloads API
    let shareToken = null;

    try {
      const resp = await request.get('/api/downloads');
      if (resp.ok()) {
        const data = await resp.json();
        const items = data.downloads || [];
        for (const item of items) {
          if (item.share_token) {
            shareToken = item.share_token;
            break;
          }
        }
      }
    } catch { /* no token from downloads */ }

    // Fall back to env var
    if (!shareToken) {
      shareToken = process.env.PERF_SHARE_TOKEN || null;
    }

    if (!shareToken) {
      console.log('\n    Shared Video: SKIPPED (no share token found)');
      console.log('    Set PERF_SHARE_TOKEN env var or ensure account has shared videos.');
      record('Shared Video', -1, [], { skipped: true });
      return;
    }

    const collector = await createPerfCollector(page);
    collector.startCollection();
    const t0 = Date.now();

    await page.goto(`/shared/${shareToken}`);
    await USABLE.sharedVideo(page);

    const ms = Date.now() - t0;
    collector.stopCollection();
    const wf = collector.getNetworkWaterfall();
    record('Shared Video', ms, wf);

    console.log(`\n    Shared Video: ${ms}ms`);
    console.log(formatWaterfall(wf, { apiOnly: true }));
    await collector.dispose();
  });
});
