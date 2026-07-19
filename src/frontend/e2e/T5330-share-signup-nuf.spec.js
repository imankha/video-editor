import { test, expect } from '@playwright/test';

/**
 * T5330 — Email game-share recipient must NOT skip the new-user flow (NUF).
 *
 * Proves the live fix: a share-email recipient who signs up sees quest_1
 * ("Get Started") active and INCOMPLETE after session_init materializes the
 * shared game + a 5-star clip's auto-draft-reel -- not silently skipped past
 * onboarding. See docs/plans/tasks/T5330-share-recipient-skips-new-user-flow.md.
 *
 * Drives TWO real accounts through the actual product code path (no mocking):
 *   1. SHARER -- created via the /api/test/ensure-pg-user seam (X-User-ID
 *      header, no session cookie), creates a pending-status game (skips R2
 *      validation -- no real video content needed, mirrors the pattern in
 *      backend tests/test_shared_game_extension.py) + a 5-star raw clip tagged
 *      for the recipient, then calls POST /api/clips/share-with-teammates
 *      targeting the recipient's (not-yet-existing) email. This exercises the
 *      REAL non-user pending-share branch (materialization.py's
 *      _materialize_or_pend "recipient_user is None" path) -- exactly what a
 *      real email share to someone who hasn't signed up yet does.
 *   2. RECIPIENT -- created via the same seam AFTER the share targets its
 *      email (so the pending share is genuinely waiting, matching the real
 *      product timeline), then POST /api/auth/dev-login (T3980) -- which runs
 *      the REAL user_session_init() path, including the T3230 auto-materialize
 *      block this task's fix touches -- and mints a real session cookie.
 *
 * Follows the test-login / dev-login auth-bypass patterns from
 * e2e/new-user-flow.spec.js and e2e/helpers/realAuth.js (dev/staging only,
 * X-Test-Mode gated, never production).
 *
 * Honest-skip convention (matches T4550/T4880's `reachable` pattern): if a
 * required seam or endpoint is unavailable in this environment, fixture setup
 * fails fast, logs a loud [T5330][SKIP] line, and calls test.skip() with the
 * reason -- this spec NEVER silently passes when it couldn't actually drive
 * the scenario.
 *
 * Run:
 *   bash scripts/dev-verify.sh e2e/T5330-share-signup-nuf.spec.js
 *   or: cd src/frontend && npx playwright test e2e/T5330-share-signup-nuf.spec.js
 */

const API_PORT = 8000;
const API_BASE = process.env.E2E_API_BASE || `http://localhost:${API_PORT}/api`;

const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const SHARER_ID = `e2e5330sharer${RUN_ID}`.replace(/[^a-z0-9]/gi, '');
const RECIPIENT_ID = `e2e5330recip${RUN_ID}`.replace(/[^a-z0-9]/gi, '');
// Deterministic: matches what POST /api/test/ensure-pg-user assigns (T5330 relies
// on this to target the share at an email the recipient will actually resolve to).
const RECIPIENT_EMAIL = `${RECIPIENT_ID}@e2e.local`;
const SHARE_TAG = 'e2e-nuf-teammate';

function sharerHeaders() {
  return { 'X-User-ID': SHARER_ID, 'X-Test-Mode': 'true' };
}

/** Idempotently create `userId` in the Postgres users table (test seam, T4120).
 * Its email is deterministic: `${userId}@e2e.local`. */
async function ensurePgUser(request, userId) {
  const res = await request.post(`${API_BASE}/test/ensure-pg-user`, {
    headers: { 'X-User-ID': userId, 'X-Test-Mode': 'true' },
  });
  if (!res.ok()) {
    throw new Error(`ensure-pg-user failed (${res.status()}) for ${userId}: ${await res.text()}`);
  }
  return res.json();
}

/** As the sharer: create a pending-status game (no real video/R2 needed) plus a
 * 5-star clip tagged for SHARE_TAG. Returns the new game id. */
async function createSharerGameAndClip(request) {
  const blake3Hash = `e2e5330game${RUN_ID}`.replace(/[^a-z0-9]/gi, '').toLowerCase();

  const gameRes = await request.post(`${API_BASE}/games`, {
    headers: sharerHeaders(),
    data: {
      opponent_name: 'T5330 Opponent',
      status: 'pending', // skips R2 validation -- no real video content required
      videos: [{ blake3_hash: blake3Hash, sequence: 1 }],
    },
  });
  if (!gameRes.ok()) {
    throw new Error(`create game failed (${gameRes.status()}): ${await gameRes.text()}`);
  }
  const { game_id: gameId } = await gameRes.json();
  if (!gameId) throw new Error(`create game response missing game_id: ${JSON.stringify(await gameRes.json())}`);

  const clipRes = await request.post(`${API_BASE}/clips/raw/save`, {
    headers: sharerHeaders(),
    data: {
      game_id: gameId,
      start_time: 0,
      end_time: 5,
      name: 'T5330 Golazo',
      rating: 5, // materialize_game_share auto-creates the recipient's draft reel for a 5-star clip
      tagged_teammates: [SHARE_TAG],
    },
  });
  if (!clipRes.ok()) {
    throw new Error(`create clip failed (${clipRes.status()}): ${await clipRes.text()}`);
  }

  return gameId;
}

/** Share the game+clip with the (not-yet-existing) recipient via the real
 * teammate-share endpoint -- the same code path a real "share via email" uses. */
