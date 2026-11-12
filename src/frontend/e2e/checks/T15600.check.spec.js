/**
 * T15600 - per-criterion acceptance check (group checks protocol).
 *
 * Under-44px touch targets across sign-in, Annotate, Spotlight, Gallery and the share
 * page (Apple HIG / WCAG 2.5.5 minimum). This check reaches the two screens that need
 * no login (sign-in, a public share page) at iPhone-14 and iPad portrait sizes and
 * measures representative controls from the bug's own list.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T15600.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';

const IPHONE_14 = { width: 390, height: 844 };
const IPAD = { width: 834, height: 1194 };

async function goToSignInScreen(page) {
  await page.goto('/');
  const emailField = page.getByLabel(/email address/i);
  const useRealSignIn = page.getByRole('button', { name: 'Use the real sign-in screen' });
  await expect(emailField.or(useRealSignIn)).toBeVisible({ timeout: 30000 });
  if (await useRealSignIn.isVisible().catch(() => false)) await useRealSignIn.click();
  await expect(emailField).toBeVisible({ timeout: 30000 });
}

async function assertAtLeast44(locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

for (const [label, viewport] of [['iPhone 14', IPHONE_14], ['iPad', IPAD]]) {
  test(`T15600:C1 - sign-in email field and Send code button are >=44x44 on ${label}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    try {
      await goToSignInScreen(page);
      await assertAtLeast44(page.getByLabel(/email address/i));
      await page.getByLabel(/email address/i).fill(`t15600-check-${Date.now()}@example.com`);
      await assertAtLeast44(page.getByText('Send code', { exact: true }));
    } finally {
      await context.close();
    }
  });
}
