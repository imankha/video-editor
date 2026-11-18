import { test } from '@playwright/test';
import { checkSecondProfileHasNoCreditsBubble } from '../helpers/secondProfileFlow';

// T17320: the T17090:C1 staging check timed out because its click on the Sport and profile
// chip matched only "Switch sport or profile"; on an account whose profile has no sport the
// chip is labelled "Pick your sport for play tags". This is the same C1 check, shared flow.
test.setTimeout(180000);

test('T17320:C1 a new second profile on an existing account shows no free-credits bubble at 1440x900', async ({ browser }) => {
  await checkSecondProfileHasNoCreditsBubble(browser);
});
