"""
T5630 — v028 profile_db migration: add export_jobs.stage + output_key and
backfill `stage` from status/output_video_id/modal_call_id.

Exercises the backfill WITH DATA under the migration runner's TUPLE row factory
(migrations/__init__.py connects with plain sqlite3.connect, no sqlite3.Row).
The backfill is set-based (pure UPDATE, no per-row Python read) so the v017
row-factory landmine cannot bite; the only positional read is the PRAGMA
column-existence probe (r[1]). Tests confirm the derivation rules and
idempotency.
"""

import sqlite3

from app.migrations.profile_db.v028_export_job_stages import V028ExportJobStages


def _make_pre_v028_db(tmp_path):
    """export_jobs WITHOUT stage/output_key, tuple row factory (mirrors how
    migrations/__init__.py opens the connection)."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no row_factory -> tuples
    conn.execute("""
        CREATE TABLE export_jobs (
            id TEXT PRIMARY KEY,
            project_id INTEGER,
            type TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            output_video_id INTEGER,
            output_filename TEXT,
            modal_call_id TEXT
        )
    """)
    conn.commit()
    return conn


def _insert(conn, job_id, status, output_video_id=None, modal_call_id=None):
    conn.execute(
        "INSERT INTO export_jobs (id, project_id, type, status, output_video_id, modal_call_id) "
        "VALUES (?, 1, 'framing', ?, ?, ?)",
        (job_id, status, output_video_id, modal_call_id),
    )
    conn.commit()


def _stage(conn, job_id):
    return conn.execute("SELECT stage FROM export_jobs WHERE id = ?", (job_id,)).fetchone()[0]


def test_adds_columns_when_missing(tmp_path):
    conn = _make_pre_v028_db(tmp_path)
    cols_before = {row[1] for row in conn.execute("PRAGMA table_info(export_jobs)").fetchall()}
    assert "stage" not in cols_before and "output_key" not in cols_before

    V028ExportJobStages().up(conn)

    cols_after = {row[1] for row in conn.execute("PRAGMA table_info(export_jobs)").fetchall()}
    assert "stage" in cols_after
    assert "output_key" in cols_after


def test_idempotent_when_columns_already_present(tmp_path):
    conn = _make_pre_v028_db(tmp_path)
    V028ExportJobStages().up(conn)  # adds columns
    V028ExportJobStages().up(conn)  # must not raise / not duplicate-add

    cols = [row[1] for row in conn.execute("PRAGMA table_info(export_jobs)").fetchall()]
    assert cols.count("stage") == 1
    assert cols.count("output_key") == 1


def test_backfill_complete_job_gets_complete_stage(tmp_path):
    conn = _make_pre_v028_db(tmp_path)
    _insert(conn, "job-complete", "complete", output_video_id=5)
    V028ExportJobStages().up(conn)
    assert _stage(conn, "job-complete") == "complete"


def test_backfill_processing_with_output_video_infers_persisting(tmp_path):
    conn = _make_pre_v028_db(tmp_path)
    _insert(conn, "job-persist", "processing", output_video_id=9)
    V028ExportJobStages().up(conn)
    assert _stage(conn, "job-persist") == "persisting"


def test_backfill_processing_with_modal_call_infers_rendering(tmp_path):
    conn = _make_pre_v028_db(tmp_path)
    _insert(conn, "job-render", "processing", modal_call_id="fc-abc")
    V028ExportJobStages().up(conn)
    assert _stage(conn, "job-render") == "rendering"


def test_backfill_processing_bare_infers_queued(tmp_path):
    conn = _make_pre_v028_db(tmp_path)
    _insert(conn, "job-queued", "pending")
    V028ExportJobStages().up(conn)
    assert _stage(conn, "job-queued") == "queued"


def test_backfill_error_left_at_default(tmp_path):
    """status='error' is not overwritten — stage stays the column default
    ('queued'); error is tracked by `status`, not `stage`."""
    conn = _make_pre_v028_db(tmp_path)
    _insert(conn, "job-error", "error", output_video_id=3)
    V028ExportJobStages().up(conn)
    assert _stage(conn, "job-error") == "queued"


def test_output_key_stays_null_for_existing_rows(tmp_path):
    conn = _make_pre_v028_db(tmp_path)
    _insert(conn, "job-any", "processing", modal_call_id="fc-1")
    V028ExportJobStages().up(conn)
    ok = conn.execute("SELECT output_key FROM export_jobs WHERE id = 'job-any'").fetchone()[0]
    assert ok is None


def test_noop_on_missing_export_jobs_table(tmp_path):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables at all
    V028ExportJobStages().up(conn)  # must not raise
