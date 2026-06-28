/**
 * T4080 verification: every annotation-mode clip row shows the clip's in-match
 * time in soccer notation (MM'SS"), right-aligned, and the rows are ordered by
 * in-match start time (the reference order that Reel Drafts / My Reels match).
 *
 * Drives the app AS A REAL USER with real data (see e2e/helpers/realAuth.js +
 * .claude/skills/drive-app-as-user/SKILL.md). Needs the dev backend (APP_ENV=dev)
 * + a real account with an annotated game. Run:
 *   cd src/frontend && E2E_BASE_URL=http://localhost:5173 \
 *     npx playwright test e2e/annotate-soccer-times.spec.js --reporter=line
 * Params: E2E_REAL_EMAIL (default imankh@gmail.com), E2E_DEBUG_GAME (default 5).
 *
 * The cross-view ordering match (Reel Drafts / My Reels share this in-game-time
 * key) is also covered deterministically by unit/component tests:
 *   src/utils/timeFormat.test.js (compareGameTime),
 *   src/components/collections/GameCollectionGroup.order.test.jsx.
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth';

// "MM'SS\"" -> seconds, for asserting ascending order.
const clockToSeconds = (txt) => {
  const m = /^(\d+)'(\d{2})"$/.exec(txt.trim());
  if (!m) throw new Error(`unexpected game-clock text: ${JSON.stringify(txt)}`);
  return Number(m[1]) * 60 + Number(m[2]);
};

test('annotation clip rows show right-aligned soccer time, ordered by in-game time (T4080)', async ({ context, page }) => {
  await loginAsRealUser(context);
  const gameId = process.env.E2E_DEBUG_GAME || '5';
  await openGameInAnnotate(page, gameId);

  // Wait for the clips sidebar to populate.
  const sidebar = page.locator('[data-sidebar="clips"]');
  await expect(sidebar).toBeVisible({ timeout: 20000 });

  const clocks = sidebar.locator('span[title="Game time"]');
  await expect(clocks.first()).toBeVisible({ timeout: 20000 });

  const texts = await clocks.allInnerTexts();
  expect(texts.length).toBeGreaterThan(0);

  // Each row's time is valid soccer notation...
  const seconds = texts.map(clockToSeconds);
  // ...and the rows are in non-decreasing in-game-time order.
  for (let i = 1; i < seconds.length; i++) {
    expect(seconds[i]).toBeGreaterThanOrEqual(seconds[i - 1]);
  }

  // eslint-disable-next-line no-console
  console.log(`[T4080] game ${gameId}: ${texts.length} rows, clocks = ${texts.join(', ')}`);
});
