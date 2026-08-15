/**
 * fixtureGuard — fast-fail preconditions for REAL-ACCOUNT e2e specs (T6760).
 *
 * The problem this solves: a real-account spec that opens a saved GAME in the
 * Annotate screen (loginAsRealUser + openGameInAnnotate) has no way to tell a
 * PRODUCT regression from a drifted FIXTURE. When the dev QA account's game-source
 * storage has expired/drifted, the Annotate screen never mounts a <video> and never
 * paints clip markers, so the spec's first `waitFor` sits on the DEFAULT per-test
 * timeout (300000ms locally — see playwright.config.js) and the run reads as "125
 * broken features" when the truth is "the fixture needs repair." The 2026-08-11
 * full-sweep's giant 5-minute-timeout cascades in the T5700/T5725/T6400 clusters
 * were all this (docs/testing/derisk-plan-2026-08-11.md).
 *
 * `assertGameStorageActive` turns that 5-minute silent hang into a sub-second, loud
 * failure with a message that says exactly what is stale and how to repair it. It
 * mirrors the proven bug27p-expired-annotations.spec.js beforeAll: authenticate the
 * request context, GET /api/games, assert the driving game reports
 * storage_status === 'active'. It ASSERTS (fails loudly) rather than test.skip()s —
 * a missing/expired real-account fixture is a fixture bug to fix, not a condition to
 * silently pass over (CLAUDE.md: no silent fallback for internal data).
 */
import { expect } from '@playwright/test';

const DEFAULT_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const DEFAULT_API_BASE = process.env.E2E_API_BASE || '/api';

/**
 * Assert the real account's driving game has ACTIVE source storage, fast and loud.
 * Call from a spec's file-scope `test.beforeAll(async ({ request }) => {...})`.
 *
 * @param {import('@playwright/test').APIRequestContext} request the Playwright `request` fixture
 * @param {number|string} gameId the game the spec opens in Annotate
 * @param {{email?: string, apiBase?: string}} [opts]
 * @returns {Promise<object>} the matched game record (for optional further assertions)
 */
export async function assertGameStorageActive(request, gameId, opts = {}) {
  const email = opts.email || DEFAULT_EMAIL;
  const apiBase = opts.apiBase || DEFAULT_API_BASE;

  // The bare `request` fixture has its OWN cookie jar (separate from the browser
  // context), so authenticate it here — same first step as bug27p's beforeAll.
  await request.post(`${apiBase}/auth/dev-login`, {
    data: { email },
    headers: { 'X-Test-Mode': 'true' },
  });
  const res = await request.get(`${apiBase}/games`);
  expect(
    res.ok(),
    `[T6760 fixture] GET ${apiBase}/games must succeed for ${email} — is the backend up (dev/staging, not prod) and the account seeded?`,
  ).toBeTruthy();

  const body = await res.json();
  const games = Array.isArray(body) ? body : body.games;
  const game = (games || []).find((g) => String(g.id) === String(gameId));
  expect(
    game,
    `[T6760 fixture] game ${gameId} not found on ${email} — the dev QA account drifted. ` +
      `Repair/re-seed the account (CLAUDE.md Data Safety Rules) instead of reading this as a product regression. ` +
      `Context: docs/testing/derisk-plan-2026-08-11.md.`,
  ).toBeTruthy();
  expect(
    game.storage_status,
    `[T6760 fixture] game ${gameId} source storage is "${game && game.storage_status}", expected "active" — ` +
      `the dev QA account's game-source storage expired/drifted. This spec drives that game's Annotate screen and ` +
      `would otherwise HANG the full per-test timeout waiting for a <video>/clip-markers that never load. ` +
      `Repair the fixture (re-seed / extend storage), do NOT read this as a product regression. ` +
      `Precedent: bug27p-expired-annotations.spec.js; context: docs/testing/derisk-plan-2026-08-11.md.`,
  ).toBe('active');

  return game;
}
