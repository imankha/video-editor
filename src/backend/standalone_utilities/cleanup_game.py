#!/usr/bin/env python
"""Clean up all data for a given game ID (clips, projects, gallery videos).

Usage: python cleanup_game.py <game_id> [--sync-r2]
Example: python cleanup_game.py 13 --sync-r2

Options:
    --sync-r2    Also sync changes to R2 and delete clip files from cloud
    --dry-run    Show what would be deleted without actually deleting
"""

import sqlite3
import sys
import os
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    try:
        game_id = int(sys.argv[1])
    except ValueError:
        print(f"Error: game_id must be an integer, got '{sys.argv[1]}'")
        sys.exit(1)

    sync_r2 = '--sync-r2' in sys.argv
    dry_run = '--dry-run' in sys.argv

    # Setup paths
    script_dir = Path(__file__).parent
    project_root = script_dir.parent.parent
    db_path = project_root / 'user_data' / 'a' / 'database.sqlite'

    if not db_path.exists():
        print(f"Error: Database not found at {db_path}")
        sys.exit(1)

    # Load .env for R2 credentials if syncing
    if sync_r2:
        sys.path.insert(0, str(project_root / 'src' / 'backend'))
        from dotenv import load_dotenv
        env_path = project_root / 'src' / 'backend' / '.env'
        load_dotenv(env_path)

    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Check game exists
    cursor.execute('SELECT id, name FROM games WHERE id = ?', (game_id,))
    game = cursor.fetchone()
    if not game:
        print(f"Error: Game {game_id} not found")
        conn.close()
        sys.exit(1)

    print(f"{'[DRY RUN] ' if dry_run else ''}=== Cleaning up game {game_id}: {game['name']} ===\n")

    # Get clip IDs and their associated projects
    cursor.execute("SELECT id, filename, auto_project_id FROM raw_clips WHERE game_id = ?", (game_id,))
    clips = cursor.fetchall()
    clip_ids = [c['id'] for c in clips]
    project_ids = [c['auto_project_id'] for c in clips if c['auto_project_id']]
    filenames = [c['filename'] for c in clips if c['filename']]

    print(f"Found {len(clips)} clips")
    print(f"Found {len(project_ids)} auto-projects: {project_ids}")
    print(f"Found {len(filenames)} clip files\n")

    if dry_run:
        print("[DRY RUN] Would delete:")
        print(f"  - working_clips for projects {project_ids}")
        print(f"  - working_videos for projects {project_ids}")
        print(f"  - final_videos for game {game_id}")
        print(f"  - projects {project_ids}")
        print(f"  - {len(clips)} raw_clips")
        print(f"  - Reset game {game_id} counts")
        if sync_r2:
            print(f"  - {len(filenames)} files from R2")
        conn.close()
        return

    # Delete working_clips for these projects
    if project_ids:
        placeholders = ','.join('?' * len(project_ids))
        cursor.execute(f"DELETE FROM working_clips WHERE project_id IN ({placeholders})", project_ids)
        print(f"Deleted {cursor.rowcount} working_clips")

        cursor.execute(f"DELETE FROM working_videos WHERE project_id IN ({placeholders})", project_ids)
        print(f"Deleted {cursor.rowcount} working_videos")

        cursor.execute(f"DELETE FROM final_videos WHERE project_id IN ({placeholders})", project_ids)
        print(f"Deleted {cursor.rowcount} final_videos (project-linked)")

        cursor.execute(f"DELETE FROM projects WHERE id IN ({placeholders})", project_ids)
        print(f"Deleted {cursor.rowcount} projects")

    # Delete final_videos directly linked to game
    cursor.execute("DELETE FROM final_videos WHERE game_id = ?", (game_id,))
    print(f"Deleted {cursor.rowcount} final_videos (game-linked)")

    # Delete raw_clips
    cursor.execute("DELETE FROM raw_clips WHERE game_id = ?", (game_id,))
    print(f"Deleted {cursor.rowcount} raw_clips")

    # Reset game counts
    cursor.execute("""
        UPDATE games
        SET clip_count = 0, brilliant_count = 0, good_count = 0,
            interesting_count = 0, mistake_count = 0, blunder_count = 0
        WHERE id = ?
    """, (game_id,))
    print(f"Reset game {game_id} counts")

    conn.commit()
    print("\nLocal DB committed!")

    # Verify
    cursor.execute("SELECT COUNT(*) as cnt FROM raw_clips WHERE game_id = ?", (game_id,))
    print(f"Verification: {cursor.fetchone()['cnt']} clips remaining")
    conn.close()

    # Sync to R2 if requested
    if sync_r2:
        print("\n=== Syncing to R2 ===")
        try:
            from app.storage import R2_ENABLED, sync_database_to_r2, delete_from_r2

            if R2_ENABLED:
                # Sync database
                success = sync_database_to_r2('a', db_path)
                if success:
                    print("Database synced to R2!")
                else:
                    print("WARNING: Failed to sync database to R2")

                # Delete clip files from R2
                for filename in filenames:
                    r2_key = f"raw_clips/{filename}"
                    try:
                        delete_from_r2('a', r2_key)
                        print(f"  Deleted from R2: {r2_key}")
                    except Exception as e:
                        print(f"  Failed to delete {r2_key}: {e}")
            else:
                print("R2 not enabled, skipping cloud sync")
        except Exception as e:
            print(f"R2 sync error: {e}")
            import traceback
            traceback.print_exc()

    print("\n=== Done! ===")

if __name__ == '__main__':
    main()
