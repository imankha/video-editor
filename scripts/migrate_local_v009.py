"""One-off: run profile_db migrations (incl. v009) on every LOCAL profile DB and
report quality_score backfill stats. Local inspection only -- does not upload to R2."""
import sqlite3
import sys
import glob
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "backend"))

from app.database import USER_DATA_BASE
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.migrations.profile_db import RUNNER

dbs = sorted(glob.glob(str(USER_DATA_BASE / "*" / "profiles" / "*" / "profile.sqlite")))
print(f"Found {len(dbs)} local profile DBs; latest profile_db version = {RUNNER.latest_version}\n")

totals = {"migrated": 0, "already": 0, "errors": 0, "no_fv": 0,
          "fv_total": 0, "q_set": 0, "q_null": 0}

for path in dbs:
    parts = path.replace("\\", "/").split("/")
    user_id, profile_id = parts[-4], parts[-2]
    try:
        set_current_user_id(user_id)
        set_current_profile_id(profile_id)
        conn = sqlite3.connect(path, timeout=30)
        conn.execute("PRAGMA busy_timeout=30000")
        before = conn.execute("PRAGMA user_version").fetchone()[0]
        applied = RUNNER.run(conn, "sqlite")
        after = conn.execute("PRAGMA user_version").fetchone()[0]
        if applied:
            totals["migrated"] += 1
        else:
            totals["already"] += 1
        # Inspect final_videos quality_score / season_rank
        has_fv = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='final_videos'"
        ).fetchone()
        if has_fv:
            rows = conn.execute(
                "SELECT quality_score, season_rank FROM final_videos WHERE published_at IS NOT NULL"
            ).fetchall()
            qset = sum(1 for r in rows if r[0] is not None)
            qnull = sum(1 for r in rows if r[0] is None)
            rranked = sum(1 for r in rows if r[1] is not None)
            totals["fv_total"] += len(rows)
            totals["q_set"] += qset
            totals["q_null"] += qnull
            if rows:
                print(f"  {user_id[:8]}/{profile_id[:8]}  v{before}->{after}  "
                      f"published={len(rows):3d}  quality_set={qset:3d}  quality_null(multi-clip)={qnull:3d}  ranked={rranked}")
            else:
                totals["no_fv"] += 1
        conn.commit()
        conn.close()
    except Exception as e:
        totals["errors"] += 1
        print(f"  ERROR {user_id[:8]}/{profile_id[:8]}: {type(e).__name__}: {e}")

print("\n=== TOTALS ===")
print(f"  accounts migrated now: {totals['migrated']}, already current: {totals['already']}, errors: {totals['errors']}")
print(f"  published reels: {totals['fv_total']}  | quality_score set (single-clip): {totals['q_set']}  | NULL (multi-clip): {totals['q_null']}")
