// T11770 live QA: the shared CreditCostRow across its four modals. Drives the
// real app as a real user across the milestone width set, proving:
//   AC1 cost / balance / retention never interleave; each readable on its own
//       line or unit (the original bug: "2 credits - keeps your video for 30
//       Balance: days 54").
//   AC2 all modals show the same CreditCostRow layout.
//   AC3 an insufficient balance renders the balance red AND the existing
//       buy-credits path still works (clicked through, not just asserted).
//
// Coverage note: this spec live-drives THREE of the four CreditCostRow modals
// across the full 320/360/375/390/768 width set: Upload game, Add video, and
// Add footage (opened inside the Annotate editor on the seeded account's game).
// The one call site NOT live-driven is StorageExtensionModal: it only opens for a
// near/expired game, and the seeded account has none (its one game is ~2 weeks
// from expiry) -- a genuine fixture gap. It renders the SAME CreditCostRow with
// the same prop shape proven here and is covered by its unit tests
// (StorageExtensionModal.test.jsx asserts the stacked cost/note/red-balance
// layout), so the residual layout risk is low.
import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth';
import { saveEvidence, assertNoHorizontalOverflow } from './helpers/qa.js';
import { GAME_RETENTION_NOTE, ATTACH_RETENTION_NOTE, FOOTAGE_RETENTION_NOTE } from './helpers/retentionCopy.js';

const EMAIL = 'imankh@gmail.com';
const WIDTHS = [320, 360, 375, 390, 768];
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_VIDEO = path.resolve(__dirname, '../../../formal annotations/test.short/game2-test.mp4');

// A node that interleaves has WRAPPED to 2+ lines (the original bug shape was
// "...for 30 Balance: days 54" -- cost and balance each spilling onto a second
// line beside each other). A single-line node's rendered height is ~one
// line-height; a 2-line node is ~2x. Assert the node's height is at most ~1.5x
// its computed line-height, so a wrap is caught no matter how it is positioned.
// Falls back to 1.2*font-size when line-height computes to the 'normal' keyword.
// NOTE: positional checks alone (balance to the right of cost) do NOT catch this
// -- two side-by-side 2-line nodes satisfy them while interleaving (round-3 MAJOR
// review finding, 2026-10-04). The single-line check is the real AC1 guard.
async function assertSingleLine(locator, label) {
  const m = await locator.evaluate((node) => {
    const cs = getComputedStyle(node);
    let lh = parseFloat(cs.lineHeight);
    if (Number.isNaN(lh)) lh = parseFloat(cs.fontSize) * 1.2; // 'normal'
    return { lineHeight: lh, height: node.getBoundingClientRect().height };
  });
  expect(
    m.height,
    `${label} must render on ONE line (height=${m.height.toFixed(1)}px, line-height=${m.lineHeight.toFixed(1)}px) -- a wrap here is the interleave bug`,
  ).toBeLessThanOrEqual(m.lineHeight * 1.5);
}

