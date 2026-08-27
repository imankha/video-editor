"""
cleanup_orphan_raw_clips.py — Opt-in orphan raw_clips/ extract reporter + cleaner.

An "orphan" is an R2 object under a profile's `raw_clips/` prefix whose basename is
NOT referenced by any current DB pointer into that prefix. Two columns point into
`raw_clips/` and BOTH must be treated as live references (see _referenced_filenames):
  - `raw_clips.filename`            — annotated-clip extracts + T4175 sweep extracts
                                       + direct no-game uploads (routers/clips.py).
  - `working_clips.uploaded_filename` — user-uploaded multi-clip source clips. The
                                       live export path downloads these from
                                       `raw_clips/{uploaded_filename}`
                                       (routers/export/multi_clip.py, and the
                                       source-availability probe in
                                       services/export_helpers.py). Omitting this
                                       column would misclassify every uploaded clip
                                       as an orphan and DELETE live user footage
                                       under --apply (T7830 review finding).

Why orphans exist (T7600): the expiry sweep's `_export_brilliant_clip` used to mint a
FRESH random filename, upload a new object, and overwrite `raw_clips.filename` on
every re-run. Because the whole game is retried (up to MAX_AUTO_EXPORT_ATTEMPTS)
whenever a LATER stage fails (recap crash after the brilliant-clip loop), the same
clip could be exported 2-3 times — each wave orphaning the prior upload (never
deleted, un-referenced once the DB pointer moved). Prod saw 3 waves = 3x storage.
T7600 fixed the source (exists-check before re-export); this script reports/cleans
the ALREADY-orphaned objects that the bug left behind.

SWEEP-SIGNATURE GATE (data-safety, T7830): only unreferenced objects whose basename
matches the sweep writer's `auto_` naming (`auto_{game}_{clip}_{hex}.mp4`) are treated
as DELETION candidates. Any OTHER unreferenced object (a `{uuid}.mp4` shape) is
reported in a separate "unreferenced (non-sweep)" section for human review and is
NEVER deleted by --apply — so a reference-set gap can never silently delete a
user upload. This keeps the reclaim scope exactly the T7600 mess the task targets.

SAFETY (mirrors scripts/cleanup_orphan_profiles.py):
- Dry-run by default. Pass --apply to actually delete.
- --apply deletes ONLY sweep-signature (`auto_`) orphans, and is confirmation-gated.
- Per CLAUDE.md Data Safety Rules, the AI never runs --apply against prod; a human
  runs it with explicit sign-off after reviewing the dry-run report.

Usage:
    python scripts/cleanup_orphan_raw_clips.py [--env dev|staging|prod] [--apply]
                                               [--user <user_id>]
                                               [--report qa/orphan-audit-report.txt]

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
    size = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.1f}{unit}" if unit != "B" else f"{int(size)}B"
        size /= 1024
    return f"{size:.1f}TB"


# --- Pure classification helpers (unit-tested, no DB/R2) --------------------

def is_sweep_orphan_name(basename: str) -> bool:
    """True if `basename` matches the expiry-sweep writer's naming signature.

    The sweep uploads `auto_{game_id}_{clip_id}_{hex8}.mp4` (auto_export.py). Only
    these are deletion candidates — user uploads are `{uuid_hex}{ext}` and must
    never be swept even if a reference-set gap left them unreferenced.
    """
    return basename.startswith("auto_")


def classify_objects(
    referenced: set[str], objects: list[tuple[str, int]]
) -> tuple[list[tuple[str, int]], list[tuple[str, int]]]:
    """Split raw_clips/ objects into (sweep_orphans, other_unreferenced).

    `objects` is a list of (relative_path, size) where relative_path is
    'raw_clips/<basename>'. An object is unreferenced when its basename is not in
    `referenced`. Unreferenced objects further split by the sweep signature:
      - sweep_orphans     — `auto_` prefixed → DELETION candidates.
      - other_unreferenced — everything else → REPORT ONLY, never deleted.
    Referenced objects are dropped from both lists.
    """
    sweep_orphans: list[tuple[str, int]] = []
    other: list[tuple[str, int]] = []
    for rel_path, size in objects:
        basename = rel_path.split("/", 1)[1] if "/" in rel_path else rel_path
        if basename in referenced:
            continue
        if is_sweep_orphan_name(basename):
            sweep_orphans.append((rel_path, size))
        else:
            other.append((rel_path, size))
    return sweep_orphans, other


# --- DB / R2 access ---------------------------------------------------------

def _referenced_filenames() -> set[str]:
    """Every basename under raw_clips/ that a live DB pointer references, in the
    active profile context. Unions BOTH columns that name raw_clips/ objects:
      - raw_clips.filename
      - working_clips.uploaded_filename (ALL versions — an older working_clips
        version's source object is still load-bearing and must never be swept).
    NULL/empty excluded. Missing table (fresh/empty profile DB) tolerated."""
    from app.database import get_db_connection
    referenced: set[str] = set()
    with get_db_connection() as conn:
        tables = {
            r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "raw_clips" in tables:
            for r in conn.execute(
                "SELECT filename FROM raw_clips "
                "WHERE filename IS NOT NULL AND filename != ''"
            ).fetchall():
                referenced.add(r["filename"])
        if "working_clips" in tables:
            for r in conn.execute(
                "SELECT uploaded_filename FROM working_clips "
                "WHERE uploaded_filename IS NOT NULL AND uploaded_filename != ''"
            ).fetchall():
                referenced.add(r["uploaded_filename"])
    return referenced


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


def _scan_profile(user_id: str) -> tuple[list[tuple[str, int]], list[tuple[str, int]]]:
    """(sweep_orphans, other_unreferenced) for the active profile context."""
    referenced = _referenced_filenames()
    return classify_objects(referenced, _list_raw_clip_objects(user_id))


def main():
    parser = argparse.ArgumentParser(
        description="Report/clean orphan raw_clips/ extracts (dry-run by default)."
    )
    parser.add_argument("--env", default=os.getenv("APP_ENV", "dev"),
                        choices=["dev", "staging", "prod"],
                        help="App environment prefix in R2 (default: APP_ENV or 'dev')")
    parser.add_argument("--apply", action="store_true",
                        help="Actually delete sweep-signature orphans (default is dry-run)")
    parser.add_argument("--user", default=None,
                        help="Limit to a single user_id (default: all users)")
    parser.add_argument("--report", default=None,
                        help="Also write the full report to this file path")
    args = parser.parse_args()

    _load_env()
    os.environ["APP_ENV"] = args.env

    from app.database import ensure_database
    from app.migrations import _get_profile_ids
    from app.profile_context import set_current_profile_id
    from app.services.auth_db import get_all_users_for_admin
    from app.storage import R2_BUCKET, delete_from_r2, get_r2_client
    from app.user_context import set_current_user_id

    lines: list[str] = []

    def out(msg: str = "") -> None:
        print(msg)
        lines.append(msg)

    out(f"[cleanup_orphan_raw_clips] env={args.env} bucket={R2_BUCKET} "
        f"dry_run={not args.apply}")

    # Fail loudly rather than silently reporting "no orphans" when R2 is
    # unreachable (no creds) — a false all-clear could mask a real backlog.
    if get_r2_client() is None:
        out("ERROR: no R2 client (missing R2_* credentials for this env). "
            "Cannot list objects — aborting. Run from an env with prod R2 creds.")
        if args.report:
            Path(args.report).parent.mkdir(parents=True, exist_ok=True)
            Path(args.report).write_text("\n".join(lines) + "\n")
        sys.exit(2)

    out("")

    if args.user:
        user_ids = [args.user]
    else:
        user_ids = [u["user_id"] for u in get_all_users_for_admin()]

    # (user_id, profile_id, rel_path, size)
    sweep_orphans: list[tuple[str, str, str, int]] = []
    other_unref: list[tuple[str, str, str, int]] = []
    for user_id in user_ids:
        for profile_id in _get_profile_ids(user_id):
            set_current_user_id(user_id)
            set_current_profile_id(profile_id)
            try:
                ensure_database()
                sweep, other = _scan_profile(user_id)
            except Exception as e:
                out(f"  WARN: scan failed for {user_id[:8]}/{profile_id}: {e}")
                continue
            for rel_path, size in sweep:
                sweep_orphans.append((user_id, profile_id, rel_path, size))
            for rel_path, size in other:
                other_unref.append((user_id, profile_id, rel_path, size))

    # --- Report: sweep orphans (deletion candidates), grouped per profile ---
    total_bytes = sum(o[3] for o in sweep_orphans)
    if not sweep_orphans:
        out("No sweep-signature (auto_) orphan raw_clips/ objects found.")
    else:
        out(f"Sweep orphans (auto_): {len(sweep_orphans)} object(s), "
            f"{_fmt_bytes(total_bytes)} reclaimable.\n")
        per_profile: dict[tuple[str, str], list[tuple[str, int]]] = {}
        for user_id, profile_id, rel_path, size in sweep_orphans:
            per_profile.setdefault((user_id, profile_id), []).append((rel_path, size))
        for (user_id, profile_id), items in per_profile.items():
            pbytes = sum(s for _, s in items)
            out(f"  {user_id[:8]}.../{profile_id}  "
                f"{len(items)} object(s), {_fmt_bytes(pbytes)}:")
            for rel_path, size in items:
                out(f"      {rel_path}  ({_fmt_bytes(size)})")
        out(f"\n  TOTAL across {len(per_profile)} profile(s): "
            f"{len(sweep_orphans)} object(s), {_fmt_bytes(total_bytes)} reclaimable.")

    # --- Report-only: unreferenced non-sweep objects (NEVER deleted here) ---
    if other_unref:
        obytes = sum(o[3] for o in other_unref)
        out(f"\nUnreferenced NON-sweep objects (REVIEW ONLY — not deleted by "
            f"--apply): {len(other_unref)} object(s), {_fmt_bytes(obytes)}.")
        out("  These do not match the sweep's auto_ signature. Investigate before "
            "any manual deletion — they may be live uploads with a reference this "
            "audit does not model.")
        for user_id, profile_id, rel_path, size in other_unref:
            out(f"  {user_id[:8]}.../{profile_id}  {rel_path}  ({_fmt_bytes(size)})")

    if args.report:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        Path(args.report).write_text("\n".join(lines) + "\n")
        print(f"\nReport written to {args.report}")

    if not sweep_orphans:
        return

    if not args.apply:
        out(f"\nDry-run: {len(sweep_orphans)} sweep object(s) "
            f"({_fmt_bytes(total_bytes)}) would be deleted.")
        out("Re-run with --apply to delete (a human, with explicit sign-off).")
        return

    answer = input(
        f"\nAbout to DELETE {len(sweep_orphans)} sweep object(s) "
        f"({_fmt_bytes(total_bytes)}). Type 'yes' to proceed: "
    )
    if answer.strip().lower() != "yes":
        print("Aborted.")
        return

    deleted = 0
    for user_id, profile_id, rel_path, _size in sweep_orphans:
        set_current_user_id(user_id)
        set_current_profile_id(profile_id)
        if delete_from_r2(user_id, rel_path):
            print(f"  DELETE {user_id[:8]}.../{profile_id}  {rel_path}")
            deleted += 1
        else:
            print(f"  FAILED {user_id[:8]}.../{profile_id}  {rel_path}")

    print(f"\nDeleted {deleted}/{len(sweep_orphans)} sweep orphan object(s).")


if __name__ == "__main__":
    main()
