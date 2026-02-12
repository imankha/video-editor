#!/usr/bin/env python3
"""
Migration script for T66: Archive existing completed projects.

This script archives all completed projects (those with final_video_id set)
to R2 storage as JSON files. Run this once after deploying T66 changes to
clean up the existing database.

Usage:
    cd src/backend
    .venv/Scripts/python.exe scripts/archive_completed_projects.py

Options:
    --dry-run    Show what would be archived without making changes
    --user-id    Specify user ID (default: 'a')
"""

import argparse
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import get_db_connection, ensure_database
from app.user_context import set_current_user_id
from app.services.project_archive import archive_project
from app.storage import R2_ENABLED


def main():
    parser = argparse.ArgumentParser(description='Archive completed projects to R2')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be archived')
    parser.add_argument('--user-id', default='a', help='User ID to process (default: a)')
    args = parser.parse_args()

    # Set user context
    set_current_user_id(args.user_id)
    print(f"Processing user: {args.user_id}")

    # Ensure database exists
    ensure_database()

    if not R2_ENABLED:
        print("Warning: R2 is not enabled. Archives will not be uploaded.")
        if not args.dry_run:
            print("Aborting. Enable R2 or use --dry-run to see what would be archived.")
            return 1

    # Find completed projects
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT p.id, p.name, p.aspect_ratio, p.created_at,
                   (SELECT COUNT(*) FROM working_clips wc WHERE wc.project_id = p.id) as clip_count,
                   (SELECT COUNT(*) FROM working_videos wv WHERE wv.project_id = p.id) as video_count
            FROM projects p
            WHERE p.final_video_id IS NOT NULL
            ORDER BY p.created_at
        """)
        completed_projects = cursor.fetchall()

    if not completed_projects:
        print("No completed projects found. Nothing to archive.")
        return 0

    print(f"\nFound {len(completed_projects)} completed projects to archive:")
    print("-" * 60)

    for project in completed_projects:
        print(f"  #{project['id']}: {project['name']} ({project['aspect_ratio']})")
        print(f"       {project['clip_count']} clips, {project['video_count']} videos")
        print(f"       Created: {project['created_at']}")

    print("-" * 60)

    if args.dry_run:
        print("\n[DRY RUN] No changes made. Remove --dry-run to archive these projects.")
        return 0

    # Confirm before proceeding
    response = input(f"\nArchive {len(completed_projects)} projects? (yes/no): ")
    if response.lower() != 'yes':
        print("Aborted.")
        return 1

    # Archive each project
    archived_count = 0
    failed_count = 0

    for project in completed_projects:
        project_id = project['id']
        print(f"\nArchiving project #{project_id}: {project['name']}...", end=" ")

        try:
            if archive_project(project_id, args.user_id):
                print("OK")
                archived_count += 1
            else:
                print("FAILED (archive_project returned False)")
                failed_count += 1
        except Exception as e:
            print(f"FAILED ({e})")
            failed_count += 1

    # Summary
    print("\n" + "=" * 60)
    print(f"Migration complete!")
    print(f"  Archived: {archived_count}")
    print(f"  Failed:   {failed_count}")

    if archived_count > 0:
        print("\nRun VACUUM to reclaim disk space:")
        print(f"  sqlite3 user_data/{args.user_id}/database.sqlite 'VACUUM'")

    return 0 if failed_count == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
