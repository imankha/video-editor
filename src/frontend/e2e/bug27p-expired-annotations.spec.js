/**
 * bug 27p (primary) + bug 28p (rider) live verification, driven AS A REAL USER.
 *
 * bug 27p: when a game's source video has expired (R2 source hard-deleted
 * post-grace), the Annotate screen must show a deliberate "source video expired"
 * state instead of mounting a <video> against the dead source. Annotations stay
 * readable and "Playback Annotations" is disabled. A non-expired game must still
 * mount a normal player (regression).
 *
 * bug 28p: the Games-menu per-game details row must read Clips -> Quality -> Tags.
 *
 * FIXTURE: this spec does NOT flip the DB itself. Run the QA harness first, which
 * flips game_storage.storage_expires_at into the past for E2E_EXPIRED_GAME on the
 * local profile DB, then invokes dev-verify with this spec. The beforeAll below
 * asserts the fixture is in place (expired game reports storage_status 'expired',
 * healthy game reports 'active') so a missing fixture fails loudly, not silently.
 *
 * Params (defaults match the imankh@gmail.com dev account):
 *   E2E_REAL_EMAIL   default imankh@gmail.com
 *   E2E_EXPIRED_GAME default 5   (36 clips) -- flipped expired by the harness
 *   E2E_HEALTHY_GAME default 7   (13 clips) -- left active for the regression leg
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const EXPIRED_GAME = process.env.E2E_EXPIRED_GAME || '5';
const HEALTHY_GAME = process.env.E2E_HEALTHY_GAME || '7';

test.describe('bug 27p expired-source Annotate + bug 28p games-menu order', () => {
  test.beforeAll(async ({ request }) => {
    // Authenticate the shared request context and confirm the DB fixture is live.
    await request.post('/api/auth/dev-login', { data: { email: EMAIL } });
    const res = await request.get('/api/games');
    expect(res.ok(), 'GET /api/games should succeed').toBeTruthy();
    const body = await res.json();
    const games = Array.isArray(body) ? body : body.games;
    const byId = Object.fromEntries(games.map((g) => [String(g.id), g]));

    const expired = byId[EXPIRED_GAME];
    const healthy = byId[HEALTHY_GAME];
    expect(expired, `expired fixture game ${EXPIRED_GAME} must exist`).toBeTruthy();
    expect(healthy, `healthy game ${HEALTHY_GAME} must exist`).toBeTruthy();
    // The whole point of the fixture: game N's source is reported expired.
    expect(
      expired.storage_status,
      `game ${EXPIRED_GAME} must be flipped expired by the QA harness (run it first)`,
    ).toBe('expired');
    expect(healthy.storage_status, `game ${HEALTHY_GAME} must stay active`).toBe('active');
  });

  test('expired game: renders the expired panel, no <video>, playback disabled, clips still readable', async ({ context, page }) => {
    await loginAsRealUser(context, EMAIL);
    await openGameInAnnotate(page, EXPIRED_GAME);

    // 1. Deliberate expired state is rendered (getByText throws if absent).
    await expect(page.getByText(/source video expired/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/your annotations are still listed/i)).toBeVisible();

    // 2. No <video> mounts against the dead source.
    await expect(page.locator('video')).toHaveCount(0);

    // 3. "Playback Annotations" is disabled (its enterPlaybackMode is the only
    //    entry to the playback tree that would mount dual <video>).
    const playbackBtn = page.getByRole('button', { name: /playback annotations/i });
    await expect(playbackBtn).toBeVisible();
    await expect(playbackBtn).toBeDisabled();

    // 4. Annotations stay readable -- clip markers still render on the timeline.
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 20000 });
    const markers = await page.locator('.clip-marker').count();
    expect(markers).toBeGreaterThan(0);
    console.log(`[bug27p] expired game ${EXPIRED_GAME}: expired panel shown, 0 <video>, playback disabled, ${markers} clip markers readable`);
  });

  test('non-expired game: normal player mounts (regression)', async ({ context, page }) => {
    await loginAsRealUser(context, EMAIL);
    await openGameInAnnotate(page, HEALTHY_GAME);

    // The expired panel must NOT appear, and a real <video> must mount.
    await expect(page.getByText(/source video expired/i)).toHaveCount(0);
    await expect(page.locator('video').first()).toBeVisible({ timeout: 20000 });

    // Clip markers render too (T4060 load-order not regressed).
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 20000 });
    console.log(`[bug27p] healthy game ${HEALTHY_GAME}: <video> mounted, no expired panel`);
  });

  test('bug 28p: games-menu details row renders Clips -> Quality -> Tags in DOM order', async ({ context, page }) => {
    await loginAsRealUser(context, EMAIL);
    await page.goto('/');
    await page.locator('button:has-text("Games")').click();
    // Cards are clickable directly (no per-card "Load" button); gate on the list
    // heading + a rendered Quality span so the details rows are in the DOM.
    await expect(page.getByRole('heading', { name: /your games/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/^Quality:/).first()).toBeVisible({ timeout: 15000 });

    // Find a details row that has a Quality span AND at least one tag pill, then
    // read the document order of the clips span, the Quality span, and the first
    // tag pill inside that row.
    const order = await page.evaluate(() => {
      // The clips span, the Quality span, and the TagBadges pills are all direct
      // siblings in one details-row div. Anchor on the Quality span and use ITS
      // parent as the row so we can't accidentally match a huge page ancestor
      // (whose first .rounded-full is an unrelated header badge).
      const qualitySpans = Array.from(document.querySelectorAll('span'))
        .filter((s) => s.textContent.trim().startsWith('Quality:'));
      for (const qualityEl of qualitySpans) {
        const row = qualityEl.parentElement;
        if (!row) continue;
        const spans = Array.from(row.querySelectorAll('span'));
        const clipsEl = spans.find((s) => /^\d+\s*clips?$/.test(s.textContent.trim()));
        const tagEl = row.querySelector('.rounded-full');
        if (!clipsEl || !tagEl) continue;
        const all = Array.from(row.querySelectorAll('*'));
        return {
          clips: all.indexOf(clipsEl),
          quality: all.indexOf(qualityEl),
          tag: all.indexOf(tagEl),
          clipsText: clipsEl.textContent.trim(),
          qualityText: qualityEl.textContent.trim(),
          tagText: tagEl.textContent.trim(),
        };
      }
      return null;
    });

    expect(order, 'a details row with clips + Quality + a tag pill must exist').not.toBeNull();
    console.log(`[bug28p] order indices -> clips=${order.clips} ("${order.clipsText}"), quality=${order.quality} ("${order.qualityText}"), tag=${order.tag} ("${order.tagText}")`);
    expect(order.clips).toBeGreaterThanOrEqual(0);
    expect(order.quality).toBeGreaterThan(order.clips);
    expect(order.tag).toBeGreaterThan(order.quality);
  });
});
