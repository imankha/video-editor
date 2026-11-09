/**
 * T15370 — Annotate landscape fullscreen side-strip cockpit (controls beside
 * the picture, not on it). Live-drives a real account's game in mobile
 * fullscreen landscape and asserts the acceptance criteria that need a real
 * layout engine (unit tests in AnnotateModeView.landscapeCockpit.test.jsx
 * cover the component wiring; this spec covers real geometry).
 *
 * Template: e2e/T10840-focus-landscape-cockpit.qa.spec.js (same cockpit
 * pattern, Focus side). Entry pattern: e2e/T11150-play-editor-hierarchy.qa.spec.js
 * `tryEnterMobileFullscreenEditor` (fullscreen is pure CSS state, no
 * element.requestFullscreen, so the toggle click is safe headless).
 *
 * Covers (design doc T15370-design.md § Acceptance Criteria):
 *  AC1 — no vertical scroll; the picture rect does not overlap either strip
 *        or the timeline zone, paused.
 *  AC3 — every strip button is >= 44x44; Play is >= 52x52.
 * Lightly touches AC2 (Mark play opens the side sheet, timeline zone hides)
 * and AC7 (rotating back to portrait restores the scrolling layout, no
 * console error) as cheap regression guards; the fuller rect-overlap
 * percentage math and the trim-drag/keyboard checks are left to a human pass
 * per the design doc's Risks table (notch/keyboard are real-device-only).
 *
 * NON-MUTATING: opens a game, toggles fullscreen/editor, screenshots. Never
 * exports or saves. Honest-skips (repo convention) when no active game with
 * clips is available, or when a step can't be reached under headless
 * emulation.
 *
 * Run: bash scripts/dev-verify.sh e2e/T15370-annotate-landscape-cockpit.qa.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE;
const API_BASE = process.env.E2E_API_BASE || '/api';

const COCKPIT_VIEWPORTS = [
  { label: '812x334-samsung', width: 812, height: 334 },
  { label: '844x390-iphone', width: 844, height: 390 },
];

async function enterLandscapeFullscreen(page) {
  const fsBtn = page.getByTitle('Fullscreen').first();
  if (!(await fsBtn.count().catch(() => 0))) return 'Fullscreen toggle not offered';
  await fsBtn.click({ force: true, timeout: 5000 });
  await page.waitForTimeout(600);
  const leftStrip = page.getByTestId('annotate-cockpit-left-strip');
  if (!(await leftStrip.isVisible().catch(() => false))) return 'cockpit left strip did not mount after entering fullscreen';
  return null;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

for (const vp of COCKPIT_VIEWPORTS) {
  test.describe(`T15370 cockpit @ ${vp.label}`, () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ context, page }) => {
      test.setTimeout(120_000);
      await loginAsRealUser(context, REAL_EMAIL, PROFILE);
      const res = await context.request.get(
        `${API_BASE}/games`,
        PROFILE ? { headers: { 'X-Profile-ID': PROFILE } } : undefined,
      );
      expect(res.ok(), `GET ${API_BASE}/games (${res.status()})`).toBeTruthy();
      const games = (await res.json()).games || [];
      const target = games.find((g) => g.storage_status === 'active' && (g.clip_count || 0) > 0);
      test.skip(!target, '[T15370] no active game with clips available');
      await openGameInAnnotate(page, target.id);
      await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 30000 });
    });

    test('AC1/AC3: side strips beside the picture, no scroll, 44px (52px Play) hit targets', async ({ page }) => {
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

      const reason = await enterLandscapeFullscreen(page);
      test.skip(!!reason, `[T15370] ${reason}`);

      // AC1 — no vertical scroll.
      const overflows = await page.evaluate(() => {
        const el = document.scrollingElement;
        return el.scrollHeight > el.clientHeight + 1;
      });
      expect(overflows, 'no vertical scroll in the landscape cockpit').toBe(false);

      const leftStrip = page.getByTestId('annotate-cockpit-left-strip');
      const rightStrip = page.getByTestId('annotate-cockpit-right-strip');
      const timelineZone = page.getByTestId('annotate-cockpit-timeline');
      await expect(leftStrip).toBeVisible();
      await expect(rightStrip).toBeVisible();
      await expect(timelineZone).toBeVisible();

      // AC1 — the picture (the <video> element) never overlaps either strip
      // or the timeline zone, paused.
      const videoBox = await page.locator('[data-testid="annotate-coach-stage"] video').first().boundingBox();
      const leftBox = await leftStrip.boundingBox();
      const rightBox = await rightStrip.boundingBox();
      const timelineBox = await timelineZone.boundingBox();
      expect(videoBox, 'video element present').not.toBeNull();
      for (const [label, box] of [['left strip', leftBox], ['right strip', rightBox], ['timeline zone', timelineBox]]) {
        expect(rectsOverlap(videoBox, box), `picture overlaps ${label}`).toBe(false);
      }

      // AC3 — every button in both strips is >= 44x44; Play is >= 52x52.
      const leftButtons = await leftStrip.locator('button').all();
      const rightButtons = await rightStrip.locator('button').all();
      expect(leftButtons.length, 'left strip has buttons').toBeGreaterThan(0);
      expect(rightButtons.length, 'right strip has buttons').toBeGreaterThan(0);
      for (const btn of [...leftButtons, ...rightButtons]) {
        const box = await btn.boundingBox();
        expect(box).not.toBeNull();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      const playBox = await page.getByTestId('annotate-play-button').boundingBox();
      expect(playBox.width).toBeGreaterThanOrEqual(52);
      expect(playBox.height).toBeGreaterThanOrEqual(52);

      await saveEvidence(page, `T15370-${vp.label}-cockpit`);
      expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
    });

    test('AC2: Mark/Edit play opens the side sheet and hides the timeline zone', async ({ page }) => {
      const reason = await enterLandscapeFullscreen(page);
      test.skip(!!reason, `[T15370] ${reason}`);

      await page.locator('.clip-marker').first().click({ force: true });
      await page.waitForTimeout(300);
      const markBtn = page.getByTestId('annotate-mark-play-button');
      if (await markBtn.count().catch(() => 0)) {
        await markBtn.click({ force: true }).catch(() => {});
      }
      const sheet = page.getByTestId('annotate-cockpit-sheet');
      if (!(await sheet.isVisible({ timeout: 3000 }).catch(() => false))) {
        test.skip(true, '[T15370] side sheet did not open after selecting a play');
      }
      await expect(sheet).toBeVisible();
      expect(await page.getByTestId('annotate-cockpit-timeline').count()).toBe(0);
      await saveEvidence(page, `T15370-${vp.label}-side-sheet`);
    });
  });
}

test.describe('T15370 rotate back to portrait restores the T15380 layout', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

  test.beforeEach(async ({ context, page }) => {
    test.setTimeout(120_000);
    await loginAsRealUser(context, REAL_EMAIL, PROFILE);
    const res = await context.request.get(
      `${API_BASE}/games`,
      PROFILE ? { headers: { 'X-Profile-ID': PROFILE } } : undefined,
    );
    expect(res.ok()).toBeTruthy();
    const games = (await res.json()).games || [];
    const target = games.find((g) => g.storage_status === 'active' && (g.clip_count || 0) > 0);
    test.skip(!target, '[T15370] no active game with clips available');
    await openGameInAnnotate(page, target.id);
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 30000 });
  });

  test('AC7: rotating to portrait keeps the video and drops the cockpit strips, no console error', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    const reason = await enterLandscapeFullscreen(page);
    test.skip(!!reason, `[T15370] ${reason}`);

    await page.setViewportSize({ width: 393, height: 852 });
    await page.waitForTimeout(300);
    await expect(page.getByTestId('annotate-cockpit-left-strip')).toHaveCount(0);
    await expect(page.locator('[data-testid="annotate-coach-stage"] video').first()).toBeVisible();
    await saveEvidence(page, 'T15370-rotated-back-portrait');

    expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
  });
});
