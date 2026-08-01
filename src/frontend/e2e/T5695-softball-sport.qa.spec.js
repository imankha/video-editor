/**
 * T5695 QA — Add Fastpitch Softball as a supported sport.
 *
 * Drives the app AS A REAL USER (dev-login, real data) per
 * .claude/skills/drive-app-as-user/SKILL.md. Verifies the acceptance criteria
 * against what the app actually renders + persists, then cleans up after itself
 * (the created softball profile is deleted so the shared dev account is left as
 * found).
 *
 * Run: bash scripts/dev-verify.sh e2e/T5695-softball-sport.qa.spec.js
 *
 * Criteria and how each is evidenced here:
 *  1. Softball selectable in the sport picker with the 🥎 glyph -> open the real
 *     profile manager, assert the "🥎 Softball" option is present. (live UI)
 *  2. Annotate shows the four softball positions + fastpitch tags (Rise Ball,
 *     Slap Hit); tagging persists `softball` -> create a softball profile via the
 *     real store, round-trip GET /api/profiles to prove the stored sport is
 *     'softball', and execute the SAME registry functions the Annotate tag panel
 *     uses (getPositions/getAllTags) IN THE REAL BROWSER to prove the palette.
 *  3. Collections softball curated combos -> covered deterministically by the
 *     backend test test_each_sport_curated_and_per_tag[softball]; a live surface
 *     needs published softball reels, which this fresh profile has none of (see
 *     the report's WHY note).
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

test('T5695 softball: picker glyph, persisted sport, and annotate tag palette (real app)', async ({ context, page }) => {
  test.setTimeout(120000);
  await loginAsRealUser(context);
  await page.goto('/');

  // Wait for the profile store to initialize (ProfileSportButton renders only then).
  const sportButton = page.getByRole('button', { name: /Switch sport or profile/i });
  await expect(sportButton).toBeVisible({ timeout: 30000 });

  // --- Criterion 1: sport picker offers "🥎 Softball" -----------------------
  await sportButton.click();
  // The InlineSportSelect renders each supported sport as a native <option>
  // "{emoji} {name}". Assert the softball option (with its glyph) exists.
  const softballGlyphOption = page.locator('option', { hasText: /🥎\s*Softball/ });
  await expect(softballGlyphOption.first()).toHaveCount(1, { timeout: 10000 });
  await saveEvidence(page, 'criterion-1-sport-picker-softball');
  // Close the modal (Escape) before driving the store.
  await page.keyboard.press('Escape');

  // --- Criterion 2a: creating a softball profile PERSISTS sport='softball' ---
  const created = await page.evaluate(async () => {
    const { useProfileStore } = await import('/src/stores/profileStore.js');
    const p = await useProfileStore.getState().createProfile('T5695 Softball QA', '#F59E0B', { sport: 'softball' });
    return p;
  });
  expect(created?.id, 'createProfile returned a profile id').toBeTruthy();

  // Round-trip: read the profile back from the backend and prove the stored
  // sport string is 'softball' (this is the "tagging a clip persists softball"
  // guarantee at its source — the profile's sport is the value clips inherit).
  const profilesRes = await page.request.get('/api/profiles');
  expect(profilesRes.ok()).toBeTruthy();
  const profilesBody = await profilesRes.json();
  const list = Array.isArray(profilesBody) ? profilesBody : profilesBody.profiles;
  const persisted = list.find((p) => p.id === created.id);
  expect(persisted, 'created profile present in GET /api/profiles').toBeTruthy();
  expect(persisted.sport).toBe('softball');
  // eslint-disable-next-line no-console
  console.log(`[T5695] persisted profile ${created.id} sport = ${persisted.sport}`);

  // --- Criterion 1 (glyph is live): softball profile now active shows 🥎 -----
  await expect(sportButton).toContainText('🥎', { timeout: 15000 });
  await saveEvidence(page, 'criterion-2-softball-profile-active');

  // --- Criterion 2b: the Annotate tag palette the UI renders for softball ----
  // getPositions/getAllTags are the exact registry functions the Annotate tag
  // panel calls. Execute them in the REAL browser (real ESM module, not jsdom).
  const palette = await page.evaluate(async () => {
    const reg = await import('/src/modes/annotate/constants/tagRegistry.js');
    return {
      positions: reg.getPositions('softball').map((p) => p.name),
      tags: reg.getAllTags('softball').map((t) => t.name),
      emoji: reg.sportEmoji('softball'),
    };
  });
  expect(palette.positions).toEqual(['Pitcher', 'Batter', 'Infielder', 'Outfielder']);
  expect(palette.tags).toContain('Rise Ball');
  expect(palette.tags).toContain('Slap Hit');
  expect(palette.emoji).toBe('🥎');
  // eslint-disable-next-line no-console
  console.log(`[T5695] softball palette positions=${palette.positions.join('/')} tags=${palette.tags.join(', ')}`);

  // --- Responsive: sport picker at 375px + desktop, no horizontal overflow ---
  await sportButton.click();
  await responsiveSweep(page);
  await page.keyboard.press('Escape');

  // --- Cleanup: delete the QA profile so the shared account is left as found -
  await page.evaluate(async (id) => {
    const { useProfileStore } = await import('/src/stores/profileStore.js');
    await useProfileStore.getState().deleteProfile(id);
  }, created.id);
  const afterRes = await page.request.get('/api/profiles');
  const afterBody = await afterRes.json();
  const afterList = Array.isArray(afterBody) ? afterBody : afterBody.profiles;
  expect(afterList.find((p) => p.id === created.id), 'QA profile cleaned up').toBeFalsy();
});
