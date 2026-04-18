# T1570: Admin Panel Missing Users

## Problem

Some users (e.g., sarkarati@gmail.com) don't appear in the admin panel user table even though they exist in auth.sqlite. The admin panel may be filtering or querying users incorrectly, or there's a mismatch between auth DB and profile DBs.

## Acceptance Criteria

- All users in auth.sqlite appear in the admin panel user table
- Users with profiles on remote (R2) but no local profile should still be listed
- Verify the admin panel query joins correctly with profile data

## Notes

- Discovered on 2026-04-17 when sarkarati@gmail.com was confirmed in prod auth.sqlite but not visible in admin panel
- May be related to users whose profile DBs haven't been synced locally
