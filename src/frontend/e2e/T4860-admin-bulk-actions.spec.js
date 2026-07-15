// T4860 — Admin Bulk User Actions live-drive QA.
//
// Drives the admin panel AS A REAL ADMIN (imankh@gmail.com via dev-login) and
// asserts on what the user SEES: selection mode, bulk grant credits (table
// balances update without reload), bulk-email test-send, and the two-step
// confirm. Email runs in dev-mode (no RESEND_API_KEY in the dev .env) so no real
// mail is sent; the final bulk-send confirm is intentionally NOT clicked.
//
// Evidence lands in <repo>/qa/ via saveEvidence / responsiveSweep.
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

/** Read a row's Credits cell (the cell that holds the per-row "Grant credits"
 * Plus button), returning an integer or null for the "—" placeholder. */
async function readCredits(row) {
  const cell = row.locator('td:has([title="Grant credits"])');
  const text = (await cell.innerText()).trim();
  const m = text.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

test('T4860 admin bulk grant + email test-send + confirm', async ({ context, page }) => {
  test.setTimeout(120000);
  await loginAsRealUser(context, ADMIN_EMAIL);
  await page.goto('/');
  await expect(page.getByRole('button', { name: ADMIN_EMAIL })).toBeVisible({ timeout: 30000 });

  // The dev-login helper injects the session cookie directly, bypassing the
  // frontend login handler that normally fires checkAdmin() — so trigger the
  // real admin-status check, which makes the (admin-only) header button appear.
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    await useAuthStore.getState().checkAdmin();
  });

  // Enter the admin panel via the header Admin button (admin-only).
  const adminBtn = page.locator('[title="Admin Panel"]');
  await adminBtn.waitFor({ state: 'visible', timeout: 30000 });
  await adminBtn.click();

  // The admin screen renders several tables (analytics + users). Scope to the
  // users table — the only one with per-row "Grant credits" buttons.
  const usersTable = page.locator('table').filter({ has: page.locator('[title="Grant credits"]') });
  const rows = usersTable.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 30000 });
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
  await saveEvidence(page, 'ac1-admin-user-table');

  // ---- AC1: selection mode + live count ------------------------------------
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const row0 = rows.nth(0);
  const row1 = rows.nth(1);
  // Leading checkbox column: the first cell's button toggles the row.
  await row0.locator('td').first().locator('button').click();
  await row1.locator('td').first().locator('button').click();
  await expect(page.getByText('2 selected')).toBeVisible();
  await saveEvidence(page, 'ac1-two-selected');

  // ---- AC2: bulk grant credits, balances update WITHOUT reload -------------
  const before0 = await readCredits(row0);
  const before1 = await readCredits(row1);
  const urlBefore = page.url();

  // Bar button "Grant Credits" (capital C); a case-sensitive regex avoids the
  // per-row "Grant credits" title collision.
  await page.getByRole('button', { name: /^Grant Credits$/ }).click();
  await expect(page.getByText('Grant credits to 2 users')).toBeVisible();
  await page.locator('input[type="number"]').fill('1');
  await page.getByRole('button', { name: /Grant to 2 users/ }).click();
  await expect(page.getByText(/Granted 2/)).toBeVisible({ timeout: 15000 });
  await saveEvidence(page, 'ac2-bulk-grant-summary');
  // Scope to the modal — the Select toggle also reads "Done" in selection mode.
  await page.locator('.fixed.inset-0').getByRole('button', { name: 'Done' }).click();

  // No navigation happened — same URL, table still mounted.
  expect(page.url()).toBe(urlBefore);
  const after0 = await readCredits(row0);
  const after1 = await readCredits(row1);
  // Each granted row now shows a numeric balance; if it was numeric before, it
  // incremented by exactly 1 (the live store patch, no page reload).
  expect(after0).not.toBeNull();
  expect(after1).not.toBeNull();
  if (before0 !== null) expect(after0).toBe(before0 + 1);
  if (before1 !== null) expect(after1).toBe(before1 + 1);
  await saveEvidence(page, 'ac2-balances-updated-no-reload');

  // ---- AC4 + AC5: bulk email test-send + two-step confirm ------------------
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await rows.nth(0).locator('td').first().locator('button').click();
  await rows.nth(1).locator('td').first().locator('button').click();
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('button', { name: /^Send Email$/ }).click();

  const emailModal = page.locator('.fixed.inset-0');
  await expect(emailModal.getByText(/2 recipients .* hello@reelballers\.com/)).toBeVisible();
  await emailModal.locator('input[type="text"]').fill('QA: New features are live');
  await emailModal.locator('textarea').fill('Hi there,\n\nWe just shipped bulk admin actions.\n\nThanks!');

  // AC4: test-send to the admin's own address (dev-mode -> logged success).
  await page.getByRole('button', { name: 'Send test to me' }).click();
  await expect(page.getByText(/Test sent to/)).toBeVisible({ timeout: 15000 });
  await saveEvidence(page, 'ac4-test-send-confirmed');

  // AC5: first Send is a confirm step showing the recipient count. Do NOT click
  // the second time — we don't want to send to real dev users.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('button', { name: /Really send to 2 users\?/ })).toBeVisible();
  await saveEvidence(page, 'ac5-two-step-confirm');

  // ---- Responsive sweep on the admin table (UI change) ---------------------
  // Close the modal first (X button) so the sweep captures the table.
  await page.locator('.fixed.inset-0 button').first().click();
  await responsiveSweep(page);
});
