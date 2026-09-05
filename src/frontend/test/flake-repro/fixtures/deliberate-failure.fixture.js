// T8770 synthetic repro fixture (NOT run by the main suite — *.fixture.js is not
// matched by the default include; the meta-test invokes it via a dedicated
// config). A plainly-failing assertion: proves the mitigation never swallows a
// genuine test failure.
import { test, expect } from 'vitest';

test('deliberately fails so the run must exit non-zero', () => {
  expect(1).toBe(2);
});
