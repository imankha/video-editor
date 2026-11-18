import { test, expect } from '@playwright/test';
import { loginForCheck, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T17050: the checkout heading's line under "<Pack>: N credits" read "$6.99 · ~ plays"
 * (no number, wrong word) while the pack card said "~10 highlights". At each size, open
 * the credit chip, then for every pack read its card's "~N highlights", pick it, and
 * check the checkout line shows the same "~N highlights" next to the pack's price.
 */
test.setTimeout(170000);

async function checkEveryPack(page) {
  // '/home', not '/': a bare '/' cold load restores the account's resume point (T16910).
  await page.goto('/home');
  await disableGuidanceForCheck(page);
  await page.getByTitle(/to buy more/i).first().click();
  const dialog = page.locator('div.fixed.inset-0').filter({ has: page.getByRole('heading', { name: 'Buy credits' }) });
  const packs = dialog.locator('button').filter({ hasText: /\$\d/ });
  await expect(packs.first()).toBeVisible({ timeout: 30000 });
  const count = await packs.count();
  expect(count, 'at least one pack is offered').toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const cardText = (await packs.nth(i).textContent()).replace(/\s+/g, ' ');
    const highlights = cardText.match(/~(\d+) highlights/)?.[1];
    const price = cardText.match(/\$\d+(?:\.\d{2})?/)?.[0];
    expect(highlights, `pack ${i} card shows ~N highlights: "${cardText}"`).toBeTruthy();
    await packs.nth(i).click();

    const form = page.locator('form').filter({ has: page.getByTestId('buy-credits-pay') });
    const subline = form.locator('xpath=./div[1]//p').first();
    await expect(subline).toBeVisible({ timeout: 60000 });
    await expect(subline, `pack ${i} checkout line matches its card`).toHaveText(`${price} · ~${highlights} highlights`);

    // The header's first button goes back to the pack list.
    await form.locator('xpath=./div[1]/button[1]').click();
    await expect(packs.nth(i)).toBeVisible({ timeout: 30000 });
  }
}

test('T17050:C1 at 390x844 the checkout heading shows each pack\'s ~N highlights', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await loginForCheck(context);
  await checkEveryPack(await context.newPage());
  await context.close();
});

test('T17050:C2 at 1440x900 the checkout heading shows each pack\'s ~N highlights', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await loginForCheck(context);
  await checkEveryPack(await context.newPage());
  await context.close();
});
