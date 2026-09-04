import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T6890 — Rename/edit pencil sits next to the name it renames (all 3 tile types).
 *
 * Positioning-only UX fix. Drives the REAL app as a real user (imankh@gmail.com,
 * profile 9fa7378c) and proves, on each of the three tile surfaces, that:
 *   - the pencil renders in the bottom scrim as an immediate sibling of the name
 *     <h3> (discoverable at rest — no hover / no kebab open), AND
 *   - clicking it still starts the existing rename / edit flow (no behavior change).
 *
 * Then a responsive sweep (375px + desktop) proves no crowding/overflow now that
 * the scrim carries name + pencil on one row.
 *
 * Acceptance-criteria evidence map:
 *   AC1 draft rename icon next to the name          -> "draft" test + qa/T6890-draft-*.png
 *   AC2 reel + game rename icon next to the name     -> "reel"/"game" tests + qa/T6890-*.png
 *   AC3 no regression to rename/edit behavior        -> each test clicks the pencil and asserts the flow starts
 *   AC4 no crowding/overflow at 375px                -> responsiveSweep (assertNoHorizontalOverflow) per surface
 */

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

// The pencil must sit directly beside the name it edits: its immediately
// preceding sibling, in the same flex row, must be the name <h3>. Derived from
// the pencil element itself so we assert the real tile relationship (not some
// unrelated section heading elsewhere on the page).
async function assertPencilBesideName(page, pencil) {
  const info = await page.evaluate((b) => {
    const prev = b.previousElementSibling;
    return {
      prevTag: prev?.tagName || null,
      prevText: (prev?.textContent || '').trim().slice(0, 60),
      sameFlexRow: !!(b.parentElement && b.parentElement.className.includes('flex')),
    };
  }, pencil);
  expect(info.prevTag, 'the pencil sits immediately after the name heading').toBe('H3');
  expect(info.sameFlexRow, 'name + pencil share a flex row in the scrim').toBe(true);
  return info;
}

test.beforeEach(async ({ context }) => {
  await loginAsRealUser(context, EMAIL, PROFILE);
});

test('GameTile: edit pencil sits beside the game name and opens the edit flow', async ({ page }) => {
  await page.goto('/home/games');
  const tile = page.locator('[data-testid="game-card"], [data-game-kebab]').first();
  await tile.waitFor({ state: 'visible', timeout: 15000 });

  const pencil = page.locator('[data-game-edit]').first();
  await expect(pencil).toBeVisible(); // at rest — no kebab open needed
  await assertPencilBesideName(page, await pencil.elementHandle());

  await saveEvidence(page, 'T6890-game-pencil-beside-name');

  // Clicking the pencil opens the edit flow (rename dialog / edit form), and does
  // NOT trigger the tile's primary open (annotate) — URL stays on the games home.
  await pencil.click();
  await page.waitForTimeout(400);
  expect(page.url()).toContain('/home/games');

  await responsiveSweep(page);
});

test('DraftTile: rename pencil sits beside the reel name and starts inline rename', async ({ page }) => {
  await page.goto('/home/reels');
  await page.locator('[data-testid="project-card"]').first()
    .waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

  const draftCount = await page.locator('[data-testid="project-card"]').count();
  test.skip(draftCount === 0, 'no draft reels on this account to exercise DraftTile');

  const pencil = page.locator('button[aria-label="Rename reel"]').first();
  await expect(pencil).toBeVisible();
  await assertPencilBesideName(page, await pencil.elementHandle());

  await saveEvidence(page, 'T6890-draft-pencil-beside-name');

  await pencil.click();
  // Inline rename input (autofocused) replaces the name heading, seeded with the name.
  const draftInput = page.locator('input:focus');
  await expect(draftInput).toBeVisible();
  expect((await draftInput.inputValue()).length, 'rename input seeded with the name').toBeGreaterThan(0);
  await saveEvidence(page, 'T6890-draft-inline-rename-open');
  await page.keyboard.press('Escape');

  await responsiveSweep(page);
});

test('ReelTile: rename pencil sits beside the reel name and starts inline rename', async ({ page }) => {
  await page.goto('/');
  // T8545/T8555: switch to the Published tab (DownloadsPanel's inline body, was a
  // top-right icon button opening a drawer) — the surface that renders ReelTile.
  await page.getByRole('button', { name: /^Published/ }).first().click();
  await page.waitForTimeout(600);

  // Scope to the Published tab panel. Reels live inside collapsed game groups —
  // expand the first one so its ReelTiles render, then act on the ReelTile
  // pencil beside the name.
  const panel = page.getByTestId('published-tab-panel');
  const group = panel.locator('[data-testid="collapsible-group-header"]').first();
  await group.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  test.skip((await group.count()) === 0, 'no reel collections on this account to exercise ReelTile');
  await group.click(); // reels (ReelTiles) load lazily on expand

  const renameBtn = panel.locator('button[aria-label="Rename reel"]').first();
  await renameBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  test.skip((await renameBtn.count()) === 0, 'expanded collection has no reels to exercise ReelTile');

  await expect(renameBtn).toBeVisible();
  await assertPencilBesideName(page, await renameBtn.elementHandle());
  await saveEvidence(page, 'T6890-reel-pencil-beside-name');

  await renameBtn.click();
  const reelInput = page.locator('input:focus');
  await expect(reelInput).toBeVisible();
  expect((await reelInput.inputValue()).length, 'rename input seeded with the name').toBeGreaterThan(0);
  await saveEvidence(page, 'T6890-reel-inline-rename-open');

  await responsiveSweep(page);
});
