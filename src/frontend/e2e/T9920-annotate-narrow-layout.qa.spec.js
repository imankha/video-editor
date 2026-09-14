/**
 * T9920 Bug B — Annotate plays panel at narrow widths.
 *
 * The `ClipsSidePanel` used to mount via a raw `hidden sm:flex` CSS gate (visible
 * from 640px up) while every JS decision in the app treats up to 1023px as mobile
 * (`useIsMobile()` = `max-width: 1023px`). That 640-1023px gap left a permanent,
 * undismissable 352px panel that squeezed the canvas to ~250px at 699px, with the
 * ONLY dismiss toggle ("Show clips") gated `flex sm:hidden` — i.e. it only existed
 * BELOW 640px. The fix moves the panel onto `useMobileClipPanel = isMobile &&
 * !isLandscape`: a dismissable off-canvas drawer across the whole 640-1023px range,
 * while landscape phones (T4933) keep the in-flow desktop panel.
 *
 * This asserts BEHAVIOUR (which layout renders + no horizontal overflow), not
 * pixels. REAL-BROWSER ONLY against a real account with a clipped game (game 6).
 * NOTE: authored as a QA artifact — needs Playwright browsers + a live backend, so
 * it is NOT run in the /dotask container; run it against a real stack / CI.
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { saveEvidence, assertNoHorizontalOverflow } from './helpers/qa.js';

const AUDIT_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const AUDIT_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 6);

const desktopPanel = (page) => page.locator('[data-sidebar="clips"]');
const showClipsToggle = (page) => page.getByTitle('Show clips');

async function openGame(page) {
  await openGameInAnnotate(page, GAME_ID);
  await page.getByTestId('overlay-video-stage').first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
  // The clip markers mount once annotations load — a good "screen is ready" signal.
  await page.locator('.clip-marker').first().waitFor({ state: 'visible', timeout: 30000 });
}

test.describe('T9920 Annotate narrow-width plays panel', () => {
  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
  });

  // Narrow desktop/tablet (FINE pointer, so useIsMobile keys purely on max-width:
  // 1023px). 699 + 768 are the dead-zone widths; the in-flow 352px panel must be
  // GONE and the "Show clips" drawer toggle present, with no horizontal overflow.
  for (const width of [699, 768, 1023]) {
    test(`@ ${width}px (narrow desktop): plays panel collapses to a dismissable drawer`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openGame(page);

      await expect(
        desktopPanel(page),
        `@ ${width}px: the in-flow 352px panel must NOT be permanently mounted`
      ).toHaveCount(0);
      await expect(
        showClipsToggle(page),
        `@ ${width}px: a "Show clips" toggle must exist to open the plays drawer`
      ).toBeVisible();

      await assertNoHorizontalOverflow(page);

      // The toggle opens the off-canvas drawer, which mounts the panel on demand.
      await showClipsToggle(page).click();
      await expect(
        desktopPanel(page),
        `@ ${width}px: the drawer mounts the plays panel when opened`
      ).toBeVisible();
      await saveEvidence(page, `t9920-bugB_narrow-${width}`);
    });
  }

  // Desktop >=1024px keeps the in-flow panel and shows NO drawer toggle.
  test('@ 1440px (desktop): in-flow plays panel stays mounted, no drawer toggle', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGame(page);
    await expect(desktopPanel(page), '@ 1440px: in-flow panel present').toBeVisible();
    await expect(showClipsToggle(page), '@ 1440px: no mobile drawer toggle').toHaveCount(0);
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 't9920-bugB_desktop-1440');
  });
});

// T4933 landmine guard: a landscape PHONE (>=640px wide, short height) must keep
// the DESKTOP in-flow ClipsSidePanel, NOT the off-canvas drawer — its
// `useIsLandscape()` excludes it from `useMobileClipPanel`. Emulate a real phone
// (touch, isMobile) at 844x390 so the orientation/height media query matches.
test.describe('T9920 landscape-phone keeps the desktop panel (T4933)', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ context }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
  });

  test('844x390 landscape phone renders the in-flow desktop plays panel', async ({ page }) => {
    await openGameInAnnotate(page, GAME_ID);
    await page.locator('.clip-marker').first().waitFor({ state: 'visible', timeout: 30000 });
    await expect(
      desktopPanel(page),
      '844x390 landscape phone must keep the in-flow desktop ClipsSidePanel (T4933)'
    ).toBeVisible();
    await expect(
      showClipsToggle(page),
      '844x390 landscape phone must NOT show the off-canvas drawer toggle'
    ).toHaveCount(0);
    await saveEvidence(page, 't9920-t4933-landscape-phone');
  });
});
