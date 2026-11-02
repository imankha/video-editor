# T14190: 10K readiness load test (procedure and results)

Task: [T14190-load-test-10k-readiness.md](tasks/T14190-load-test-10k-readiness.md).
Tooling: `scripts/load_test_10k.py` (seed + scenario + pass verdict),
`scripts/concurrency_probe.py` (N=8 `/api/health` burst), `scripts/delete_user.py --email-suffix`
(cleanup). Synthetic staging data only; prod is refused by the script.

## Pass criteria

| Criterion | Limit | Source |
|-----------|-------|--------|
| `/api/health` p95 under the scenario | < 200 ms | `load_test_10k.py run` summary `health_p95_ms` |
| Slowest authenticated request | <= 1 s | summary `auth_max_ms` |
| Failed requests | 0 | summary `errors` |
| Fly CPU throttle during the run | 0 | Fly dashboard, machine metrics (CPU throttled) |
| `do_sweep` runtime and Class A per run | independent of user count | staging log `[Sweep] Complete in` + `GET /api/admin/r2-usage` source `sweep` |

`run` exits 1 and lists every breached criterion in `failures` when any of the first three fails.
An empty measurement (no samples) is a failure, never a pass.

## Procedure (staging)

Run from `src/backend` with `.env.staging` present (R2 + `DATABASE_URL`, as `delete_user.py` reads).

1. Seed: `python ../../scripts/load_test_10k.py seed --env staging --count 10000`
   (users rows only, emails `lt-NNNNN@loadtest.invalid`; idempotent).
2. Sweep at 10K: wait for the next scheduled sweep or restart the staging machine (the sweep
   runs at startup). Record the `[Sweep] Complete in {s}s` line (`fly logs -a reel-ballers-api-staging`)
   and the `sweep` row's Class A count from `GET /api/admin/r2-usage` (diff before/after). Do NOT
   run `do_sweep` from a laptop: an out-of-process sweep moves R2 behind the live machine's version
   cache (CLAUDE.md, Migration System).
3. Scenario: `python ../../scripts/load_test_10k.py run --env staging --base https://reel-ballers-api-staging.fly.dev --vus 100 --duration 120 --out /tmp/t14190-run.json`
   During the run, note the Fly CPU throttle and disk graphs.
4. Concurrency floor: `python ../../scripts/concurrency_probe.py --base https://reel-ballers-api-staging.fly.dev --path /api/health --anon`
5. Cleanup: `python ../../scripts/delete_user.py --env staging --email-suffix @loadtest.invalid --dry-run`,
   check the count is the seeded count, then rerun with `--yes`. This removes the users rows and the
   R2 prefixes the scenario created for the 100 virtual users, through the same hardened per-user
   path as any account deletion.

## Not covered by the scenario (gaps)

- **40 held-open Modal waits.** Staging has no seam to stub a Modal call (`/api/test/*` seams are
  not mounted on staging), so the scenario does not hold export jobs open. Measure export bursts
  separately, or add a staging-safe seam if T14130 needs it.
- **Edit actions.** VUs replay the boot burst (reads + session_init for a fresh profile) only;
  surgical edit writes need seeded projects/clips per synthetic user.

## Results

### Baseline (before fixes), 2026-11-01

| Measurement | Result | Notes |
|-------------|--------|-------|
| `/api/health` idle, N=1/2/4/8 (concurrency_probe, anon) | wall 84 / 81 / 95 / 141 ms; N=8 per-request median 141 ms, finish spread 51 ms | fresh TLS connection per request; no other load |
| 100-VU scenario | not run yet | needs `.env.staging` and operator go-ahead (staging writes) |
| Sweep at 10K users | not run yet | same |
| CPU throttle / disk | not recorded yet | Fly dashboard |

### Pass run (after T14100, T14110, T14130, T14140, T14150)

Not run yet.
