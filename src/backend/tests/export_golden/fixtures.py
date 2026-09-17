"""Fixture-project + fixture-media builders shared by the T4370 golden tests.

Mirrors the minimal-inline-INSERT pattern already used by
tests/test_t4350_carry_finalize.py (no shared "build a fixture project" helper
existed before this harness -- see the Code Expert audit).
"""

import subprocess
import tempfile
import uuid
from pathlib import Path

from app.database import get_db_connection
from .snapshot import canonicalize_row

# Columns that are ALREADY-ENCODED msgpack blobs -- decode before diffing so the
# golden is readable JSON, not opaque bytes that flake on msgpack key ordering.
TABLE_BLOB_FIELDS = {
    "working_videos": ("highlights_data", "detections_data", "framing_snapshot"),
    "final_videos": ("tags", "game_ids"),
    "export_jobs": ("input_data",),
    "raw_clips": ("tags", "default_highlight_regions", "tagged_teammates"),
    "working_clips": ("crop_data", "timing_data", "segments_data"),
}

# Columns that are nondeterministic (UUID-suffixed filenames, wall-clock
# timestamps) and therefore masked to a fixed placeholder -- the golden pins
# SHAPE (which columns a writer sets vs. leaves NULL), not incidental randomness.
TABLE_MASK_FIELDS = {
    "working_videos": ("filename", "created_at"),
    "final_videos": ("filename", "created_at", "published_at"),
    "export_jobs": ("id", "started_at", "completed_at", "created_at", "output_filename", "output_key"),
    "working_clips": ("exported_at", "created_at"),
    "raw_clips": ("filename", "boundaries_updated_at", "created_at"),
    "projects": ("created_at", "last_opened_at"),
}

# Keys INSIDE a decoded blob dict that are legitimately nondeterministic in
# production too (a real user_id, a real tmp render path) -- not a test
# artifact, so masked rather than pinned literally.
TABLE_BLOB_SUBFIELD_MASKS = {
    "export_jobs": {"input_data": ("credit_user_id", "video_path")},
}


def generate_tiny_mp4(duration: int = 1, size: str = "180x320", fps: int = 15) -> bytes:
    """Render a tiny faststart MP4 via ffmpeg lavfi (no network, deterministic
    frames) -- mirrors app/routers/test_seams.py::_generate_tiny_mp4."""
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "fixture.mp4"
        subprocess.run(
            [
                "ffmpeg", "-y", "-f", "lavfi",
                "-i", f"testsrc=size={size}:rate={fps}:duration={duration}",
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", str(out),
            ],
            check=True, capture_output=True, timeout=30,
        )
        return out.read_bytes()


def write_tiny_mp4(path: Path, duration: int = 1, size: str = "180x320", fps: int = 15) -> Path:
    """Same as generate_tiny_mp4 but writes directly to `path` (for stubs that
    need a real on-disk file, e.g. the sweep/worker triggers' ffmpeg boundary)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", f"testsrc=size={size}:rate={fps}:duration={duration}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", str(path),
        ],
        check=True, capture_output=True, timeout=30,
    )
    return path


class FakeUploadFile:
    """Minimal stand-in for FastAPI's UploadFile -- `_export_clips`/
    `process_single_clip` only call `.read()` (Modal branch also `.seek(0)`)."""

    def __init__(self, content: bytes):
        self._content = content

    async def read(self) -> bytes:
        return self._content

    async def seek(self, offset: int) -> None:
        return None


def new_test_user_id(slug: str) -> str:
    """A fresh, never-before-seen user id -> a brand-new profile.sqlite with
    autoincrement ids starting at 1, so project_id/working_video_id etc. are
    deterministic within a single test run (no cross-test row pollution)."""
    return f"test_t4370_{slug}_{uuid.uuid4().hex[:8]}"


def build_fixture_project(
    *,
    name: str = "T4370 Golden Fixture",
    aspect_ratio: str = "9:16",
    clip_count: int = 1,
    raw_duration: float = 5.0,
) -> dict:
    """Seed a minimal project + N working_clips (+ backing raw_clips rows) on
    the CURRENT profile connection. Caller must have already called
    set_current_user_id/set_current_profile_id.

    Returns {"project_id", "working_clip_ids", "raw_clip_ids"}.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES (?, ?)",
            (name, aspect_ratio),
        )
        project_id = cursor.lastrowid

        raw_clip_ids = []
        working_clip_ids = []
        for i in range(clip_count):
            cursor.execute(
                """INSERT INTO raw_clips (filename, rating, start_time, end_time, video_sequence)
                   VALUES (?, ?, ?, ?, ?)""",
                (f"raw_fixture_{i}.mp4", 5, 0.0, raw_duration, 1),
            )
            raw_clip_id = cursor.lastrowid
            raw_clip_ids.append(raw_clip_id)

            cursor.execute(
                """INSERT INTO working_clips
                       (project_id, raw_clip_id, uploaded_filename, sort_order, version)
                   VALUES (?, ?, ?, ?, 1)""",
                (project_id, raw_clip_id, f"wc_fixture_{i}.mp4", i),
            )
            working_clip_ids.append(cursor.lastrowid)

        conn.commit()

    return {
        "project_id": project_id,
        "working_clip_ids": working_clip_ids,
        "raw_clip_ids": raw_clip_ids,
    }


