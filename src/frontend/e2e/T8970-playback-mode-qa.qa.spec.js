/**
 * T8970 QA: Playback Annotations mode — item 1 (blank video on exit), item 2
 * (mutating clip editor still active during playback), item 3 (active-clip
 * highlight tracks playback), item 4 (mode visually unambiguous).
 *
 * Drives the app as a real user against dev/staging. Asserts the FIXED behavior;
 * skips loudly when the account has no suitable seeded game (never a silent pass).
 * Runs via dev-verify (by-path lifts the config grepInvert) or an explicit
 * @staging-gate lane — NOT the default e2e sweep or branch-CI vitest run.
 *
 *   bash scripts/dev-verify.sh e2e/T8970-playback-mode-qa.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth';

const API_BASE = process.env.E2E_API_BASE || '/api';
const PROFILE = process.env.E2E_REAL_PROFILE;

test('T8970: Playback Annotations mode is fixed (items 1-4) @staging-gate @gate-b', async ({ context, page }) => {
  test.setTimeout(120000);
  await loginAsRealUser(context, process.env.E2E_REAL_EMAIL || 'imankh@gmail.com', PROFILE);

  const res = await context.request.get(`${API_BASE}/games`, PROFILE ? { headers: { 'X-Profile-ID': PROFILE } } : undefined);
  expect(res.ok(), `GET /api/games (${res.status()})`).toBeTruthy();
  const games = (await res.json()).games || [];
  const withClips = games.filter((g) => g.storage_status === 'active' && (g.clip_count || 0) > 0);
  // Prefer the clip-richest game (item 3 needs multiple clips); E2E_GAME_ID overrides.
  const forced = process.env.E2E_GAME_ID ? withClips.find((g) => String(g.id) === process.env.E2E_GAME_ID) : null;
  const target = forced || withClips.slice().sort((a, b) => (b.clip_count || 0) - (a.clip_count || 0))[0];
  if (!target) console.log('[T8970][SKIP] no active game with clips to drive');
  test.skip(!target, 'no active game with clips available');
  console.log(`[T8970] driving game id=${target.id} (${target.opponent_name}) clip_count=${target.clip_count}`);

  await openGameInAnnotate(page, target.id);
  await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 20000 });

  // --- Enter Playback Annotations ---
  await page.getByText(/Playback Annotations/i).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'qa/T8970-01-playback-entered.png', fullPage: false });

  // --- Item 4: persistent mode badge is visible the whole time the mode is active ---
  await expect(page.getByTestId('playback-mode-badge')).toBeVisible();

  // --- Item 2: the mutating clip DETAILS EDITOR must NOT be present during playback ---
  const deleteClip = page.getByText(/Delete Clip/i);
  const createReel = page.getByRole('button', { name: /Create Reel|Reel Created/i });
  expect(await deleteClip.count() === 0 || !(await deleteClip.first().isVisible().catch(() => false)),
    'Delete-Clip must not be visible during playback').toBeTruthy();
  expect(await createReel.count() === 0 || !(await createReel.first().isVisible().catch(() => false)),
    'Create-Reel must not be visible during playback').toBeTruthy();

  // Clicking a non-active row seeks (does NOT open a mutating editor).
  const rows = page.locator('[data-testid="clip-row"]');
  const rowCount = await rows.count();
  if (rowCount > 2) {
    await rows.nth(2).click();
    await page.waitForTimeout(600);
    expect(await deleteClip.count() === 0 || !(await deleteClip.first().isVisible().catch(() => false)),
      'row click during playback must not open the editor').toBeTruthy();
    await page.screenshot({ path: 'qa/T8970-02-after-row-click.png', fullPage: false });
  }

  // --- Item 3: active-clip highlight (animate-pulse) renders distinctly ---
  async function activeRowIndex() {
    for (let i = 0; i < rowCount; i++) {
      const cls = (await rows.nth(i).getAttribute('class')) || '';
      if (cls.includes('animate-pulse')) return i;
    }
    return -1;
  }
  expect(await activeRowIndex(), 'an active-clip row is highlighted during playback').toBeGreaterThanOrEqual(0);

  // --- Item 1: exit playback, annotate video must NOT be blank ---
  await page.getByRole('button', { name: /Back to Annotate/i }).first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'qa/T8970-03-after-exit.png', fullPage: false });
  const anyPlayable = await page.evaluate(() =>
    Array.from(document.querySelectorAll('video')).some((v) => (v.currentSrc || v.src || '').length > 0));
  expect(anyPlayable, 'at least one annotate video has a src after exiting playback (not blank)').toBeTruthy();
});
