import { test, expect } from '@playwright/test';
import { loginForCheck, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T17250:C2: paying for a pack with Stripe's test card in the buy window shows
 * "N credits added. Your balance is B." Runs the real flow at a phone and a desktop
 * size: open the credit chip, pick the cheapest pack, fill the test card, press Pay,
 * then read the new balance from the chip and expect the message to name it.
 */
test.setTimeout(170000);

const SIZES = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];

async function payWithTestCard(page) {
  // '/home', not '/': a bare '/' restores the account's resume point (T14980/T16910).
  await page.goto('/home');
  await disableGuidanceForCheck(page);
  const chip = page.getByTitle(/to buy more/i).first();
  await expect(chip).toBeVisible({ timeout: 60000 });
  const before = Number((await chip.textContent()).replace(/\D/g, ''));
  await chip.click();
  const dialog = page.locator('div.fixed.inset-0').filter({ has: page.getByRole('heading', { name: 'Buy credits' }) });
  const packs = dialog.locator('button').filter({ hasText: /\$\d/ });
  await expect(packs.first()).toBeVisible({ timeout: 30000 });
  const texts = await packs.allTextContents();
  const cents = texts.map((t) => Math.round(parseFloat((t.match(/\$(\d+(?:\.\d{2})?)/) || [])[1]) * 100));
  const cheapest = cents.indexOf(Math.min(...cents));
  const packCredits = Number((texts[cheapest].match(/([\d,]+) credits/) || [])[1].replace(/,/g, ''));
  await packs.nth(cheapest).click();

  const pay = page.getByTestId('buy-credits-pay');
  await expect(pay).toBeEnabled({ timeout: 60000 });
  const frame = page.frameLocator('iframe[title*="payment input" i]').first();
  const cardTab = frame.getByText('Card', { exact: true });
  if (await cardTab.isVisible().catch(() => false)) await cardTab.click();
  await frame.locator('input[name="number"]').fill('4242424242424242');
  await frame.locator('input[name="expiry"]').fill('12 / 34');
  await frame.locator('input[name="cvc"]').fill('123');
  const postal = frame.locator('input[name="postalCode"]');
  if (await postal.isVisible().catch(() => false)) await postal.fill('94107');
  await pay.click();

  await expect(pay, 'the buy window closes after payment').toHaveCount(0, { timeout: 90000 });
  // The balance the chip shows after the grant is the one the message must name.
  await expect.poll(async () => Number((await chip.textContent()).replace(/\D/g, '')), { timeout: 60000 })
    .toBe(before + packCredits);
  const message = page.getByRole('alert').filter({ hasText: `${packCredits} credits added. Your balance is ${before + packCredits}.` });
  await expect(message).toBeVisible({ timeout: 10000 });
  // Nothing covers it (the floating Report a problem button sits below the toast stack).
  const box = await message.boundingBox();
  const vp = page.viewportSize();
  expect(box.y >= 0 && box.y + box.height <= vp.height && box.x >= 0 && box.x + box.width <= vp.width).toBe(true);
  const topEl = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="alert"]') !== null,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(topEl, 'the message is the topmost element at its centre').toBe(true);
}

for (const size of SIZES) {
  test(`T17250:C2 test-card payment shows the credits-added message with the new balance at ${size.width}x${size.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size });
    await loginForCheck(context);
    await payWithTestCard(await context.newPage());
    await context.close();
  });
}
