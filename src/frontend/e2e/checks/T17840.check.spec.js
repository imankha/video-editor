import { test } from '@playwright/test';
import { expectLegacyMultiPlayOnHome } from '../helpers/legacyMultiPlayHomeCheck';

/**
 * T17840:C1 - on Home, an old multi-play highlight says, without any click, that such
 * highlights are no longer supported for editing, and its card shows neither the rename
 * pencil nor an "In progress" badge. Steps: e2e/helpers/legacyMultiPlayHomeCheck.js.
 */
test.setTimeout(180000);

test('T17840:C1 an old multi-play highlight says it is not supported and has no edit pencil or In progress badge', async ({ page }) => {
  await expectLegacyMultiPlayOnHome(page);
});
