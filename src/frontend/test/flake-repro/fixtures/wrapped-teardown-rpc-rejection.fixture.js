// Synthetic repro of the WRAPPED teardown flake (Master CI run 41707150317,
// 2026-11-03): when the RPC channel closes while a vi.mock factory's module
// fetch is in flight, Vitest reports "There was an error when mocking a module"
// with the teardown race only as its `cause`. The test itself PASSES; with the
// filter this must be suppressed (exit 0).
import { test, expect, afterAll } from 'vitest';

test('passes cleanly', () => {
  expect(1).toBe(1);
});

afterAll(() => {
  Promise.resolve().then(() => {
    Promise.reject(new Error(
      '[vitest] There was an error when mocking a module. If you are using "vi.mock" factory, make sure there are no top level variables inside, since this call is hoisted to top of the file.',
      { cause: new Error('[vitest-worker]: Closing rpc while "fetch" was pending') },
    ));
  });
});
