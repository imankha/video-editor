"""
T85a: Migrate user data from flat layout to profiles layout.

Before: user_data/{user_id}/database.sqlite, raw_clips/, working_videos/, ...
After:  user_data/{user_id}/profiles/{profile_id}/database.sqlite, raw_clips/, ...

Handles both local filesystem AND R2 object migration.

Usage:
    cd src/backend
    .venv/Scripts/python.exe ../../scripts/migrate_r2_structure.py

    # Dry run (default):
    .venv/Scripts/python.exe ../../scripts/migrate_r2_structure.py

    # Actually move files:
    .venv/Scripts/python.exe ../../scripts/migrate_r2_structure.py --execute
"""

import argparse
import shutil
from pathlib import Path
from uuid import uuid4

# Load .env from project root (same as main.py)
from dotenv import load_dotenv
_env_file = Path(__file__).parent.parent / ".env"
if _env_file.exists():
    load_dotenv(_env_file)

# Directories/files that belong inside a profile
PROFILE_ITEMS = {
    "database.sqlite",
    "database.db",
    "video_editor.db",
    "raw_clips",
    "working_videos",
    "final_videos",
    "downloads",
    "games",
    "highlights",
    "clip_cache",
    "uploads",
}

# Items that stay at user level (not profile-scoped)
USER_LEVEL_ITEMS = {
    "profiles",  # The profiles directory itself
}

USER_DATA_BASE = Path(__file__).parent.parent / "user_data"


def migrate_user(user_id: str, profile_id: str, execute: bool = False):
    """Migrate a single user's data into a profile directory."""
    user_dir = USER_DATA_BASE / user_id
    if not user_dir.exists():
        print(f"  [SKIP] User directory does not exist: {user_dir}")
        return

    profile_dir = user_dir / "profiles" / profile_id

    # Check if there's anything to migrate at the top level
    top_level_data = [item for item in user_dir.iterdir()
                      if item.name in PROFILE_ITEMS]
    if not top_level_data:
        print(f"  [SKIP] No top-level data to migrate (already done or empty)")
        return

    # If profile dir already has a database (e.g., from user_session_init),
    # remove it — the real data at top level takes precedence
    stale_db = profile_dir / "database.sqlite"
    if stale_db.exists():
        if execute:
            print(f"  [REPLACE] Removing empty database created by init: {stale_db}")
            stale_db.unlink()
        else:
            print(f"  [DRY RUN] Would remove empty init database: {stale_db}")

    # Ensure profile directory exists
    if execute:
        profile_dir.mkdir(parents=True, exist_ok=True)
    else:
        print(f"  [DRY RUN] Would create: {profile_dir}")

    items_to_move = []
    for item in user_dir.iterdir():
        if item.name in USER_LEVEL_ITEMS:
            print(f"  [KEEP] {item.name} (user-level)")
            continue
        if item.name in PROFILE_ITEMS:
            items_to_move.append(item)
        else:
            print(f"  [WARN] Unknown item: {item.name} — will move to profile")
            items_to_move.append(item)

    for item in items_to_move:
        dest = profile_dir / item.name
        if execute:
            print(f"  [MOVE] {item.name} -> profiles/{profile_id}/{item.name}")
            shutil.move(str(item), str(dest))
        else:
            print(f"  [DRY RUN] Would move: {item.name} -> profiles/{profile_id}/{item.name}")

    print(f"  {'Migrated' if execute else 'Would migrate'} {len(items_to_move)} items")

    # Upload selected-profile.json to R2 so /api/auth/init finds it
    if items_to_move:
        try:
            import sys
            sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "backend"))
            from app.storage import R2_ENABLED, upload_profiles_json, upload_selected_profile_json
            if R2_ENABLED:
                if execute:
                    upload_profiles_json(user_id, profile_id)
                    upload_selected_profile_json(user_id, profile_id)
                    print(f"  [R2] Uploaded profiles.json and selected-profile.json")
                else:
                    print(f"  [DRY RUN] Would upload profiles.json and selected-profile.json to R2")
            else:
                print(f"  [R2] R2 disabled, skipping profile upload")
        except ImportError:
            print(f"  [WARN] Could not import storage module — run from src/backend to upload to R2")


