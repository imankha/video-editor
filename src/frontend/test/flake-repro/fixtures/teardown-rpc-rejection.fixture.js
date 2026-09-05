// T8770 synthetic repro fixture. The test itself PASSES; it emits a floating
// unhandled rejection shaped exactly like the worker-pool RPC teardown flake
// (fired after the test body returns, on a later microtask, so it escapes the
// test and reaches Vitest's process-level unhandled-rejection handler — the same
// path the real teardown race lands on). With the onUnhandledError filter this
// must be suppressed (exit 0); without it the run exits non-zero.
import { test, expect, afterAll } from 'vitest';

test('passes cleanly', () => {
  expect(1).toBe(1);
});

afterAll(() => {
  // Escape into a truly unhandled rejection after the test has finished.
  Promise.resolve().then(() => {
    Promise.reject(new Error('[vitest-worker]: Closing rpc while "fetch" was pending'));
  });
});
