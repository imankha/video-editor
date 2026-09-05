// T8770 synthetic repro fixture. The test PASSES but emits a floating unhandled
// rejection with a DIFFERENT message (a real bug escaping as a rejection, e.g. a
// product fetch that rejected and nobody awaited). This must NOT be suppressed by
// the filter — proving the mitigation is narrow and still catches genuine
// post-run failures. With the onUnhandledError filter applied, this run must
// STILL exit non-zero.
import { test, expect, afterAll } from 'vitest';

test('passes cleanly', () => {
  expect(1).toBe(1);
});

afterAll(() => {
  Promise.resolve().then(() => {
    Promise.reject(new Error('genuine app bug: fetch failed and nobody awaited it'));
  });
});