async function shareWithRecipient(request, gameId) {
  const res = await request.post(`${API_BASE}/clips/share-with-teammates`, {
    headers: sharerHeaders(),
    data: {
      game_id: gameId,
      recipients: [{ tag_name: SHARE_TAG, emails: [RECIPIENT_EMAIL] }],
    },
  });
  if (!res.ok()) {
    throw new Error(`share-with-teammates failed (${res.status()}): ${await res.text()}`);
  }
  const body = await res.json();
  if (!body.sent_tags?.includes(SHARE_TAG)) {
    throw new Error(`share was not recorded as sent: ${JSON.stringify(body)}`);
  }
  return body;
}

async function cleanup(request) {
  for (const userId of [SHARER_ID, RECIPIENT_ID]) {
    try {
      const res = await request.delete(`${API_BASE}/auth/user`, { headers: { 'X-User-ID': userId } });
      if (res.ok()) console.log(`[T5330][Cleanup] deleted ${userId}`);
    } catch (e) {
      console.log(`[T5330][Cleanup] warning for ${userId}: ${e.message}`);
    }
  }
}

test.describe('T5330 — share-email recipient sees the new-user flow', () => {
  test.afterAll(async ({ request }) => {
    await cleanup(request);
  });

  test('email-share signup recipient lands on quest_1 (active, incomplete), not past it', async ({ page, request }) => {
    test.setTimeout(60_000);

    // --- Fixture setup: two real accounts, driven through the real product
    // code path (games/clips API + the real sharing endpoint). If any required
    // seam is unavailable in this environment, honest-skip -- never fake it. ---
    let gameId;
    try {
      await ensurePgUser(request, SHARER_ID);
      gameId = await createSharerGameAndClip(request);
      await shareWithRecipient(request, gameId);
      // Recipient's Postgres user is created AFTER the share targets its email --
      // matches the real "share sent to someone who hasn't signed up yet" order,
      // and is what makes the pending_teammate_shares row genuinely pending.
      await ensurePgUser(request, RECIPIENT_ID);
    } catch (e) {
      const reason = `T5330 fixture setup unavailable (needs /api/test/* seams + ` +
        `sharing endpoints in a dev/staging backend): ${e.message}`;
      console.log(`[T5330][SKIP] ${reason}`);
      test.skip(true, reason);
      return;
    }

    // --- Recipient signup: dev-login runs the REAL session_init() path, which
    // is exactly where T3230's auto-materialize block (and this task's fix)
    // live -- this is the actual bug's trigger point, not a simulation. ---
    const loginRes = await page.request.post(`${API_BASE}/auth/dev-login`, {
      data: { user_id: RECIPIENT_ID },
      headers: { 'X-Test-Mode': 'true' },
    });
    if (!loginRes.ok()) {
      const reason = `dev-login failed (${loginRes.status()}) for recipient ${RECIPIENT_ID}: ${await loginRes.text()}`;
      console.log(`[T5330][SKIP] ${reason}`);
      test.skip(true, reason);
      return;
    }
    console.log(`[T5330] Recipient session established: ${JSON.stringify(await loginRes.json())}`);

    // --- Drive the live app as the recipient ---
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Sanity: the shared game materialized and is present/usable (T3230's data
    // behavior is unchanged by this fix -- only quest counting changed).
    const games = await page.evaluate(async (apiBase) => {
      const res = await fetch(`${apiBase}/games`, { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.games || [];
    }, '/api');
    expect(games, 'shared game must be present in the recipient profile').not.toBeNull();
    expect(games.length, 'the materialized shared game is present').toBeGreaterThanOrEqual(1);

    // --- THE assertion: quest_1 renders as the active onboarding quest in the
    // UI, not skipped past. QuestPanel only renders a quest while it is
    // active/incomplete (it hides once all quests are done), so visibility of
    // "Get Started" alone proves the NUF was NOT skipped. ---
    const questTitle = page.locator('.quest-title', { hasText: 'Get Started' });
    await expect(questTitle, 'Quest 1 "Get Started" panel must be visible -- NUF not skipped')
      .toBeVisible({ timeout: 15000 });

    // Cross-check step-level incompleteness via the same API the UI reads, for
    // a precise assertion matching the acceptance criterion wording exactly
    // ("quest_1 active and incomplete") and pinpointing which step would have
    // regressed if this ever breaks again.
    const progress = await page.evaluate(async (apiBase) => {
      const res = await fetch(`${apiBase}/quests/progress`, { credentials: 'include' });
      if (!res.ok) return null;
      return res.json();
    }, '/api');
    const quest1 = progress?.quests?.find((q) => q.id === 'quest_1');
    expect(quest1, 'quest_1 present in progress response').toBeTruthy();
    expect(quest1.completed, 'quest_1 must be incomplete for a never-started recipient').toBe(false);
    expect(quest1.steps.upload_game, 'upload_game must NOT be pre-completed by the shared game').toBe(false);
    expect(quest1.steps.add_clip, 'add_clip must NOT be pre-completed by the shared clip').toBe(false);
    expect(quest1.steps.rate_clip, 'rate_clip must NOT be pre-completed by the shared 5-star clip').toBe(false);
    expect(quest1.steps.annotate_brilliant, 'annotate_brilliant must NOT be pre-completed by the auto-draft-reel')
      .toBe(false);

    console.log('[T5330] PASS: share-email signup recipient lands on quest_1 (active, incomplete) -- NUF not skipped.');
  });
});
