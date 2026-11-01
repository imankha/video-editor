"""T14270: tests that create Postgres users must not leave them in the dev DB.

pg_conn runs against the SHARED dev Postgres. Its teardown only deleted the
fixed _TEST_USER_IDS allowlist, so tests that create per-run ids (uuid suffix)
left one user row per run, which then showed up in admin user lists and
analytics. This runs one test from each such file in a child pytest against
the same DATABASE_URL and asserts none of their user ids survive.
"""
import os
import subprocess
import sys
from pathlib import Path

import psycopg2

BACKEND_DIR = Path(__file__).resolve().parent.parent

# One test per file that creates per-run user ids, and the id prefixes it uses.
CREATING_TESTS = [
    "tests/test_t10270_stuck_uploads_clip_key.py::test_clip_row_reports_kind_and_checks_the_raw_clips_key",
    "tests/test_t8170_stuck_uploads_cross_thread.py::test_stuck_uploads_returns_200_not_500_cross_thread",
    "tests/test_t8170_stuck_uploads_cross_thread.py::test_stuck_uploads_no_pending_rows_returns_200_empty",
    "tests/test_t10300_link_uploaded_clip.py::TestSourceDiscriminator::test_uploaded_clip_has_source_upload",
    "tests/test_t7970_upload_failure_milestones.py::test_prepare_upload_invalid_file_size_records_refused",
    "tests/test_t8370_clip_upload.py::TestBatchClipUpload::test_batch_upload_creates_raw_clip_with_full_range_and_auto_project",
    "tests/test_t8370_clip_upload_reconciliation.py::TestClipUploadReconciliationReaper::test_orphaned_debit_younger_than_24h_is_left_alone",
]
ID_PREFIXES = ["admin_t10270_", "u_t10270stuck_", "admin_t8170", "u_t8170",
               "test_t10300_", "test_t7970_", "test_t8370_"]


def _matching_user_ids(dsn):
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        clauses = " OR ".join(["user_id LIKE %s"] * len(ID_PREFIXES))
        cur.execute(f"SELECT user_id FROM users WHERE {clauses}",
                    [p.replace("_", r"\_") + "%" for p in ID_PREFIXES])
        return {r[0] for r in cur.fetchall()}
    finally:
        conn.close()


def test_tests_that_create_users_leave_no_user_rows(pg_conn):
    dsn = pg_conn
    before = _matching_user_ids(dsn)

    result = subprocess.run(
        [sys.executable, "-m", "pytest", *CREATING_TESTS, "-q", "-p", "no:cacheprovider"],
        cwd=BACKEND_DIR, env={**os.environ, "DATABASE_URL": dsn},
        capture_output=True, text=True, timeout=600,
    )
    assert result.returncode == 0, f"child pytest failed:\n{result.stdout[-3000:]}\n{result.stderr[-2000:]}"

    leaked = _matching_user_ids(dsn) - before
    assert leaked == set(), f"tests left user rows in Postgres: {sorted(leaked)}"
