/**
 * T15540 - per-criterion acceptance checks (group checks protocol).
 *
 * OtpAuthForm.jsx: after an invalid sign-in code the boxes used to keep the rejected
 * digits and focus, so a retry typed a new digit into a box still holding an old one --
 * and because the code still read as "complete", each such edit auto-submitted a code
 * that was still mostly the old wrong digits, burning extra verify attempts.
 *
 * This is pre-auth UI behavior, so no login step -- the checks reach the code step with
 * a real send-otp round trip, then intercept only /api/auth/verify-otp so the check does
 * not depend on reading a real emailed code and does not burn real backend attempts.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T15540.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120000);

async function goToSignInScreen(page) {
  await page.goto('/');
  // Local dev stacks show a dev-account picker first; staging/prod show the real
  // sign-in screen directly (no dev-accounts probe outside dev). Race the two so
  // we don't act on a stale snapshot taken before either has rendered.
  const emailField = page.getByLabel(/email address/i);
  const useRealSignIn = page.getByRole('button', { name: 'Use the real sign-in screen' });
  await expect(emailField.or(useRealSignIn)).toBeVisible({ timeout: 30000 });
  if (await useRealSignIn.isVisible().catch(() => false)) await useRealSignIn.click();
  await expect(emailField).toBeVisible({ timeout: 30000 });
}

async function reachCodeStep(page) {
  // send-otp is mocked too: a real send goes out over an email provider this
  // check must not depend on, and the behavior under test is what happens
  // after verify-otp rejects a code, not whether an email was delivered.
  await page.route('**/api/auth/send-otp', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true }),
  }));
  await goToSignInScreen(page);
  await page.getByLabel(/email address/i).fill(`t15540-check-${Date.now()}@example.com`);
  await page.getByText('Send code', { exact: true }).click();
  await expect(page.getByText(/6-digit code/i)).toBeVisible({ timeout: 30000 });
}

function codeInputs(page) {
  return page.locator('input[maxlength="1"]');
}

async function typeCode(page, digits) {
  const inputs = codeInputs(page);
  for (let i = 0; i < digits.length; i++) {
    await inputs.nth(i).fill(digits[i]);
  }
}

test('T15540:C1 - an invalid code clears the boxes and refocuses the first one', async ({ page }) => {
  await page.route('**/api/auth/verify-otp', (route) => route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'Invalid code. 3 attempts remaining.' }),
  }));

  await reachCodeStep(page);
  await typeCode(page, '123456');
  await expect(page.getByText(/invalid code/i)).toBeVisible({ timeout: 30000 });

  const inputs = codeInputs(page);
  for (let i = 0; i < 6; i++) {
    await expect(inputs.nth(i)).toHaveValue('');
  }
  await expect(inputs.nth(0)).toBeFocused({ timeout: 5000 });
});

test('T15540:C2 - a single fresh digit over a leftover wrong code does not re-submit it', async ({ page }) => {
  let verifyCalls = 0;
  await page.route('**/api/auth/verify-otp', (route) => {
    verifyCalls += 1;
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Invalid code. 3 attempts remaining.' }),
    });
  });

  await reachCodeStep(page);
  await typeCode(page, '111111');
  await expect(page.getByText(/invalid code/i)).toBeVisible({ timeout: 30000 });
  expect(verifyCalls).toBe(1);

  // Boxes are cleared by C1's fix, so one fresh digit leaves 5 boxes empty --
  // this must not read as a "complete" code and re-submit.
  await codeInputs(page).nth(0).fill('6');
  await page.waitForTimeout(1000);
  expect(verifyCalls).toBe(1);
});

test('T15540:C2 - a Verify tap racing an in-flight auto-submit for the same code does not double-submit', async ({ page }) => {
  let verifyCalls = 0;
  await page.route('**/api/auth/verify-otp', async (route) => {
    verifyCalls += 1;
    // Hold the response open so the real-world race window (a Verify tap landing
    // while the auto-submit for the just-completed code is still in flight) is
    // wide enough to force deterministically, instead of depending on a sub-ms
    // timing race a real device hits but a test can't land reliably.
    await new Promise((resolve) => setTimeout(resolve, 300));
    return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Invalid code. 3 attempts remaining.' }),
    });
  });

  await reachCodeStep(page);
  await typeCode(page, '123456'); // completes the code -> auto-submits, verify-otp now in flight

  // Force a tap on the real Verify button while that request is still pending --
  // this reproduces the bug report's "a Verify tap submits again" after the
  // auto-submit already fired for the same code. Bypassing the `disabled`
  // attribute is deliberate: the thing under test is OtpAuthForm's verifyingRef
  // dedup guard (handleVerifyCode bails if a submit for this code is already in
  // flight), not whether the DOM blocks a click on a disabled button.
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent.trim() === 'Verify');
    button.removeAttribute('disabled');
    button.click();
  });

  await expect(page.getByText(/invalid code/i)).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(300);
  expect(verifyCalls).toBe(1);
});
