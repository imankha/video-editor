#!/usr/bin/env python3
"""T5089: READ-ONLY migration-floor sweep across every reachable DB.

Computes, per track, ``FLOOR = min(schema_version)`` over EVERY reachable DB so
the T5089 prune can safely delete the contiguous ``v001..v{FLOOR}`` prefix. The
prune is only safe once this floor is proven across ALL environments and ALL
objects — including ORPHAN profile objects that the old bulk sweep skipped
forever (the 2026-07-25 finding: an orphan is exactly where a below-floor DB
hides). This script lists R2 DIRECTLY (not the profile registry), so orphans are
included by construction.

STRICTLY READ-ONLY. It never writes R2, never writes any DB, never runs a
migration. Each SQLite object is downloaded to a temp file, its ``PRAGMA
user_version`` is read, and the temp file is deleted. Postgres is read with a
single ``SELECT ... FROM schema_migrations``.

Why a script and not the admin endpoint: ``GET /api/admin/migration-status``
covers only a user's *registered* profiles, so it misses orphans — the whole
point of the floor proof. This walks the raw R2 keyspace instead.

Usage (run once per environment, with THAT env's credentials loaded in .env):

    cd src/backend
    # SQLite tracks (user.sqlite + profile.sqlite, orphan-inclusive) for one env:
    .venv/Scripts/python.exe ../../scripts/measure_migration_floor.py --env prod
    # Postgres floor for one env (uses that env's DATABASE_URL):
    .venv/Scripts/python.exe ../../scripts/measure_migration_floor.py --env prod --postgres

R2 uses a single shared bucket keyed by ``{env}/users/...``, so one credential
set can sweep dev/staging/prod prefixes; postgres needs each env's own
DATABASE_URL. Record the per-track floors + date back in the T5089 task file.
"""

import argparse
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "backend"))

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from app.storage import R2_BUCKET, R2_ENABLED, get_r2_client  # noqa: E402


def _read_user_version_from_r2(client, key: str) -> int | None:
    """Download one SQLite object to a temp file, read PRAGMA user_version, delete.
    Returns None if the object is missing/unreadable (reported, never counted as
    a floor — an unknown version must not silently lower the floor)."""
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
            tmp = f.name
        client.download_file(R2_BUCKET, key, tmp)
        conn = sqlite3.connect(tmp)
        try:
            return conn.execute("PRAGMA user_version").fetchone()[0]
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001 — a read error is reported, not fatal
        print(f"  !! could not read {key}: {type(e).__name__}: {e}")
        return None
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)


def _iter_db_keys(client, env: str):
    """Yield every user.sqlite and profile.sqlite key under {env}/users/, listing
    R2 directly so ORPHAN (unregistered) profile objects are included."""
    paginator = client.get_paginator("list_objects_v2")
    prefix = f"{env}/users/"
    for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("/user.sqlite") or key.endswith("/profile.sqlite"):
                yield key


def sweep_sqlite(env: str) -> None:
    if not R2_ENABLED:
        print(
            f"[{env}] R2 is DISABLED (R2_ENABLED=false / no credentials in .env). "
            "Cannot sweep the SQLite tracks here. Load this env's R2 credentials and rerun."
        )
        return
    client = get_r2_client()
    if client is None:
        print(f"[{env}] get_r2_client() returned None — R2 credentials missing.")
        return

    user_db_versions: dict[str, int] = {}
    profile_db_versions: dict[str, int] = {}
    unreadable = 0
    total = 0
    for key in _iter_db_keys(client, env):
        total += 1
        v = _read_user_version_from_r2(client, key)
        if v is None:
            unreadable += 1
            continue
        if key.endswith("/user.sqlite"):
            user_db_versions[key] = v
        else:
            profile_db_versions[key] = v

    print(f"\n[{env}] swept {total} SQLite object(s); {unreadable} unreadable.")
    for track, versions in (("user_db", user_db_versions), ("profile_db", profile_db_versions)):
        if not versions:
            print(f"[{env}] {track}: no readable objects.")
            continue
        floor = min(versions.values())
        head = max(versions.values())
        at_floor = sorted(k for k, v in versions.items() if v == floor)
        print(f"[{env}] {track}: FLOOR=v{floor:03d} head=v{head:03d} "
              f"across {len(versions)} object(s).")
        # Version histogram: how many objects sit at each schema version. The tail
        # (low versions with a handful of objects) is what constrains the prune —
        # a single below-floor outlier blocks deleting anything under it.
        hist: dict[int, int] = {}
        for v in versions.values():
            hist[v] = hist.get(v, 0) + 1
        print(f"[{env}] {track}: version histogram (version: count):")
        for v in sorted(hist):
            print(f"    v{v:03d}: {hist[v]}")
        print(f"[{env}] {track}: object(s) AT the floor v{floor:03d} "
              f"(prune constraint; first 15):")
        for k in at_floor[:15]:
            print(f"    v{floor:03d}  {k}")
        if len(at_floor) > 15:
            print(f"    ... and {len(at_floor) - 15} more at v{floor:03d}")
    if unreadable:
        print(f"[{env}] WARNING: {unreadable} object(s) unreadable — resolve before "
              "trusting the floor (an unknown version could be below it).")


def sweep_postgres(env: str) -> None:
    import psycopg2

    url = os.environ.get("DATABASE_URL")
    if not url:
        print(f"[{env}] postgres: DATABASE_URL not set — load this env's DB URL and rerun.")
        return
    conn = psycopg2.connect(url)
    try:
        cur = conn.cursor()
        cur.execute("SELECT version FROM schema_migrations ORDER BY version")
        versions = [r[0] for r in cur.fetchall()]
    finally:
        conn.close()
    if not versions:
        print(f"[{env}] postgres: schema_migrations is EMPTY (fresh _SCHEMA_DDL, never "
              "migrated). Postgres is exempt from the floor gate (see T5089).")
        return
    # Postgres is one shared deploy-migrated DB per env; the prune-relevant fact is
    # "is it at head?", not a per-user min. Report min_applied/head/contiguity so the
    # operator can confirm every env's ledger reached head before pruning that track.
    contiguous = versions == list(range(min(versions), max(versions) + 1))
    print(f"[{env}] postgres: min_applied=v{min(versions):03d} head=v{max(versions):03d} "
          f"({len(versions)} applied, {'contiguous' if contiguous else 'HAS GAPS'}).")


def main() -> None:
    ap = argparse.ArgumentParser(description="T5089 read-only migration-floor sweep")
    ap.add_argument("--env", required=True, choices=["dev", "staging", "prod"],
                    help="environment whose R2 prefix / DATABASE_URL to sweep")
    ap.add_argument("--postgres", action="store_true",
                    help="measure the postgres floor (uses DATABASE_URL) instead of R2 SQLite")
    args = ap.parse_args()
    if args.postgres:
        sweep_postgres(args.env)
    else:
        sweep_sqlite(args.env)


if __name__ == "__main__":
    main()
