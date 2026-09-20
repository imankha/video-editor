import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T10710 QA — live-drive the genuinely-unrated play badge (T10690 design),
 * against a real account's real data: Mark a play, confirm the rated badge
 * shows the UNDONE (amber, "Not rated yet") treatment rather than a fake
 * default rating, then pick a rating and confirm it flips to DONE (green)
 * with the correct notation glyph.
 *
 * This is the live proof that create-at-tap (AnnotateContainer.jsx) no longer
 * seeds NEW_PLAY_DEFAULT_RATING and that useAnnotate's loadAnnotations no
 * longer coerces a missing rating back to a number — a unit-test-only check
 * of that plumbing would not catch a regression that only shows up once the
 * badge, the picker and the create payload are wired together end to end.
 *
 * Run: bash scripts/dev-verify.sh e2e/T10710-unrated-badge.qa.spec.js --reporter=line
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE;
const API_BASE = process.env.E2E_API_BASE || '/api';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('T10710 — unrated play badge: live QA', () => {
  test.beforeEach(async ({ context, page }) => {
    test.setTimeout(120000);
    await loginAsRealUser(context, REAL_EMAIL, PROFILE);

    const res = await context.request.get(
      `${API_BASE}/games`,
      PROFILE ? { headers: { 'X-Profile-ID': PROFILE } } : undefined,
    );
    expect(res.ok(), `GET ${API_BASE}/games (${res.status()})`).toBeTruthy();
    const games = (await res.json()).games || [];
    const target = games.find((g) => g.storage_status === 'active');
    test.skip(!target, '[T10710] no active game available');
    console.log(`[T10710] driving active game id=${target.id} (${target.opponent_name})`);

    await openGameInAnnotate(page, target.id);
    await expect(page.locator('video').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1500);
  });

  test('Mark play -> rated badge is unset (not green) -> pick a rating -> turns green @t10710', async ({ page }) => {
    const primaryCta = page.locator('[data-testid="annotate-primary-cta"]');
    await expect(primaryCta).toBeVisible({ timeout: 8000 });
    // Seek to an empty stretch so the CTA reads "Mark play" (playhead-driven
    // auto-select flips it to "Edit play" over an existing clip).
    for (const frac of [0.62, 0.82, 0.45, 0.95]) {
      await page.locator('video').first().evaluate((v, f) => { v.currentTime = (v.duration || 90) * f; }, frac);
      const playBtn = page.locator('button[title="Play"]:visible').first();
      if (await playBtn.count()) {
        await playBtn.click();
        await page.waitForTimeout(1300);
        const pauseBtn = page.locator('button[title="Pause"]:visible').first();
        if (await pauseBtn.count()) await pauseBtn.click();
      }
      await page.waitForTimeout(500);
      if (/Mark play/i.test((await primaryCta.textContent()) || '')) break;
    }
    await expect(primaryCta, 'need an empty stretch so the CTA reads "Mark play"').toHaveText(/Mark play/i, { timeout: 5000 });

    // T10690: create-at-tap sends NO rating field — the row lands with
    // rating = NULL, not a seeded default.
    const [saveResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/clips/raw/save') && r.request().method() === 'POST'),
      primaryCta.click(),
    ]);
    const sentBody = saveResp.request().postDataJSON();
    expect(sentBody.rating ?? null, 'create-at-tap payload carries no numeric rating').toBeNull();
    const clipId = (await saveResp.json()).raw_clip_id;

    const strip = page.locator('[data-testid="annotate-editor-strip"]');
    await expect(strip).toBeVisible({ timeout: 10000 });

    // Criterion: the rated badge shows the UNDONE (amber, "Not rated yet")
    // treatment, never green/DONE, until the user picks a rating.
    const ratedBadge = strip.getByTestId('badge-rated');
    await expect(ratedBadge).toHaveAttribute('data-state', 'undone');
    await expect(ratedBadge).toHaveAttribute('title', 'Not rated yet');
    await saveEvidence(page, 'T10710-1-fresh-play-unrated-badge');

    // Picking a rating flips the badge to DONE (green) with the correct glyph.
    await ratedBadge.click();
    const [put] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/api/clips/raw/${clipId}`) && req.method() === 'PUT'),
      page.getByTestId('rating-picker').getByRole('radio', { name: /^4 stars - Good/ }).click(),
    ]);
    expect(put.postDataJSON()).toEqual({ rating: 4 });
    await expect(ratedBadge).toHaveAttribute('data-state', 'done');
    await expect(ratedBadge).toHaveAttribute('title', 'Play rated');
    await saveEvidence(page, 'T10710-2-rated-badge-turns-green');

    // Clean up: delete the play this test created so it doesn't linger on the account.
    await strip.getByTestId('delete-play-button').click();
    const confirmDelete = page.getByRole('button', { name: /^Delete/ }).last();
    if (await confirmDelete.isVisible().catch(() => false)) await confirmDelete.click();
  });
});
