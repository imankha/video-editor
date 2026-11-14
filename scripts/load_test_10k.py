"""T14190 10K readiness load test: seed synthetic users, run the scenario, clean up.

Assumed load at 10K registered users: ~1,000 daily actives, ~100 concurrent sessions
at peak. Pass criteria (evaluate()): /api/health p95 < 200 ms and no authenticated
request > 1 s under the scenario, with no failed request. Fly CPU throttle and the
sweep's runtime / Class A count are read from Fly metrics and the staging log; see
docs/plans/T14190-load-test-results.md for the full procedure and recorded results.

Usage (from src/backend; dev or staging ONLY -- prod is refused):
    python ../../scripts/load_test_10k.py seed --env staging --count 10000
    python ../../scripts/load_test_10k.py run --env staging \\
        --base https://reel-ballers-api-staging.fly.dev --vus 100 --duration 120 \\
        --out /tmp/t14190-run.json
    python ../../scripts/delete_user.py --env staging --email-suffix @loadtest.invalid --yes

seed/run read DATABASE_URL from the env file (.env / .env.staging), as
delete_user.py does. Each virtual user boots as one synthetic user through the
dev/staging X-User-ID bypass (no X-Profile-ID, so session_init creates its profile
on first touch), then repeats the app's boot burst with think time. A health prober
fires N=8 concurrent /api/health (concurrency_probe's burst) every interval.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import random
import sys
import time
import uuid
from pathlib import Path

import httpx

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

SYNTHETIC_EMAIL_SUFFIX = "@loadtest.invalid"
HEALTH_P95_LIMIT_MS = 200.0
AUTH_MAX_LIMIT_MS = 1000.0
HEALTH_BURST = 8
# The editor's boot burst (concurrency_probe.PUBLISH_BURST_PATHS without the
# /api/health victim, which the prober measures separately).
BOOT_PATHS = (
    "/api/bootstrap",
    "/api/admin/me",
    "/api/rank/confidence?aspect_ratio=9:16",
    "/api/rank/confidence?aspect_ratio=16:9",
    "/api/collections/summary",
    "/api/intro-cards",
)


def synthetic_email(i: int) -> str:
    return f"lt-{i:05d}{SYNTHETIC_EMAIL_SUFFIX}"


def percentile(values: list[float], p: float) -> float:
    """Nearest-rank percentile."""
    ordered = sorted(values)
    rank = max(1, math.ceil(p / 100 * len(ordered)))
    return ordered[rank - 1]


def evaluate(health_ms: list[float], auth_ms: list[float], errors: int) -> list[str]:
    """Failed pass criteria, one line each; [] is a pass."""
    if not health_ms or not auth_ms:
        return ["no /api/health samples or no authenticated samples: the run measured nothing"]
    failures = []
    health_p95 = percentile(health_ms, 95)
    if health_p95 >= HEALTH_P95_LIMIT_MS:
        failures.append(f"health p95 {health_p95:.0f} ms >= {HEALTH_P95_LIMIT_MS:.0f} ms")
    slowest = max(auth_ms)
    if slowest > AUTH_MAX_LIMIT_MS:
        failures.append(f"slowest authenticated request {slowest:.0f} ms > {AUTH_MAX_LIMIT_MS:.0f} ms")
    if errors:
        failures.append(f"{errors} failed requests (non-2xx or transport error)")
    return failures


def require_non_prod(env: str) -> None:
    if env not in ("dev", "staging"):
        sys.exit(f"REFUSING env={env}: the load test seeds and drives dev/staging only")


def seed_users(conn, count: int) -> int:
    """Insert synthetic users 0..count-1 (idempotent); returns how many were new."""
    from psycopg2.extras import execute_values

    rows = [(str(uuid.uuid4()), synthetic_email(i)) for i in range(count)]
    cur = conn.cursor()
    inserted = execute_values(
        cur,
        "INSERT INTO users (user_id, email) VALUES %s ON CONFLICT (email) DO NOTHING RETURNING user_id",
        rows, page_size=1000, fetch=True,
    )
    conn.commit()
    return len(inserted)


def synthetic_user_ids(conn, limit: int) -> list[str]:
    cur = conn.cursor()
    cur.execute(
        "SELECT user_id FROM users WHERE email LIKE %s ORDER BY email LIMIT %s",
        ("%" + SYNTHETIC_EMAIL_SUFFIX, limit),
    )
    return [r["user_id"] for r in cur.fetchall()]


async def _timed_get(client, url: str, headers: dict) -> tuple[float, bool]:
    start = time.perf_counter()
    try:
        r = await client.get(url, headers=headers)
        ok = 200 <= r.status_code < 300
    except httpx.HTTPError:
        ok = False
    return (time.perf_counter() - start) * 1000, ok


async def _virtual_user(client, base: str, user_id: str, deadline: float, think_s: float, out: dict):
    headers = {"X-User-ID": user_id}
    while time.perf_counter() < deadline:
        results = await asyncio.gather(*[_timed_get(client, base + p, headers) for p in BOOT_PATHS])
        for path, (ms, ok) in zip(BOOT_PATHS, results):
            out["auth"].setdefault(path, []).append(ms)
            out["errors"] += not ok
        await asyncio.sleep(random.uniform(0.5, 1.5) * think_s)


async def _health_prober(client, base: str, deadline: float, interval_s: float, out: dict):
    while time.perf_counter() < deadline:
        results = await asyncio.gather(
            *[_timed_get(client, base + "/api/health", {}) for _ in range(HEALTH_BURST)]
        )
        for ms, ok in results:
            out["health"].append(ms)
            out["errors"] += not ok
        await asyncio.sleep(interval_s)


async def run_scenario(base: str, user_ids: list[str], duration_s: float,
                       think_s: float, health_interval_s: float) -> dict:
    out: dict = {"health": [], "auth": {}, "errors": 0}
    limits = httpx.Limits(max_connections=len(user_ids) * len(BOOT_PATHS) + HEALTH_BURST)
    async with httpx.AsyncClient(limits=limits, timeout=30.0) as client:
        deadline = time.perf_counter() + duration_s
        await asyncio.gather(
            _health_prober(client, base, deadline, health_interval_s, out),
            *[_virtual_user(client, base, uid, deadline, think_s, out) for uid in user_ids],
        )
    return out


def _summary(out: dict) -> dict:
    auth_all = [ms for samples in out["auth"].values() for ms in samples]
    return {
        "health_samples": len(out["health"]),
        "health_p50_ms": percentile(out["health"], 50) if out["health"] else None,
        "health_p95_ms": percentile(out["health"], 95) if out["health"] else None,
        "auth_samples": len(auth_all),
        "auth_max_ms": max(auth_all) if auth_all else None,
        "auth_p95_ms_by_path": {p: round(percentile(s, 95)) for p, s in out["auth"].items()},
        "errors": out["errors"],
        "failures": evaluate(out["health"], auth_all, out["errors"]),
    }


def main() -> None:
    import delete_user  # env-file loading + the Postgres connection, shared with cleanup

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    seed = sub.add_parser("seed")
    seed.add_argument("--env", required=True)
    seed.add_argument("--count", type=int, default=10_000)
    run = sub.add_parser("run")
    run.add_argument("--env", required=True)
    run.add_argument("--base", required=True)
    run.add_argument("--vus", type=int, default=100)
    run.add_argument("--duration", type=float, default=120.0, help="seconds")
    run.add_argument("--think", type=float, default=3.0, help="mean seconds between a VU's bursts")
    run.add_argument("--health-interval", type=float, default=1.0)
    run.add_argument("--out", help="write the summary JSON here")
    args = ap.parse_args()

    require_non_prod(args.env)
    conn = delete_user.get_pg_conn(delete_user.load_env(args.env))
    if args.cmd == "seed":
        print(f"seeded {seed_users(conn, args.count)} new synthetic users ({args.count} requested)")
        return

    user_ids = synthetic_user_ids(conn, args.vus)
    conn.close()
    if len(user_ids) < args.vus:
        sys.exit(f"only {len(user_ids)} synthetic users exist; run `seed` first")
    summary = _summary(asyncio.run(run_scenario(
        args.base.rstrip("/"), user_ids, args.duration, args.think, args.health_interval,
    )))
    text = json.dumps(summary, indent=2)
    print(text)
    if args.out:
        Path(args.out).write_text(text)
    sys.exit(1 if summary["failures"] else 0)


if __name__ == "__main__":
    main()
