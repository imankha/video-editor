import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';
import { loginAsRealUser } from '../helpers/realAuth';

/**
 * T17150 - Admin Panel numbers agree with each other at 1440x900. A dev-picker account is an
 * admin on a dev stack (T16430); a deployed target logs in as the real admin account, like the
 * other admin checks (T17160, T16660).
 */
test.setTimeout(240000);
test.use({ viewport: { width: 1440, height: 900 } });

const ADMIN_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

async function openAdmin(page) {
  if (process.env.E2E_BASE_URL) {
    await loginAsRealUser(page, ADMIN_EMAIL);
  } else {
    await loginForCheck(page);
  }
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin Panel' })).toBeVisible({ timeout: 60000 });
}

// The dimension table on screen: the one with an "Upload tries" header.
function dimensionTable(page) {
  return page.locator('table').filter({ has: page.locator('th', { hasText: /^Upload tries$/ }) });
}

async function readDimensionRows(page) {
  const table = dimensionTable(page);
  await expect(table).toBeVisible({ timeout: 60000 });
  return table.evaluate((t) => {
    const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
    const rateAt = heads.indexOf('Upload Success');
    const triesAt = heads.indexOf('Upload tries');
    return [...t.querySelectorAll('tbody tr')]
      .map(tr => [...tr.querySelectorAll('td')])
      .filter(tds => tds.length > triesAt)
      .map(tds => ({ label: tds[0].textContent.trim(), rate: tds[rateAt].textContent.trim(), tries: tds[triesAt].textContent.trim() }));
  });
}

test('T17150:C2 in every Dimension table successes never exceed tries and the rate is successes / tries', async ({ page }) => {
  await openAdmin(page);
  let checked = 0;
  for (const dimension of ['Campaigns', 'Cohorts', 'Builds']) {
    await page.getByRole('button', { name: dimension, exact: true }).click();
    const rows = await readDimensionRows(page);
    for (const row of rows) {
      const where = `${dimension} row "${row.label}": rate "${row.rate}", tries cell "${row.tries}"`;
      const m = row.tries.match(/^(\d+) of (\d+)$/);
      expect(m, `${where} should read "<successes> of <tries>"`).not.toBeNull();
      const successes = Number(m[1]);
      const tries = Number(m[2]);
      expect(successes, where).toBeLessThanOrEqual(tries);
      if (tries > 0) {
        expect(row.rate, where).toBe(`${(Math.round((successes / tries) * 10000) / 100).toFixed(2)}%`);
      } else {
        expect(['--', 'not tracked'], where).toContain(row.rate);
      }
      checked += 1;
    }
  }
  expect(checked, 'no Dimension table had a row to check').toBeGreaterThan(0);
});

test('T17150:C3 a Campaigns table row is listed in Manage Campaigns or says why it is not', async ({ page }) => {
  await openAdmin(page);
  await page.getByRole('button', { name: 'Campaigns', exact: true }).click();
  const table = dimensionTable(page);
  await expect(table).toBeVisible({ timeout: 60000 });
  const rows = await table.evaluate(t => [...t.querySelectorAll('tbody tr')]
    .map(tr => tr.querySelector('td'))
    .filter(Boolean)
    .filter(td => !/^Unattributed/.test(td.textContent.trim()))
    .map(td => ({ name: (td.firstChild?.textContent || '').trim(), text: td.textContent.trim() })));
  expect(rows.length, 'the Campaigns table has no rows').toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Manage Campaigns' }).click();
  await expect(page.getByRole('heading', { name: 'Manage Campaigns' })).toBeVisible({ timeout: 60000 });
  const modal = page.locator('div.fixed.inset-0').filter({ has: page.getByRole('heading', { name: 'Manage Campaigns' }) });
  await expect(modal.getByText(/Loading/)).toHaveCount(0, { timeout: 60000 });
  const listed = await modal.locator('li').allTextContents();

  for (const row of rows) {
    const inManage = listed.some(text => text.includes(row.name));
    const saysWhy = row.text.includes('not in Manage Campaigns');
    expect(inManage || saysWhy, `Campaigns row "${row.text}" is neither in Manage Campaigns nor marked`).toBe(true);
  }
});
