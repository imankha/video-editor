import { test } from '@playwright/test';
import { checkHomeTouchTargets } from '../helpers/homeTouchTargets';

// T17300: the T17110:C1 staging check failed because no draft used a ready game, so the storage
// banner never showed. The shared flow now makes every draft use one; this is the same C1 check.
test.setTimeout(240000);

test('T17300:C1 storage banner, Retry, Discard and Report a problem are at least 44x44 at 390x844 touch', async ({ browser }) => {
  await checkHomeTouchTargets(browser, { width: 390, height: 844 });
});
