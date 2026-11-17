/**
 * T16820 - the T16760:C1 staging check, which timed out because its setup reused an existing
 * draft: on staging it picked one on a game stuck uploading, where Frame shows "Game video still
 * uploading" and no Preview toggle. The setup now makes a fresh highlight on a ready game.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16820.check.spec.js --reporter=line
 */
import { test } from '@playwright/test';
import { expectPortraitPreviewAboveBand } from '../helpers/portraitPreviewLayout';

// Making the highlight took ~5.5 min on a loaded local stack (T16820); both sizes share it. The
// harness gives one spec 900 s (CHECK_SPEC_SECONDS).
test.setTimeout(870000);

test('T16820:C1 - 1440x900 and 1366x768: portrait preview and its controls fully visible above the action bar', async ({ browser }) => {
  await expectPortraitPreviewAboveBand(browser, [[1440, 900], [1366, 768]]);
});
