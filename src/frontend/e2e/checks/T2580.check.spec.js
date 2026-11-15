import { test, expect } from '@playwright/test';
import { loginAsRealUser } from '../helpers/realAuth';

/**
 * T2580:C2 - the admin upload panel shows how many recent uploads cannot start at once
 * (their index sits at the end of the file). Admin-only panel, so this logs in as the
 * admin account (T7420/T15690 precedent). The figure on screen is the endpoint's own
 * index_checks.not_at_front for the panel's window, read from the response, never hard-coded.
 */
test.setTimeout(240000);

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const URL_PART = '/api/admin/upload-failures';

test('T2580:C2 Upload Failures panel shows how many recent uploads cannot start at once', async ({ browser }) => {
  const context = await browser.newContext();
  await loginAsRealUser(context, ADMIN_EMAIL);
  const page = await context.newPage();
  await page.goto('/admin');
  const section = page.getByRole('button', { name: 'Upload Failures', exact: true });
  await expect(section).toBeVisible({ timeout: 90000 });
  await section.click();
  const loadButton = page.getByRole('button', { name: /Load upload failures/ });
  await expect(loadButton).toBeEnabled({ timeout: 30000 });
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(URL_PART) && r.request().method() === 'GET', { timeout: 90000 }),
    loadButton.click(),
  ]);
  expect(response.ok(), `${URL_PART} -> ${response.status()}`).toBeTruthy();
  const body = await response.json();
  expect(body.index_checks, 'the endpoint reports index checks for the window').toBeTruthy();
  const { checked, not_at_front: notAtFront } = body.index_checks;
  expect(notAtFront).toBeLessThanOrEqual(checked);

  const card = page.getByTestId('upload-index-checks');
  await expect(card).toContainText('Cannot start at once', { timeout: 30000 });
  await expect(page.getByTestId('upload-index-not-at-front')).toHaveText(String(notAtFront));
  await expect(card).toContainText(`of ${checked} uploads checked`);
  await context.close();
});
