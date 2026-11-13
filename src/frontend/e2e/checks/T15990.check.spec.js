/**
 * T15990 - per-criterion acceptance check (group checks protocol).
 *
 * T15400:C2 failed on staging: Frame's small shape chip (`focus-shape-chip`) never
 * rendered, so the "Switch to landscape?" dialog could not be opened. T15610 had frozen
 * `boxPrePlaced` at mount for the guide's step total, and the portrait layout fed that
 * frozen value to FrameShapeChoice's `hasPositions`; a project whose crop positions load
 * after the view mounts kept the full "Where will you share it?" picker forever. The
 * portrait layout now passes the live position count, as the landscape cockpit does.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T15990.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

test.setTimeout(240000);

test.describe('T15990 checks: Switch to landscape dialog on iPhone 14', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 664 } });

  test('T15990:C1 - every "Switch to landscape?" dialog button is tappable on iPhone 14 (elementFromPoint hits the button)', async ({ context, page }) => {
    await loginForCheck(context);
    const res = await page.request.get(checkApi('/projects'));
    expect(res.ok(), `GET /projects -> ${res.status()}`).toBeTruthy();
    const body = await res.json();
    const projects = Array.isArray(body) ? body : body.projects || [];
    const candidate = projects.find((p) => p.has_crop_keyframes);
    test.skip(!candidate, '[T15990] no project with crop keyframes placed (needed for the shape chip)');

    await page.goto(`/focus/p/${candidate.id}`);
    await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });

    // The staging failure: the chip never appeared (the full picker stayed instead).
    const chip = page.getByTestId('focus-shape-chip');
    await expect(chip).toBeVisible({ timeout: 60000 });
    await chip.tap();

    await expect(page.getByTestId('focus-shape-switch-confirm')).toBeVisible();

    for (const testId of ['focus-shape-switch-confirm-button', 'focus-shape-switch-keep']) {
      const btn = page.getByTestId(testId);
      await expect(btn).toBeVisible();
      const hit = await btn.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && (top === el || el.contains(top));
      });
      expect(hit, `elementFromPoint at ${testId}'s centre is the button`).toBe(true);
    }
  });
});
