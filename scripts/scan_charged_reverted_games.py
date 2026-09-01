"""
T8150 victim probe (READ-ONLY): find charged-but-reverted games.

Background
----------
Before T8150, `POST /api/games/{id}/activate` flipped a game pending->ready in the
local profile.sqlite and returned 200 (firing the "Game ready!" toast) WITHOUT a
durable_sync. The flip rode the middleware's fire-and-forget R2 sync; a 0.5s
lock-defer or a machine swap lost it, and the next cold restore / CAS re-heal pulled
R2's pre-flip snapshot back down. Because activate's storage-ref write, the credit
debit, and the status flip are ALL in that one lost sync, R2 keeps the game as plain
`status='pending'` with no storage ref -- while the credit debit is durable and
independent in Postgres (T5840). Net: the user paid, the game "vanished" (a pending
game is filtered out of readyGames), and NOTHING in the profile.sqlite alone proves
it was charged.

The ONLY durable evidence a reverted game was charged is a Postgres
`credit_transactions` debit with source='game_upload' and reference_id = str(game_id).
This probe intersects that with the pending games in a profile.sqlite to surface the
victims. It is READ-ONLY: it reports, it never writes. Repair (flip the paid game
back to 'ready', or refund) is a separate, deliberate decision per victim.

What it targets
---------------
A `games` row where BOTH hold:
  - status = 'pending' in the profile.sqlite (the reverted/never-advanced state), and
  - a Postgres `credit_transactions` row exists for this user with
    source='game_upload' and reference_id = str(game.id) and amount < 0 (a real debit).

NOTE on ambiguity: game_id is a per-profile SQLite autoincrement, so a user with
multiple profiles can have the same game_id in two profiles, both charging with the
same reference_id. Pass --profile-id for logging context; treat a hit as a STRONG
candidate to review, not a proven single victim, when the user has >1 profile.

Usage (dry-run / read-only always)
----------------------------------
    # profile.sqlite downloaded from R2 (same pattern as migrations / reset-test-user)
    cd src/backend && .venv/Scripts/python.exe ../../scripts/scan_charged_reverted_games.py \
        <profile.sqlite> --user-id <user_id> [--profile-id <pid>] \
        [--pg "postgres://..."]   # defaults to $DATABASE_URL

Across all accounts, drive it from the supervisor's per-account R2 download loop (one
profile.sqlite at a time) exactly like scan_orphaned_pending_uploads.py.

DO NOT RUN FROM THE CONTAINER WORKER against prod -- no staging/prod R2 or Postgres
access here. The supervisor/user runs it post-merge. This script performs NO writes,
so it is safe to run against a live prod Postgres (SELECT-only) and a downloaded
profile.sqlite.
"""

import argparse
import os
import sqlite3
import sys
from pathlib import Path


def find_pending_games(conn: sqlite3.Connection):
    """All pending games in this profile.sqlite (the reverted/never-advanced set)."""
    cur = conn.cursor()
    cur.execute(
        "SELECT id, name, blake3_hash, created_at FROM games WHERE status = 'pending' "
        "ORDER BY created_at"
    )
    return cur.fetchall()


def charged_reference_ids(pg_conn, user_id: str) -> set:
    """reference_ids this user was debited for under source='game_upload'.

    amount < 0 = a debit (credits spent). Read-only SELECT.
    """
    cur = pg_conn.cursor()
    cur.execute(
        """
        SELECT reference_id
        FROM credit_transactions
        WHERE user_id = %s AND source = 'game_upload' AND amount < 0
        """,
        (user_id,),
    )
    return {str(r[0]) for r in cur.fetchall() if r[0] is not None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("db_path", help="Path to a profile.sqlite DB (downloaded from R2)")
    parser.add_argument("--user-id", required=True, help="Owning user_id (for the Postgres lookup)")
    parser.add_argument("--profile-id", default=None, help="Profile id (logging/context only)")
    parser.add_argument(
        "--pg", default=os.environ.get("DATABASE_URL"),
        help="Postgres connection string (default: $DATABASE_URL)",
    )
    args = parser.parse_args()

    db_path = Path(args.db_path)
    if not db_path.exists():
        print(f"ERROR: {db_path} not found", file=sys.stderr)
        sys.exit(1)
    if not args.pg:
        print("ERROR: no Postgres connection string (pass --pg or set DATABASE_URL)", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    pending = find_pending_games(conn)
    if not pending:
        print(f"No pending games in {db_path} (profile={args.profile_id}). Nothing to check.")
        return

    try:
        import psycopg2
    except ImportError:
        print("ERROR: psycopg2 not installed; cannot query Postgres.", file=sys.stderr)
        sys.exit(1)

    pg_conn = psycopg2.connect(args.pg)
    try:
        charged = charged_reference_ids(pg_conn, args.user_id)
    finally:
        pg_conn.close()

    victims = [(gid, name, blake3, created) for (gid, name, blake3, created) in pending
               if str(gid) in charged]

    print(
        f"{len(pending)} pending game(s) in profile={args.profile_id or '?'} "
        f"(user={args.user_id}); {len(victims)} are CHARGED (credit_transactions debit) "
        f"-> charged-but-reverted victims:"
    )
    for gid, name, blake3, created in victims:
        print(f"  [VICTIM] id={gid} name={name!r} hash={(blake3 or '')[:12]} created_at={created}")
    for gid, name, blake3, created in pending:
        if str(gid) not in charged:
            print(f"  [uncharged-pending] id={gid} name={name!r} created_at={created}")

    print(
        "\nREAD-ONLY report. Repair is a separate decision per victim: either re-drive "
        "activate (idempotent; self-heals refs + re-flips to ready, now durably) by "
        "having the user reopen the game, or manually flip status='ready' in the R2 "
        "profile.sqlite. Do NOT auto-repair from this script."
    )


if __name__ == "__main__":
    main()
