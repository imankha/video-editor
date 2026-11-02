#!/usr/bin/env python3
"""T14140: READ-ONLY audit that Postgres game_storage_refs mirrors every
profile's SQLite game_storage rows (INV-M, docs/plans/tasks/T14140-design.md §2).

The expiry sweep selects candidate profiles from game_storage_refs and, before
the IRREVERSIBLE R2 delete of a game video, checks only the profiles Postgres
says still hold it. A SQLite row with no PG mirror is therefore a ref the sweep
cannot see -- a LIVE one is a video it could delete out from under its owner.
This script measures that on a real environment before the PG-driven sweep is
deployed there.

STRICTLY READ-ONLY unless `--repair --apply`. Each profile.sqlite is listed
straight from R2 (orphan-inclusive, like measure_migration_floor.py), downloaded
to a temp file, read (PRAGMA user_version + game_storage), and deleted. It never
writes R2, never touches USER_DATA_BASE, never migrates. Out-of-process is safe
for that reason: the CLAUDE.md hazard is a separate process that MIGRATES or
UPLOADS a DB behind the live server.

Reported per environment:
  - SQLite-only LIVE rows        -> FAIL (exit 1)
  - profiles below profile_db v047 (the PG backfill)  -> FAIL
  - unreadable profiles          -> FAIL (never counted as clean)
  - SQLite-only expired rows     -> reported (a storage leak, not a data risk)
  - PG-only rows; orphan PG profiles (no profile.sqlite in R2)  -> reported
  - expiry disagreements         -> informational
  - grace rows with no recorded queuer (Phase 2 defers them)  -> reported

`--repair` prints what it would do; `--repair --apply` re-inserts SQLite-only
rows into Postgres (insert_game_storage_ref_pg_only: idempotent, GREATEST
expiry) and deletes PG rows of orphan profiles. Re-run the audit afterwards.

Usage (with THAT env's R2 credentials + DATABASE_URL in .env):

    cd src/backend
    python ../../scripts/audit_game_storage_mirror.py --env prod
    python ../../scripts/audit_game_storage_mirror.py --env prod --repair
    python ../../scripts/audit_game_storage_mirror.py --env prod --repair --apply
"""

import argparse
import os
import sqlite3
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

# profile_db v047 backfills game_storage_refs from game_storage; a profile below
# it has never been mirrored at all.
BACKFILL_VERSION = 47

# Same mapping as measure_migration_floor.py: production lives under
# `production/`, not `prod/` (an empty prefix would be a false all-clear).
_R2_PREFIX_FOR_ENV = {"dev": "dev", "staging": "staging", "prod": "production"}


