/**
 * T17730 - the staging check of T17650:C2 (phone and tablet) timed out after 90 s waiting for
 * Frame's video, for the same reason as T17720: the scenario opened the first /projects entry with
 * a clip, and on staging both listed projects sit on a game whose upload never finished
 * (playback-url 409), so Frame mounted no player. This re-runs the T17650:C2 scenario on the phone
 * and tablet touch layouts as the staging check does.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17730.check.spec.js --reporter=line
 */
import { test } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';
import { runTrimSplitScenario } from '../helpers/trimSplitScenario';

test.setTimeout(420000);

test.describe('T17730 @ phone 390x844 touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('T17730:C1 phone - the T17650:C2 steps stay reachable on a phone touch layout', async ({ context, page }) => {
    await loginForCheck(context);
    await runTrimSplitScenario(page, { isTouch: true });
  });
});

test.describe('T17730 @ tablet 820x1180 touch', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('T17730:C1 tablet - the T17650:C2 steps stay reachable on a tablet touch layout', async ({ context, page }) => {
    await loginForCheck(context);
    await runTrimSplitScenario(page, { isTouch: true });
  });
});
