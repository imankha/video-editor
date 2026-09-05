// T8770: Narrowly suppress the Vitest worker-pool RPC teardown race so it stops
// failing otherwise-100%-passing CI runs.
//
// Signature: an "Unhandled Rejection" like
//   Error: [vitest-worker]: Closing rpc while "fetch" was pending
// fired AFTER the real run finishes, from worker-pool teardown (the RPC channel
// a worker uses to fetch modules from the main process closes while a module
// fetch is still in flight). It is never a product-code error and never has a
// FAILING TEST behind it, so --retry can't absorb it — it only bumps the
// process exit code, turning a green run red. Documented history:
// docs/testing/known-failures.md (the worker-pool RPC teardown row).
//
// Why onUnhandledError and NOT dangerouslyIgnoreUnhandledErrors:
// Reading Vitest 4.0.13 source, `dangerouslyIgnoreUnhandledErrors` gates the
// SOLE unhandled-error -> exitCode path (Vitest._checkUnhandledErrors), but it
// is a BLANKET switch: it also suppresses a genuine in-test unhandled rejection
// (a real bug that escapes as a rejection rather than an assertion). That is the
// exact class we must NOT hide. `onUnhandledError` instead runs per-error inside
// StateManager.catchError BEFORE the error is added to the set that drives the
// exit code, so returning `false` drops ONLY the matched error and lets every
// other unhandled error still fail the run. Vitest's own docs recommend this
// over the dangerous flag for hiding specific errors. Genuine assertion failures
// are unaffected either way — they exit non-zero via a completely separate,
// ungated path (TestRun.end computes state from hasFailed(modules)).
//
// This is deliberately narrow: message-matched to the worker-teardown RPC race
// only. Anything else — including a real fetch rejection from product code —
// passes through untouched. The synthetic repro in
// test/flake-repro/ proves all three properties empirically.

// Matches "[vitest-worker]: Closing rpc while \"<method>\" was pending" for any
// pending RPC method (observed as "fetch", but the race is method-agnostic).
const WORKER_TEARDOWN_RPC = /\[vitest-worker\]:\s*Closing rpc while ".*" was pending/;

/**
 * @param {unknown} error - a thrown value or Error-like object (may carry a
 *   Vitest-attached `.type`, e.g. "Unhandled Error" / "Teardown Error").
 * @returns {boolean} true only for the known worker-pool RPC teardown flake.
 */
export function isWorkerTeardownRpcFlake(error) {
  const message = typeof error === 'string' ? error : error?.message;
  return typeof message === 'string' && WORKER_TEARDOWN_RPC.test(message);
}

/**
 * Vitest `test.onUnhandledError` callback. Return `false` to ignore an error;
 * returning undefined keeps it (and it will fail the run as before).
 * @param {import('vitest/node').SerializedError | Error} error
 * @returns {boolean | void}
 */
export function onUnhandledError(error) {
  if (isWorkerTeardownRpcFlake(error)) return false;
  return undefined;
}
