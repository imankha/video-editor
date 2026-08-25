"""
cleanup_orphan_profiles.py — Opt-in orphan R2 profile archiver.

An "orphan" is a profile.sqlite object in R2 whose profile ID is NOT present in
the user's user.sqlite profiles table (the canonical registry).  The migration
runner skips orphans and reports them in results["users"]["orphans"]; this script
takes the next step: archive (copy to orphans/ prefix) then delete the originals.

SAFETY:
- Dry-run by default.  Pass --apply to actually move objects.
- Archives: copies each orphan object to <env>/users/<uid>/orphans/<pid>/<file>
  BEFORE deleting the original.  Nothing is hard-deleted without a backup copy.
- Confirmation-gated: lists what would be archived and prompts before --apply acts.

Usage:
    python scripts/cleanup_orphan_profiles.py [--env dev|staging|prod] [--apply]

Requirements:
    R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT_URL, R2_BUCKET in env
    (or .env file).  Also needs DATABASE_URL (Postgres) to read the user registry.
"""

import argparse
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

# Ensure the backend package is importable
sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "backend"))

# Tables whose row counts are dumped per orphan as "verified empty" evidence
# before anything is deleted. Any table missing on a below-schema orphan is
# reported as "-" rather than crashing the run.
_EVIDENCE_TABLES = ("raw_clips", "projects", "final_videos", "games", "game_storage")

# prod's REAL R2 prefix is `production/` (APP_ENV=production on the prod machine),
# NOT `prod/`. Accept the friendly `prod` alias but resolve it to the real prefix
# so `--env prod` doesn't silently scan an empty `prod/` and report no orphans.
_ENV_PREFIX = {"prod": "production"}


def _require_env(var: str) -> str:
    val = os.getenv(var)
    if not val:
        print(f"ERROR: {var} is not set.", file=sys.stderr)
        sys.exit(1)
    return val


def _get_r2_client():
    import boto3
    return boto3.client(
        "s3",
        aws_access_key_id=_require_env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=_require_env("R2_SECRET_ACCESS_KEY"),
        endpoint_url=_require_env("R2_ENDPOINT_URL"),
    )


def _list_r2_profile_ids(client, bucket: str, app_env: str, user_id: str) -> list[str]:
    prefix = f"{app_env}/users/{user_id}/profiles/"
    response = client.list_objects_v2(Bucket=bucket, Prefix=prefix, Delimiter="/")
    ids = []
    for cp in response.get("CommonPrefixes", []):
        parts = cp["Prefix"].rstrip("/").split("/")
        ids.append(parts[-1])
    return ids


def _list_r2_objects_under(client, bucket: str, prefix: str) -> list[str]:
    keys = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
    return keys


def _get_registered_profile_ids(user_id: str) -> set[str]:
    from app.services.user_db import ensure_user_database, get_profiles
    ensure_user_database(user_id)
    return {p["id"] for p in get_profiles(user_id)}


def _get_all_user_ids() -> list[str]:
    from app.services.auth_db import get_all_users_for_admin
    return [u["user_id"] for u in get_all_users_for_admin()]


def _local_profile_dir(user_id: str, pid: str) -> Path:
    """On-machine local copy of a profile dir (mirrors the R2 prefix). Read from
    app.database so it resolves to the real user_data volume on the machine."""
    from app.database import USER_DATA_BASE
    return USER_DATA_BASE / user_id / "profiles" / pid


