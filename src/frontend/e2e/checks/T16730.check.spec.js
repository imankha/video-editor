/**
 * T16730 - per-criterion acceptance check (group checks protocol).
 *
 * C1 re-runs T16525:C2, which failed intermittently: a parent who returns after a sharpen must
 * see "Your highlight is in Highlights" on the recovery card, View must open the in-Highlights
 * panel, and the highlight must be listed in Highlights.
 *
 * The recovery card reads the export list from /api/bootstrap when it lands within 2 s and from
 * GET /api/exports/unacknowledged otherwise; the bug was bootstrap's list missing `finished`, so
 * the outcome depended on which one won. This check returns several times on fast loads (the
 * bootstrap path) and once with /api/bootstrap held back 3 s (the fallback path), and every
 * return must show the in-Highlights message. The framing card stays until View is tapped
 * (T9285), so every reload sees it.
 *
 * The steps live in ../helpers/returnAfterSharpen.js (T16800:C1 runs the same ones).
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16730.check.spec.js --reporter=line
 */
import { test } from '@playwright/test';
import { returnAfterSharpenFindsHighlight } from '../helpers/returnAfterSharpen';

test('T16730:C1 - a parent who returns later sees the same message and finds the highlight in Highlights', async ({ browser }) => {
  test.setTimeout(900000);
  await returnAfterSharpenFindsHighlight(browser, 'T16730');
});
