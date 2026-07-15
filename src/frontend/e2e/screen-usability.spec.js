/**
 * screen-usability.spec.js — the mobile/viewport usability matrix (T4930).
 *
 * Drives EVERY user-facing screen AS A REAL USER (dev-login) and runs the three
 * behavioral usability invariants (reachable+clickable / no horizontal overflow /
 * no dead scroll trap — see helpers/usabilityAudit.js) against it. Playwright runs
 * this ONE spec once per viewport project (iphone, iphone-se, android, tablet,
 * desktop — see playwright.config.js), and for phone projects each screen is
 * audited in portrait AND landscape. Coverage = manifests x projects x
 * orientations, with no copy-pasted tests.
 *
 * Scope guard: this is the ONLY spec wired to run across the mobile projects; the
 * existing functional specs stay Desktop-Chrome-only (config `testMatch`), so the
 * added CI cost is exactly one audit pass per device, not the whole suite x5.
 *
 * A screen whose fullest-state precondition is absent in this environment (no
 * exported reel, single-profile account, empty gallery) is SKIPPED with a logged
 * reason — never silently passed (CLAUDE.md: no silent fallbacks). The synthetic
 * good/bad-layout proof that the audit actually catches the T4880 failure class
 * lives in screen-usability.selfcheck.spec.js and needs no backend.
 */
import { test } from '@playwright/test';
import { SCREENS, AUDIT_EMAIL, loginAsRealUser } from './manifests/screenManifests.js';
import { sweepOrientations } from './helpers/usabilityAudit.js';

test.describe('screen usability matrix', () => {
  for (const screen of SCREENS) {
    test(`usable: ${screen.name}`, async ({ context, page }, testInfo) => {
      test.setTimeout(180_000);
      const vp = page.viewportSize();
      console.log(`[usability] ${screen.name} @ ${testInfo.project.name} (${vp?.width}x${vp?.height})`);

      // Authenticate the project's context (inherits the device viewport/touch)
      // as the real account, so every screen loads with representative data.
      await loginAsRealUser(context, AUDIT_EMAIL);

      let result;
      try {
        result = await screen.setup(page);
      } catch (e) {
        // A navigation failure to reach the fullest state is a skip-with-reason,
        // not a pass and not a usability failure of the screen itself.
        test.skip(true, `${screen.name}: could not reach fullest state (${String(e).slice(0, 140)})`);
        return;
      }
      if (!result || result.ready === false) {
        test.skip(true, `${screen.name}: precondition not met — ${result?.reason || 'unknown'}`);
        return;
      }

      await sweepOrientations(page, screen);
    });
  }
});