def _count_orphan_rows(client, bucket: str, src_prefix: str) -> dict[str, int | None]:
    """Download the orphan's profile.sqlite to a temp file and count rows in the
    evidence tables, so a delete is backed by "here's what was in it" numbers
    rather than a bare confirmation. Returns {table: count or None-if-missing}.
    None for the whole set if there's no profile.sqlite object to read."""
    key = src_prefix + "profile.sqlite"
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as fh:
            tmp = Path(fh.name)
        client.download_file(bucket, key, str(tmp))
        counts: dict[str, int | None] = {}
        conn = sqlite3.connect(str(tmp))
        try:
            for table in _EVIDENCE_TABLES:
                try:
                    counts[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                except sqlite3.OperationalError:
                    counts[table] = None  # table absent on a below-schema orphan
        finally:
            conn.close()
        return counts
    except Exception as e:
        print(f"    WARN: could not read profile.sqlite for evidence: {e}")
        return {}
    finally:
        if tmp and tmp.exists():
            tmp.unlink()


def _format_counts(counts: dict[str, int | None]) -> str:
    if not counts:
        return "(no profile.sqlite / unreadable)"
    return ", ".join(
        f"{t}={counts[t] if counts.get(t) is not None else '-'}" for t in _EVIDENCE_TABLES
    )


def main():
    parser = argparse.ArgumentParser(description="Archive orphan R2 profiles (dry-run by default).")
    parser.add_argument("--env", default=os.getenv("APP_ENV", "dev"),
                        choices=["dev", "staging", "prod", "production"],
                        help="App environment prefix in R2 (default: APP_ENV or 'dev'). "
                             "'prod' is an alias for the real 'production' prefix.")
    parser.add_argument("--apply", action="store_true",
                        help="Actually archive and delete (default is dry-run)")
    args = parser.parse_args()

    # Load env from .env if present
    env_file = Path(__file__).parent.parent / "src" / "backend" / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())

    bucket = _require_env("R2_BUCKET")
    # Resolve the friendly alias (prod -> production) to the real R2 prefix.
    app_env = _ENV_PREFIX.get(args.env, args.env)

    print(f"[cleanup_orphan_profiles] env={app_env} bucket={bucket} dry_run={not args.apply}\n")

    client = _get_r2_client()
    user_ids = _get_all_user_ids()

    all_orphans: list[tuple[str, str]] = []  # (user_id, profile_id)

    for user_id in user_ids:
        try:
            registered = _get_registered_profile_ids(user_id)
        except Exception as e:
            print(f"  WARN: could not read registry for {user_id}: {e}")
            continue

        r2_ids = _list_r2_profile_ids(client, bucket, app_env, user_id)
        for pid in r2_ids:
            if pid not in registered:
                all_orphans.append((user_id, pid))

    if not all_orphans:
        print("No orphans found.")
        return

    print(f"Found {len(all_orphans)} orphan profile(s):\n")
    # Per-orphan row-count evidence: what each "empty" orphan actually holds,
    # dumped BEFORE any delete so the operator decides on numbers, not a prompt.
    for user_id, pid in all_orphans:
        src_prefix = f"{app_env}/users/{user_id}/profiles/{pid}/"
        counts = _count_orphan_rows(client, bucket, src_prefix)
        local_dir = _local_profile_dir(user_id, pid)
        local_note = " [local copy present]" if local_dir.is_dir() else ""
        print(f"  {user_id[:8]}... / {pid}: {_format_counts(counts)}{local_note}")

    if not args.apply:
        print(f"\nDry-run: {len(all_orphans)} profile(s) would be archived + deleted (R2 + local).")
        print("Re-run with --apply to perform the archive+delete.")
        return

    # Confirmation gate
    answer = input(f"\nAbout to ARCHIVE + DELETE {len(all_orphans)} profile(s). Type 'yes' to proceed: ")
    if answer.strip().lower() != "yes":
        print("Aborted.")
        return

    archived = 0
    for user_id, pid in all_orphans:
        src_prefix = f"{app_env}/users/{user_id}/profiles/{pid}/"
        dst_prefix = f"{app_env}/users/{user_id}/orphans/{pid}/"
        keys = _list_r2_objects_under(client, bucket, src_prefix)

        # 1. Archive (copy to orphans/) BEFORE any delete — nothing is hard-
        #    deleted without a backup copy.
        for key in keys:
            dst_key = dst_prefix + key[len(src_prefix):]
            print(f"  COPY   {key}  ->  {dst_key}")
            client.copy_object(
                Bucket=bucket,
                CopySource={"Bucket": bucket, "Key": key},
                Key=dst_key,
            )

        # 2. Delete LOCAL first, then R2. Order matters: the local copy must die
        #    FIRST so that if the run crashes between the two deletes, no
        #    surviving local file is left for the shutdown/sweep path to
        #    re-upload — which would resurrect the R2 orphan (the self-sustaining
        #    loop). Deleting R2 first would leave exactly that window open.
        local_dir = _local_profile_dir(user_id, pid)
        if local_dir.is_dir():
            print(f"  DELETE (local) {local_dir}")
            shutil.rmtree(local_dir)

        for key in keys:
            print(f"  DELETE {key}")
            client.delete_object(Bucket=bucket, Key=key)

        # 3. Verify BOTH copies are gone before counting this orphan cleaned.
        remaining = _list_r2_objects_under(client, bucket, src_prefix)
        if remaining:
            print(f"  ERROR: {len(remaining)} R2 object(s) still under {src_prefix} after delete — NOT verified")
            continue
        if local_dir.exists():
            print(f"  ERROR: local dir {local_dir} still present after delete — NOT verified")
            continue
        archived += 1

    print(f"\nArchived + deleted {archived}/{len(all_orphans)} orphan profile(s) (verified R2 + local empty).")


if __name__ == "__main__":
    main()
