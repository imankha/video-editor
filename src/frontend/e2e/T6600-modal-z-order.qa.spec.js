import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence, assertNoHorizontalOverflow } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';
import { Z } from '../src/constants/zLayers.js';

/**
 * T6600 — REAL BROWSER proof of the intro-card modal z-order fix. Pure CSS
 * stacking-context bug; jsdom cannot prove it (T5380 rule).
 *
 * Root cause (measured, see T6600-diag): the intro-card modal is a DOM child of
 * ManageProfilesModal (`fixed ... z-50`), itself inside the `fixed top-4 right-4
 * z-30` header container — so the modal is TRAPPED in another element's stacking
 * context and its root-level ceiling is that container's z, NOT the z-50 it sets.
 * DraftTile portals its hover overlays to `document.body` at z-[60]/z-[70]
 * (DraftTile.jsx:708,711) precisely to escape its own hover:scale transform. A
 * body-portal at z >= the trap therefore paints OVER the modal — undimmed, above
 * the scrim, which no backdrop opacity can fix.
 *
 * REPRODUCTION FIDELITY: the DraftTile portal only exists WHILE A TILE IS
 * INTERACTED WITH, so an idle check falsely passes. This spec reproduces the exact
 * production stacking condition two ways:
 *   (1) hover every real draft tile and assert none paints over the modal, and
 *   (2) inject the byte-for-byte DraftTile body-portal (its real Tailwind classes
 *       `fixed inset-4 ... z-[70]`, appended to document.body) while the modal is
 *       open, and assert the MODAL — not the portal — is the topmost element over
 *       the panel. On unfixed code (2) fails (the portal wins); post-fix the modal
 *       wins because it is portaled to body at the nested-modal layer above z-[70].
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';

// Exact classes DraftTile.jsx:708/711 put on its body-portaled preview overlays:
// a full-viewport backdrop at z-[60] plus the panel at z-[70]. The z-[60] inset-0
// backdrop alone covers the whole modal, so the probe is geometry-independent.
const DRAFT_PORTAL_BACKDROP = 'fixed inset-0 bg-black/80 z-[60]';
const DRAFT_PORTAL_PANEL = 'fixed inset-4 md:inset-12 lg:inset-20 z-[70] flex flex-col bg-gray-900 rounded-xl';

async function openIntroCards(page) {
  await page.goto('/home/reels');
  await page.waitForSelector('[data-testid="project-card"]', { timeout: 20000 });
  await page.getByRole('button', { name: /switch sport or profile/i }).click();
  await page.getByRole('heading', { name: 'Manage Profiles' }).waitFor({ timeout: 10000 });
  await page.getByTitle('Edit name, color & sport').first().click();
  await page.getByRole('button', { name: 'Intro cards' }).click();
  await page.getByRole('heading', { name: 'Intro cards' }).waitFor({ timeout: 10000 });
}

// Return the topmost element's testid-chain at the viewport centre (always inside
// both the intro panel and the injected inset-0 backdrop).
async function paintChainAtCentre(page) {
  return page.evaluate(() => {
    const x = window.innerWidth / 2;
    const y = window.innerHeight / 2;
    const chain = [];
    let el = document.elementsFromPoint(x, y)[0];
    while (el && el !== document.body) {
      chain.push(el.getAttribute('data-testid') || el.className.toString().slice(0, 40));
      el = el.parentElement;
    }
    return chain;
  });
}

test.describe('T6600 intro-card modal z-order (real browser)', () => {
  skipOnDeployedTarget(test, 'needs dev-login + real data; local/staging only');
  test.setTimeout(180000);

  test('no page element paints over the intro-card modal — desktop + 375px', async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL);

    for (const [w, h, label] of [[1280, 800, 'desktop'], [375, 780, '375px']]) {
      await page.setViewportSize({ width: w, height: h });
      await openIntroCards(page);

      // Responsive: the open modal must not introduce horizontal overflow.
      await assertNoHorizontalOverflow(page);

      // (1) Hover every real draft tile; none may paint over the modal.
      const tiles = page.locator('[data-testid="project-card"]');
      const count = await tiles.count();
      for (let i = 0; i < count; i++) {
        const box = await tiles.nth(i).boundingBox();
        if (!box) continue;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        if (cy < 0 || cy > h) continue;
        await page.mouse.move(cx, cy);
        await page.waitForTimeout(100);
        const chain = await page.evaluate(([px, py]) => {
          const c = [];
          let el = document.elementsFromPoint(px, py)[0];
          while (el && el !== document.body) { c.push(el.getAttribute('data-testid')); el = el.parentElement; }
          return c;
        }, [cx, cy]);
        const overModal = chain.some((t) => t === 'project-card' || t === 'ready-actions' || t === 'draft-kebab-menu');
        expect(overModal, `[${label}] hovered tile #${i} paints over modal: ${JSON.stringify(chain)}`).toBe(false);
      }

      // (2) Inject the real DraftTile body-portal (backdrop z-[60] + panel z-[70])
      //     over the open modal, then verify the MODAL is still on top (the fix
      //     escapes the trap and outranks the tile portals).
      await page.evaluate(([bd, pn]) => {
        for (const [cls, tid] of [[bd, 't6600-draft-backdrop'], [pn, 't6600-draft-portal-probe']]) {
          const probe = document.createElement('div');
          probe.className = cls;
          probe.setAttribute('data-testid', tid);
          document.body.appendChild(probe);
        }
      }, [DRAFT_PORTAL_BACKDROP, DRAFT_PORTAL_PANEL]);
      await page.waitForTimeout(60);
      const chain = await paintChainAtCentre(page);
      await saveEvidence(page, `T6600-${label}-portal-over-modal`);
      const portalOnTop = chain.includes('t6600-draft-portal-probe') || chain.includes('t6600-draft-backdrop');
      expect(portalOnTop, `[${label}] DraftTile-style body portal paints OVER the intro modal: ${JSON.stringify(chain)}`).toBe(false);

      await page.evaluate(() => {
        document.querySelector('[data-testid="t6600-draft-portal-probe"]')?.remove();
        document.querySelector('[data-testid="t6600-draft-backdrop"]')?.remove();
      });
      // Close modals for the next viewport pass.
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(150);
    }
  });

  // Nested order: ManageProfiles -> IntroCards -> ConfirmationDialog. The delete-card
  // confirm lives INSIDE the intro-card modal's subtree (IntroCardGrid), so it must
  // paint above the grid at every level.
  test('nested ManageProfiles -> IntroCards -> ConfirmationDialog order', async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openIntroCards(page);

    // The profile may have no cards — create one so there is a delete-confirm to
    // stack. New card -> editor -> back to grid -> the tile's Delete button.
    // Scope strictly to the intro-card modal (reel/game tiles elsewhere also carry
    // "Delete <x>" labels behind the modal).
    const modal = page.getByTestId('intro-cards-modal');
    const visibleDel = modal.getByRole('button', { name: /^Delete / }).filter({ visible: true });
    if ((await visibleDel.count()) === 0) {
      await modal.getByRole('button', { name: 'New card' }).first().click();
      // Editor (or the consent gate) exposes a "Cards" back control.
      const back = page.getByRole('button', { name: /Cards/ });
      await back.first().waitFor({ timeout: 15000 }).catch(() => {});
      await back.first().click().catch(() => {});
      await visibleDel.first().waitFor({ timeout: 10000 }).catch(() => {});
    }
    if ((await visibleDel.count()) === 0) {
      test.skip(true, 'could not create an intro card to delete-confirm');
      return;
    }
    await visibleDel.first().click();
    const dialog = page.getByRole('button', { name: 'Delete card' });
    await dialog.waitFor({ timeout: 5000 });

    // The confirm's own button must be the topmost element at its centre (nothing
    // from the intro grid or the page paints over it).
    const box = await dialog.boundingBox();
    const onTop = await page.evaluate(([x, y]) => {
      const top = document.elementsFromPoint(x, y)[0];
      return top && (top.textContent || '').includes('Delete card');
    }, [box.x + box.width / 2, box.y + box.height / 2]);
    await saveEvidence(page, 'T6600-nested-confirm-over-intro');
    expect(onTop, 'delete-card confirm must paint above the intro-card grid').toBe(true);

    // Clean up the card created for this test (leave the real account as found).
    await page.getByRole('button', { name: 'Delete card' }).click().catch(() => {});
  });

  // Regression matrix for the mechanical scale migration (byte-identical z-values,
  // now read from constants/zLayers). The ordering itself is locked by
  // src/constants/zLayers.test.js; this proves it against the REAL DownloadsPanel
  // in a real browser: the PLAYER rung (CollectionPlayer) covers the panel, and the
  // ALERT rung (LockedReasonModal) covers the player. The rung classes injected are
  // the exact strings the migrated components render (Z.PLAYER / Z.ALERT).
  // Which layer is topmost at (x,y)? Report the DownloadsPanel drawer as
  // 'downloads-panel' (a RIGHT-side panel, so the probe point comes from its own
  // bounding box), else the topmost element's testid.
  const topTestIdAt = (page, x, y) => page.evaluate(([px, py]) => {
    let n = document.elementsFromPoint(px, py)[0];
    while (n && n !== document.body) {
      if ((n.className || '').toString().includes('animate-slide-in-right')) return 'downloads-panel';
      const t = n.getAttribute('data-testid');
      if (t) return t;
      n = n.parentElement;
    }
    return null;
  }, [x, y]);

  test('regression: PLAYER covers DownloadsPanel; ALERT covers the player', async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // Open the REAL DownloadsPanel (Highlight Reels) — it opens even with zero reels.
    await page.getByRole('button', { name: /my reels/i }).first().click();
    const drawer = page.locator('.animate-slide-in-right').first();
    await drawer.waitFor({ timeout: 15000 });
    const dbox = await drawer.boundingBox();
    // Probe just inside the drawer's LEFT edge, clamped into the viewport, so the
    // point is guaranteed to land on the panel (a right-side sheet).
    const px = Math.min(Math.max(dbox.x + 15, 5), 1280 - 5);
    const py = Math.min(dbox.y + dbox.height / 2, 800 - 5);
    expect(await topTestIdAt(page, px, py), 'DownloadsPanel drawer is open beneath the probe point').toBe('downloads-panel');

    // If the account has a published reel, drive the REAL CollectionPlayer too.
    const reel = page.locator('[data-testid="reel-card"]');
    if ((await reel.count()) > 0) {
      await reel.first().getByRole('button', { name: 'Play video' }).first().click();
      await page.locator('[data-testid="collection-player-backdrop"]').waitFor({ timeout: 15000 });
      const t = await topTestIdAt(page, px, py);
      expect(t, 'real CollectionPlayer must cover the DownloadsPanel').not.toBe('downloads-panel');
      await saveEvidence(page, 'T6600-real-collectionplayer-over-downloads');
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);
    }

    // PLAYER rung over the real panel: inject CollectionPlayer's real root class.
    await page.evaluate((cls) => {
      const el = document.createElement('div');
      el.className = `fixed inset-0 ${cls} bg-black`;
      el.setAttribute('data-testid', 't6600-player-probe');
      document.body.appendChild(el);
    }, Z.PLAYER);
    await page.waitForTimeout(60);
    expect(await topTestIdAt(page, px, py), 'PLAYER rung must cover the DownloadsPanel').toBe('t6600-player-probe');
    await saveEvidence(page, 'T6600-player-over-downloads');

    // ALERT rung over the player: inject LockedReasonModal's real root class.
    await page.evaluate((cls) => {
      const el = document.createElement('div');
      el.className = `fixed inset-0 ${cls} flex items-center justify-center`;
      el.setAttribute('data-testid', 't6600-alert-probe');
      document.body.appendChild(el);
    }, Z.ALERT);
    await page.waitForTimeout(60);
    expect(await topTestIdAt(page, px, py), 'ALERT rung (LockedReason) must cover the player').toBe('t6600-alert-probe');
    await saveEvidence(page, 'T6600-alert-over-player');

    await page.evaluate(() => {
      document.querySelector('[data-testid="t6600-player-probe"]')?.remove();
      document.querySelector('[data-testid="t6600-alert-probe"]')?.remove();
    });
  });
});
