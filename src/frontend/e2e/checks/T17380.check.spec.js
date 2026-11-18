import { test } from '@playwright/test';
import { retryCreditsRefusedUpload } from '../helpers/creditsRefusedRetry';

// The flow lives in the helper; its comment says what is setup and what is the asserted gesture.
test.setTimeout(480000);

test('T17380:C2 retrying an upload refused for credits, after getting credits, completes it once', async ({ context, page }) => {
  await retryCreditsRefusedUpload(context, page);
});
