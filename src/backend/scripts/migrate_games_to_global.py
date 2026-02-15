#!/usr/bin/env python3
"""
Migration script: Move game videos from user-specific to global storage.

Old storage: {user_id}/games/{video_filename}
New storage: games/{blake3_hash}.mp4

This script:
1. Finds all games with video_filename but no blake3_hash
2. Downloads video from old R2 location
3. Computes BLAKE3 hash
4. Copies to global location (if not already there)
5. Updates database with blake3_hash

Run with: cd src/backend && .venv/Scripts/python.exe scripts/migrate_games_to_global.py
"""

import sys
import os
import tempfile
import hashlib
from pathlib import Path

# Add app to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import get_db_connection, USER_DATA_BASE
from app.user_context import set_current_user_id
from app.storage import (
    R2_ENABLED,
    get_r2_client,
    R2_BUCKET,
    r2_head_object_global,
    generate_presigned_url,
)

# Try to import blake3, fall back to hashlib if not available
try:
    import blake3
    USE_BLAKE3 = True
except ImportError:
    USE_BLAKE3 = False
    print("Warning: blake3 module not installed, using SHA256 instead")
    print("Install with: pip install blake3")


def compute_hash(file_path: Path) -> str:
    """Compute BLAKE3 (or SHA256 fallback) hash of a file."""
    if USE_BLAKE3:
        hasher = blake3.blake3()
    else:
        hasher = hashlib.sha256()

    with open(file_path, 'rb') as f:
        while chunk := f.read(8192 * 1024):  # 8MB chunks
            hasher.update(chunk)

    return hasher.hexdigest()


def download_from_r2(user_id: str, r2_key: str, local_path: Path) -> bool:
    """Download a file from R2 to local path."""
    client = get_r2_client()
    if not client:
        return False

    try:
        full_key = f"{user_id}/{r2_key}"
        client.download_file(R2_BUCKET, full_key, str(local_path))
        return True
    except Exception as e:
        print(f"  Error downloading {full_key}: {e}")
        return False


def upload_to_r2_global(local_path: Path, r2_key: str) -> bool:
    """Upload a file to global R2 location."""
    client = get_r2_client()
    if not client:
        return False

    try:
        client.upload_file(str(local_path), R2_BUCKET, r2_key)
        return True
    except Exception as e:
        print(f"  Error uploading to {r2_key}: {e}")
        return False


def migrate_user_games(user_id: str, dry_run: bool = True):
    """Migrate all games for a user to global storage."""
    print(f"\n{'=' * 60}")
    print(f"Migrating games for user: {user_id}")
    print(f"{'=' * 60}")

    set_current_user_id(user_id)

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Find games with video_filename but no blake3_hash
        cursor.execute("""
            SELECT id, name, video_filename, video_size
            FROM games
            WHERE video_filename IS NOT NULL
              AND video_filename != ''
              AND (blake3_hash IS NULL OR blake3_hash = '')
        """)
        games = cursor.fetchall()

        if not games:
            print("No games need migration.")
            return

        print(f"Found {len(games)} games to migrate:")
        for game in games:
            size_mb = (game['video_size'] or 0) / 1024 / 1024
            print(f"  - Game {game['id']}: {game['name']} ({size_mb:.1f} MB)")

        if dry_run:
            print("\n[DRY RUN] No changes made. Run with --execute to migrate.")
            return

        # Process each game
        migrated = 0
        failed = 0

        for game in games:
            game_id = game['id']
            video_filename = game['video_filename']

            print(f"\nMigrating game {game_id}: {game['name']}")
            print(f"  Old location: {user_id}/games/{video_filename}")

            # Download to temp file
            with tempfile.NamedTemporaryFile(delete=False, suffix='.mp4') as tmp:
                tmp_path = Path(tmp.name)

            try:
                # Download from old location
                print(f"  Downloading...")
                if not download_from_r2(user_id, f"games/{video_filename}", tmp_path):
                    print(f"  FAILED: Could not download from R2")
                    failed += 1
                    continue

                # Compute hash
                print(f"  Computing hash...")
                blake3_hash = compute_hash(tmp_path)
                print(f"  Hash: {blake3_hash}")

                # Check if already exists in global location
                global_key = f"games/{blake3_hash}.mp4"
                if r2_head_object_global(global_key):
                    print(f"  Already exists in global storage (dedup!)")
                else:
                    # Upload to global location
                    print(f"  Uploading to global storage...")
                    if not upload_to_r2_global(tmp_path, global_key):
                        print(f"  FAILED: Could not upload to global location")
                        failed += 1
                        continue

                # Update database
                cursor.execute(
                    "UPDATE games SET blake3_hash = ? WHERE id = ?",
                    (blake3_hash, game_id)
                )
                conn.commit()

                print(f"  SUCCESS: Migrated to games/{blake3_hash}.mp4")
                migrated += 1

            finally:
                # Clean up temp file
                if tmp_path.exists():
                    tmp_path.unlink()

        print(f"\n{'=' * 60}")
        print(f"Migration complete: {migrated} migrated, {failed} failed")
        print(f"{'=' * 60}")


def main():
    if not R2_ENABLED:
        print("ERROR: R2 is not enabled. Set R2 environment variables first.")
        print("Required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET")
        sys.exit(1)

    dry_run = "--execute" not in sys.argv

    if dry_run:
        print("=" * 60)
        print("DRY RUN MODE - No changes will be made")
        print("Run with --execute to actually migrate")
        print("=" * 60)

    # Find all users with databases
    for user_dir in USER_DATA_BASE.iterdir():
        if user_dir.is_dir() and (user_dir / "database.sqlite").exists():
            migrate_user_games(user_dir.name, dry_run=dry_run)


if __name__ == "__main__":
    main()