// The CreditCostRow row (cost + balance) and its note must never interleave:
// each of cost/balance is one whitespace-nowrap node that stays on a SINGLE line
// (assertSingleLine), balance sits to the RIGHT of cost on a shared row or drops
// WHOLE to its own line below it, and the note (when present) sits below both.
async function assertCostRowLaidOut(page, noteText) {
  const cost = page.getByText(/^Cost: \d+ credit/).first();
  const balance = page.getByText(/^Balance: /).first();
  await expect(cost).toBeVisible();
  await expect(balance).toBeVisible();

  // AC1 core: neither cost nor balance may wrap onto a second line.
  await assertSingleLine(cost, 'Cost');
  await assertSingleLine(balance, 'Balance');

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
    await assertSingleLine(note, 'Note');
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

      await assertCostRowLaidOut(page, GAME_RETENTION_NOTE);
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

      await assertCostRowLaidOut(page, ATTACH_RETENTION_NOTE);
      await assertNoHorizontalOverflow(page);
      await saveEvidence(page, `criterion-2-attach-video-modal-${width}`);
    });

    test(`add-footage modal: same layout @${width}`, async ({ context, page }) => {
      await loginAsRealUser(context, EMAIL);
      await page.setViewportSize({ width, height: 760 });
      // Open the seeded account's game straight into Annotate, where the
      // "Add footage to game" button lives (AnnotateModeView whole-game row).
      const res = await page.request.get('/api/games');
      const body = await res.json();
      const games = Array.isArray(body) ? body : (body.games || []);
      expect(games.length).toBeGreaterThan(0);
      // Open the game in Annotate, retrying the navigation if we land on the
      // sign-in gate. Driving this one real account through ~16 sequential tests
      // (each its own dev-login) occasionally leaves session-init not yet settled
      // when /annotate mounts, so the auth gate flashes; re-minting the cookie and
      // re-navigating clears it. Caveat: a hard dev-login failure (4xx) still
      // throws from loginAsRealUser, but this retry CANNOT distinguish a benign
      // not-yet-settled flash from a real frontend regression that surfaces the
      // sign-in gate (e.g. a 503/500 during session-init the gate renders instead
      // of surfacing) -- it would paper over such a bug if it cleared within 3
      // tries. Bounded to 3 so a persistent gate still fails the test loudly.
      const restart = page.getByRole('button', { name: 'Restart' }).first();
      for (let attempt = 1; attempt <= 3; attempt++) {
        await openGameInAnnotate(page, games[0].id);
        // Boot preloader (#preloader) overlays the DOM while session-init + the
        // game load run; it intercepts pointer events and the editor re-renders as
        // data lands, so wait it out before reaching for controls.
        await page.locator('#preloader').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
        if (await restart.isVisible().catch(() => false)) break;
        // Still not in the editor -> re-auth and try again (unless out of tries).
        expect(attempt, 'Annotate editor never loaded (stuck on sign-in gate)').toBeLessThan(3);
        await loginAsRealUser(context, EMAIL);
      }

      // The whole-game actions (incl. "Add footage to game") render only when NO
      // play is selected (!isEditMode). Selection is playhead-derived (the
      // auto-select/deselect effect in AnnotateContainer), and the editor
      // restores the last-viewed time, which can sit inside a play and auto-select
      // it. Seek to 0 via Restart: time 0 is before every play on this game, so
      // the effect deselects and the whole-game row (with the button) appears.
      await expect(restart).toBeVisible({ timeout: 30000 });
      await restart.click();

      const addBtn = page.getByRole('button', { name: 'Add footage to game' }).first();
      await expect(addBtn).toBeVisible({ timeout: 30000 });
      await addBtn.click();
      await expect(page.getByRole('heading', { name: 'Add footage' })).toBeVisible();

      await assertCostRowLaidOut(page, FOOTAGE_RETENTION_NOTE);
      // No assertNoHorizontalOverflow here: the Annotate editor behind the modal
      // has its own known narrow-width header overflow (T11740, not yet merged),
      // which is unrelated to this modal's CreditCostRow. The modal is a centered
      // max-w-md overlay; assertCostRowLaidOut is the layout proof that matters.
      await saveEvidence(page, `criterion-2-add-footage-modal-${width}`);
    });
  }

  // Counterfactual (round-3 MAJOR review): PROVE the strengthened check actually
  // catches an interleave. Reconstruct the exact bug shape the reviewer described
  // -- a 230px flex-wrap row whose cost AND balance each wrap to 2 lines side by
  // side (the pre-fix layout, before whitespace-nowrap). The OLD positional check
  // (balance to the right of cost) still PASSES this; assertSingleLine must FAIL.
  test('assertSingleLine catches the interleave the positional check misses', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 760 });
    // No whitespace-nowrap + width-constrained spans -> each text wraps to 2 lines.
    await page.setContent(`<!doctype html><html><body style="margin:0">
      <div id="row" style="width:230px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:0 12px;align-items:flex-start;font:14px/20px sans-serif;color:#111">
        <span id="cost" style="width:95px">Cost: 2 credits now</span>
        <span id="bal" style="width:95px">Balance: 54 credits</span>
      </div></body></html>`);
    const cost = page.locator('#cost');
    const bal = page.locator('#bal');
    const cb = await cost.boundingBox();
    const bb = await bal.boundingBox();

    // Both genuinely wrapped (2 lines ~= 40px at line-height 20px) and sit on a
    // shared row -> the OLD positional guard is satisfied, i.e. blind to the bug.
    expect(cb.height, 'cost should have wrapped to 2 lines in the counterfactual').toBeGreaterThan(30);
    expect(bb.height, 'balance should have wrapped to 2 lines in the counterfactual').toBeGreaterThan(30);
    expect(Math.abs(cb.y - bb.y)).toBeLessThan(cb.height * 0.75);          // sameRow branch
    expect(bb.x).toBeGreaterThanOrEqual(cb.x + cb.width - 1);               // old check PASSES

    // The strengthened check MUST reject both wrapped nodes.
    let costThrew = false;
    try { await assertSingleLine(cost, 'Cost'); } catch { costThrew = true; }
    expect(costThrew, 'assertSingleLine must FAIL on a wrapped cost (the interleave)').toBe(true);
    let balThrew = false;
    try { await assertSingleLine(bal, 'Balance'); } catch { balThrew = true; }
    expect(balThrew, 'assertSingleLine must FAIL on a wrapped balance (the interleave)').toBe(true);

    // Sanity: the SAME check passes once the nodes are forced onto one line
    // (whitespace-nowrap), confirming it is not just always-throwing.
    await cost.evaluate((n) => { n.style.whiteSpace = 'nowrap'; n.style.width = 'auto'; });
    await bal.evaluate((n) => { n.style.whiteSpace = 'nowrap'; n.style.width = 'auto'; });
    await assertSingleLine(cost, 'Cost');
    await assertSingleLine(bal, 'Balance');
  });

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
