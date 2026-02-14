#!/usr/bin/env python3
"""
T80: Migrate games to global deduplicated storage.

This script migrates existing games from per-user storage to global
deduplicated storage. Only user "a" games are migrated; other test
users are deleted.

Storage structure change:
  Before: {user_id}/games/{filename}.mp4
  After:  games/{blake3_hash}.mp4  (global, deduplicated)

The script:
1. Downloads each game video from user "a"'s storage
2. Computes BLAKE3 hash
3. Uploads to global games/ prefix with ref_count metadata
4. Updates user_games table
5. Deletes original per-user game files
6. Optionally deletes other test users

Usage:
    cd src/backend
    .venv/Scripts/python.exe ../../scripts/migrate_games.py [--dry-run] [--delete-test-users]

Options:
    --dry-run           Show what would be done without making changes
    --delete-test-users Delete all users except "a" from R2
    --keep-originals    Don't delete original per-user game files
"""

import os
import sys
import argparse
import hashlib
import tempfile
import sqlite3
import json
from pathlib import Path
from datetime import datetime

# Add backend to path for imports
backend_path = Path(__file__).parent.parent / "src" / "backend"
sys.path.insert(0, str(backend_path))

# Load environment variables
from dotenv import load_dotenv
project_root = Path(__file__).parent.parent
env_file = project_root / ".env"
if env_file.exists():
    load_dotenv(env_file)

# Now import app modules
from app.storage import (
    R2_ENABLED,
    R2_BUCKET,
    get_r2_client,
    r2_key,
    download_from_r2,
    r2_head_object_global,
    r2_set_object_metadata_global,
    delete_from_r2,
)


def compute_blake3_hash(file_path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    """Compute BLAKE3 hash of a file."""
    try:
        from blake3 import blake3
        hasher = blake3()
    except ImportError:
        # Fallback to hashlib if blake3 not available
        # Note: hashlib doesn't have blake3, so we use sha256 as fallback
        print("WARNING: blake3 module not found, using sha256 (install blake3 for proper hashing)")
        hasher = hashlib.sha256()

    with open(file_path, 'rb') as f:
        while chunk := f.read(chunk_size):
            hasher.update(chunk)

    return hasher.hexdigest()


def get_user_database(user_id: str) -> Path:
    """Get path to user's database file."""
    user_data_base = project_root / "user_data" / user_id
    return user_data_base / "database.sqlite"


def download_user_database(user_id: str, local_path: Path) -> bool:
    """Download user's database from R2."""
    client = get_r2_client()
    if not client:
        return False

    key = r2_key(user_id, "database.sqlite")
    try:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        client.download_file(R2_BUCKET, key, str(local_path))
        return True
    except Exception as e:
        print(f"  Failed to download database: {e}")
        return False


def upload_to_global_storage(
    local_path: Path,
    blake3_hash: str,
    metadata: dict,
    dry_run: bool = False
) -> bool:
    """Upload a game video to global storage with metadata."""
    client = get_r2_client()
    if not client:
        return False

    global_key = f"games/{blake3_hash}.mp4"

    if dry_run:
        print(f"  [DRY RUN] Would upload to {global_key}")
        return True

    try:
        # Check if already exists
        existing = r2_head_object_global(global_key)
        if existing:
            # Increment ref_count instead of re-uploading
            existing_meta = existing.get('Metadata', {})
            ref_count = int(existing_meta.get('ref_count', '1'))
            existing_meta['ref_count'] = str(ref_count + 1)
            r2_set_object_metadata_global(global_key, existing_meta)
            print(f"  Game already exists globally, incremented ref_count to {ref_count + 1}")
            return True

        # Upload with metadata
        client.upload_file(
            str(local_path),
            R2_BUCKET,
            global_key,
            ExtraArgs={
                'ContentType': 'video/mp4',
                'Metadata': {k: str(v) for k, v in metadata.items()}
            }
        )
        print(f"  Uploaded to global storage: {global_key}")
        return True
    except Exception as e:
        print(f"  Failed to upload: {e}")
        return False


def list_r2_prefixes(prefix: str = "") -> list:
    """List top-level prefixes (user IDs) in R2 bucket."""
    client = get_r2_client()
    if not client:
        return []

    try:
        # List with delimiter to get "folders"
        response = client.list_objects_v2(
            Bucket=R2_BUCKET,
            Prefix=prefix,
            Delimiter='/'
        )

        prefixes = []
        for cp in response.get('CommonPrefixes', []):
            prefix_name = cp.get('Prefix', '').rstrip('/')
            if prefix_name and prefix_name != 'games':  # Exclude global games folder
                prefixes.append(prefix_name)

        return prefixes
    except Exception as e:
        print(f"Failed to list R2 prefixes: {e}")
        return []


def delete_r2_prefix(prefix: str, dry_run: bool = False) -> int:
    """Delete all objects under a prefix in R2."""
    client = get_r2_client()
    if not client:
        return 0

    deleted_count = 0
    try:
        # List all objects under prefix
        paginator = client.get_paginator('list_objects_v2')

        for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=prefix):
            objects = page.get('Contents', [])
            if not objects:
                continue

            if dry_run:
                for obj in objects:
                    print(f"  [DRY RUN] Would delete: {obj['Key']}")
                deleted_count += len(objects)
            else:
                # Delete in batches of 1000
                delete_objects = [{'Key': obj['Key']} for obj in objects]
                client.delete_objects(
                    Bucket=R2_BUCKET,
                    Delete={'Objects': delete_objects}
                )
                deleted_count += len(objects)
                print(f"  Deleted {len(objects)} objects from {prefix}")

        return deleted_count
    except Exception as e:
        print(f"Failed to delete prefix {prefix}: {e}")
        return deleted_count


