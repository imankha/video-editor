/**
 * T16820 - the T16760:C1 staging check, which timed out because its setup reused an existing
 * draft: on staging it picked one on a game stuck uploading, where Frame shows "Game video still
 * uploading" and no Preview toggle. The setup now makes a fresh highlight on a ready game.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16820.check.spec.js --reporter=line
 */
import { test } from '@playwright/test';
import { expectPortraitPreviewAboveBand } from '../helpers/portraitPreviewLayout';

test.setTimeout(300000);

for (const [width, height] of [[1440, 900], [1366, 768]]) {
  test(`T16820:C1 - ${width}x${height}: portrait preview and its controls fully visible above the action bar`, async ({ browser }) => {
    await expectPortraitPreviewAboveBand(browser, width, height);
  });
}
