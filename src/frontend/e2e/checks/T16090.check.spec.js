import { test } from '@playwright/test';
import { deletedReelLeavesNoHighlight } from '../helpers/deletedReelFlow';

/**
 * T16090:C3 - after publishing a highlight and deleting its reel, Annotate no longer
 * lists that highlight for the play, and the play can make a new highlight that opens
 * in Frame with its video. The flow lives in ../helpers/deletedReelFlow.js (T16100:C1's
 * check runs it too). The first version seeded the highlight through a dev-only test
 * seam, which 404s on staging, so the staging check never reached the feature.
 */
test.setTimeout(1200000);

test('T16090:C3 a deleted reel leaves no highlight behind in Annotate', async ({ context, page }) => {
  await deletedReelLeavesNoHighlight(context, page);
});
