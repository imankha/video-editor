import { test, expect } from '@playwright/test';
import { runSpecTests } from '../helpers/specRunner.js';

/**
 * T11905 - the shared Spotlight-draft helper (e2e/helpers/overlayDraft.js) opens a draft
 * instead of returning ok:false, which the specs that use it turn into a skip. It used to look
 * for an 'Open in Spotlight' button the app no longer renders.
 *
 * C1 runs the real spec tests (helpers/specRunner.js: one child Playwright run per test, each on
 * its own account), not copies of their locators. C2 is a code check in T11905.checks.json that runs
 * the T4880 spec's Spotlight test itself.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T11905.check.spec.js --reporter=line
 */

// One Spotlight test from each spec that calls openLoadableOverlayDraft (the twelve files the task
// counts as eleven specs, T9270 having two). e2e/T4550 is in the task's list but no longer calls the
// helper (its only test is a Framing one), so the helper cannot make it skip.
const HELPER_SPECS = [
  { file: 'e2e/bug38-autoselect-and-frame-step.qa.spec.js', grep: 'glitch 3: stepping one frame' },
  { file: 'e2e/guide-no-overlap.spec.js', grep: '1280x800 Overlay: pick walk' },
  { file: 'e2e/T10310-rail-width.qa.spec.js', grep: '1280x900 Overlay: expanded rail' },
  { file: 'e2e/T10820-mobile-settings-anchor.qa.spec.js', grep: '393x852 Overlay: panel grows' },
  { file: 'e2e/T11740-editor-header-no-overflow.qa.spec.js', grep: '@ 390px: Overlay header' },
  { file: 'e2e/T12730-guide-pulse.spec.js', grep: 'Overlay: pick walk parked' },
  { file: 'e2e/T4880-mobile-editor-reachable.spec.js', grep: 'Overlay: primary CTA reachable' },
  { file: 'e2e/T5676-aspect-stage-alignment.qa.spec.js', grep: 'no pillarbox \\+ overlays stay aligned' },
  { file: 'e2e/T6510-preview-image-frame-choice.qa.spec.js', grep: 'default resolves \\+ is SHOWN' },
  { file: 'e2e/T9270-cta-above-fold.qa.spec.js', grep: '1280x900 Overlay: CTA above the fold' },
  { file: 'e2e/T9270-mobile-drawer.qa.spec.js', grep: 'Overlay: video stage is taller' },
  { file: 'e2e/T9550-editor-stage-strings.qa.spec.js', grep: 'Overlay Cover image tab' },
];

const describeRun = (r) => `${r.file} --grep '${r.grep}':\n` +
  (r.tests.length ? r.tests.map(t => `  [${t.status}] ${t.title}${t.skipReason ? ` (skip: ${t.skipReason})` : ''}` +
    (t.error ? `\n    ${t.error.split('\n').slice(0, 6).join('\n    ')}` : '')).join('\n') : `  no test ran\n${r.log}`);

test.describe('T11905 Spotlight draft helper', () => {
  test('T11905:C1 every spec that uses the Spotlight-draft helper executes its assertions; none is skipped for a missing button', async () => {
    test.setTimeout(20 * 60 * 1000);
    const runs = await runSpecTests(HELPER_SPECS);
    console.log(runs.map(describeRun).join('\n'));

    for (const run of runs) {
      expect(run.tests.length, `${run.file}: the grep selected no test\n${run.log}`).toBeGreaterThan(0);
      for (const t of run.tests) {
        // The helper annotates the test when it opens a draft; past that point the spec runs its own
        // steps. A spec's own later skip (bug38 glitch 3 without a readable frame) or assertion failure
        // is listed above but is outside this criterion: it is not a skip for a missing button.
        expect(t.annotations, `${run.file} > ${t.title} never got a Spotlight draft from the helper ` +
          `[${t.status}${t.skipReason ? `, skip: ${t.skipReason}` : ''}]\n${t.error}`).toContain('overlay-draft-opened');
      }
    }
  });
});
