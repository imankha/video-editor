"""T4790 regression tests for the three F821 undefined-name bugs found during
the lint-backlog triage. Each of these was a latent NameError that would fire at
runtime on a specific code path; each test below fails on the pre-fix code.

Bugs:
  1. exports.finalize_modal_export returned an undefined `presigned_url` on its
     success path -> the whole recovered-export finalization always fell into the
     `except` and returned {"finalized": False}.
  2. games_upload used generate_presigned_url_global without importing it.
  3. export/multi_clip._run_multi_clip_background used canonicalize_segments_data
     (a function-local import present in a *different* function) without importing
     it in this function -> NameError whenever a clip carried segments_data.
"""
import ast
import sqlite3
from contextlib import contextmanager
from pathlib import Path


def _in_memory_db():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        "CREATE TABLE export_jobs (id TEXT PRIMARY KEY, project_id INTEGER, "
        "status TEXT, output_video_id INTEGER, output_filename TEXT, completed_at TEXT)"
    )
    cur.execute("CREATE TABLE projects (id INTEGER PRIMARY KEY, working_video_id INTEGER)")
    cur.execute(
        "CREATE TABLE working_videos (id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "project_id INTEGER, filename TEXT)"
    )
    cur.execute("INSERT INTO projects (id, working_video_id) VALUES (?, ?)", (42, None))
    cur.execute(
        "INSERT INTO export_jobs (id, project_id, status) VALUES (?, ?, ?)",
        ("job-1", 42, "processing"),
    )
    conn.commit()
    return conn


def test_finalize_modal_export_success_path_no_undefined_name(monkeypatch):
    """Bug 1: the success path must return finalized=True, not crash on an
    undefined `presigned_url`. Pre-fix this returned {"finalized": False}."""
    from app.routers import exports

    conn = _in_memory_db()

    @contextmanager
    def _fake_conn():
        yield conn  # shared connection; do not close between calls

    monkeypatch.setattr(exports, "get_db_connection", _fake_conn)
    monkeypatch.setattr(exports, "record_milestone", lambda *a, **k: None)

    result = exports.finalize_modal_export(
        job={"id": "job-1", "project_id": 42},
        modal_result={"output_key": "working_videos/working_42_abc.mp4"},
        user_id="user-1",
    )

    assert result["finalized"] is True, result
    assert "presigned_url" not in result  # generated on-the-fly, never stored here
    assert result["output_filename"] == "working_42_abc.mp4"


def test_games_upload_imports_generate_presigned_url_global():
    """Bug 2: the name must resolve in the games_upload module namespace."""
    from app.routers import games_upload

    assert callable(games_upload.generate_presigned_url_global)


def test_multi_clip_background_imports_canonicalize():
    """Bug 3: _run_multi_clip_background must import canonicalize_segments_data
    within its own body (the sibling function's import does not reach it)."""
    src = Path(__file__).resolve().parents[1] / "app" / "routers" / "export" / "multi_clip.py"
    tree = ast.parse(src.read_text(encoding="utf-8"))

    fn = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "_run_multi_clip_background"
    )
    imported = {
        alias.name
        for node in ast.walk(fn)
        if isinstance(node, ast.ImportFrom)
        for alias in node.names
    }
    assert "canonicalize_segments_data" in imported
