"""
cleanup_orphan_raw_clips.py — Opt-in orphan raw_clips/ extract reporter + cleaner.

An "orphan" is an R2 object under a profile's `raw_clips/` prefix whose basename is
NOT referenced by any current `raw_clips.filename` value in that profile's SQLite
(the canonical registry of which extract each clip points at).

Why they exist (T7600): the expiry sweep's `_export_brilliant_clip` used to mint a
FRESH random filename, upload a new object, and overwrite `raw_clips.filename` on
every re-run. Because the whole game is retried (up to MAX_AUTO_EXPORT_ATTEMPTS)
whenever a LATER stage fails (recap crash after the brilliant-clip loop), the same
clip could be exported 2-3 times — each wave orphaning the prior upload (never
deleted, un-referenced once the DB pointer moved). Prod saw 3 waves = 3x storage.
T7600 fixed the source (exists-check before re-export); this script reports/cleans
the ALREADY-orphaned objects that the bug left behind.

SAFETY (mirrors scripts/cleanup_orphan_profiles.py):
- Dry-run by default. Pass --apply to actually delete.
- Confirmation-gated: prints exactly what would be deleted + bytes reclaimed and
  prompts before --apply acts.
- Per CLAUDE.md Data Safety Rules, the AI never runs --apply against prod; a human
  runs it with explicit sign-off after reviewing the dry-run report.

Usage:
    python scripts/cleanup_orphan_raw_clips.py [--env dev|staging|prod] [--apply]
                                               [--user <user_id>]

Requirements:
    R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT_URL, R2_BUCKET in env
    (or src/backend/.env). Also needs DATABASE_URL (Postgres) for the user registry.
"""

import argparse
import os
import sys
from pathlib import Path

# Ensure the backend package is importable
sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "backend"))


def _load_env() -> None:
    env_file = Path(__file__).parent.parent / "src" / "backend" / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())


def _fmt_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f}{unit}" if unit != "B" else f"{n}B"
        n /= 1024
    return f"{n:.1f}TB"


def _referenced_filenames() -> set[str]:
    """Current raw_clips.filename values in the active profile context (canonical
    set of extracts still pointed at). NULL/empty excluded."""
    from app.database import get_db_connection
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT filename FROM raw_clips WHERE filename IS NOT NULL AND filename != ''"
        ).fetchall()
    return {r["filename"] for r in rows}


def _list_raw_clip_objects(user_id: str) -> list[tuple[str, int]]:
    """(relative_path, size) for every object under the active profile's raw_clips/
    prefix. relative_path is the 'raw_clips/<file>' key the app's helpers accept."""
    from app.storage import R2_BUCKET, get_r2_client, r2_key
    client = get_r2_client()
    if not client:
        return []
    full_prefix = r2_key(user_id, "raw_clips/")
    strip = full_prefix[: -len("raw_clips/")]  # env/users/<uid>/profiles/<pid>/
    out: list[tuple[str, int]] = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=full_prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("/"):
                continue  # skip folder markers
            out.append((key[len(strip):], obj.get("Size", 0)))
    return out


def _scan_profile(user_id: str) -> list[tuple[str, int]]:
    """Orphan (relative_path, size) list for the active profile context."""
    referenced = _referenced_filenames()
    orphans = []
    for rel_path, size in _list_raw_clip_objects(user_id):
        basename = rel_path.split("/", 1)[1] if "/" in rel_path else rel_path
        if basename not in referenced:
            orphans.append((rel_path, size))
    return orphans


def main():
    parser = argparse.ArgumentParser(
        description="Report/clean orphan raw_clips/ extracts (dry-run by default)."
    )
    parser.add_argument("--env", default=os.getenv("APP_ENV", "dev"),
                        choices=["dev", "staging", "prod"],
                        help="App environment prefix in R2 (default: APP_ENV or 'dev')")
    parser.add_argument("--apply", action="store_true",
                        help="Actually delete orphans (default is dry-run)")
    parser.add_argument("--user", default=None,
                        help="Limit to a single user_id (default: all users)")
    args = parser.parse_args()

    _load_env()
    os.environ["APP_ENV"] = args.env

    from app.database import ensure_database
    from app.migrations import _get_profile_ids
    from app.profile_context import set_current_profile_id
    from app.services.auth_db import get_all_users_for_admin
    from app.storage import R2_BUCKET, delete_from_r2
    from app.user_context import set_current_user_id

    print(f"[cleanup_orphan_raw_clips] env={args.env} bucket={R2_BUCKET} "
          f"dry_run={not args.apply}\n")

    if args.user:
        user_ids = [args.user]
    else:
        user_ids = [u["user_id"] for u in get_all_users_for_admin()]

    # (user_id, profile_id, rel_path, size)
    all_orphans: list[tuple[str, str, str, int]] = []
    for user_id in user_ids:
        for profile_id in _get_profile_ids(user_id):
            set_current_user_id(user_id)
            set_current_profile_id(profile_id)
            try:
                ensure_database()
                orphans = _scan_profile(user_id)
            except Exception as e:
                print(f"  WARN: scan failed for {user_id[:8]}/{profile_id}: {e}")
                continue
            for rel_path, size in orphans:
                all_orphans.append((user_id, profile_id, rel_path, size))

    if not all_orphans:
        print("No orphan raw_clips/ objects found.")
        return

    total_bytes = sum(o[3] for o in all_orphans)
    print(f"Found {len(all_orphans)} orphan object(s), "
          f"{_fmt_bytes(total_bytes)} reclaimable:\n")
    for user_id, profile_id, rel_path, size in all_orphans:
        print(f"  {user_id[:8]}.../{profile_id}  {rel_path}  ({_fmt_bytes(size)})")

    if not args.apply:
        print(f"\nDry-run: {len(all_orphans)} object(s) "
              f"({_fmt_bytes(total_bytes)}) would be deleted.")
        print("Re-run with --apply to delete (a human, with explicit sign-off).")
        return

    answer = input(
        f"\nAbout to DELETE {len(all_orphans)} object(s) "
        f"({_fmt_bytes(total_bytes)}). Type 'yes' to proceed: "
    )
    if answer.strip().lower() != "yes":
        print("Aborted.")
        return

    deleted = 0
    for user_id, profile_id, rel_path, _size in all_orphans:
        set_current_user_id(user_id)
        set_current_profile_id(profile_id)
        if delete_from_r2(user_id, rel_path):
            print(f"  DELETE {user_id[:8]}.../{profile_id}  {rel_path}")
            deleted += 1
        else:
            print(f"  FAILED {user_id[:8]}.../{profile_id}  {rel_path}")

    print(f"\nDeleted {deleted}/{len(all_orphans)} orphan object(s).")


if __name__ == "__main__":
    main()
