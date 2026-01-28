#!/usr/bin/env python
"""
Temporary CLI script to sync annotations from frontend to database and extract clips.

Usage:
  1. In browser console, run: copy(JSON.stringify(annotateRegions))
  2. Run this script: python sync_annotations.py <game_id>
  3. Paste the JSON when prompted

Or pass JSON directly:
  python sync_annotations.py <game_id> --json '<json_string>'
"""

import sys
import json
import asyncio
sys.path.insert(0, '.')

from app.database import get_db_connection
from app.routers.clips import extract_all_pending_clips
from app.routers.games import generate_clip_name

def sync_annotations_to_db(game_id: int, annotations: list) -> dict:
    """Create pending raw_clips from annotations."""
    results = {'created': 0, 'updated': 0, 'skipped': 0}

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Verify game exists
        cursor.execute("SELECT id, video_filename FROM games WHERE id = ?", (game_id,))
        game = cursor.fetchone()
        if not game:
            print(f"Error: Game {game_id} not found")
            return results

        print(f"Game {game_id} found, video: {game['video_filename'] or 'NOT UPLOADED'}")

        # Get existing clips
        cursor.execute("SELECT id, end_time FROM raw_clips WHERE game_id = ?", (game_id,))
        existing = {row['end_time']: row['id'] for row in cursor.fetchall()}

        for ann in annotations:
            # Handle different annotation formats from frontend
            end_time = ann.get('endTime') or ann.get('end_time')
            start_time = ann.get('startTime') or ann.get('start_time', 0)
            rating = ann.get('rating', 3)
            tags = ann.get('tags', [])
            notes = ann.get('notes', '')
            name = ann.get('name', '')

            if not end_time:
                print(f"  Skipping annotation without end_time: {ann}")
                results['skipped'] += 1
                continue

            # Don't store default names
            default_name = generate_clip_name(rating, tags)
            if name == default_name:
                name = ''

            tags_json = json.dumps(tags)

            if end_time in existing:
                # Update existing
                cursor.execute("""
                    UPDATE raw_clips
                    SET start_time = ?, name = ?, rating = ?, tags = ?, notes = ?
                    WHERE id = ?
                """, (start_time, name, rating, tags_json, notes, existing[end_time]))
                results['updated'] += 1
                print(f"  Updated clip at {end_time:.2f}s (rating={rating})")
            else:
                # Create new pending clip
                cursor.execute("""
                    INSERT INTO raw_clips (filename, rating, tags, name, notes, start_time, end_time, game_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, ('', rating, tags_json, name, notes, start_time, end_time, game_id))
                results['created'] += 1
                print(f"  Created pending clip at {end_time:.2f}s (rating={rating})")

        conn.commit()

    return results

def main():
    if len(sys.argv) < 2:
        print("Usage: python sync_annotations.py <game_id> [--json '<json>']")
        print("\nTo get annotations from browser:")
        print("  1. Open browser console in Annotate mode")
        print("  2. Run: copy(JSON.stringify(clipRegions))")
        print("  3. Run this script and paste when prompted")
        sys.exit(1)

    game_id = int(sys.argv[1])

    # Get JSON from argument or stdin
    if '--json' in sys.argv:
        json_idx = sys.argv.index('--json')
        if json_idx + 1 < len(sys.argv):
            json_str = sys.argv[json_idx + 1]
        else:
            print("Error: --json requires a value")
            sys.exit(1)
    else:
        print(f"Paste annotations JSON for game {game_id} (then press Enter twice):")
        lines = []
        while True:
            try:
                line = input()
                if line == '' and lines and lines[-1] == '':
                    break
                lines.append(line)
            except EOFError:
                break
        json_str = '\n'.join(lines).strip()

    try:
        annotations = json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        sys.exit(1)

    print(f"\nParsed {len(annotations)} annotations")

    # Sync to database
    print(f"\n=== Syncing annotations to database ===")
    results = sync_annotations_to_db(game_id, annotations)
    print(f"\nSync complete: {results['created']} created, {results['updated']} updated, {results['skipped']} skipped")

    # Trigger extraction
    if results['created'] > 0:
        print(f"\n=== Extracting pending clips ===")
        extract_results = extract_all_pending_clips()
        print(f"Extraction complete: {extract_results}")

        # Show 5-star clips that should have projects
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT rc.id, rc.rating, rc.auto_project_id, p.name as project_name
                FROM raw_clips rc
                LEFT JOIN projects p ON rc.auto_project_id = p.id
                WHERE rc.game_id = ? AND rc.rating = 5
            """, (game_id,))
            five_star = cursor.fetchall()

            if five_star:
                print(f"\n=== 5-star clips (should have projects) ===")
                for row in five_star:
                    status = f"project={row['auto_project_id']} ({row['project_name']})" if row['auto_project_id'] else "NO PROJECT"
                    print(f"  Clip {row['id']}: {status}")

    print("\nDone!")

if __name__ == '__main__':
    main()
