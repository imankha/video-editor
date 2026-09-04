/**
 * T7350 QA — Share routing uses POINTER CAPABILITY, never a UA sniff.
 *
 * Bug: `DownloadsPanel.webShareReel` gated the native-share attempt on
 * `useWebShare().isMobile`, which came from a `navigator.userAgent` regex
 * (`isMobileDevice()`). Real mobile users on in-app webviews / desktop-site
 * mode / unlisted UA strings were misclassified as desktop and dropped onto the
 * custom `ShareModal` instead of the native OS share sheet. Fix (T7350): derive
 * `isMobile` from `useIsCoarsePointer()` (`(pointer: coarse)` matchMedia), the
 * same capability check ReelTile/DraftTile already use.
 *
 * This spec live-drives the REAL account (dev-login) and proves the two
 * routing directions the fix must keep straight, WITHOUT any UA string:
 *
 *   A. FINE pointer (desktop): clicking Share opens ShareModal directly and
 *      NEVER calls navigator.share() — T5220's desktop fix stays intact even
 *      though we install a navigator.share() stub that a Chromium build would
 *      expose.
 *   B. COARSE pointer (touch): clicking Share DOES attempt navigator.share()
 *      (the native OS sheet) and does NOT open ShareModal.
 *
 * The real-device coarse-pointer native-share sheet itself is an OS surface that
 * cannot be asserted in a container — Playwright's touch emulation flips the
 * `(pointer: coarse)` media query (verified inline) and we assert our code
 * REACHES navigator.share; the OS sheet render is the supervisor/device step.
 *
 * Run: bash scripts/dev-verify.sh e2e/T7350-mobile-share-routing.qa.spec.js
 */
import { test, expect, devices } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

// Install a navigator.share() spy that records calls on window (does not open a
// real sheet). A Chromium desktop build that exposes navigator.share() is
// exactly the T5220 trap this stub reproduces.
async function stubNavigatorShare(context) {
  await context.addInitScript(() => {
    window.__shareCalls = [];
    // URL-only share => LINK_ONLY path; resolve so the handler completes.
    navigator.share = (data) => { window.__shareCalls.push(data); return Promise.resolve(); };
    navigator.canShare = () => false; // force LINK_ONLY (no file fetch in a test)
  });
}

async function openMyReelsAndFirstReel(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: /^Highlights/ }).first().click();
  const panel = page.getByTestId('highlights-tab-panel');
  const shown = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
  if (!shown) {
    const headers = panel.getByTestId('collapsible-group-header');
    await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const n = await headers.count();
    for (let i = 0; i < n; i++) {
      await headers.nth(i).click({ timeout: 3000 }).catch(() => {});
      const appeared = await panel.getByTestId('reel-card').first()
        .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
      if (appeared) break;
    }
  }
  return panel;
}

test('A: FINE pointer (desktop) — Share opens ShareModal, never navigator.share (T5220 stays fixed) @staging-gate @gate-b', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await stubNavigatorShare(context);
  await loginAsRealUser(context, EMAIL, PROFILE);
  const page = await context.newPage();

  const cap = await page.evaluate(() => ({
    coarse: window.matchMedia('(pointer: coarse)').matches,
    hasShare: typeof navigator.share === 'function',
  }));
  expect(cap.coarse, 'desktop context is a FINE pointer').toBe(false);
  expect(cap.hasShare, 'navigator.share stub is present (the T5220 Chromium trap)').toBe(true);

  const panel = await openMyReelsAndFirstReel(page);
  const hasReels = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
  test.skip(!hasReels, 'no published reels on this account/profile');
  const tile = panel.getByTestId('reel-card').first();

  await tile.hover();
  await tile.getByRole('button', { name: 'More actions' }).click();
  await page.getByText('Share', { exact: true }).click();

  // ShareModal heading is `Share "<name>"` — its presence proves setSharingDownload fired.
  await expect(page.getByText(/^Share "/).first()).toBeVisible({ timeout: 15000 });
  const shareCalls = await page.evaluate(() => window.__shareCalls.length);
  expect(shareCalls, 'navigator.share must NOT be called on a fine pointer').toBe(0);
  await saveEvidence(page, 'T7350-A-fine-pointer-opens-sharemodal');
  await context.close();
});

test('B: COARSE pointer (touch) — Share attempts navigator.share (native sheet), no ShareModal @staging-gate @gate-b', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  await stubNavigatorShare(context);
  await loginAsRealUser(context, EMAIL, PROFILE);
  const page = await context.newPage();

  const coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
  expect(coarse, 'iPhone context reports a COARSE pointer').toBe(true);

  const panel = await openMyReelsAndFirstReel(page);
  const hasReels = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
  test.skip(!hasReels, 'no published reels on this account/profile');
  const tile = panel.getByTestId('reel-card').first();

  // Coarse pointer: kebab is persistent; open it and tap Share. Use native DOM
  // click() throughout — the bottom sheet slides in (animated), so Playwright's
  // stability check would spin on the moving element; a native click doesn't.
  await tile.getByRole('button', { name: 'More actions' }).evaluate((el) => el.click());
  const shareItem = page.getByText('Share', { exact: true }).first();
  await shareItem.waitFor({ state: 'visible', timeout: 15000 });
  await shareItem.evaluate((el) => el.click());

  await expect.poll(
    () => page.evaluate(() => window.__shareCalls.length),
    { timeout: 15000, message: 'coarse pointer must reach navigator.share (native OS sheet)' },
  ).toBeGreaterThan(0);
  // ShareModal must NOT have opened on the native path.
  await expect(page.getByText(/^Share "/)).toHaveCount(0);
  await saveEvidence(page, 'T7350-B-coarse-pointer-native-share');
  await context.close();
});
