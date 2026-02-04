---
name: cleanup-users
description: Migrate and sync a user's database, then clean up other users (especially e2e test accounts)
disable-model-invocation: true
allowed-tools: Bash(*)
argument-hint: "[keep:user-id] [delete:pattern]"
---

# Cleanup Users

Migrates a user's database (runs pending migrations), syncs it to R2, and deletes other users both locally and on R2.

## Common Usage

- `/cleanup-users` - Keep user "a", delete all others (default)
- `/cleanup-users keep:b` - Keep user "b" instead
- `/cleanup-users delete:e2e_*` - Only delete users matching pattern, keep everything else
- `/cleanup-users keep:a delete:e2e_*` - Keep "a", only delete e2e test users

## Arguments

- `keep:<user-id>` - User ID to keep and sync (default: "a")
- `delete:<pattern>` - Only delete users matching this glob pattern (default: all non-kept users)

Arguments provided: `$ARGUMENTS`

## Task

Parse the arguments to determine:
1. **keep_user**: Which user to migrate and sync (default "a")
2. **delete_pattern**: Optional glob pattern to filter deletions (e.g., "e2e_*" only deletes e2e test accounts)

Then run a Python script in the backend directory that:
1. Opens a DB connection for the keep_user (triggers migrations)
2. Syncs that user's database to R2
3. Deletes matching local user directories in `user_data/`
4. Deletes matching user data in R2

If delete_pattern is specified, only delete users whose ID matches that pattern.
If no delete_pattern, delete ALL users except the kept one.

The e2e test accounts typically follow the pattern `e2e_*` (e.g., `e2e_1770151812489_zy46le`).

Make sure to:
- Show what will be deleted before deleting
- Report counts of deleted items
- Confirm the kept user's database has the latest migrations
