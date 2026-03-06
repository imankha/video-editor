import { chromium } from 'playwright';

async function run() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

  // Check overflow
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  console.log('Overflow at 375px:', JSON.stringify(overflow));

  // Keep browser open for user review
  console.log('Browser open at 375px — review the Annotate screen and press Ctrl+C when done');
  await new Promise(() => {}); // Keep alive
}

run().catch(console.error);
