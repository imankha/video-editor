#!/usr/bin/env python
"""Check game database state for a given game ID.

Usage: python check_game.py <game_id>
Example: python check_game.py 13
"""

import sqlite3
import sys
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Usage: python check_game.py <game_id>")
        print("Example: python check_game.py 13")
        sys.exit(1)

    try:
        game_id = int(sys.argv[1])
    except ValueError:
        print(f"Error: game_id must be an integer, got '{sys.argv[1]}'")
        sys.exit(1)

    db_path = Path(__file__).parent.parent.parent / 'user_data' / 'a' / 'database.sqlite'
    if not db_path.exists():
        print(f"Error: Database not found at {db_path}")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Check game exists
    cursor.execute('SELECT id, name FROM games WHERE id = ?', (game_id,))
    game = cursor.fetchone()
    if not game:
        print(f"Error: Game {game_id} not found")
        conn.close()
        sys.exit(1)

    print(f"=== GAME {game_id}: {game['name']} ===\n")

    # Check raw clips
    print(f'=== RAW CLIPS FOR GAME {game_id} ===')
    cursor.execute('''
        SELECT id, start_time, end_time, rating, name, filename, auto_project_id
        FROM raw_clips WHERE game_id = ? ORDER BY start_time
    ''', (game_id,))
    clips = cursor.fetchall()
    for r in clips:
        mins = int(r['start_time'] // 60)
        secs = int(r['start_time'] % 60)
        fname = (r['filename'][:30] + '...') if r['filename'] else 'NONE'
        name = r['name'] or '(no name)'
        print(f"  {r['id']}: {mins}:{secs:02d} rating={r['rating']} proj={r['auto_project_id']} name={name[:20]}")
    print(f"Total: {len(clips)} clips\n")

    # Check projects linked to this game's clips
    print(f'=== PROJECTS LINKED TO GAME {game_id} CLIPS ===')
    cursor.execute('''
        SELECT p.id, p.name, rc.id as raw_clip_id, rc.start_time
        FROM projects p
        JOIN raw_clips rc ON rc.auto_project_id = p.id
        WHERE rc.game_id = ?
        ORDER BY p.id
    ''', (game_id,))
    projs = cursor.fetchall()
    for r in projs:
        mins = int(r['start_time'] // 60)
        secs = int(r['start_time'] % 60)
        print(f"  Project {r['id']}: {r['name']} (clip {r['raw_clip_id']} at {mins}:{secs:02d})")
    print(f"Total: {len(projs)} projects\n")

    # Check final videos
    print(f'=== FINAL VIDEOS FOR GAME {game_id} ===')
    cursor.execute('''
        SELECT id, filename, version, source_type, name
        FROM final_videos WHERE game_id = ?
        ORDER BY id
    ''', (game_id,))
    videos = cursor.fetchall()
    for r in videos:
        print(f"  {r['id']}: {r['name']} (v{r['version']}, {r['source_type']})")
    print(f"Total: {len(videos)} final videos\n")

    # Duplicate check
    print(f'=== DUPLICATE CHECK (by start_time) ===')
    cursor.execute('''
        SELECT start_time, COUNT(*) as cnt FROM raw_clips
        WHERE game_id = ? GROUP BY start_time HAVING cnt > 1
    ''', (game_id,))
    dups = cursor.fetchall()
    if dups:
        for d in dups:
            mins = int(d['start_time'] // 60)
            secs = int(d['start_time'] % 60)
            print(f"  Duplicate at {mins}:{secs:02d}: {d['cnt']} copies")
    else:
        print('  No duplicates found')

    conn.close()

if __name__ == '__main__':
    main()
