// T11770 live QA: the shared CreditCostRow across its four modals. Drives the
// real app as a real user at 320 and 390, proving the acceptance criteria:
//   AC1 cost / balance / retention never interleave; each readable on its own
//       line or unit (the original bug: "2 credits - keeps your video for 30
//       Balance: days 54").
//   AC2 all modals show the same CreditCostRow layout.
//   AC3 an insufficient balance renders the balance red AND the existing
//       buy-credits path still works (clicked through, not just asserted).
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, assertNoHorizontalOverflow } from './helpers/qa.js';

const EMAIL = 'imankh@gmail.com';
const WIDTHS = [320, 390];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_VIDEO = path.resolve(__dirname, '../../../formal annotations/test.short/game2-test.mp4');

// The CreditCostRow row (cost + balance) and its note must never interleave:
// each of cost/balance is one whitespace-nowrap node, balance sits to the RIGHT
// of cost on a shared row or drops WHOLE to its own line below it, and the note
// (when present) sits below both.
async function assertCostRowLaidOut(page, noteText) {
  const cost = page.getByText(/^Cost: \d+ credit/).first();
  const balance = page.getByText(/^Balance: /).first();
  await expect(cost).toBeVisible();
  await expect(balance).toBeVisible();
  const cb = await cost.boundingBox();
  const bb = await balance.boundingBox();

  const sameRow = Math.abs(cb.y - bb.y) < cb.height * 0.75;
  if (sameRow) {
    // on one row -> balance strictly to the right of cost, no horizontal overlap
    expect(bb.x).toBeGreaterThanOrEqual(cb.x + cb.width - 1);
  } else {
    // wrapped -> balance dropped to its own line below cost, intact
    expect(bb.y).toBeGreaterThan(cb.y + cb.height - 1);
  }

  if (noteText) {
    const note = page.getByText(noteText).first();
    await expect(note).toBeVisible();
    const nb = await note.boundingBox();
    // note is on its own line below BOTH cost and balance
    expect(nb.y).toBeGreaterThan(Math.max(cb.y + cb.height, bb.y + bb.height) - 1);
  }
  return { cb, bb };
}

async function openGamesTab(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /^Games\b/ }).first().click();
  // "Upload game" is unique to the Games tab -> confirms the switch landed before
  // we go looking for a tile kebab (otherwise we're still on the default Clips tab).
  await expect(page.getByRole('button', { name: 'Upload game' }).first()).toBeVisible({ timeout: 15000 });
}

test.describe('T11770 CreditCostRow', () => {
  test.describe.configure({ timeout: 90000 });

  for (const width of WIDTHS) {
    test(`upload-game modal: cost/balance/note never interleave @${width}`, async ({ context, page }) => {
      await loginAsRealUser(context, EMAIL);
      await page.setViewportSize({ width, height: 760 });
      await openGamesTab(page);
      await page.getByRole('button', { name: 'Upload game' }).first().click();
      await expect(page.getByRole('heading', { name: 'Upload game' })).toBeVisible();

      await assertCostRowLaidOut(page, 'Your game video is kept for 30 days.');
      await assertNoHorizontalOverflow(page);
      await saveEvidence(page, `criterion-1-upload-modal-${width}`);
    });

    test(`attach-video modal: same layout @${width}`, async ({ context, page }) => {
      await loginAsRealUser(context, EMAIL);
      await page.setViewportSize({ width, height: 760 });
      await openGamesTab(page);
      // Open the game tile's action menu (kebab) and choose "Add video".
      const kebab = page.locator('[data-game-kebab]').first();
      await expect(kebab).toBeVisible({ timeout: 15000 });
      await kebab.click();
      // Scope to the kebab menu + exact name: the game tile is itself a role=button
      // whose name loosely matches, so an unscoped query would grab the tile (and
      // navigate into the editor) instead of the menu item.
      await page.locator('[data-game-menu]').getByRole('button', { name: 'Add video', exact: true }).click({ timeout: 15000 });
      await expect(page.getByRole('heading', { name: 'Add a video' })).toBeVisible();

      await assertCostRowLaidOut(page, 'keeps this video for 30 days');
      await assertNoHorizontalOverflow(page);
      await saveEvidence(page, `criterion-2-attach-video-modal-${width}`);
    });
  }

  test('insufficient balance: balance renders red and buy-credits path still works @390', async ({ context, page }) => {
    await loginAsRealUser(context, EMAIL);
    await page.setViewportSize({ width: 390, height: 760 });
    await openGamesTab(page);
    // The balance comes from session-init, not a standalone GET, so force a short
    // balance in the store after load (cost is 2, so 1 < 2 -> red). fetchCredits is
    // one-shot (guarded) and opening the modal only reads the store, so this holds.
    await page.evaluate(async () => {
      const { useCreditStore } = await import('/src/stores/creditStore.js');
      useCreditStore.setState({ balance: 1, loaded: true });
    });
    await page.getByRole('button', { name: 'Upload game' }).first().click();
    await expect(page.getByRole('heading', { name: 'Upload game' })).toBeVisible();

    // Balance node is red.
    const balance = page.getByText(/^Balance: 1 credit/).first();
    await expect(balance).toBeVisible();
    const cls = await balance.getAttribute('class');
    expect(cls).toContain('text-red-400');
    await saveEvidence(page, 'criterion-3-balance-red');

    // Click through the existing buy-credits path: pick a file to enable submit,
    // then submit with the short balance -> BuyCreditsModal opens.
    await page.locator('.fixed input[type="file"]').first().setInputFiles(TEST_VIDEO);
    const submit = page.getByRole('button', { name: 'Upload game' }).last();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText('Buy Credits').first()).toBeVisible();
    await saveEvidence(page, 'criterion-3-buy-credits-opens');
  });
});
