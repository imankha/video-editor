// T8770: fast unit coverage for the flake predicate. The meta-test proves the
// end-to-end Vitest wiring; this pins the message-matching itself so a careless
// edit to the regex (too broad -> swallows real bugs; too narrow -> flake
// returns) is caught instantly without spawning subprocesses.
import { describe, test, expect } from 'vitest';
import { isWorkerTeardownRpcFlake, onUnhandledError } from '../../vitest.onUnhandledError.js';

describe('isWorkerTeardownRpcFlake', () => {
  test('matches the observed "fetch" teardown flake', () => {
    const err = new Error('[vitest-worker]: Closing rpc while "fetch" was pending');
    expect(isWorkerTeardownRpcFlake(err)).toBe(true);
  });

  test('matches the same race for any pending RPC method', () => {
    const err = new Error('[vitest-worker]: Closing rpc while "collect" was pending');
    expect(isWorkerTeardownRpcFlake(err)).toBe(true);
  });

  test('accepts a bare string message too', () => {
    expect(isWorkerTeardownRpcFlake('[vitest-worker]: Closing rpc while "fetch" was pending')).toBe(true);
  });

  test('does NOT match a genuine app error that merely mentions fetch', () => {
    expect(isWorkerTeardownRpcFlake(new Error('fetch failed: 500 from /api/clips'))).toBe(false);
  });

  test('does NOT match a genuine assertion-style rejection', () => {
    expect(isWorkerTeardownRpcFlake(new Error('expected 1 to equal 2'))).toBe(false);
  });

  test('is null/undefined safe', () => {
    expect(isWorkerTeardownRpcFlake(null)).toBe(false);
    expect(isWorkerTeardownRpcFlake(undefined)).toBe(false);
    expect(isWorkerTeardownRpcFlake({})).toBe(false);
  });
});

describe('onUnhandledError callback contract', () => {
  test('returns false (ignore) ONLY for the flake', () => {
    expect(onUnhandledError(new Error('[vitest-worker]: Closing rpc while "fetch" was pending'))).toBe(false);
  });

  test('returns undefined (keep) for every other error', () => {
    expect(onUnhandledError(new Error('genuine app bug'))).toBeUndefined();
    expect(onUnhandledError('fetch failed')).toBeUndefined();
  });
});
