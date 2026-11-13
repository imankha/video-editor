/**
 * T15600 - per-criterion acceptance check (group checks protocol).
 *
 * Under-44px touch targets across sign-in, Annotate, Spotlight, Gallery and the share
 * page (Apple HIG / WCAG 2.5.5 minimum), at iPhone-14 and iPad sizes.
 *
 * Coverage (fix round 3, reviewer: the original check only measured 2 of ~20 listed
 * controls and claimed share-page coverage it never had):
 *   - Sign-in (no login): email field, Send code, Verify, Send a new code, Use a
 *     different email -- all 5 of the sign-in screen's own listed controls.
 *   - Public share pages (no login): SharedCollectionView's Share + Download this
 *     highlight, SharedGameView's REEL BALLERS link, SharedAnnotationView's logo link.
 *   - Authenticated real controls (loginForCheck -- a per-container cloned preset
 *     account locally, the seeded e2e-gate account on a deployed target, both with
 *     games/clips/projects -- T11500): Annotate's "1x" speed chip (AnnotateControls'
 *     SpeedControl).
 *   - NOT covered here (documented gap, not claimed): the Plays-list "View
 *     details"/"Jump to play" buttons (ClipListItem/ClipsSidePanel) -- a coarse-pointer
 *     touch context renders Annotate's mobile card layout instead of that sidebar, so
 *     reaching those two controls needs a non-touch/wide-viewport context this check's
 *     "coarse pointer" premise can't combine with the 390px/834px sizes under test.
 *     Frame's small "Portrait"/"Landscape" chip (`focus-shape-chip`, the control this
 *     fix actually touched) only renders once the draft HAS crop positions, which the
 *     seeded fixture does not guarantee (FIXTURE-CONTRACT.md's "Un-started-draft gap")
 *     -- verified live against the current dev stack's seed, it stayed on the
 *     unfixed, pre-positions "Where will you share it?" picker the whole run, so
 *     asserting on it here would be asserting on data availability, not the fix.
 *     Also not covered: Spotlight's number chips / Delete spotlight hit-pad / toast
 *     View+Dismiss, Gallery header, and the share page's "Tap to unmute" control --
 *     reaching a highlight region or a toast needs interaction setup beyond this
 *     round's scope; "Tap to unmute" is VideoControls' pre-existing IS_COARSE padding
 *     (untouched by this fix) rather than a coarse-pointer Tailwind floor, so it isn't
 *     part of this fix's regression surface.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T15600.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { openGameInAnnotate } from '../helpers/realAuth';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

const IPHONE_14 = { width: 390, height: 844 };
const IPAD = { width: 834, height: 1194 };
const VIEWPORTS = [['iPhone 14', IPHONE_14], ['iPad', IPAD]];

async function goToSignInScreen(page) {
  await page.goto('/');
  const emailField = page.getByLabel(/email address/i);
  const useRealSignIn = page.getByRole('button', { name: 'Use the real sign-in screen' });
  await expect(emailField.or(useRealSignIn)).toBeVisible({ timeout: 30000 });
  if (await useRealSignIn.isVisible().catch(() => false)) await useRealSignIn.click();
  await expect(emailField).toBeVisible({ timeout: 30000 });
}

async function reachCodeStep(page) {
  await page.route('**/api/auth/send-otp', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true }),
  }));
  await goToSignInScreen(page);
  await page.getByLabel(/email address/i).fill(`t15600-check-${Date.now()}@example.com`);
  await page.getByText('Send code', { exact: true }).click();
  await expect(page.getByText(/6-digit code/i)).toBeVisible({ timeout: 30000 });
}

async function assertAtLeast44(locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

async function newCoarseContext(browser, viewport) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
  return { context, page: await context.newPage() };
}

for (const [label, viewport] of VIEWPORTS) {
  test(`T15600:C1 - sign-in screen controls are >=44x44 on ${label}`, async ({ browser }) => {
    const { context, page } = await newCoarseContext(browser, viewport);
    try {
      await goToSignInScreen(page);
      await assertAtLeast44(page.getByLabel(/email address/i));
      await page.getByLabel(/email address/i).fill(`t15600-check-${Date.now()}@example.com`);
      await assertAtLeast44(page.getByText('Send code', { exact: true }));

      await reachCodeStep(page);
      await assertAtLeast44(page.getByRole('button', { name: 'Verify' }));
      await assertAtLeast44(page.getByText('Send a new code', { exact: true }));
      await assertAtLeast44(page.getByText('Use a different email', { exact: true }));
    } finally {
      await context.close();
    }
  });

  test(`T15600:C1 - public share page controls are >=44x44 on ${label}`, async ({ browser }) => {
    const { context, page } = await newCoarseContext(browser, viewport);
    try {
      // SharedCollectionView: route-mocked (same pattern as
      // shared-viewer-affordance-gating.spec.js) so the viewer renders without a
      // real share.
      const SHARE_TOKEN = 'abc123def456';
      await page.route(`**/api/shared/collection/${SHARE_TOKEN}`, (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          title: 'Game highlights',
          aspect_ratio: '9:16',
          members: [{ id: 1, name: 'Goal vs Carlsbad', presigned_url: 'about:blank', duration: 10 }],
        }),
      }));
      await page.goto(`/shared/collection/${SHARE_TOKEN}`);
      await assertAtLeast44(page.getByRole('button', { name: 'Share' }));
      await assertAtLeast44(page.getByRole('button', { name: /Download this highlight/i }));

      // SharedGameView: the REEL BALLERS header link only renders in the 'ready'
      // state, so mock a minimal successful resolve (same shape the real
      // /api/shared/game/{token} endpoint returns).
      await page.route('**/api/shared/game/deadbeef0000', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ game_name: 'U10 vs Rivals', game_date: '2026-01-01', clips: [] }),
      }));
      await page.goto('/shared/game/deadbeef0000');
      await assertAtLeast44(page.getByRole('link', { name: 'REEL BALLERS' }));

      // SharedAnnotationView: a bogus teammate token hits the 'error' state, which
      // renders the same Shell (logo link) as every other state.
      await page.goto('/shared/teammate/deadbeef0001');
      await expect(page.getByText('ReelBallers')).toBeVisible({ timeout: 30000 });
      await assertAtLeast44(page.getByRole('link').filter({ hasText: 'ReelBallers' }));
    } finally {
      await context.close();
    }
  });

  test(`T15600:C1 - authenticated Annotate speed chip is >=44x44 on ${label}`, async ({ browser }) => {
    const { context, page } = await newCoarseContext(browser, viewport);
    try {
      await loginForCheck(page);

      const gamesRes = await page.request.get(checkApi('/games'));
      const { games } = await gamesRes.json();
      const activeGame = games.find((g) => g.storage_status !== 'expired') ?? games[0];
      expect(activeGame).toBeTruthy();
      await openGameInAnnotate(page, activeGame.id);
      await expect(page.locator('video').first()).toBeVisible({ timeout: 30000 });
      await assertAtLeast44(page.getByRole('button', { name: '1x', exact: true }));
    } finally {
      await context.close();
    }
  });
}
