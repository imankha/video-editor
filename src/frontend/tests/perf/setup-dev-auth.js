/**
 * Dev auth setup using test-login endpoint.
 *
 * For dev/staging environments where test-login is available.
 * Uses sarkarati@gmail.com user ID for consistent test data.
 *
 * Run: cd src/frontend && node tests/perf/setup-dev-auth.js
 */
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const baseURL = 'http://localhost:5173';
const AUTH_DIR = path.join(__dirname, '.auth');
const STATE_FILE = path.join(AUTH_DIR, 'state.json');

async function main() {
  console.log(`\nDev auth setup (${baseURL})\n`);
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  // Look up the user_id for the target account.
  // Pass PERF_USER_ID to override, or PERF_EMAIL to search.
  const targetEmail = process.env.PERF_EMAIL || 'sarkarati@gmail.com';
  let userId = process.env.PERF_USER_ID || null;

  if (!userId) {
    try {
      const resp = await page.request.get(`http://localhost:8000/api/admin/users`);
      if (resp.ok()) {
        const data = await resp.json();
        const users = data.users || data || [];
        const user = users.find(u => u.email === targetEmail);
        if (user) userId = user.user_id || user.id;
      }
    } catch { /* fall back below */ }
  }

  if (!userId) {
    userId = 'perf-test-user';
    console.log(`  Could not find ${targetEmail}, using generic test user.`);
  } else {
    console.log(`  Found user: ${userId} (${targetEmail})`);
  }

  // Set test headers
  await page.setExtraHTTPHeaders({
    'X-User-ID': userId,
    'X-Test-Mode': 'true',
  });

  // Navigate and trigger test-login
  await page.goto(baseURL);
  const result = await page.evaluate(async (headers) => {
    const res = await fetch('/api/auth/test-login', {
      method: 'POST',
      credentials: 'include',
      headers,
    });
    if (!res.ok) return { error: `test-login failed: ${res.status}` };
    return await res.json();
  }, { 'Content-Type': 'application/json', 'X-User-ID': userId, 'X-Test-Mode': 'true' });

  if (result.error) {
    console.log(`  Auth failed: ${result.error}`);
  } else {
    console.log(`  Authenticated as: ${result.email} (${result.user_id})`);
  }

  await page.reload();
  await page.waitForLoadState('networkidle');

  // Wait for the app to show authenticated state
  try {
    await page.waitForFunction(() => {
      return document.querySelector('[data-game-id]') ||
        document.body.innerText.includes('No games yet') ||
        document.body.innerText.includes('Add Game');
    }, { timeout: 15_000 });
    console.log('  Home page loaded.');
  } catch {
    console.log('  Warning: could not confirm home page loaded.');
  }

  await context.storageState({ path: STATE_FILE });
  console.log(`  Saved to ${STATE_FILE}\n`);

  await browser.close();
}

main().catch(console.error);