def _parse_expiry(value) -> datetime | None:
    """SQLite stores ISO strings; Postgres returns datetimes. None = unparseable."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    try:
        dt = datetime.fromisoformat(str(value))
    except (ValueError, TypeError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def diff_profile(user_id, profile_id, user_version, sqlite_rows, pg_rows, now) -> dict:
    """Compare one profile's SQLite game_storage rows [(hash, expires)] against
    its Postgres game_storage_refs rows [(hash, expires)]. An unparseable SQLite
    expiry counts as LIVE (same conservatism as count_refs_in_profile)."""
    pg = {h: _parse_expiry(e) for h, e in pg_rows}
    sqlite_only_live, sqlite_only_expired, mismatch = [], [], []
    for h, raw in sqlite_rows:
        exp = _parse_expiry(raw)
        if h not in pg:
            if exp is None or exp >= now:
                sqlite_only_live.append(h)
            else:
                sqlite_only_expired.append(h)
        elif exp is not None and pg[h] is not None and abs((exp - pg[h]).total_seconds()) > 1:
            mismatch.append(h)
    sqlite_hashes = {h for h, _ in sqlite_rows}
    return {
        "user_id": user_id,
        "profile_id": profile_id,
        "user_version": user_version,
        "below_backfill": user_version < BACKFILL_VERSION,
        "sqlite_only_live": sorted(sqlite_only_live),
        "sqlite_only_expired": sorted(sqlite_only_expired),
        "pg_only": sorted(set(pg) - sqlite_hashes),
        "expiry_mismatch": sorted(mismatch),
        "unreadable": None,
    }


def unreadable_profile(user_id, profile_id, reason) -> dict:
    return {"user_id": user_id, "profile_id": profile_id, "unreadable": reason,
            "below_backfill": False, "sqlite_only_live": [], "sqlite_only_expired": [],
            "pg_only": [], "expiry_mismatch": []}


def exit_code(reports) -> int:
    """1 when INV-M is not proven for every profile, else 0."""
    for r in reports:
        if r["unreadable"] or r["below_backfill"] or r["sqlite_only_live"]:
            return 1
    return 0


def _read_profile(client, bucket, key):
    """(user_version, [(hash, expires)]) from a temp copy of one R2 object."""
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
            tmp = f.name
        client.download_file(bucket, key, tmp)
        conn = sqlite3.connect(tmp)
        try:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            has_table = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_storage'"
            ).fetchone()
            rows = conn.execute(
                "SELECT blake3_hash, storage_expires_at FROM game_storage"
            ).fetchall() if has_table else []
            return version, [(r[0], r[1]) for r in rows]
        finally:
            conn.close()
    finally:
        if tmp:
            for suffix in ("", "-wal", "-shm"):
                if os.path.exists(tmp + suffix):
                    os.unlink(tmp + suffix)


def _iter_profile_keys(client, bucket, env):
    """Yield (user_id, profile_id, key) for every profile.sqlite under the env."""
    prefix = f"{_R2_PREFIX_FOR_ENV[env]}/users/"
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            parts = key[len(prefix):].split("/")
            # {user_id}/profiles/{profile_id}/profile.sqlite
            if len(parts) == 4 and parts[1] == "profiles" and parts[3] == "profile.sqlite":
                yield parts[0], parts[2], key


def _load_pg_refs(cur) -> dict:
    cur.execute("SELECT user_id, profile_id, blake3_hash, storage_expires_at FROM game_storage_refs")
    refs: dict[tuple[str, str], list] = {}
    for r in cur.fetchall():
        refs.setdefault((r["user_id"], r["profile_id"]), []).append(
            (r["blake3_hash"], r["storage_expires_at"]))
    return refs


def _print_report(env, reports, orphans):
    def total(field):
        return sum(len(r[field]) for r in reports)

    print(f"\n[{env}] audited {len(reports)} profile(s)")
    print(f"[{env}] SQLite-only LIVE rows:    {total('sqlite_only_live')}")
    print(f"[{env}] below v{BACKFILL_VERSION:03d}:              "
          f"{sum(1 for r in reports if r['below_backfill'])}")
    print(f"[{env}] unreadable profiles:      {sum(1 for r in reports if r['unreadable'])}")
    print(f"[{env}] SQLite-only expired rows: {total('sqlite_only_expired')}")
    print(f"[{env}] PG-only rows:             {total('pg_only')}")
    print(f"[{env}] orphan PG profiles:       {len(orphans)}")
    print(f"[{env}] expiry mismatches:        {total('expiry_mismatch')}")
    for r in reports:
        if r["unreadable"]:
            print(f"  UNREADABLE {r['user_id']}/{r['profile_id']}: {r['unreadable']}")
        if r["below_backfill"]:
            print(f"  BELOW v{BACKFILL_VERSION:03d} {r['user_id']}/{r['profile_id']} "
                  f"(user_version={r['user_version']})")
        for h in r["sqlite_only_live"]:
            print(f"  SQLITE-ONLY LIVE {r['user_id']}/{r['profile_id']} hash={h}")
    for (uid, pid), rows in sorted(orphans.items()):
        print(f"  ORPHAN PG {uid}/{pid}: {len(rows)} row(s)")


def _repair(cur, sqlite_rows_by_profile, reports, orphans, apply):
    from app.services.auth_db import insert_game_storage_ref_pg_only

    verb = "APPLY" if apply else "DRY-RUN"
    for r in reports:
        rows = dict(sqlite_rows_by_profile.get((r["user_id"], r["profile_id"]), []))
        for h in r["sqlite_only_live"] + r["sqlite_only_expired"]:
            print(f"  {verb} mirror {r['user_id']}/{r['profile_id']} hash={h} expires={rows[h]}")
            if apply:
                # game_size_bytes is not needed for the mirror's safety role;
                # the row is keyed on (user, profile, hash).
                insert_game_storage_ref_pg_only(r["user_id"], r["profile_id"], h, 0, rows[h])
    for (uid, pid) in sorted(orphans):
        print(f"  {verb} delete orphan PG rows {uid}/{pid}")
        if apply:
            cur.execute(
                "DELETE FROM game_storage_refs WHERE user_id = %s AND profile_id = %s",
                (uid, pid),
            )


def main() -> int:
    ap = argparse.ArgumentParser(description="T14140 read-only game_storage mirror audit")
    ap.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    ap.add_argument("--repair", action="store_true", help="print the repair plan")
    ap.add_argument("--apply", action="store_true", help="with --repair: execute it")
    args = ap.parse_args()
    if args.apply and not args.repair:
        ap.error("--apply requires --repair")

    sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "backend"))
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env")
    import psycopg2
    from app.storage import R2_BUCKET, get_r2_client
    from psycopg2.extras import RealDictCursor

    client = get_r2_client()
    if client is None:
        raise SystemExit(f"[{args.env}] R2 credentials missing; cannot audit.")
    pg = psycopg2.connect(os.environ["DATABASE_URL"], cursor_factory=RealDictCursor)
    pg.autocommit = True
    try:
        cur = pg.cursor()
        pg_refs = _load_pg_refs(cur)
        now = datetime.now(UTC)
        reports, sqlite_rows_by_profile, seen = [], {}, set()
        for user_id, profile_id, key in _iter_profile_keys(client, R2_BUCKET, args.env):
            seen.add((user_id, profile_id))
            try:
                version, rows = _read_profile(client, R2_BUCKET, key)
            except Exception as e:  # noqa: BLE001 -- reported as a failure, never as clean
                reports.append(unreadable_profile(user_id, profile_id, f"{type(e).__name__}: {e}"))
                continue
            sqlite_rows_by_profile[(user_id, profile_id)] = rows
            reports.append(diff_profile(
                user_id, profile_id, version, rows, pg_refs.get((user_id, profile_id), []), now))
        if not reports:
            raise SystemExit(f"[{args.env}] ANOMALY: 0 profile objects listed; wrong prefix/bucket?")
        orphans = {k: v for k, v in pg_refs.items() if k not in seen}
        _print_report(args.env, reports, orphans)
        # Grace rows queued before T14140 recorded the queuer: the sweep's
        # Phase 2 defers them (never deletes blind) until an operator decides.
        cur.execute("SELECT blake3_hash FROM r2_grace_deletions WHERE queued_by_user_id IS NULL")
        legacy = [r["blake3_hash"] for r in cur.fetchall()]
        print(f"[{args.env}] grace rows without queuer: {len(legacy)}")
        for h in legacy:
            print(f"  LEGACY GRACE hash={h}")
        if args.repair:
            _repair(cur, sqlite_rows_by_profile, reports, orphans, args.apply)
        code = exit_code(reports)
        print(f"[{args.env}] INV-M {'PROVEN' if code == 0 else 'NOT PROVEN'}")
        return code
    finally:
        pg.close()


if __name__ == "__main__":
    sys.exit(main())
