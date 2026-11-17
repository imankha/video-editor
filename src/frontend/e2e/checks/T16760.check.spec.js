/**
 * T16760 - per-criterion acceptance checks (group checks protocol).
 *
 * In Frame, Preview resizes the stage to the reel's shape. For a portrait (9:16) reel the stage
 * used to take half the column's width (T15650's 50% width floor): at 1440x900 it ran ~890px
 * tall, its lower part and the play controls under the fixed action band ("Sharpen my
 * highlight"). The whole preview and its controls must sit above the band without scrolling.
 * T16820: the setup makes a fresh highlight on a ready game (helpers/portraitPreviewLayout.js).
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16760.check.spec.js --reporter=line
 */
import { test } from '@playwright/test';
import { expectPortraitPreviewAboveBand } from '../helpers/portraitPreviewLayout';

// Making the highlight took ~5.5 min on a loaded local stack (T16820); both sizes share it. The
// harness gives one spec 900 s (CHECK_SPEC_SECONDS).
test.setTimeout(870000);

test('T16760:C1 - 1440x900 and 1366x768: portrait preview and its controls sit above the action bar without scrolling', async ({ browser }) => {
  await expectPortraitPreviewAboveBand(browser, [[1440, 900], [1366, 768]]);
});
