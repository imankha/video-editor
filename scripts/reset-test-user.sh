#!/bin/bash
# Reset imankh@gmail.com (user "a") for fresh new-user-flow testing.
#
# Usage: bash scripts/reset-test-user.sh
#
# What it does:
# 1. Clears all tables in the active profile's database (games, clips, projects, exports, achievements)
# 2. Resets credits to 0 and clears credit_transactions in auth.sqlite
# 3. Does NOT delete the user account, profiles, or profile directories
# 4. Does NOT touch R2 — this is local-only

set -e

USER_DATA="$(dirname "$0")/../user_data"
AUTH_DB="$USER_DATA/auth.sqlite"
USER_ID="a"

echo "=== Resetting user '$USER_ID' (imankh@gmail.com) ==="

# Find all profile databases for user a
for db in "$USER_DATA/$USER_ID/profiles"/*/database.sqlite; do
  if [ -f "$db" ]; then
    profile_dir=$(basename "$(dirname "$db")")
    echo ""
    echo "--- Clearing profile: $profile_dir ---"
    sqlite3 "$db" <<'SQL'
DELETE FROM games;
DELETE FROM raw_clips;
DELETE FROM projects;
DELETE FROM working_clips;
DELETE FROM working_videos;
DELETE FROM final_videos;
DELETE FROM export_jobs;
DELETE FROM achievements;
DELETE FROM before_after_tracks;
SQL
    echo "  Cleared: games, raw_clips, projects, working_clips, working_videos, final_videos, export_jobs, achievements"
  fi
done

# Reset credits in auth.sqlite
echo ""
echo "--- Resetting credits in auth.sqlite ---"
sqlite3 "$AUTH_DB" <<SQL
UPDATE users SET credits = 0 WHERE user_id = '$USER_ID';
DELETE FROM credit_transactions WHERE user_id = '$USER_ID';
SQL
echo "  Credits: 0, transactions: cleared"

echo ""
echo "=== Done. Restart the backend server to pick up changes. ==="
