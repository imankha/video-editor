import { chromium } from 'playwright';

async function run() {
  const width = parseInt(process.argv[2]) || 375;
  const height = parseInt(process.argv[3]) || 812;

  console.log(`Launching browser at ${width}x${height}...`);
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

  // Check overflow
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  console.log('Overflow:', JSON.stringify(overflow));

  // Keep browser open for user review
  console.log('Browser open -- review and press Ctrl+C when done');
  await new Promise(() => {}); // Keep alive
}

run().catch(console.error);
