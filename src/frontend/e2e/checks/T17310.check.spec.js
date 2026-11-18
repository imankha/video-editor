import { test } from '@playwright/test';
import { checkHomeTouchTargets } from '../helpers/homeTouchTargets';

// T17310: the T17110:C2 staging check failed twice over: its Games click timed out once a
// concurrent check's dev-login ended its session (fixed by T17290), and run alone no storage
// banner showed because no draft used a ready game (fixed in the shared flow by T17300).
// This is the same C2 check.
test.setTimeout(240000);

test('T17310:C1 Home touch targets are at least 44x44 at 360x640 and 768x1024 touch', async ({ browser }) => {
  await checkHomeTouchTargets(browser, { width: 360, height: 640 });
  await checkHomeTouchTargets(browser, { width: 768, height: 1024 });
});
