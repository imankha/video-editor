import { test, expect } from '@playwright/test';
import { disableGuidanceForCheck } from './helpers/checkAuth';

/**
 * T16590: disableGuidanceForCheck against a stand-in for the real switch's lifecycle on a
 * fresh page load (GuidanceToggle.jsx): absent at first, then drawn disabled and reading
 * Off while settings load (T13420), then enabled and reading the saved value (On). The
 * helper used to look once, find nothing, and return with Guidance still on.
 * No app server needed: the page is set inline.
 */
const LIFECYCLE_PAGE = `
<body>
<script>
  setTimeout(() => {
    const b = document.createElement('button');
    b.setAttribute('role', 'switch');
    b.setAttribute('data-testid', 'guidance-toggle');
    b.setAttribute('aria-checked', 'false');
    b.disabled = true;
    b.textContent = 'Guidance';
    b.onclick = () => b.setAttribute('aria-checked', b.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    document.body.appendChild(b);
    setTimeout(() => { b.setAttribute('aria-checked', 'true'); b.disabled = false; }, 1000);
  }, 1500);
</script>
</body>`;

test('T16590:C1 the helper waits for a late Guidance switch and turns it off', async ({ page }) => {
  await page.setContent(LIFECYCLE_PAGE);
  await disableGuidanceForCheck(page);
  // Past the stand-in's load (2.5 s), the switch reads On unless the helper turned it off.
  await page.waitForTimeout(3000);
  await expect(page.getByTestId('guidance-toggle')).toBeEnabled();
  await expect(page.getByTestId('guidance-toggle')).toHaveAttribute('aria-checked', 'false', { timeout: 100 });
});

test('T16590:C2 the helper returns without error within its wait when there is no switch', async ({ page }) => {
  await page.setContent('<body><p>No Guidance here</p></body>');
  const started = Date.now();
  await disableGuidanceForCheck(page);
  expect(Date.now() - started).toBeLessThan(10000);
});
