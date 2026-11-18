import { test, expect } from '@playwright/test';
import { loginForCheck, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T16890: the Buy credits card step (Stripe card form + "Pay $X") grew taller than the
 * screen and could not be scrolled, so the Pay button sat below the bottom and the
 * header's close control above the top. Each size runs the repro: open the credit chip,
 * pick the smallest pack, expand Card, then at each size scroll the dialog the way the
 * input device does (mouse wheel, or a touch swipe) until Pay is on screen, scroll back to
 * the header, and finally press its close control.
 */
test.setTimeout(170000);

const PHONES = [{ width: 390, height: 844 }, { width: 360, height: 640 }];
const TOUCH_SIZES = [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }];
const DESKTOPS = [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }];

async function openCardStep(page) {
  // '/home', not '/': a bare '/' cold load restores the account's resume point (T14980), and
  // on staging the shared account's point is an editor that opens a few seconds later,
  // unmounting the Buy credits dialog this check just opened (T16910).
  await page.goto('/home');
  await disableGuidanceForCheck(page);
  await page.getByTitle(/to buy more/i).first().click();
  const dialog = page.locator('div.fixed.inset-0').filter({ has: page.getByRole('heading', { name: 'Buy credits' }) });
  const packs = dialog.locator('button').filter({ hasText: /\$\d/ });
  await expect(packs.first()).toBeVisible({ timeout: 30000 });
  // The smallest pack is the cheapest one.
  const texts = await packs.allTextContents();
  const cents = texts.map((t) => Math.round(parseFloat((t.match(/\$(\d+(?:\.\d{2})?)/) || [])[1]) * 100));
  await packs.nth(cents.indexOf(Math.min(...cents))).click();

  const pay = page.getByTestId('buy-credits-pay');
  await expect(pay).toBeEnabled({ timeout: 60000 });
  const card = page.frameLocator('iframe[title*="payment input" i]').getByText('Card', { exact: true });
  if (await card.isVisible().catch(() => false)) await card.click();
  const form = pay.locator('xpath=ancestor::form');
  // The header's last button is the close (X) control.
  return { pay, form, close: form.locator('xpath=./div[1]/button[last()]') };
}

// Wait for the card form to finish growing (the optional contact fields come in last).
async function waitFormSettled(form) {
  let last = -1;
  await expect.poll(async () => {
    const h = (await form.boundingBox())?.height ?? 0;
    const settled = h === last;
    last = h;
    return settled;
  }, { timeout: 30000, intervals: [1000] }).toBe(true);
}

async function scrollBy(page, cdp, form, dy) {
  const box = await form.boundingBox();
  const vp = page.viewportSize();
  // Inside the dialog's left padding (not over the Stripe frame), clamped on screen.
  const x = Math.max(4, box.x - 12);
  const y = Math.min(Math.max(vp.height / 2, 20), vp.height - 20);
  if (cdp) {
    // A finger swipe: drag up to scroll down.
    const [px, y0, y1] = [Math.round(x), Math.round(y + dy / 2), Math.round(y - dy / 2)];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: px, y: y0 }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: px, y: Math.round(y0 + (y1 - y0) * (i / 10)) }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, dy);
  }
  await page.waitForTimeout(250);
}

function onScreen(box, vp) {
  return !!box && box.y >= 0 && box.y + box.height <= vp.height && box.x >= 0 && box.x + box.width <= vp.width;
}

/** Open the card step once, then at each size scroll down to Pay and back up to close; close at the end. */
async function checkSizes(page, sizes, touch) {
  await page.setViewportSize(sizes[0]);
  const { pay, form, close } = await openCardStep(page);
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  for (const size of sizes) {
    await page.setViewportSize(size);
    await waitFormSettled(form);
    const vp = page.viewportSize();
    const label = `${size.width}x${size.height}${touch ? ' touch' : ''}`;

    for (let i = 0; i < 15 && !onScreen(await pay.boundingBox(), vp); i++) await scrollBy(page, cdp, form, 300);
    expect(onScreen(await pay.boundingBox(), vp), `${label}: Pay is on screen after scrolling down`).toBe(true);

    for (let i = 0; i < 15 && !onScreen(await close.boundingBox(), vp); i++) await scrollBy(page, cdp, form, -300);
    expect(onScreen(await close.boundingBox(), vp), `${label}: close control is on screen after scrolling up`).toBe(true);
  }
  const box = await close.boundingBox();
  if (touch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await close.click();
  await expect(pay, 'the close control closes the dialog').toHaveCount(0, { timeout: 10000 });
}

test('T16890:C1 phone sizes: Pay and close are reachable on the card step', async ({ browser }) => {
  const context = await browser.newContext();
  await loginForCheck(context);
  await checkSizes(await context.newPage(), PHONES, false);
  await context.close();
});

test('T16890:C2 tablet and desktop sizes, touch on phone and tablet: the whole card form is reachable', async ({ browser }) => {
  const touchContext = await browser.newContext({ hasTouch: true, isMobile: true });
  await loginForCheck(touchContext);
  await checkSizes(await touchContext.newPage(), TOUCH_SIZES, true);
  await touchContext.close();

  const context = await browser.newContext();
  await loginForCheck(context);
  await checkSizes(await context.newPage(), DESKTOPS, false);
  await context.close();
});
