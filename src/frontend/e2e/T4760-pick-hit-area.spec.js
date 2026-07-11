import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T4760 Pick hit area -- real browser layout evidence.
 *
 * Unit tests (pickHitArea.test.jsx) proved the component logic. These specs
 * prove the layout in a real browser: the ENTIRE name+info+button block is
 * the pick target (not just the 44px visual button), and a tap on the clip
 * video DOES NOT pick.
 *
 * Route-mocked: /api/rank/* returns injected pairs so no seeded reels are
 * required. Real auth: loginAsRealUser (imankh@gmail.com) loads the real
 * bootstrap/games so the home screen renders normally.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T4760-pick-hit-area.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

const MOCK_CONFIDENCE = {
  eligible: true,
  confidence_pct: 45.0,
  ranked_count: 5,
  total: 10,
  total_sec: 120,
};

const MOCK_PAIR = {
  a: {
    id: 101,
    name: 'Goal vs Carlsbad',
    stream_url: '/api/working/101/stream',
    aspect_ratio: '9:16',
    project_id: null,
    minute: 23,
    tags: ['goal'],
    opponent_line: 'vs Carlsbad',
  },
  b: {
    id: 102,
    name: 'Save vs Eagles',
    stream_url: '/api/working/102/stream',
    aspect_ratio: '9:16',
    project_id: null,
    minute: 45,
    tags: ['save'],
    opponent_line: 'vs Eagles',
  },
};

const MOCK_RESULT = {
  confidence_pct: 50.0,
  ranked_count: 6,
  total: 10,
  total_sec: 120,
  undo: { winner_id: 101, loser_id: 102 },
};

/** Set up all /api/rank/* intercepts. Call before page.goto. */
async function setupRankingMocks(page) {
  await page.route('**/api/rank/confidence**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CONFIDENCE),
    }),
  );

  // First fetch -> real pair; subsequent fetches -> 204 (exhausted).
  let nextCallCount = 0;
  await page.route('**/api/rank/next**', (route) => {
    nextCallCount += 1;
    if (nextCallCount === 1) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_PAIR),
      });
    } else {
      route.fulfill({ status: 204, body: '' });
    }
  });

  await page.route('**/api/rank/result', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_RESULT),
    }),
  );

  // Silence video stream fetches -- layout renders even without video data.
  await page.route('**/api/working/**', (route) =>
    route.fulfill({ status: 200, contentType: 'video/mp4', body: '' }),
  );
}

/** Login, mock routes, navigate home, open My Reels, click the ConfidenceBanner. */
async function openRankingGame(context, page) {
  await loginAsRealUser(context, REAL_EMAIL);
  await setupRankingMocks(page);

  await page.goto('/');
  await page.waitForLoadState('networkidle').catch(() => {});

  // GalleryButton has title="My Reels" (SECTION_NAMES.LIBRARY)
  await page.getByTitle('My Reels').first().click({ timeout: 15000 });

  // ConfidenceBanner shows "Rank reels" when kind === 'active' (eligible: true)
  const rankLink = page.getByText('Rank reels').first();
  await rankLink.waitFor({ timeout: 15000 });
  await rankLink.click({ timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Test 1: Desktop (1280px) -- split view, ReelMatchCard
// ---------------------------------------------------------------------------
test('T4760 desktop: near-miss tap on name area registers pick; video tap does not', async ({
  context,
  page,
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openRankingGame(context, page);

  // Split view (isMobile=false) renders ReelMatchCard with data-testid="reel-pick-target"
  const pickTarget = page.locator('[data-testid="reel-pick-target"]').first();
  await pickTarget.waitFor({ timeout: 10000 });

  // -- assertion 1: tap on the VIDEO AREA (above the overlay) does NOT pick --
  let pickCount = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/rank/result')) {
      pickCount += 1;
    }
  });

  // Click 80px ABOVE the top edge of the pick-target div (lands in the video portion)
  const pickBox = await pickTarget.boundingBox();
  await page.mouse.click(pickBox.x + pickBox.width / 2, pickBox.y - 80);
  await page.waitForTimeout(700);

  expect(pickCount, 'tap on video area must NOT fire POST /api/rank/result').toBe(0);
  await saveEvidence(page, 'T4760-desktop-video-tap-no-pick');

  // -- assertion 2: tap on NAME TEXT (top of pick zone, not the visual button) DOES pick --
  // The visual "Pick this one" button has pointer-events:none; only the wrapper fires.
  const nameText = pickTarget.locator('div.font-semibold').first();
  await nameText.click({ timeout: 5000 });
  await page.waitForTimeout(700);

  expect(pickCount, 'name-area tap must fire POST /api/rank/result').toBe(1);
  await saveEvidence(page, 'T4760-desktop-name-tap-picks');
});

// ---------------------------------------------------------------------------
// Test 2: Mobile 375px -- hero mode, HeroMatchup + responsiveSweep
// ---------------------------------------------------------------------------
test('T4760 mobile 375px: hero pick zone works; responsiveSweep captures both layouts', async ({
  context,
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 375, height: 812 });
  await openRankingGame(context, page);

  // Hero mode (isMobile=true, portrait) renders [data-testid="hero-pick-target"]
  const heroPick = page.locator('[data-testid="hero-pick-target"]').first();
  await heroPick.waitFor({ timeout: 10000 });

  // responsiveSweep: captures the rendered pick-target UI at 375px and 1280px.
  // At 1280px the split-view (ReelMatchCard) appears instead of hero mode --
  // both layouts must have no horizontal overflow.
  await responsiveSweep(page);

  // After sweep returns to 375px, HeroMatchup re-mounts (viewport-driven
  // unmount/remount on the 1280->375 transition); wait for the target again.
  await heroPick.waitFor({ timeout: 10000 });

  // Dismiss the first-time HeroIntroModal ("Got it" button).
  const gotIt = page.getByRole('button', { name: 'Got it' });
  if (await gotIt.count()) {
    await gotIt.click({ timeout: 5000 });
  }

  // Wait for the pick gate to clear (PICK_GATE_SEC = 3s; aria-disabled flips false).
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="hero-pick-target"]');
      return el && el.getAttribute('aria-disabled') !== 'true';
    },
    { timeout: 8000 },
  );

  // Track picks
  let heroPickCount = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/rank/result')) {
      heroPickCount += 1;
    }
  });

  // Tap the NAME TEXT inside the hero-pick-target zone (not the visual button).
  // This is "near the button but not on it" -- the whole bottom overlay is the hit area.
  const heroName = heroPick.locator('div.font-semibold').first();
  await heroName.click({ timeout: 5000 });
  await page.waitForTimeout(700);

  expect(heroPickCount, 'hero name-area tap must fire POST /api/rank/result').toBe(1);

  // Final evidence screenshot of the hero layout at 375px
  await saveEvidence(page, 'T4760-mobile-hero-pick-registers');
});
