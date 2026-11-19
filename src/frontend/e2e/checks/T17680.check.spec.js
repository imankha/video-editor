import { test, expect } from '@playwright/test';
import { loginForCheck, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T17680 - the Manage profiles dialog covers every Home highlight control behind it.
 *
 * Regression of T6600: Manage profiles is mounted by ProfileSportButton inside the Home
 * header cluster (`fixed ... z-30`), so rendered inline its own z-layer is capped by that
 * cluster, and the highlight tiles' Play/Share buttons (`z-30`, later in the DOM) paint and
 * hit-test above it. Steps from the 2026-11-18 report: open Highlights, scroll 300 px, open
 * Manage profiles, then look (C1) and tap (C2) where a background Play/Share button sits.
 */
test.setTimeout(420000);

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

async function openHighlights(page) {
  await page.goto('/');
  await disableGuidanceForCheck(page);
  await page.getByRole('button', { name: /^Highlights/ }).first().click();
  const panel = page.getByTestId('published-tab-panel').first();
  await expect(panel).toBeVisible({ timeout: 60000 });
  const card = panel.getByTestId('reel-card').first();
  const shown = await card.waitFor({ state: 'visible', timeout: 120000 }).then(() => true, () => false);
  if (!shown) {
    const headers = panel.getByTestId('collapsible-group-header');
    const n = await headers.count();
    for (let i = 0; i < n; i++) {
      await headers.nth(i).click({ timeout: 3000 }).catch(() => {});
      if (await card.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) break;
    }
  }
  await expect(card, 'the account needs at least one highlight on Home').toBeVisible({ timeout: 30000 });
}

/** Resize, then scroll Highlights by 300 px with the tiles still on screen (the reported steps). */
async function showViewport(page, viewport) {
  await page.setViewportSize(viewport);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.wheel(0, 300);
  await page.getByTestId('reel-card').first().scrollIntoViewIfNeeded();
}

async function closeManageProfiles(page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Manage profiles' })).toBeHidden({ timeout: 10000 });
}

async function openManageProfiles(page) {
  await page.getByRole('button', { name: /switch sport or profile/i }).click();
  await expect(page.getByRole('heading', { name: 'Manage profiles' })).toBeVisible({ timeout: 30000 });
}

/**
 * Every highlight Play/Share button whose centre is on screen, with the element the browser
 * puts on top at that point and whether that element belongs to the open dialog.
 */
async function probeBackgroundControls(page) {
  return page.evaluate(() => {
    const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Manage profiles');
    const dialog = heading && heading.closest('.fixed.inset-0');
    const buttons = [...document.querySelectorAll('[data-testid="reel-card"] button')];
    return buttons.map((btn) => {
      const r = btn.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (r.width === 0 || x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null;
      const top = document.elementFromPoint(x, y);
      const control = top && top.closest('button, a, input, select, textarea, [role="button"]');
      return {
        topIsDialogControl: !!(dialog && control && dialog.contains(control)),
        label: btn.getAttribute('aria-label') || btn.textContent.trim(),
        x, y,
        topInDialog: !!(dialog && top && dialog.contains(top)),
        topInTile: !!(top && top.closest('[data-testid="reel-card"]')),
      };
    }).filter(Boolean);
  });
}

test('T17680:C1 no background highlight control paints above Manage profiles at phone, tablet and desktop', async ({ page }) => {
  await loginForCheck(page);
  await openHighlights(page);
  for (const viewport of VIEWPORTS) {
    await showViewport(page, viewport);
    await openManageProfiles(page);
    const probes = await probeBackgroundControls(page);
    expect(probes.length, `${viewport.width}x${viewport.height}: a highlight control on screen behind the dialog`).toBeGreaterThan(0);
    const escaped = probes.filter((p) => !p.topInDialog || p.topInTile);
    expect(escaped, `${viewport.width}x${viewport.height}: controls above the dialog`).toEqual([]);
    await closeManageProfiles(page);
  }
});

// The dialog layer is the backdrop plus the panel on it. On a short Home page the tiles sit
// under the centred panel, so the tap goes to a Play/Share spot where the dialog has no
// control of its own (tapping a profile row there would switch the account's profile): it
// must land on the dialog layer, not reach the tile, and leave the dialog open. A viewport
// where every Play/Share spot is under a dialog control is hit-tested without tapping.
test('T17680:C2 tapping where a background Play or Share button sits hits the dialog backdrop, not the button', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();
  await loginForCheck(page);
  await openHighlights(page);
  await page.evaluate(() => {
    window.__t17680Hits = [];
    window.addEventListener('click', (e) => {
      const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Manage profiles');
      const dialog = heading && heading.closest('.fixed.inset-0');
      window.__t17680Hits.push({
        inDialog: !!(dialog && dialog.contains(e.target)),
        inTile: !!e.target.closest('[data-testid="reel-card"]'),
        target: `${e.target.tagName} ${(e.target.getAttribute('aria-label') || e.target.textContent || '').slice(0, 40)}`,
      });
    }, { capture: true });
  });
  let tapped = 0;
  for (const viewport of VIEWPORTS) {
    const touch = viewport.width < 1024;
    await showViewport(page, viewport);
    await openManageProfiles(page);
    let probes = [];
    let target;
    for (const block of [null, 'start', 'center', 'end']) {
      if (block) await page.getByTestId('reel-card').first().evaluate((el, b) => el.scrollIntoView({ block: b }), block);
      probes = (await probeBackgroundControls(page)).filter((p) => p.label === 'Share' || p.label === 'Watch marked plays');
      target = probes.find((p) => !p.topIsDialogControl && p.label === 'Share') || probes.find((p) => !p.topIsDialogControl);
      if (target) break;
    }
    const size = `${viewport.width}x${viewport.height}`;
    expect(probes.length, `${size}: a Play/Share button on screen behind the dialog`).toBeGreaterThan(0);
    if (!target) {
      expect(probes.filter((p) => !p.topInDialog || p.topInTile), `${size}: Play/Share spots the dialog does not take`).toEqual([]);
      await closeManageProfiles(page);
      continue;
    }

    await page.evaluate(() => { window.__t17680Hits = []; });
    if (touch) await page.touchscreen.tap(target.x, target.y);
    else await page.mouse.click(target.x, target.y);
    tapped += 1;

    const hits = await page.evaluate(() => window.__t17680Hits);
    const where = `${size} ${touch ? 'tap' : 'click'} on ${target.label} at ${Math.round(target.x)},${Math.round(target.y)}`;
    expect(hits.length, `${where}: produced a click`).toBeGreaterThan(0);
    expect(hits.filter((h) => h.inTile), `${where}: clicks that reached a highlight tile`).toEqual([]);
    expect(hits.filter((h) => !h.inDialog), `${where}: clicks outside the dialog layer`).toEqual([]);
    await expect(page.getByRole('heading', { name: 'Manage profiles' }), `${where}: dialog still open`).toBeVisible();
    await closeManageProfiles(page);
  }
  expect(tapped, 'at least one real tap or click on a Play/Share spot').toBeGreaterThan(0);
  await context.close();
});

test('T17680:C3 Manage profiles, then Intro cards, then a delete confirmation stack in order', async ({ page }) => {
  await loginForCheck(page);
  await openHighlights(page);
  await showViewport(page, { width: 1440, height: 900 });
  await openManageProfiles(page);
  await page.getByTitle('Edit name, color & sport').first().click();
  await page.getByRole('button', { name: 'Intro cards' }).click();
  const introModal = page.getByTestId('intro-cards-modal');
  await expect(introModal).toBeVisible({ timeout: 30000 });

  // Level 2: the Intro cards dialog covers Manage profiles and the page.
  const introTop = await page.evaluate(() => {
    const modal = document.querySelector('[data-testid="intro-cards-modal"]');
    const top = document.elementFromPoint(8, window.innerHeight / 2);
    return !!(modal && top && modal.contains(top));
  });
  expect(introTop, 'Intro cards dialog is on top at the left edge').toBe(true);

  // Level 3: a delete confirmation opened from a card covers the Intro cards dialog.
  const deleteBtn = introModal.getByRole('button', { name: /^Delete / }).first();
  await expect(deleteBtn, 'the profile needs at least one intro card').toBeVisible({ timeout: 30000 });
  await deleteBtn.click();
  const confirmTitle = page.getByRole('heading', { name: /^Delete ".*"\?$/ });
  await expect(confirmTitle).toBeVisible({ timeout: 10000 });
  const confirmTop = await page.evaluate(() => {
    const title = [...document.querySelectorAll('h3')].find((h) => /^Delete ".*"\?$/.test(h.textContent.trim()));
    const r = title.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === title || title.contains(top);
  });
  expect(confirmTop, 'the confirmation is on top').toBe(true);
  // Leave without deleting.
  await page.getByRole('dialog').filter({ has: confirmTitle }).getByRole('button', { name: 'Cancel' }).click();
  await expect(confirmTitle).toBeHidden();
  await expect(introModal).toBeVisible();
});
