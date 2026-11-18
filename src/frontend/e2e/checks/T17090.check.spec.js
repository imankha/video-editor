import { test } from '@playwright/test';
import { checkSecondProfileHasNoCreditsBubble } from '../helpers/secondProfileFlow';

/**
 * T17090: the "You have N free credits" sentence (T17200: the Home first-run coach line, or its plain-text twin with Guidance off) is a
 * brand new account's welcome. A second profile on an existing account has no
 * games yet, but its credits are the account's own, so it must not show there.
 * The profile is added and switched to through the UI (Sport and profile chip,
 * Add profile, Create), in-app with no reload; it is deleted afterwards and the
 * original profile restored.
 */
test.setTimeout(180000);

test('T17090:C1 a new second profile on an existing account shows no free-credits bubble at 1440x900', async ({ browser }) => {
  await checkSecondProfileHasNoCreditsBubble(browser);
});