def migrate_user_games(user_id: str, dry_run: bool = False, keep_originals: bool = False) -> dict:
    """Migrate games for a single user to global storage."""
    print(f"\n{'='*60}")
    print(f"Migrating games for user: {user_id}")
    print('='*60)

    stats = {
        'games_found': 0,
        'games_migrated': 0,
        'games_skipped': 0,
        'errors': 0
    }

    # Create temp directory for downloads
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Download user's database
        db_path = temp_path / "database.sqlite"
        print(f"Downloading database for user {user_id}...")

        if not download_user_database(user_id, db_path):
            print(f"  Could not download database, checking local...")
            local_db = get_user_database(user_id)
            if local_db.exists():
                import shutil
                shutil.copy(local_db, db_path)
            else:
                print(f"  No database found for user {user_id}")
                return stats

        # Connect to database
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # Check if games table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='games'")
        if not cursor.fetchone():
            print(f"  No games table found")
            conn.close()
            return stats

        # Check if user_games table exists, create if not
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_games'")
        if not cursor.fetchone():
            print("  Creating user_games table...")
            if not dry_run:
                cursor.execute("""
                    CREATE TABLE user_games (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        blake3_hash TEXT NOT NULL UNIQUE,
                        original_filename TEXT NOT NULL,
                        display_name TEXT,
                        file_size INTEGER NOT NULL,
                        duration REAL,
                        width INTEGER,
                        height INTEGER,
                        fps REAL,
                        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                """)

        # Get all games
        cursor.execute("""
            SELECT id, name, video_filename, video_duration, video_width,
                   video_height, video_size, created_at
            FROM games
            WHERE video_filename IS NOT NULL
        """)
        games = cursor.fetchall()
        stats['games_found'] = len(games)

        print(f"Found {len(games)} games to migrate")

        for game in games:
            game_id = game['id']
            video_filename = game['video_filename']
            print(f"\n  Processing game {game_id}: {video_filename}")

            if not video_filename:
                print(f"    Skipping - no video file")
                stats['games_skipped'] += 1
                continue

            # Download video from user's storage
            video_local_path = temp_path / video_filename
            print(f"    Downloading video...")

            if not download_from_r2(user_id, f"games/{video_filename}", video_local_path):
                print(f"    Failed to download video, skipping")
                stats['errors'] += 1
                continue

            # Compute BLAKE3 hash
            print(f"    Computing BLAKE3 hash...")
            blake3_hash = compute_blake3_hash(video_local_path)
            print(f"    Hash: {blake3_hash[:16]}...")

            # Get file size
            file_size = video_local_path.stat().st_size

            # Prepare metadata
            metadata = {
                'ref_count': '1',
                'original_filename': video_filename,
                'created_at': datetime.utcnow().isoformat() + 'Z'
            }
            if game['video_duration']:
                metadata['duration'] = str(game['video_duration'])
            if game['video_width']:
                metadata['width'] = str(game['video_width'])
            if game['video_height']:
                metadata['height'] = str(game['video_height'])

            # Upload to global storage
            print(f"    Uploading to global storage...")
            if not upload_to_global_storage(video_local_path, blake3_hash, metadata, dry_run):
                stats['errors'] += 1
                continue

            # Insert into user_games table
            if not dry_run:
                try:
                    cursor.execute("""
                        INSERT OR IGNORE INTO user_games
                        (blake3_hash, original_filename, display_name, file_size,
                         duration, width, height, added_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        blake3_hash,
                        video_filename,
                        game['name'],
                        file_size,
                        game['video_duration'],
                        game['video_width'],
                        game['video_height'],
                        game['created_at']
                    ))
                    print(f"    Added to user_games table")
                except Exception as e:
                    print(f"    Failed to insert into user_games: {e}")
                    stats['errors'] += 1
                    continue
            else:
                print(f"    [DRY RUN] Would insert into user_games")

            # Delete original per-user file
            if not keep_originals and not dry_run:
                if delete_from_r2(user_id, f"games/{video_filename}"):
                    print(f"    Deleted original from per-user storage")
                else:
                    print(f"    Warning: Could not delete original")
            elif not keep_originals:
                print(f"    [DRY RUN] Would delete original from per-user storage")

            # Clean up local temp file
            video_local_path.unlink()

            stats['games_migrated'] += 1
            print(f"    Migration complete!")

        # Commit database changes
        if not dry_run:
            conn.commit()

            # Upload updated database back to R2
            print(f"\n  Uploading updated database...")
            client = get_r2_client()
            if client:
                try:
                    client.upload_file(
                        str(db_path),
                        R2_BUCKET,
                        r2_key(user_id, "database.sqlite")
                    )
                    print(f"  Database uploaded successfully")
                except Exception as e:
                    print(f"  Warning: Failed to upload database: {e}")

        conn.close()

    return stats


def delete_test_users(keep_user: str = "a", dry_run: bool = False) -> dict:
    """Delete all test users except the specified one."""
    print(f"\n{'='*60}")
    print(f"Deleting test users (keeping: {keep_user})")
    print('='*60)

    stats = {
        'users_found': 0,
        'users_deleted': 0,
        'objects_deleted': 0
    }

    # List all user prefixes
    prefixes = list_r2_prefixes()
    stats['users_found'] = len(prefixes)

    print(f"Found {len(prefixes)} user prefixes: {prefixes}")

    for prefix in prefixes:
        if prefix == keep_user:
            print(f"\n  Keeping user: {prefix}")
            continue

        if prefix == 'games':
            print(f"\n  Skipping global games folder")
            continue

        print(f"\n  Deleting user: {prefix}")
        deleted = delete_r2_prefix(f"{prefix}/", dry_run)
        stats['objects_deleted'] += deleted
        stats['users_deleted'] += 1

    return stats


def main():
    parser = argparse.ArgumentParser(
        description="Migrate games to global deduplicated storage"
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help="Show what would be done without making changes"
    )
    parser.add_argument(
        '--delete-test-users',
        action='store_true',
        help="Delete all users except 'a' from R2"
    )
    parser.add_argument(
        '--keep-originals',
        action='store_true',
        help="Don't delete original per-user game files"
    )
    parser.add_argument(
        '--user',
        default='a',
        help="User ID to migrate (default: 'a')"
    )

    args = parser.parse_args()

    print("="*60)
    print("T80: Game Migration Script")
    print("="*60)

    if not R2_ENABLED:
        print("\nERROR: R2 is not enabled. Set R2_ENABLED=true in .env")
        sys.exit(1)

    print(f"\nR2 Bucket: {R2_BUCKET}")
    print(f"Dry run: {args.dry_run}")
    print(f"Keep originals: {args.keep_originals}")
    print(f"Delete test users: {args.delete_test_users}")

    # Install blake3 if needed
    try:
        import blake3
        print(f"Using blake3 module for hashing")
    except ImportError:
        print("\nWARNING: blake3 module not installed.")
        print("Install with: pip install blake3")
        print("Falling back to sha256 (NOT compatible with frontend BLAKE3)")
        response = input("Continue anyway? [y/N] ")
        if response.lower() != 'y':
            sys.exit(1)

    # Migrate user's games
    migrate_stats = migrate_user_games(
        args.user,
        dry_run=args.dry_run,
        keep_originals=args.keep_originals
    )

    # Delete test users if requested
    delete_stats = {'users_deleted': 0, 'objects_deleted': 0}
    if args.delete_test_users:
        delete_stats = delete_test_users(keep_user=args.user, dry_run=args.dry_run)

    # Print summary
    print(f"\n{'='*60}")
    print("MIGRATION SUMMARY")
    print('='*60)
    print(f"Games found:     {migrate_stats['games_found']}")
    print(f"Games migrated:  {migrate_stats['games_migrated']}")
    print(f"Games skipped:   {migrate_stats['games_skipped']}")
    print(f"Errors:          {migrate_stats['errors']}")

    if args.delete_test_users:
        print(f"\nUsers deleted:   {delete_stats['users_deleted']}")
        print(f"Objects deleted: {delete_stats['objects_deleted']}")

    if args.dry_run:
        print("\n[DRY RUN] No changes were made.")

    print()


if __name__ == "__main__":
    main()
