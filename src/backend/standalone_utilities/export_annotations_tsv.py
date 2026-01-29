#!/usr/bin/env python
"""Export all game annotations to TSV files in formal annotations folders."""

import sys
import sqlite3
import json
from pathlib import Path

# Map game names/keywords to folder names
FOLDER_MAP = {
    # LAFC Oct 25
    'lafc-so-cal-2025-10-25': '10.25.WCFC vs LAFC Socal',
    'LAFC': '10.25.WCFC vs LAFC Socal',
    '10-25': '10.25.WCFC vs LAFC Socal',
    # LA Breakers Nov 1
    'la-breakers-2025-11-01': '11.1.LA Breakers',
    '11-01': '11.1.LA Breakers',
    # Carlsbad
    'carlsbad': '12.6.carlsbad',
    # SoCal Blaze
    'so-cal-blaze': '12.6.socalblaze',
    # LA Breakers LB Sept 27
    'long-beach-2025-09-27': '9.27.LA Breakers LB',
    '09-27': '9.27.LA Breakers LB',
    # Test
    'test': 'test.short',
}

def seconds_to_mmss(seconds):
    """Convert seconds to MM:SS format."""
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins}:{secs:02d}"

def find_folder_for_game(game_name, video_filename):
    """Try to match a game to its annotation folder."""
    search_str = f"{game_name} {video_filename or ''}"
    for keyword, folder in FOLDER_MAP.items():
        if keyword.lower() in search_str.lower():
            return folder
    return None

def export_game_to_tsv(cursor, game_id, game_name, output_path):
    """Export a game's clips to TSV format."""
    cursor.execute("""
        SELECT start_time, end_time, rating, tags, name, notes
        FROM raw_clips
        WHERE game_id = ?
        ORDER BY start_time
    """, (game_id,))

    clips = cursor.fetchall()
    if not clips:
        print(f"  No clips for game {game_id}")
        return 0

    lines = ["start_time\trating\ttags\tclip_name\tclip_duration\tnotes"]

    for clip in clips:
        start_time = clip['start_time'] or 0
        end_time = clip['end_time'] or (start_time + 15)
        duration = end_time - start_time

        tags_list = json.loads(clip['tags']) if clip['tags'] else []
        tags_str = ','.join(tags_list)

        line = "\t".join([
            seconds_to_mmss(start_time),
            str(clip['rating'] or 3),
            tags_str,
            clip['name'] or '',
            str(duration),
            clip['notes'] or ''
        ])
        lines.append(line)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f"  Wrote {len(clips)} clips to {output_path}")
    return len(clips)

def main():
    db_path = Path(__file__).parent.parent.parent / 'user_data' / 'a' / 'database.sqlite'
    annotations_dir = Path(__file__).parent.parent.parent / 'formal annotations'

    if not db_path.exists():
        print(f"Database not found: {db_path}")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Get all games with clips
    cursor.execute("""
        SELECT g.id, g.name, g.video_filename, COUNT(rc.id) as clip_count
        FROM games g
        LEFT JOIN raw_clips rc ON g.id = rc.game_id
        GROUP BY g.id
        HAVING clip_count > 0
        ORDER BY g.id
    """)

    games = cursor.fetchall()
    print(f"Found {len(games)} games with clips\n")

    total_exported = 0
    for game in games:
        game_id = game['id']
        game_name = game['name']
        video_filename = game['video_filename']
        clip_count = game['clip_count']

        print(f"Game {game_id}: {game_name} ({clip_count} clips)")

        folder = find_folder_for_game(game_name, video_filename)
        if not folder:
            print(f"  WARNING: Could not find folder for game '{game_name}'")
            print(f"    Video: {video_filename}")
            continue

        output_path = annotations_dir / folder / 'exported.tsv'
        exported = export_game_to_tsv(cursor, game_id, game_name, output_path)
        total_exported += exported

    print(f"\nTotal: {total_exported} clips exported")
    conn.close()

if __name__ == '__main__':
    main()
