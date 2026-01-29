#!/usr/bin/env python
"""Check database health and recommend cleanup."""

import sqlite3
from pathlib import Path

db_path = Path(r"C:\Users\imank\projects\video-editor\user_data\a\database.sqlite")
print(f"Database: {db_path}")
conn = sqlite3.connect(str(db_path))
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

issues = []

print("=== DATABASE HEALTH CHECK ===\n")

# 1. Games with mismatched clip_count
print("1. GAME CLIP COUNT ACCURACY")
cursor.execute('''
    SELECT g.id, g.name, g.clip_count as stored_count,
           (SELECT COUNT(*) FROM raw_clips rc WHERE rc.game_id = g.id) as actual_count
    FROM games g
''')
for g in cursor.fetchall():
    stored = g['stored_count'] or 0
    actual = g['actual_count']
    if stored != actual:
        issues.append(f"Game {g['id']} clip_count mismatch: stored={stored}, actual={actual}")
        print(f"  MISMATCH: Game {g['id']} ({g['name'][:30]}): stored={stored}, actual={actual}")
    else:
        print(f"  OK: Game {g['id']}: {actual} clips")

# 2. Orphaned projects (no raw_clip pointing to them)
print("\n2. ORPHANED PROJECTS (no source clip)")
cursor.execute('''
    SELECT p.id, p.name
    FROM projects p
    WHERE NOT EXISTS (SELECT 1 FROM raw_clips rc WHERE rc.auto_project_id = p.id)
''')
orphans = cursor.fetchall()
if orphans:
    for p in orphans:
        print(f"  ORPHAN: Project {p['id']}: {p['name']}")
        issues.append(f"Orphaned project {p['id']}: {p['name']}")
else:
    print("  None found")

# 3. Projects with no working clips
print("\n3. PROJECTS WITH NO WORKING CLIPS")
cursor.execute('''
    SELECT p.id, p.name
    FROM projects p
    WHERE NOT EXISTS (SELECT 1 FROM working_clips wc WHERE wc.project_id = p.id)
''')
empty_projs = cursor.fetchall()
if empty_projs:
    for p in empty_projs:
        print(f"  EMPTY: Project {p['id']}: {p['name']}")
else:
    print("  None found")

# 4. Raw clips with missing files (empty filename)
print("\n4. RAW CLIPS WITH MISSING FILES")
cursor.execute('''
    SELECT rc.id, rc.game_id, rc.start_time, rc.rating
    FROM raw_clips rc
    WHERE rc.filename IS NULL OR rc.filename = ''
''')
missing = cursor.fetchall()
if missing:
    for rc in missing:
        mins = int(rc['start_time'] // 60)
        secs = int(rc['start_time'] % 60)
        print(f"  MISSING: Clip {rc['id']} (game {rc['game_id']}, {mins}:{secs:02d}, rating {rc['rating']})")
        issues.append(f"Raw clip {rc['id']} has no file")
else:
    print("  None found")

# 5. Summary
print("\n" + "=" * 40)
if issues:
    print(f"FOUND {len(issues)} ISSUES:")
    for i in issues:
        print(f"  - {i}")
else:
    print("DATABASE IS HEALTHY!")

conn.close()
