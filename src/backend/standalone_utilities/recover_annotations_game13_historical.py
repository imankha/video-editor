#!/usr/bin/env python
"""
Recovery script for lost annotations from game 13 (LAFC Oct 25).
Data extracted from browser console logs.
"""

import sys
sys.path.insert(0, '.')

from app.database import get_db_connection
import json

GAME_ID = 13
DEFAULT_DURATION = 15.0  # Default clip duration

# Recovered annotations from console logs
# Format: (start_time, rating, name, notes, tags)
RECOVERED_CLIPS = [
    # From TSV (already have these)
    # (1520.0, 3, "Nice Dribble Foul", "Nice dribble and foul", ["Dribble"]),  # 25:20
    # (1707.0, 4, "Great Touch Through", "Great touch and through", ["Possession", "Pass"]),  # 28:27
    # (2147.0, 4, "Great Control Dribble Pass", "Great control, dribble and pass", ["Possession", "Dribble", "Pass"]),  # 35:47
    # (4933.0, 4, "Beat CB Penalty", "Great getting around center back and getting penalty", ["Dribble"]),  # 82:13
    # (5062.0, 4, "Great Win Foul", "Great win and drawing foul", ["Dribble"]),  # 84:22
    # (5300.0, 4, "Great Control Header", "Great control and header pass", ["Possession", "Pass"]),  # 88:20
    # (5480.0, 4, "Great Slide Tackle", "Great slide tackle", ["Tackle"]),  # 91:20

    # Manually added clips (from console logs)
    (313.99, 4, "", "", []),  # 5:14 - tags unknown
    (433.84, 4, "", "", []),  # 7:14 - tags unknown
    (560.05, 3, "", "", []),  # 9:20 - tags unknown
    (631.53, 4, "", "", []),  # 10:32 - tags unknown
    (690.89, 4, "", "", []),  # 11:31 - tags unknown
    (858.91, 4, "Good Header Interception", "", []),  # 14:19
    (886.52, 4, "", "", []),  # 14:47 - tags unknown
    (923.36, 4, "", "Good Cross", []),  # 15:23
    (976.29, 4, "Good Pass From the back", "", []),  # 16:16
    (1228.19, 4, "", "", []),  # 20:28 - tags unknown
    (1469.49, 4, "", "", []),  # 24:29 - tags unknown
    (2402.01, 5, "", "", []),  # 40:02 - BRILLIANT
    (3383.08, 5, "", "Great clearance", []),  # 56:23 - BRILLIANT
    (4231.80, 5, "", "", []),  # 70:32 - BRILLIANT
    (4673.87, 5, "", "", []),  # 77:54 - BRILLIANT
    (4852.96, 4, "", "", []),  # 80:53
]

def recover_annotations():
    """Insert recovered annotations into raw_clips table."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Check game exists
        cursor.execute("SELECT id, video_filename FROM games WHERE id = ?", (GAME_ID,))
        game = cursor.fetchone()
        if not game:
            print(f"Error: Game {GAME_ID} not found")
            return

        print(f"Recovering annotations for game {GAME_ID}")
        print(f"Video: {game['video_filename']}")

        created = 0
        skipped = 0

        for start_time, rating, name, notes, tags in RECOVERED_CLIPS:
            end_time = start_time + DEFAULT_DURATION

            # Check if already exists
            cursor.execute("""
                SELECT id FROM raw_clips WHERE game_id = ? AND end_time = ?
            """, (GAME_ID, end_time))

            if cursor.fetchone():
                print(f"  Skipped: {start_time:.1f}s (already exists)")
                skipped += 1
                continue

            # Insert new clip with empty filename (pending extraction)
            cursor.execute("""
                INSERT INTO raw_clips (filename, rating, tags, name, notes, start_time, end_time, game_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                '',  # empty = pending extraction
                rating,
                json.dumps(tags),
                name,
                notes,
                start_time,
                end_time,
                GAME_ID
            ))

            print(f"  Created: {start_time:.1f}s (rating={rating}) {name or notes or '-'}")
            created += 1

        conn.commit()
        print(f"\nDone: {created} created, {skipped} skipped")

        # Show summary
        cursor.execute("""
            SELECT rating, COUNT(*) as cnt FROM raw_clips WHERE game_id = ? GROUP BY rating ORDER BY rating DESC
        """, (GAME_ID,))
        print("\nClips by rating:")
        for row in cursor.fetchall():
            print(f"  {row['rating']}-star: {row['cnt']}")

if __name__ == '__main__':
    recover_annotations()

    print("\n" + "="*50)
    print("Next steps:")
    print("1. Import the TSV file in Annotate mode to get the 7 TSV clips")
    print("2. Run: curl -X POST http://localhost:8000/api/clips/extract-pending")
    print("   to extract all clips and create projects for 5-star ones")
    print("="*50)
