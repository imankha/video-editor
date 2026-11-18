import { test } from '@playwright/test';
import { retryCreditsRefusedUpload } from '../helpers/creditsRefusedRetry';

// T17620: T17380:C2 failed on staging at its spend-down: the shared account held over 2400
// credits, past the old 200-call budget, and same-second storage extensions were not charged.
// This runs T17380:C2's flow from a balance of at least 2500.
test.setTimeout(600000);

test('T17620:C1 T17380:C2 passes from a balance over 2400 credits', async ({ context, page }) => {
  await retryCreditsRefusedUpload(context, page, { minStartBalance: 2500 });
});
