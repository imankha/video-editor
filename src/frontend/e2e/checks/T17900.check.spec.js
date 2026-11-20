import { test, expect } from '@playwright/test';
import { checkApi } from '../helpers/checkAuth';
import { expectLegacyMultiPlayOnHome } from '../helpers/legacyMultiPlayHomeCheck';

/**
 * T17900:C1 - T17840:C1's steps give the expected result even when the account's last visit
 * ended in an editor. Opening '/' returns a user to where they left off (T14980), so on staging
 * the shared e2e-gate account, left in Frame by an earlier check, jumped from Home into Frame
 * right after the check clicked the Clips tab, and the legacy group never showed.
 *
 * The account's resume point is set to Frame on one of its own projects first, the state a
 * previous session leaves behind, then T17840:C1's steps run unchanged.
 */
test.setTimeout(180000);

test('T17900:C1 the T17840:C1 steps show the legacy multi-play highlight on Home after a visit that ended in Frame', async ({ page }) => {
  await expectLegacyMultiPlayOnHome(page, {
    beforeOpen: async (projects) => {
      expect(projects.length, 'a project on the account').toBeGreaterThan(0);
      const res = await page.request.post(checkApi('/me/resume-point'), {
        data: { path: `/focus/p/${projects[0].id}`, screen: 'framing' },
      });
      expect(res.ok(), `POST /me/resume-point -> ${res.status()}`).toBeTruthy();
    },
  });
});
