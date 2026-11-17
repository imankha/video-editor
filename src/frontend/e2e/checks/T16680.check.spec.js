import { test, expect } from '@playwright/test';
import { loginForCheck, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T16680 - on a phone the Home top bar (Guidance switch, profile photo) must not cover the
 * "ReelBallers" logo or its tagline, on every Home tab; the desktop header keeps its layout.
 *
 * Accounts differ between targets (dev preset vs staging gate account), and either may have no
 * profile photo. The check gives the current profile a photo by answering its profile list with
 * the server's own list (GET /api/bootstrap) plus an introPhotoUrl, so the photo is always drawn where the app puts it.
 */
test.setTimeout(240000);

// 9:16 gray image, the same aspect as a real intro photo.
const PHOTO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#888"/></svg>',
);

async function givePhoto(page) {
  // Home reads its profile list from GET /api/bootstrap (T16050); a later refetch uses /api/profiles.
  for (const url of ['**/api/bootstrap', '**/api/profiles']) {
    await page.route(url, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const body = await res.json();
      if (Array.isArray(body.profiles)) body.profiles = body.profiles.map((p) => ({ ...p, introPhotoUrl: PHOTO }));
      return route.fulfill({ response: res, json: body });
    });
  }
}

// Boxes of what the user sees: the logo emblem, the title text, the tagline text lines, the
// profile photo and the Guidance switch. Text is measured by its rendered lines, not by the
// full-width block that holds it.
async function headerBoxes(page) {
  return page.evaluate((photo) => {
    const tagline = [...document.querySelectorAll('p')].find((p) => p.textContent.startsWith('Transform game film'));
    const header = tagline.parentElement;
    const textRects = (el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return [...r.getClientRects()].filter((b) => b.width > 0 && b.height > 0);
    };
    const box = (b) => ({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
    const logo = header.querySelector('svg');
    const title = [...header.querySelectorAll('*')].find((el) => el.children.length === 0 && /ReelBallers/.test(el.textContent));
    const img = [...document.querySelectorAll('img')].find((i) => i.getAttribute('src') === photo && i.offsetParent !== null);
    const toggle = document.querySelector('[data-testid="guidance-toggle"]');
    return {
      logo: box(logo.getBoundingClientRect()),
      title: textRects(title).map(box),
      tagline: textRects(tagline).map(box),
      photo: img ? box(img.getBoundingClientRect()) : null,
      toggle: toggle ? box(toggle.getBoundingClientRect()) : null,
    };
  }, PHOTO);
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

async function openHome(page, viewport) {
  await page.setViewportSize(viewport);
  await givePhoto(page);
  await loginForCheck(page);
  await page.goto('/');
  await disableGuidanceForCheck(page);
  await expect(page.getByTestId('home-tab-games')).toBeVisible({ timeout: 60000 });
  await expect.poll(async () => (await headerBoxes(page)).photo !== null, { timeout: 60000 }).toBe(true);
  await expect.poll(async () => (await headerBoxes(page)).toggle !== null, { timeout: 60000 }).toBe(true);
}

test('T16680:C1 at 390x844 the logo, tagline, profile photo and Guidance switch do not overlap on every Home tab', async ({ page }) => {
  await openHome(page, { width: 390, height: 844 });
  for (const tab of ['home-tab-games', 'home-tab-clips', 'home-tab-published']) {
    await page.getByTestId(tab).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    const b = await headerBoxes(page);
    const brand = [['logo', b.logo], ...b.title.map((r) => ['title', r]), ...b.tagline.map((r) => ['tagline', r])];
    const covers = [['photo', b.photo], ['Guidance switch', b.toggle]];
    const hits = [];
    for (const [cn, c] of covers) {
      if (!c) { hits.push(`${cn} not drawn`); continue; }
      for (const [bn, r] of brand) if (overlaps(c, r)) hits.push(`${cn} covers ${bn}`);
    }
    if (b.photo && b.toggle && overlaps(b.photo, b.toggle)) hits.push('photo covers Guidance switch');
    expect(hits, `${tab}: ${JSON.stringify(b)}`).toEqual([]);
  }
});

test('T16680:C2 at 1280x800 the Home header keeps its desktop layout', async ({ page }) => {
  await openHome(page, { width: 1280, height: 800 });
  const b = await headerBoxes(page);
  const sport = await page.locator('button[title$="Switch sport or profile."]').boundingBox();
  // The photo hangs just below the sport button, right-aligned to it, at 56x100.
  expect(Math.round(b.photo.right - b.photo.left)).toBe(56);
  expect(Math.round(b.photo.bottom - b.photo.top)).toBe(100);
  expect(Math.abs(b.photo.right - (sport.x + sport.width))).toBeLessThan(1);
  expect(b.photo.top).toBeGreaterThanOrEqual(sport.y + sport.height);
  expect(b.photo.top).toBeLessThan(sport.y + sport.height + 10);
  // The logo sits at the top of the page column (no phone padding above it), centered.
  expect(b.logo.top).toBeLessThan(b.toggle.bottom);
  const tl = b.title[0];
  const mid = (Math.min(b.logo.left, tl.left) + Math.max(b.logo.right, tl.right)) / 2;
  expect(Math.abs(mid - 640)).toBeLessThan(20);
});
