// T8770: Permanent regression guard for the Vitest worker-pool RPC teardown
// flake fix. This is a META test: it spawns real `vitest run` subprocesses
// against synthetic fixtures and asserts on their exit codes, because the thing
// under test is Vitest's own exit-code wiring around `onUnhandledError` — which a
// future Vitest upgrade could silently change. Unit-testing the predicate alone
// (see onUnhandledError.test.js) can't catch that; only an end-to-end run can.
//
// Four scenarios, each a separate subprocess so exit codes stay unambiguous:
//   control  teardown-rpc rejection, NO filter   -> exit 1 (the flake is real)
//   A        deliberate assertion failure, filter -> exit 1 (never swallows fails)
//   B        teardown-rpc rejection, filter       -> exit 0 (flake suppressed)
//   C        genuine (other) rejection, filter    -> exit 1 (filter is narrow)
//
// Cost: ~4-5s total (4 subprocess boots). Kept in-suite because that is the only
// place a Vitest-semantics regression would surface, per the T8770 QA gate.
import { describe, test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '../..');
// vitest's bin ("./vitest.mjs") isn't exposed via package "exports", so resolve
// it relative to the resolvable package.json instead.
const vitestBin = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const reproConfig = resolve(here, 'repro.config.js');

function runFixture(fixture, { noFilter = false } = {}) {
  const result = spawnSync(
    process.execPath,
    [vitestBin, 'run', '--config', reproConfig, resolve(here, 'fixtures', fixture)],
    {
      cwd: frontendRoot,
      encoding: 'utf8',
      env: { ...process.env, ...(noFilter ? { FLAKE_REPRO_NO_FILTER: '1' } : {}) },
    },
  );
  if (result.error) throw result.error;
  return result.status;
}

const TIMEOUT = 30000;

describe('T8770 vitest-worker RPC teardown flake mitigation', () => {
  test('control: the teardown-rpc flake really fails the run without the filter', () => {
    expect(runFixture('teardown-rpc-rejection.fixture.js', { noFilter: true })).toBe(1);
  }, TIMEOUT);

  test('A: a genuine assertion failure still fails the run WITH the filter', () => {
    expect(runFixture('deliberate-failure.fixture.js')).toBe(1);
  }, TIMEOUT);

  test('B: the teardown-rpc flake is suppressed WITH the filter', () => {
    expect(runFixture('teardown-rpc-rejection.fixture.js')).toBe(0);
  }, TIMEOUT);

  test('C: a non-matching unhandled rejection is NOT suppressed (filter is narrow)', () => {
    expect(runFixture('genuine-rejection.fixture.js')).toBe(1);
  }, TIMEOUT);
});
