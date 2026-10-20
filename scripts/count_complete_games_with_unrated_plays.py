"""
count_complete_games_with_unrated_plays.py - READ-ONLY report (T12910).

Counts games already at auto_export_status='complete' that have >=1 unrated marked play
(raw_clips.rating IS NULL). Before T12910 their recap omitted those plays. If the source
is still in R2 (grace/extended) `backfill_hiq_recaps`' regenerate path could rebuild the
recap; past grace the footage is gone. This script never writes and never regenerates.

Usage: python scripts/count_complete_games_with_unrated_plays.py <profile.sqlite> [...]
"""
import sqlite3
import sys

QUERY = """
SELECT g.id, g.name, SUM(rc.rating IS NULL) AS unrated
FROM games g JOIN raw_clips rc ON rc.game_id = g.id
WHERE g.auto_export_status = 'complete'
GROUP BY g.id HAVING unrated > 0
"""


def main(paths: list[str]) -> int:
    total = 0
    for path in paths:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        rows = conn.execute(QUERY).fetchall()
        conn.close()
        total += len(rows)
        for game_id, name, unrated in rows:
            print(f"{path}: game {game_id} {name!r} unrated_plays={unrated}")
    print(f"TOTAL complete games with unrated plays: {total}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1:]))
