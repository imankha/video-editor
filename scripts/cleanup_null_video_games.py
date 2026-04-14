"""
T1180: One-off cleanup for orphan `games` rows created by the old two-step
upload flow (create-row-then-upload). These rows have `video_filename=NULL`,
`blake3_hash=NULL`, and no `game_videos` entries — they reference nothing.

After T1180's backend validation, create_game rejects empty videos, so new
orphans cannot be created. This script deletes the existing ones.

Usage (from project root):
    cd src/backend && .venv/Scripts/python.exe ../../scripts/cleanup_null_video_games.py <db_path>

The script prints the orphan rows, prompts, then deletes. FKs cascade to
raw_clips / working_clips.
"""

import argparse
import sqlite3
import sys
from pathlib import Path


def find_orphans(conn):
    """Games with no blake3_hash, no video_filename, and no game_videos."""
    cur = conn.cursor()
    cur.execute("""
        SELECT g.id, g.name, g.created_at
        FROM games g
        LEFT JOIN (SELECT DISTINCT game_id FROM game_videos) gv
               ON gv.game_id = g.id
        WHERE (g.blake3_hash IS NULL OR g.blake3_hash = '')
          AND (g.video_filename IS NULL OR g.video_filename = '')
          AND gv.game_id IS NULL
        ORDER BY g.id
    """)
    return cur.fetchall()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("db_path", help="Path to profile sqlite DB")
    parser.add_argument("--yes", action="store_true", help="Skip confirmation")
    args = parser.parse_args()

    db_path = Path(args.db_path)
    if not db_path.exists():
        print(f"ERROR: {db_path} not found", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")

    orphans = find_orphans(conn)
    if not orphans:
        print("No orphan games found.")
        return

    print(f"Found {len(orphans)} orphan game row(s) in {db_path}:")
    for gid, name, created in orphans:
        print(f"  id={gid}  name={name!r}  created_at={created}")

    if not args.yes:
        ans = input("\nDelete these rows (and their cascaded children)? [y/N]: ")
        if ans.strip().lower() != "y":
            print("Aborted.")
            return

    cur = conn.cursor()
    ids = [g[0] for g in orphans]
    placeholders = ",".join("?" for _ in ids)
    cur.execute(f"DELETE FROM games WHERE id IN ({placeholders})", ids)
    conn.commit()
    print(f"Deleted {cur.rowcount} game row(s).")


if __name__ == "__main__":
    main()
