import { test } from '@playwright/test';
import { checkSecondProfileHasNoCreditsBubble } from '../helpers/secondProfileFlow';
import { leaveAccountInAnnotate } from '../helpers/leaveAccountInAnnotate';

// T17440: T17320:C1 timed out on staging for the same reason as T17300:C1 and T17310:C1
// (T17420, T17430): an earlier check left the shared account in Annotate and the flow's bare
// '/' restored it, where there is no Sport and profile chip. This leaves the account in
// Annotate first, then runs T17320:C1's flow.
test.setTimeout(420000);

test('T17440:C1 T17320:C1 passes after another check leaves the account in Annotate', async ({ browser }) => {
  await leaveAccountInAnnotate(browser);
  await checkSecondProfileHasNoCreditsBubble(browser);
});
