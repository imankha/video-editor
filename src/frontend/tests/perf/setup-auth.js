/**
 * Manual auth setup for perf tests.
 *
 * Run once before tests:
 *   cd src/frontend && node tests/perf/setup-auth.js
 *
 * Opens a headed browser. Log in with the test account.
 * The script auto-detects login and saves browser state for test reuse.
 *
 * Override target: PERF_TARGET=dev node tests/perf/setup-auth.js
 */
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET = process.env.PERF_TARGET || 'prod';
const TARGETS = {
  prod: 'https://app.reelballers.com',
  staging: 'https://reel-ballers-staging.pages.dev',
  dev: 'http://localhost:5173',
};
const baseURL = TARGETS[TARGET] || TARGETS.prod;
const AUTH_DIR = path.join(__dirname, '.auth');
const STATE_FILE = path.join(AUTH_DIR, 'state.json');

async function main() {
  console.log(`\nAuth setup for ${TARGET} (${baseURL})`);
  console.log('A browser will open. Log in with the test account.\n');

  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  await page.goto(baseURL);

  console.log('Waiting for login (5 min timeout)...');

  try {
    await page.waitForFunction(() => {
      return document.querySelector('[data-game-id]') ||
        document.body.innerText.includes('No games yet') ||
        document.body.innerText.includes('YOUR GAMES') ||
        document.body.innerText.includes('Add Game');
    }, { timeout: 300_000 });

    console.log('Login detected. Saving state...');
    await page.waitForTimeout(2000);
  } catch {
    console.log('Timeout. Saving current state anyway...');
  }

  await context.storageState({ path: STATE_FILE });
  console.log(`Saved to ${STATE_FILE}\n`);

  await browser.close();
}

main().catch(console.error);
