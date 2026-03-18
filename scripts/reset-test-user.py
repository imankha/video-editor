"""
Reset a user's data for fresh new-user-flow testing.

Usage (from project root):
    cd src/backend && .venv/Scripts/python.exe ../../scripts/reset-test-user.py imankh@gmail.com

What it does:
1. Looks up user_id by email in auth.sqlite
2. Clears all tables in every profile database (games, clips, projects, exports, achievements)
3. Resets credits to 0 and clears credit_transactions
4. Does NOT delete the user account, profiles, or profile directories
5. Does NOT touch R2 — this is local-only
"""

import sqlite3
import sys
from pathlib import Path

USER_DATA = Path(__file__).parent.parent / "user_data"
AUTH_DB = USER_DATA / "auth.sqlite"

TABLES_TO_CLEAR = [
    "games",
    "raw_clips",
    "projects",
    "working_clips",
    "working_videos",
    "final_videos",
    "export_jobs",
    "achievements",
    "before_after_tracks",
]


def main():
    if len(sys.argv) < 2:
        print("Usage: python reset-test-user.py <email>")
        print("Example: python reset-test-user.py imankh@gmail.com")
        sys.exit(1)

    email = sys.argv[1]

    # Look up user_id by email
    if not AUTH_DB.exists():
        print(f"ERROR: auth.sqlite not found at {AUTH_DB}")
        sys.exit(1)

    conn = sqlite3.connect(str(AUTH_DB))
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT user_id FROM users WHERE email = ?", (email,)).fetchone()
    if not row:
        print(f"ERROR: No user found with email '{email}'")
        conn.close()
        sys.exit(1)

    user_id = row["user_id"]
    print(f"=== Resetting user '{user_id}' ({email}) ===")

    # Clear all profile databases
    profiles_dir = USER_DATA / user_id / "profiles"
    if not profiles_dir.exists():
        print(f"WARNING: No profiles directory at {profiles_dir}")
    else:
        for db_path in profiles_dir.glob("*/database.sqlite"):
            profile_id = db_path.parent.name
            print(f"\n--- Clearing profile: {profile_id} ---")
            pconn = sqlite3.connect(str(db_path))
            for table in TABLES_TO_CLEAR:
                try:
                    pconn.execute(f"DELETE FROM {table}")
                except sqlite3.OperationalError:
                    pass  # Table might not exist in older DBs
            pconn.commit()
            pconn.close()
            print(f"  Cleared: {', '.join(TABLES_TO_CLEAR)}")

    # Reset credits
    print("\n--- Resetting credits ---")
    conn.execute("UPDATE users SET credits = 0 WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM credit_transactions WHERE user_id = ?", (user_id,))
    conn.commit()
    conn.close()
    print("  Credits: 0, transactions: cleared")

    print(f"\n=== Done. Restart the backend server to pick up changes. ===")


if __name__ == "__main__":
    main()
