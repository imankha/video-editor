"""
T7490 heal: surface orphaned 'pending' games as 'upload_failed' visible cards.

Background
----------
Before T7490, `list_pending_uploads` SILENTLY deleted a stale resume record when
its R2 multipart was gone. That left the `games` row (kept alive by T7470's
only-if-empty guard because the user annotated during the transfer) stuck at
status='pending' — invisible on the Games tab forever, with NO `pending_uploads`
record left to trigger any reap.

T7490's honest reap (games_upload.list_pending_uploads) now marks such a game
'upload_failed' AND aborts the R2 multipart AND deletes the record — but ONLY for
games that STILL have a stale `pending_uploads` row to iterate. Games whose record
was ALREADY silently deleted by the old code (e.g. rooom1h's
efb1e9e8-d513-4e6d-bc8d-d6eae5a243e2, profile 4a613b52) are unreachable by that
path. This one-off heal finds them directly and flips them to 'upload_failed' so
their Retry/Discard card renders.

What it targets (the unambiguous dead-upload set)
-------------------------------------------------
A `games` row where ALL hold:
  - status = 'pending'
  - created_at older than --days (default 1) — a live/in-progress upload is younger
  - NO matching `pending_uploads` row (the honest reap can't reach it)

A pending game that STILL has a `pending_uploads` row is left ALONE: the next Games
tab load hits `list_pending_uploads`, which reaps it honestly (this is reported, not
acted on). This script only heals the records the reap structurally cannot see.

Usage (dry-run by default — mirrors cleanup_null_video_games.py)
----------------------------------------------------------------
    cd src/backend && .venv/Scripts/python.exe ../../scripts/scan_orphaned_pending_uploads.py <profile.sqlite> [--days 1]
    # then, to actually heal:
    cd src/backend && .venv/Scripts/python.exe ../../scripts/scan_orphaned_pending_uploads.py <profile.sqlite> --days 1 --apply

DO NOT RUN FROM THE CONTAINER WORKER. This has no staging/prod DB access here.
The supervisor/user runs it post-merge against a profile.sqlite downloaded from R2
(same pattern as migrations / reset-test-user), then re-uploads and restarts, OR
prefers the zero-touch path: just have the affected user open their Games tab so
`list_pending_uploads` reaps any record-backed orphans automatically. This script
is the fallback for RECORD-LESS orphans only.
"""

import argparse
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

UPLOAD_FAILED = "upload_failed"  # mirror app.constants.GameStatus.UPLOAD_FAILED


def _cutoff_iso(days: float) -> str:
    """created_at strings are ISO-ish; compare lexically against this cutoff."""
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def find_recordless_orphans(conn: sqlite3.Connection, days: float):
    """Pending games older than `days` with NO pending_uploads row."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT g.id, g.name, g.blake3_hash, g.created_at
        FROM games g
        LEFT JOIN pending_uploads pu ON pu.blake3_hash = g.blake3_hash
        WHERE g.status = 'pending'
          AND g.created_at < ?
          AND pu.id IS NULL
        ORDER BY g.created_at
        """,
        (_cutoff_iso(days),),
    )
    return cur.fetchall()


def find_record_backed_pending(conn: sqlite3.Connection, days: float):
    """Pending games that STILL have a pending_uploads row — reported only; the
    live `list_pending_uploads` reap will handle these on the next Games-tab load."""
    cur = conn.cursor()
    cur.execute(
        """
        SELECT g.id, g.name, g.created_at
        FROM games g
        JOIN pending_uploads pu ON pu.blake3_hash = g.blake3_hash
        WHERE g.status = 'pending'
          AND g.created_at < ?
        ORDER BY g.created_at
        """,
        (_cutoff_iso(days),),
    )
    return cur.fetchall()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("db_path", help="Path to a profile.sqlite DB (downloaded from R2)")
    parser.add_argument("--days", type=float, default=1.0, help="Min age in days (default 1)")
    parser.add_argument("--apply", action="store_true", help="Actually mark upload_failed (default: dry-run)")
    args = parser.parse_args()

    db_path = Path(args.db_path)
    if not db_path.exists():
        print(f"ERROR: {db_path} not found", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(db_path)

    record_backed = find_record_backed_pending(conn, args.days)
    if record_backed:
        print(
            f"{len(record_backed)} pending game(s) STILL have a resume record — "
            f"left alone (the live list_pending_uploads reap handles these):"
        )
        for gid, name, created in record_backed:
            print(f"  [reap-on-load] id={gid} name={name!r} created_at={created}")

    orphans = find_recordless_orphans(conn, args.days)
    if not orphans:
        print("No record-less orphaned pending games to heal.")
        return

    print(f"\nFound {len(orphans)} record-less orphaned pending game(s) in {db_path}:")
    for gid, name, blake3, created in orphans:
        print(f"  id={gid} name={name!r} hash={(blake3 or '')[:12]} created_at={created}")

    if not args.apply:
        print("\nDRY-RUN. Re-run with --apply to mark these 'upload_failed' (visible Retry/Discard card).")
        return

    cur = conn.cursor()
    ids = [g[0] for g in orphans]
    placeholders = ",".join("?" for _ in ids)
    cur.execute(
        f"UPDATE games SET status = '{UPLOAD_FAILED}' WHERE id IN ({placeholders}) AND status = 'pending'",
        ids,
    )
    conn.commit()
    print(f"\nMarked {cur.rowcount} game(s) '{UPLOAD_FAILED}'. Re-upload the DB to R2 and restart the machines.")


if __name__ == "__main__":
    main()
