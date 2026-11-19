/**
 * T17720 - the staging check of T17650:C1 timed out after 90 s waiting for Frame's video: the
 * scenario opened the first /projects entry with a clip, and on staging both listed projects
 * sit on a game whose upload never finished (playback-url 409), so Frame mounted no player.
 * This re-runs the T17650:C1 scenario (desktop 1440 x 900) as the staging check does.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17720.check.spec.js --reporter=line
 */
import { test } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';
import { runTrimSplitScenario } from '../helpers/trimSplitScenario';

test.setTimeout(420000);

test.describe('T17720 @ desktop 1440x900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('T17720:C1 - the T17650:C1 steps delete a split while the end stays trimmed at 1440 x 900', async ({ context, page }) => {
    await loginForCheck(context);
    await runTrimSplitScenario(page);
  });
});
