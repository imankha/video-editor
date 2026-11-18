import { test } from '@playwright/test';
import { checkHomeTouchTargets } from '../helpers/homeTouchTargets';
import { leaveAccountInAnnotate } from '../helpers/leaveAccountInAnnotate';

// T17430: T17310:C1 timed out on staging clicking Games for the same reason as T17300:C1
// (T17420): an earlier check left the shared account in Annotate and the shared flow's bare
// '/' restored it. This leaves the account in Annotate first, then runs T17310:C1's flow.
test.setTimeout(420000);

test('T17430:C1 T17310:C1 passes after another check leaves the account in Annotate', async ({ browser }) => {
  await leaveAccountInAnnotate(browser);
  await checkHomeTouchTargets(browser, { width: 360, height: 640 });
  await checkHomeTouchTargets(browser, { width: 768, height: 1024 });
});
