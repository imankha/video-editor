"""
T5260 — Publish must freeze the CURRENT project name into final_videos.name.

Bug: `publish_to_my_reels` set only `published_at`/`watched_at`. The name is
frozen once, at render time (INSERT in overlay.py), and never re-read. A
draft renamed AFTER render but BEFORE "Move to My Reels" silently kept its
stale render-time name in the gallery (live repro: dev user
3ed03fb5-949d-4cfd-b708-0c758ea68ef3, project 31 / final_video 74).

Fix: `publish_to_my_reels` now reads `projects.name` at publish time and
writes it into `final_videos.name` alongside `published_at`. NULL project
name keeps the existing frozen name (no silent NULL overwrite) and logs at
info. The published-reel rename endpoint (`PATCH /{id}/name`) is untouched
and still works after publish.
"""

import sqlite3
from unittest.mock import patch

import pytest

USER_ID = "t5260-user"
PROFILE_ID = "testdefault"


@pytest.fixture()
def env(tmp_path):
    """Real profile DB (via ensure_database), R2 sync disabled (durable_sync
    dependency is bypassed by calling the handler function directly, so no
    fake R2 is needed here -- unlike the T4050 roundtrip test, we never call
    through archive_project)."""
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        db_path = get_database_path()
        yield db_path


def _connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_project_and_final(db_path, *, project_name, final_name, published=False):
    """A minimal project + rendered final_video, pointers wired. Returns
    (project_id, final_video_id). `project_name=None` is a placeholder --
    `projects.name` is NOT NULL in the schema, so the caller deletes the
    project row afterward to reach the actual "missing" state (see
    `_delete_project_row_only`; T4800: final_videos.project_id has no
    ON DELETE CASCADE, so a dangling reference is a reachable state, e.g. a
    concurrent project delete racing an in-flight publish)."""
    conn = _connect(db_path)
    cur = conn.cursor()

    cur.execute(
        "INSERT INTO projects (name, aspect_ratio) VALUES (?, '9:16')",
        (project_name or "placeholder-to-be-deleted",))
    project_id = cur.lastrowid

    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence) "
        "VALUES ('raw56.mp4', 5, 3566.0, 3625.0, 7, 0)")
    raw_clip_id = cur.lastrowid

    published_at_clause = "CURRENT_TIMESTAMP" if published else "NULL"
    cur.execute(
        "INSERT INTO final_videos "
        "(project_id, filename, version, source_type, name, duration, aspect_ratio, "
        " clip_count, source_clip_id, published_at) "
        f"VALUES (?, 'final_9x16.mp4', 1, 'custom_project', ?, 59.4, "
        f" '9:16', 1, ?, {published_at_clause})",
        (project_id, final_name, raw_clip_id))
    final_video_id = cur.lastrowid

    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?",
                (final_video_id, project_id))
    conn.commit()
    conn.close()
    return project_id, final_video_id


def _delete_project_row_only(db_path, project_id):
    """Delete the projects row while leaving final_videos.project_id dangling
    -- reachable per T4800 (no ON DELETE CASCADE on that FK)."""
    conn = _connect(db_path)
    conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    conn.commit()
    conn.close()


def _final_name(db_path, final_video_id):
    conn = _connect(db_path)
    row = conn.execute(
        "SELECT name, published_at FROM final_videos WHERE id = ?",
        (final_video_id,)).fetchone()
    conn.close()
    return row["name"], row["published_at"]


async def _publish(project_id):
    """Call the handler directly (bypasses the durable_sync FastAPI dependency
    and archive_project's R2 requirement is sidestepped by patching it out --
    this test is about the name freeze, not the archive round trip)."""
    from app.routers.downloads import publish_to_my_reels
    with patch("app.routers.downloads.archive_project", return_value=False), \
         patch("app.routers.downloads.sync_db_to_r2_explicit", return_value=True):
        return await publish_to_my_reels(project_id)


@pytest.mark.asyncio
async def test_publish_freezes_current_project_name_after_draft_rename(env):
    """Rename a draft AFTER render, then publish -- final_videos.name must
    pick up the NEW project name, not the stale render-time name."""
    db_path = env

    project_id, final_video_id = _seed_project_and_final(
        db_path, project_name="Brilliant Control", final_name="Brilliant Control")

    # Draft rename gesture after render, before publish.
    conn = _connect(db_path)
    conn.execute("UPDATE projects SET name = ? WHERE id = ?",
                 ("Brilliant Control - From Air.  Test Intro Image", project_id))
    conn.commit()
    conn.close()

    result = await _publish(project_id)

    name, published_at = _final_name(db_path, final_video_id)
    assert name == "Brilliant Control - From Air.  Test Intro Image"
    assert published_at is not None
    assert result["success"] is True
    assert result["final_video_id"] == final_video_id


@pytest.mark.asyncio
async def test_publish_never_renamed_draft_unchanged(env):
    """A draft that was never renamed between render and publish keeps the
    same (already-correct) name -- no regression for the common case."""
    db_path = env

    project_id, final_video_id = _seed_project_and_final(
        db_path, project_name="Ankle Breaker", final_name="Ankle Breaker")

    await _publish(project_id)

    name, published_at = _final_name(db_path, final_video_id)
    assert name == "Ankle Breaker"
    assert published_at is not None


@pytest.mark.asyncio
async def test_publish_null_project_name_keeps_existing_frozen_name(env, caplog):
    """If the project row is missing/gone at publish time (dangling
    final_videos.project_id, T4800), keep the existing frozen
    final_videos.name rather than writing NULL over it, and publish must
    still succeed."""
    db_path = env

    project_id, final_video_id = _seed_project_and_final(
        db_path, project_name="placeholder", final_name="Brilliant Dribble")
    _delete_project_row_only(db_path, project_id)

    import logging
    with caplog.at_level(logging.INFO):
        result = await _publish(project_id)

    name, published_at = _final_name(db_path, final_video_id)
    assert name == "Brilliant Dribble"
    assert published_at is not None
    assert result["success"] is True
    assert any("[Publish]" in r.message and "name" in r.message.lower()
               for r in caplog.records), \
        "expected an info log noting the NULL project name was skipped"


@pytest.mark.asyncio
async def test_gallery_rename_after_publish_still_works(env):
    """The published-reel rename endpoint (PATCH /{id}/name) must still work
    on an already-published reel -- publish's name freeze must not interfere
    with post-publish renames."""
    db_path = env

    project_id, final_video_id = _seed_project_and_final(
        db_path, project_name="Original Name", final_name="Original Name")

    await _publish(project_id)

    from app.routers.downloads import rename_download
    rename_result = await rename_download(final_video_id, {"name": "Renamed In Gallery"})

    assert rename_result["success"] is True
    name, _ = _final_name(db_path, final_video_id)
    assert name == "Renamed In Gallery"