def cleanup_fixture_project(project_id: int) -> None:
    """Best-effort teardown; each test's own user gets a fresh profile.sqlite
    per run, so this is belt-and-suspenders, not load-bearing for isolation."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE projects SET working_video_id = NULL, final_video_id = NULL WHERE id = ?", (project_id,))
        cursor.execute("DELETE FROM export_jobs WHERE project_id = ?", (project_id,))
        cursor.execute(
            "DELETE FROM raw_clips WHERE id IN (SELECT raw_clip_id FROM working_clips WHERE project_id = ?)",
            (project_id,),
        )
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM final_videos WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def _fetch_rows(cursor, sql: str, params: tuple, table: str) -> list:
    cursor.execute(sql, params)
    blob_fields = TABLE_BLOB_FIELDS.get(table, ())
    mask_fields = TABLE_MASK_FIELDS.get(table, ())
    blob_subfield_masks = TABLE_BLOB_SUBFIELD_MASKS.get(table)
    return [
        canonicalize_row(r, blob_fields=blob_fields, mask_fields=mask_fields, blob_subfield_masks=blob_subfield_masks)
        for r in cursor.fetchall()
    ]


def snapshot_project_tables(project_id: int) -> dict:
    """The full DB-delta snapshot for a project-scoped trigger: every column of
    working_videos/final_videos/export_jobs/projects (+ working_clips/raw_clips,
    which several finalizers also mutate -- T8070 reel-source window, exported_at)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        return {
            "projects": _fetch_rows(
                cursor, "SELECT * FROM projects WHERE id = ? ORDER BY id", (project_id,), "projects"
            ),
            "working_videos": _fetch_rows(
                cursor, "SELECT * FROM working_videos WHERE project_id = ? ORDER BY id", (project_id,), "working_videos"
            ),
            "final_videos": _fetch_rows(
                cursor, "SELECT * FROM final_videos WHERE project_id = ? ORDER BY id", (project_id,), "final_videos"
            ),
            "export_jobs": _fetch_rows(
                cursor, "SELECT * FROM export_jobs WHERE project_id = ? ORDER BY id", (project_id,), "export_jobs"
            ),
            "working_clips": _fetch_rows(
                cursor, "SELECT * FROM working_clips WHERE project_id = ? ORDER BY id", (project_id,), "working_clips"
            ),
            "raw_clips": _fetch_rows(
                cursor,
                """SELECT rc.* FROM raw_clips rc
                   JOIN working_clips wc ON wc.raw_clip_id = rc.id
                   WHERE wc.project_id = ? ORDER BY rc.id""",
                (project_id,),
                "raw_clips",
            ),
        }
