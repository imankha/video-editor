import { test, expect } from '@playwright/test';
import { loginForCheck, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T17850 - a highlight card cut off at either end of a Home highlights carousel shows no
 * Play or Share button, so nothing sits under the carousel's previous/next arrow.
 *
 * Owner report (staging, 2026-11-19): the right edge card's play button overlapped the next
 * arrow. The checks open Home > Highlights, find a highlights carousel that overflows, scroll
 * it to its start (a card cut off at the right end) and its end (cut off at the left end; the
 * row snaps to card starts, so these are the positions a user lands on), and look at every
 * card's controls (C1); then scroll a cut-off card fully into view and play it (C2).
 */
test.setTimeout(420000);

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];

async function openHighlights(page) {
  await page.goto('/home');
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

/**
 * Mark the first highlights carousel of 2+ cards that overflows (data-t17850-row). An account
 * with too few highlights to overflow a row at this width (the dev preset has 2) gets its first
 * row of 2+ cards narrowed to 1.6 cards wide, which is what a longer row looks like at its
 * ends. Returns false when no row has 2 cards.
 */
async function prepareRow(page) {
  const ok = await page.evaluate(() => {
    document.querySelectorAll('[data-t17850-row]').forEach((r) => r.removeAttribute('data-t17850-row'));
    const rows = [...document.querySelectorAll('[role="group"][aria-label$="highlights"]')]
      .filter((r) => r.querySelectorAll('[data-testid="reel-card"]').length >= 2);
    let row = rows.find((r) => r.scrollWidth - r.clientWidth > 40);
    if (!row && rows.length) {
      row = rows[0];
      const tileW = row.querySelector('[data-testid="reel-card"]').offsetWidth;
      row.parentElement.style.width = `${Math.round(tileW * 1.6)}px`;
    }
    if (!row) return false;
    row.setAttribute('data-t17850-row', '');
    return true;
  });
  if (!ok) return false;
  const row = page.locator('[data-t17850-row]');
  await expect.poll(() => row.evaluate((r) => r.scrollWidth - r.clientWidth), { timeout: 30000 }).toBeGreaterThan(40);
  await row.scrollIntoViewIfNeeded();
  return true;
}

/** Scroll the marked row to its start (a card cut off on the right) or end (cut off on the left). */
async function scrollRowTo(page, where) {
  await page.locator('[data-t17850-row]').evaluate((r, w) => {
    r.style.scrollBehavior = 'auto';
    r.scrollLeft = w === 'start' ? 0 : r.scrollWidth;
    r.style.scrollBehavior = '';
  }, where);
}

/**
 * Every card in the marked row, with whether it is cut off by the row, and each of its
 * Play/Share buttons: whether it shows (no ancestor at opacity 0 or visibility hidden) and
 * whether its box overlaps either carousel arrow.
 */
async function probeRow(page) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-t17850-row]');
    const rr = row.getBoundingClientRect();
    const wrapper = row.parentElement;
    const arrows = [...wrapper.querySelectorAll('button[aria-label="Scroll left"], button[aria-label="Scroll right"]')]
      .map((a) => a.getBoundingClientRect());
    const shows = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      }
      return true;
    };
    const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return {
      arrowCount: arrows.length,
      cards: [...row.querySelectorAll('[data-testid="reel-card"]')].map((card, index) => {
        // Untransformed box: a hover scale must not count as cut off.
        const r = card.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const left = cx - card.offsetWidth / 2;
        const right = cx + card.offsetWidth / 2;
        const onScreen = right > rr.left && left < rr.right;
        const cutLeft = onScreen && left < rr.left - 2;
        const cutRight = onScreen && right > rr.right + 2;
        const cutOff = cutLeft || cutRight;
        const controls = [...card.querySelectorAll('button')]
          .filter((b) => /share|play/i.test(b.getAttribute('aria-label') || ''))
          .map((b) => {
            const br = b.getBoundingClientRect();
            return {
              label: b.getAttribute('aria-label'),
              shows: shows(b),
              overArrow: arrows.some((a) => overlaps(br, a)),
            };
          });
        return { index, name: card.querySelector('h3')?.textContent.trim(), onScreen, cutLeft, cutRight, cutOff, controls };
      }),
    };
  });
}

test('T17850:C1 edge cards show no Play or Share button and no card control overlaps an arrow, phone and desktop', async ({ page }) => {
  await loginForCheck(page);
  await openHighlights(page);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.mouse.move(0, 0);
    expect(await prepareRow(page), `${viewport.width}px: a highlights carousel with 2+ cards`).toBe(true);
    for (const [where, side] of [['start', 'cutRight'], ['end', 'cutLeft']]) {
      const at = `${viewport.width}px, row ${where}`;
      await scrollRowTo(page, where);
      await expect.poll(async () => (await probeRow(page)).cards.some((c) => c[side]),
        { timeout: 60000, message: `${at}: a card cut off at the ${side === 'cutRight' ? 'right' : 'left'} end` }).toBe(true);
      await expect.poll(async () => {
        const { cards } = await probeRow(page);
        return cards.filter((c) => c.cutOff).flatMap((c) => c.controls.filter((b) => b.shows).map((b) => `${c.name}: ${b.label}`));
      }, { timeout: 60000, message: `${at}: Play/Share showing on a cut-off card` }).toEqual([]);
      const { arrowCount, cards } = await probeRow(page);
      expect(arrowCount, `${at}: previous/next arrows drawn`).toBe(2);
      const overArrow = cards.flatMap((c) => c.controls.filter((b) => b.shows && b.overArrow).map((b) => `${c.name}: ${b.label}`));
      expect(overArrow, `${at}: a showing card control over an arrow`).toEqual([]);
      for (const c of cards.filter((x) => x.onScreen && !x.cutOff)) {
        expect(c.controls.map((b) => b.shows), `${at}: ${c.name} keeps Play and Share`).toEqual([true, true]);
      }
    }
  }
});

test('T17850:C2 a cut-off card scrolled fully into view shows its Play button again and plays that highlight', async ({ page }) => {
  await loginForCheck(page);
  await openHighlights(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await prepareRow(page), 'a highlights carousel with 2+ cards').toBe(true);
  const row = page.locator('[data-t17850-row]');
  await scrollRowTo(page, 'start');
  // At the row start the first card is fully visible with Play and Share; the right edge card hides them.
  let target;
  await expect.poll(async () => {
    const { cards } = await probeRow(page);
    target = cards.find((c) => c.cutRight);
    return !!target && !cards[0].cutOff && cards[0].controls.every((b) => b.shows)
      && target.controls.length === 2 && target.controls.every((b) => !b.shows);
  }, { timeout: 60000, message: 'first card shows Play/Share, right edge card hides them' }).toBe(true);

  const card = row.getByTestId('reel-card').nth(target.index);
  await card.evaluate((el) => el.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
  await expect.poll(async () => {
    const c = (await probeRow(page)).cards[target.index];
    return !c.cutOff && c.controls.every((b) => b.shows);
  }, { timeout: 60000, message: 'the card, now fully visible, shows Play and Share' }).toBe(true);
  const { cards } = await probeRow(page);
  for (const c of cards.filter((x) => x.onScreen && !x.cutOff)) {
    expect(c.controls.map((b) => b.shows), `${c.name} keeps Play and Share`).toEqual([true, true]);
  }

  const name = await card.locator('h3').textContent();
  await card.getByRole('button', { name: /play/i }).first().click();
  await expect(page.getByRole('dialog', { name: name.trim() })).toBeVisible({ timeout: 60000 });
});