def migrate_r2_objects(user_id: str, profile_id: str, execute: bool = False):
    """Copy R2 objects from old flat paths to new profile-scoped paths.

    Old format: {user_id}/final_videos/{filename}
    New format: {APP_ENV}/users/{user_id}/profiles/{profile_id}/final_videos/{filename}
    """
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent / "src" / "backend"))
    from app.storage import R2_ENABLED, R2_BUCKET, APP_ENV, get_r2_client

    if not R2_ENABLED:
        print("  [R2] R2 disabled, skipping R2 object migration")
        return

    client = get_r2_client()
    if not client:
        print("  [R2] No R2 client available")
        return

    old_prefix = f"{user_id}/"
    new_prefix = f"{APP_ENV}/users/{user_id}/profiles/{profile_id}/"

    # List all objects under old prefix
    paginator = client.get_paginator("list_objects_v2")
    copied = 0
    skipped = 0

    print(f"  [R2] Scanning old prefix: {old_prefix}")
    for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=old_prefix):
        for obj in page.get("Contents", []):
            old_key = obj["Key"]
            # Strip user_id prefix, get relative path (e.g., "final_videos/abc.mp4")
            relative = old_key[len(old_prefix):]
            new_key = f"{new_prefix}{relative}"

            if execute:
                try:
                    client.copy_object(
                        Bucket=R2_BUCKET,
                        CopySource={"Bucket": R2_BUCKET, "Key": old_key},
                        Key=new_key,
                    )
                    copied += 1
                    print(f"  [R2 COPY] {old_key} -> {new_key}", flush=True)
                except Exception as e:
                    print(f"  [R2 ERROR] Failed to copy {old_key}: {e}", flush=True)
            else:
                print(f"  [R2 DRY RUN] Would copy: {old_key} -> {new_key}")
                copied += 1

    if skipped:
        print(f"  [R2] Skipped {skipped} objects (already exist at new path)")
    print(f"  [R2] {'Copied' if execute else 'Would copy'} {copied} objects")


def main():
    parser = argparse.ArgumentParser(description="Migrate user data to profiles layout (T85a)")
    parser.add_argument("--execute", action="store_true",
                        help="Actually move files (default is dry run)")
    parser.add_argument("--user", default="a",
                        help="User ID to migrate (default: 'a')")
    parser.add_argument("--profile-id", default=None,
                        help="Profile ID to use (default: auto-detect from profiles/ or generate new)")
    args = parser.parse_args()

    print(f"T85a Migration: Flat -> Profiles Layout")
    print(f"{'=' * 50}")
    print(f"Mode: {'EXECUTE' if args.execute else 'DRY RUN (use --execute to apply)'}")
    print(f"User data base: {USER_DATA_BASE}")
    print()

    user_dir = USER_DATA_BASE / args.user
    if not user_dir.exists():
        print(f"User directory does not exist: {user_dir}")
        return

    # Determine profile ID
    profile_id = args.profile_id
    if not profile_id:
        # Check for existing profiles
        profiles_dir = user_dir / "profiles"
        if profiles_dir.exists():
            existing = [d.name for d in profiles_dir.iterdir()
                        if d.is_dir() and d.name != "testdefault"]
            if existing:
                profile_id = existing[0]
                print(f"Using existing profile: {profile_id}")
            else:
                profile_id = uuid4().hex[:8]
                print(f"Generated new profile ID: {profile_id}")
        else:
            profile_id = uuid4().hex[:8]
            print(f"Generated new profile ID: {profile_id}")

    print(f"Migrating user '{args.user}' -> profiles/{profile_id}/")
    print()

    migrate_user(args.user, profile_id, execute=args.execute)

    print()
    print("R2 Object Migration")
    print("-" * 30)
    migrate_r2_objects(args.user, profile_id, execute=args.execute)

    if not args.execute:
        print()
        print("This was a dry run. Run with --execute to actually move files.")


if __name__ == "__main__":
    main()
