import { test } from '@playwright/test';
import { checkHomeTouchTargets } from '../helpers/homeTouchTargets';

// T17110: Home's small touch controls measure at least 44x44 (flow in ../helpers/homeTouchTargets).
test.setTimeout(240000);

test('T17110:C1 Home touch targets are at least 44x44 at 390x844 touch', async ({ browser }) => {
  await checkHomeTouchTargets(browser, { width: 390, height: 844 });
});

test('T17110:C2 Home touch targets are at least 44x44 at 360x640 and 768x1024 touch', async ({ browser }) => {
  await checkHomeTouchTargets(browser, { width: 360, height: 640 });
  await checkHomeTouchTargets(browser, { width: 768, height: 1024 });
});
