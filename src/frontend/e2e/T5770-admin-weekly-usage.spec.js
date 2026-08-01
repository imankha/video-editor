// T5770 — Admin per-user weekly-usage columns live-drive QA.
//
// Drives the admin panel AS A REAL ADMIN (imankh@gmail.com via dev-login) and
// asserts on what the admin SEES: the two new right-aligned columns "Avg/wk"
// and "Last 7d", rendered with the real backend numbers for a deterministically
// seeded user (scripts/_t5770_qa_seed.py):
//     total 1400s over 2 weeks  -> Avg/wk = fmtDuration(700)  = "11m"
//     daily 100+200+50 (last 7d) -> Last 7d = fmtDuration(350) = "5m"
//     (an older 999s bucket at day-10 is EXCLUDED — no backfill / no leakage)
//
// It cross-checks the RENDERED cell text against the /api/admin/users JSON so
// the assertion proves rendered == real API value (no fabrication), and runs a
// responsive sweep (the table just gained two columns — overflow risk).
//
// Evidence lands in <repo>/qa/ via saveEvidence / responsiveSweep.
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const QA_EMAIL = 't5770-qa@test.local';

// Mirror of UserTable.jsx fmtDuration (hours-only, T5660) so the expected
// rendered strings are derived, not hardcoded twice.
function fmtDuration(seconds) {
  if (!seconds) return '—';
  if (seconds < 60) return '<1m';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

test('T5770 admin Avg/wk + Last 7d columns render real numbers', async ({ context, page }) => {
  skipOnDeployedTarget(test, "import()s /src/stores/authStore.js to call checkAdmin() (Vite-dev path; 404s on a deployed build)");
  test.setTimeout(120000);

  await loginAsRealUser(context, ADMIN_EMAIL);
  await page.goto('/');
  await expect(page.getByRole('button', { name: ADMIN_EMAIL })).toBeVisible({ timeout: 30000 });
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    await useAuthStore.getState().checkAdmin();
  });

  const adminBtn = page.locator('[title="Admin Panel"]');
  await adminBtn.waitFor({ state: 'visible', timeout: 30000 });
  await adminBtn.click();

  const usersTable = page.locator('table').filter({ has: page.locator('[title="Grant credits"]') });
  await expect(usersTable.locator('tbody tr').first()).toBeVisible({ timeout: 30000 });

  // ---- AC1: both new columns are present, right after Usage ------------------
  const headers = usersTable.locator('thead th');
  const headerText = await headers.allInnerTexts();
  // Header text renders visually uppercase via CSS (`text-xs uppercase`) but
  // `innerText` reflects the CSS-transformed text, not the source label — so
  // compare case-insensitively rather than against the literal COLUMNS label.
  const trimmed = headerText.map(h => h.trim().toUpperCase());
  const avgIdx = trimmed.findIndex(h => h.startsWith('AVG/WK'));
  const last7Idx = trimmed.findIndex(h => h.startsWith('LAST 7D'));
  expect(avgIdx, 'Avg/wk header present').toBeGreaterThan(-1);
  expect(last7Idx, 'Last 7d header present').toBeGreaterThan(-1);
  const usageIdx = trimmed.findIndex(h => h.startsWith('USAGE'));
  expect(avgIdx).toBe(usageIdx + 1);   // right after Usage
  expect(last7Idx).toBe(usageIdx + 2);
  await saveEvidence(page, 'criterion-1-two-columns-present');

  // ---- AC2/AC4: the API returns both fields; last-7d is REAL recorded data ---
  const apiUsers = await page.evaluate(async () => {
    const { default: apiFetch } = await import('/src/utils/apiFetch.js');
    const res = await apiFetch('/api/admin/users?page=1&page_size=50');
    return (await res.json()).users;
  });
  for (const u of apiUsers) {
    expect(typeof u.avg_weekly_seconds, `avg_weekly_seconds on ${u.email}`).toBe('number');
    expect(typeof u.last_7d_seconds, `last_7d_seconds on ${u.email}`).toBe('number');
  }
  const qa = apiUsers.find(u => u.email === QA_EMAIL);
  expect(qa, 'seeded QA user present in admin list').toBeTruthy();
  // Derivation + trailing-window SUM are exactly right (999s @ day-10 excluded).
  expect(qa.avg_weekly_seconds).toBe(700);
  expect(qa.last_7d_seconds).toBe(350);

  // ---- AC1 (rendered): the seeded row shows the derived fmtDuration strings --
  await usersTable.page().locator('input[placeholder="Search email..."]').fill('t5770-qa');
  const qaRow = usersTable.locator('tbody tr').filter({ hasText: QA_EMAIL });
  await expect(qaRow).toHaveCount(1);
  const cells = qaRow.locator('td');
  await expect(cells.nth(avgIdx)).toHaveText(fmtDuration(700));   // "11m"
  await expect(cells.nth(last7Idx)).toHaveText(fmtDuration(350)); // "5m"
  await saveEvidence(page, 'criterion-2-rendered-cells-match-api');

  // Clear the filter so the sweep captures the full table.
  await usersTable.page().locator('input[placeholder="Search email..."]').fill('');

  // ---- AC (responsive): two extra columns must not overflow horizontally -----
  await responsiveSweep(page);
  await saveEvidence(page, 'criterion-5-responsive-no-overflow');
});
