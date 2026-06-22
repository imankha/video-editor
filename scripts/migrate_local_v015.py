"""One-off: run pending profile_db migrations (through v015 last_playhead_position)
on every LOCAL profile DB. Local inspection only -- does not upload to R2.

Run from repo root:  python3 scripts/migrate_local_v015.py
"""
import sqlite3
import sys
import glob
import os
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "backend"))

from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.migrations.profile_db import RUNNER

dbs = sorted(glob.glob("user_data/*/profiles/*/profile.sqlite"))
print(f"Found {len(dbs)} local profile DBs; latest profile_db version = {RUNNER.latest_version}\n")

before_dist, after_dist = Counter(), Counter()
migrated = already = errors = with_col = 0

for path in dbs:
    parts = path.replace("\\", "/").split("/")
    user_id, profile_id = parts[-4], parts[-2]
    try:
        set_current_user_id(user_id)
        set_current_profile_id(profile_id)
        conn = sqlite3.connect(path, timeout=30)
        conn.execute("PRAGMA busy_timeout=30000")
        before = conn.execute("PRAGMA user_version").fetchone()[0]
        before_dist[before] += 1
        applied = RUNNER.run(conn, "sqlite")
        after = conn.execute("PRAGMA user_version").fetchone()[0]
        after_dist[after] += 1
        migrated += 1 if applied else 0
        already += 0 if applied else 1
        has_col = conn.execute(
            "SELECT 1 FROM pragma_table_info('games') WHERE name='last_playhead_position'"
        ).fetchone()
        with_col += 1 if has_col else 0
        conn.commit()
        conn.close()
    except Exception as e:
        errors += 1
        print(f"  ERROR {user_id[:8]}/{profile_id[:8]}: {type(e).__name__}: {e}")

print("=== TOTALS ===")
print(f"  migrated now: {migrated}  already current: {already}  errors: {errors}")
print(f"  before versions: {dict(sorted(before_dist.items()))}")
print(f"  after  versions: {dict(sorted(after_dist.items()))}")
print(f"  DBs with games.last_playhead_position column: {with_col}/{len(dbs)}")
