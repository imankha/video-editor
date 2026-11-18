/**
 * T17010 -- with Guidance on, the phone "Tags and Notes" sheet's close X (top right)
 * sat under the fixed Guidance switch: a tap on the X flipped Guidance and the sheet
 * stayed open. C1 at 390x844, C2 at 360x640 and iPad 768x1024 (all touch: a touch
 * iPad gets the same full-screen sheet, useIsMobile's coarse-pointer branch).
 *
 * The flow lives in ../helpers/tagsNotesCloseFlow.js (T17290:C1's check runs it too).
 */
import { test } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';
import { tagsNotesCloseFlow } from '../helpers/tagsNotesCloseFlow';

test.setTimeout(480000);

const CASES = [
  { id: 'T17010:C1', name: 'phone 390x844', width: 390, height: 844 },
  { id: 'T17010:C2', name: 'phone 360x640', width: 360, height: 640 },
  { id: 'T17010:C2', name: 'iPad 768x1024', width: 768, height: 1024 },
];

for (const vp of CASES) {
  test.describe(vp.name, () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: vp.width, height: vp.height } });

    test(`${vp.id} - Tags and Notes close X is not under the Guidance switch and closes the sheet (${vp.name})`, async ({ context, page }) => {
      await loginForCheck(context);
      await tagsNotesCloseFlow(page);
    });
  });
}
