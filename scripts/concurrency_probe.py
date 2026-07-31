#!/usr/bin/env python3
"""T6200 concurrency probe — is the backend serializing concurrent requests?

Fires N concurrent HTTP requests at a single-worker backend and records each
request's start offset and wall duration, so you can see whether durations scale
with N (serialization) or stay flat (true concurrency), and whether the requests
finish staggered or all-together (the prod HAR signature).

This is the repeatable artifact for T6200: re-run it to prove a fix still holds.

Usage (backend must be running on the target base URL):
    python scripts/concurrency_probe.py --mode block   # loop-probe: blocking-on-loop
    python scripts/concurrency_probe.py --mode async    # loop-probe: awaits (yields)
    python scripts/concurrency_probe.py --mode thread   # loop-probe: to_thread offload
    python scripts/concurrency_probe.py --path /api/health --auth   # real endpoint

The loop-probe modes hit the non-prod test seam GET /api/test/loop-probe and need
no auth/profile setup. Real-endpoint mode (--path) sends the dev X-User-ID +
X-Profile-ID header bypass (dev/staging only) so session_init/sync are exercised
exactly as a normal request. Read-only: never mutates data. Safe against staging
/api/health unauthenticated; NEVER point --auth at prod.
"""
from __future__ import annotations

import argparse
import asyncio
import time

import httpx

DEFAULT_BASE = "http://127.0.0.1:8000"
CONCURRENCIES = (1, 2, 4, 8)


async def _one(client: httpx.AsyncClient, url: str, headers: dict, t_burst: float):
    start = time.perf_counter()
    start_offset_ms = (start - t_burst) * 1000
    r = await client.get(url, headers=headers)
    dur_ms = (time.perf_counter() - start) * 1000
    end_offset_ms = (time.perf_counter() - t_burst) * 1000
    return {
        "status": r.status_code,
        "start_ms": start_offset_ms,
        "dur_ms": dur_ms,
        "end_ms": end_offset_ms,
    }


async def _burst(base: str, path: str, params: dict, headers: dict, n: int):
    # Give the pool at least n connections so the CLIENT never serializes.
    limits = httpx.Limits(max_connections=max(16, n), max_keepalive_connections=0)
    url = httpx.URL(base + path, params=params)
    async with httpx.AsyncClient(limits=limits, timeout=60.0) as client:
        # warm one connection open path so DNS/connect cost isn't in the burst
        try:
            await client.get(httpx.URL(base + "/api/status"))
        except Exception:
            pass
        t_burst = time.perf_counter()
        results = await asyncio.gather(
            *[_one(client, str(url), headers, t_burst) for _ in range(n)]
        )
    return results


def _summarize(n: int, results: list[dict]) -> str:
    durs = sorted(r["dur_ms"] for r in results)
    ends = [r["end_ms"] for r in results]
    wall = max(ends) - 0.0
    end_spread = max(ends) - min(ends)
    codes = {r["status"] for r in results}
    return (
        f"N={n:>2} | wall={wall:7.1f}ms | per-req min/med/max="
        f"{durs[0]:7.1f}/{durs[len(durs)//2]:7.1f}/{durs[-1]:7.1f}ms | "
        f"finish-spread={end_spread:6.1f}ms | codes={sorted(codes)}"
    )


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--mode", choices=["block", "async", "thread"], default=None,
                    help="loop-probe mode (uses the test-seam endpoint)")
    ap.add_argument("--ms", type=int, default=200, help="loop-probe work duration")
    ap.add_argument("--path", default=None, help="hit a real endpoint instead")
    ap.add_argument("--anon", action="store_true",
                    help="omit the dev X-User-ID/X-Profile-ID header bypass")
    ap.add_argument("--no-profile", action="store_true",
                    help="send X-User-ID but NOT X-Profile-ID (forces session_init)")
    ap.add_argument("--user", default="probeuser")
    ap.add_argument("--profile", default="00000000")
    ap.add_argument("--cookie", default=None,
                    help="raw Cookie header value (e.g. from a real rb_session); "
                         "exercises validate_session instead of the X-User-ID bypass")
    args = ap.parse_args()

    headers: dict[str, str] = {}
    if args.cookie:
        headers["Cookie"] = args.cookie
    elif not args.anon:
        headers["X-User-ID"] = args.user
        if not args.no_profile:
            headers["X-Profile-ID"] = args.profile

    if args.path:
        path, params = args.path, {}
        label = f"GET {args.path}" + (" (anon)" if args.anon else " (dev-hdr)")
    else:
        mode = args.mode or "block"
        path, params = "/api/test/loop-probe", {"mode": mode, "ms": args.ms}
        label = f"loop-probe mode={mode} ms={args.ms}"

    print(f"\n=== {label}  base={args.base} ===")
    for n in CONCURRENCIES:
        results = await _burst(args.base, path, params, headers, n)
        print(_summarize(n, results))


if __name__ == "__main__":
    asyncio.run(main())
