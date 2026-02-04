#!/usr/bin/env python
"""
Cleanup users script - migrates/syncs one user, deletes others.

Usage:
    python cleanup.py [keep:user-id] [delete:pattern]

Examples:
    python cleanup.py                     # Keep 'a', delete all others
    python cleanup.py keep:b              # Keep 'b', delete all others
    python cleanup.py delete:e2e_*        # Keep 'a', only delete e2e_* users
    python cleanup.py keep:a delete:e2e_* # Keep 'a', only delete e2e_* users
"""

import sys
import os
import shutil
import fnmatch
from pathlib import Path

# Must run from backend directory
if not Path("app/database.py").exists():
    print("ERROR: Run this script from the backend directory")
    print("  cd src/backend && python ../../.claude/skills/cleanup-users/cleanup.py")
    sys.exit(1)

from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, '.')

# Re-import after dotenv to pick up R2 config
import importlib
import app.storage
importlib.reload(app.storage)
from app.storage import get_r2_client, R2_BUCKET

# Parse arguments
keep_user = 'a'
delete_pattern = None

for arg in sys.argv[1:]:
    if arg.startswith('keep:'):
        keep_user = arg[5:]
    elif arg.startswith('delete:'):
        delete_pattern = arg[7:]

print(f"Keep user: {keep_user}")
print(f"Delete pattern: {delete_pattern or '(all non-kept users)'}")

# 1. Run migrations and sync to R2
print(f"\n=== Step 1: Running migrations for user '{keep_user}' ===")
from app.database import get_db_connection, sync_db_to_cloud
from app.user_context import set_current_user_id

set_current_user_id(keep_user)
with get_db_connection() as conn:
    cursor = conn.cursor()
    # Verify migrations ran by checking for recent columns
    cursor.execute("PRAGMA table_info(raw_clips)")
    columns = [row['name'] for row in cursor.fetchall()]
    print(f"  raw_clips: {len(columns)} columns")
    if 'boundaries_version' in columns:
        print("  ✓ boundaries_version column present")

    cursor.execute("PRAGMA table_info(working_clips)")
    columns = [row['name'] for row in cursor.fetchall()]
    print(f"  working_clips: {len(columns)} columns")
    if 'raw_clip_version' in columns:
        print("  ✓ raw_clip_version column present")

print(f"\n=== Step 2: Syncing user '{keep_user}' to R2 ===")
sync_db_to_cloud()
print("  ✓ Sync complete")

# 2. Delete other local users
print(f"\n=== Step 3: Deleting local users ===")
user_data_path = Path(__file__).parent.parent.parent.parent / "user_data"
if not user_data_path.exists():
    user_data_path = Path("C:/Users/imank/projects/video-editor/user_data")

deleted_local = []
for user_dir in user_data_path.iterdir():
    if not user_dir.is_dir():
        continue
    if user_dir.name == keep_user:
        continue
    # Check pattern if specified
    if delete_pattern and not fnmatch.fnmatch(user_dir.name, delete_pattern):
        continue
    print(f"  Deleting: {user_dir.name}")
    shutil.rmtree(user_dir)
    deleted_local.append(user_dir.name)

print(f"  ✓ Deleted {len(deleted_local)} local users")

# 3. Delete other R2 users
print(f"\n=== Step 4: Deleting R2 users ===")
client = get_r2_client()
if client:
    deleted_r2 = []
    deleted_users = set()
    paginator = client.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=R2_BUCKET):
        if 'Contents' not in page:
            continue
        for obj in page['Contents']:
            key = obj['Key']
            user_id = key.split('/')[0] if '/' in key else key
            if user_id == keep_user:
                continue
            # Check pattern if specified
            if delete_pattern and not fnmatch.fnmatch(user_id, delete_pattern):
                continue
            if user_id not in deleted_users:
                print(f"  Deleting user: {user_id}")
                deleted_users.add(user_id)
            client.delete_object(Bucket=R2_BUCKET, Key=key)
            deleted_r2.append(key)
    print(f"  ✓ Deleted {len(deleted_r2)} R2 objects from {len(deleted_users)} users")
else:
    print("  ⚠ R2 client not available")

print(f"\n=== Done! ===")
print(f"  Kept and synced: {keep_user}")
print(f"  Deleted locally: {len(deleted_local)} users")
if client:
    print(f"  Deleted from R2: {len(deleted_users)} users ({len(deleted_r2)} objects)")
