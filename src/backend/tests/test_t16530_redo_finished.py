"""T16530: redo a finished highlight from the Finished screen.

A redo (Add or Redo spotlight, Edit zoom) replaces the finished highlight in place:
- the old version stays in Highlights while the redo is being made (open-for-redo
  never unpublishes it, unlike restore-project's "open as draft");
- the new version replaces it when its render completes, and a share link made
  before the redo then plays the new version (moved only after the durable sync);
- Edit zoom states its credit cost first and says when the game video is gone.

Mocked: Modal, R2 copy/probe/poster/sync (external). Real: the profile DB, the
finalize/publish writers, the share rows in Postgres.
"""

import sqlite3
from unittest.mock import patch

import pytest

from tests.conftest import register_test_user_ids
from tests.test_t4050_publish_restore_roundtrip import USER_ID, env  # noqa: F401  (fixture)
from tests.test_t16510_record_finish import user_actions  # noqa: F401  (fixture)
from tests.test_t16520_server_finish import _rows, _seed_project, _sharpen, r2  # noqa: F401  (fixture)


@pytest.fixture
def sharer(pg_conn):
    from app.services.auth_db import create_user
    register_test_user_ids(USER_ID)
    create_user(USER_ID, email="t16530@example.com")
    yield


def _share(final_row) -> str:
    from app.profile_context import get_current_profile_id
    from app.services.sharing_db import create_shares
    shares = create_shares(
        video_id=final_row["id"], sharer_user_id=USER_ID, sharer_profile_id=get_current_profile_id(),
        video_filename=final_row["filename"], video_name="Before redo", video_duration=10.0,
        recipient_emails=["friend@example.com"], is_public=True,
    )
    return shares[0]["share_token"]


def _current_final(db_path, project_id):
    return _rows(db_path, "SELECT fv.id, fv.filename, fv.published_at FROM projects p "
                          "JOIN final_videos fv ON fv.id = p.final_video_id WHERE p.id = ?", (project_id,))[0]


async def _spotlight(monkeypatch, project_id, export_id, synced=True):
    """The spotlight render as the app runs it (background worker, real finalize)."""
    import app.routers.export.overlay as ov
    import app.services.export_helpers as helpers

    async def fake_modal(**kwargs):
        return {"status": "success", "gpu_seconds": 1.0, "modal_function": "test"}

    async def quiet(*a, **k):
        return None

    monkeypatch.setattr(ov, "call_modal_overlay_auto", fake_modal)
    monkeypatch.setattr(ov, "generate_poster_at_export", quiet)
    monkeypatch.setattr(ov, "resolve_output_aspect_ratio", lambda **kw: kw.get("project_aspect_ratio"))
    monkeypatch.setattr(ov, "delete_prior_final_object", lambda *a: None)
    monkeypatch.setattr(ov.manager, "send_progress", quiet)
    monkeypatch.setattr(helpers, "send_progress", quiet)
    monkeypatch.setattr(helpers, "create_progress_callback", lambda *a, **k: (lambda *x, **y: None))
    monkeypatch.setattr(helpers, "store_modal_call_id", lambda *a, **k: None)
    monkeypatch.setattr(helpers, "sync_export_db_to_r2", lambda *a, **k: synced)
    from app.profile_context import get_current_profile_id
    await ov._run_overlay_export_background(
        export_id=export_id, project_id=project_id, project_name="Redo",
        user_id=USER_ID, profile_id=get_current_profile_id(), working_filename="wv.mp4",
        highlight_regions=[], effect_type="dark_overlay", video_duration=10.0,
    )


@pytest.mark.asyncio
async def test_t16530_c2_spotlight_redo_moves_an_earlier_share_link_to_the_new_version(
        env, user_actions, r2, sharer, monkeypatch):  # noqa: F811
    db_path, _ = env
    from app.services.sharing_db import get_share_by_token

    project_id = _seed_project(db_path)
    await _sharpen(db_path, project_id, "job-a")
    token = _share(_current_final(db_path, project_id))
    conn = sqlite3.connect(str(db_path))
    conn.execute("INSERT INTO export_jobs (id, project_id, type, status, input_data) "
                 "VALUES ('spot-a', ?, 'overlay', 'processing', ?)", (project_id, b"\x80"))
    conn.commit()
    conn.close()

    await _spotlight(monkeypatch, project_id, "spot-a")

    new = _current_final(db_path, project_id)
    assert new["published_at"] is not None, "the spotlight version is in Highlights"
    share = get_share_by_token(token)
    assert share["video_filename"] == new["filename"], "the earlier link plays the new version"
    assert share["video_id"] == new["id"]


@pytest.mark.asyncio
async def test_t16530_c2_a_failed_sync_leaves_the_share_on_the_old_version(
        env, user_actions, r2, sharer, monkeypatch):  # noqa: F811
    db_path, _ = env
    from app.services.sharing_db import get_share_by_token

    project_id = _seed_project(db_path)
    await _sharpen(db_path, project_id, "job-b")
    old = _current_final(db_path, project_id)
    token = _share(old)
    conn = sqlite3.connect(str(db_path))
    conn.execute("INSERT INTO export_jobs (id, project_id, type, status, input_data) "
                 "VALUES ('spot-b', ?, 'overlay', 'processing', ?)", (project_id, b"\x80"))
    conn.commit()
    conn.close()

    await _spotlight(monkeypatch, project_id, "spot-b", synced=False)

    assert get_share_by_token(token)["video_filename"] == old["filename"]


@pytest.mark.asyncio
async def test_t16530_c3_a_second_sharpen_moves_an_earlier_share_link(env, user_actions, r2, sharer):  # noqa: F811
    db_path, _ = env
    from app.services.sharing_db import get_share_by_token

    project_id = _seed_project(db_path)
    await _sharpen(db_path, project_id, "job-c1")
    token = _share(_current_final(db_path, project_id))

    result = await _sharpen(db_path, project_id, "job-c2")

    assert result["finish"]["finished"] is True
    new = _current_final(db_path, project_id)
    share = get_share_by_token(token)
    assert share["video_filename"] == new["filename"], "the earlier link plays the re-sharpened version"
    assert share["video_id"] == new["id"]


@pytest.mark.asyncio
async def test_t16530_c4_opening_a_finished_highlight_for_redo_keeps_it_in_highlights(env, user_actions, r2):  # noqa: F811
    db_path, _ = env
    from app.routers.downloads import list_downloads, open_for_redo
    from app.services.project_archive import archive_completed_projects

    project_id = _seed_project(db_path)
    await _sharpen(db_path, project_id, "job-d")
    final = _current_final(db_path, project_id)
    with patch("app.services.project_archive.R2_ENABLED", False):
        archive_completed_projects()

    result = await open_for_redo(final["id"])

    assert result["project_id"] == project_id
    assert _current_final(db_path, project_id)["published_at"] is not None, "never unpublished"
    listed = await list_downloads()
    assert final["id"] in [d.id for d in listed.downloads], "the old version is still in Highlights"
    clips = _rows(db_path, "SELECT id FROM working_clips WHERE project_id = ?", (project_id,))
    assert clips, "the crop and spotlight data are there to edit"


@pytest.mark.asyncio
async def test_t16530_c3_redo_info_states_the_sharpen_cost(env, user_actions, r2):  # noqa: F811
    db_path, _ = env
    from app.routers.downloads import redo_info

    project_id = _seed_project(db_path)  # raw clip 1.0 -> 20+id seconds, no trim
    await _sharpen(db_path, project_id, "job-e")
    final = _current_final(db_path, project_id)

    info = await redo_info(final["id"])

    assert info["project_id"] == project_id
    assert info["reframe_credits"] == 19 + project_id
    assert info["game_video_available"] is True


@pytest.mark.asyncio
async def test_t16530_c3_redo_info_says_when_the_game_video_is_gone(env, user_actions, r2):  # noqa: F811
    db_path, _ = env
    from app.routers.downloads import redo_info

    project_id = _seed_project(db_path)
    await _sharpen(db_path, project_id, "job-f")
    final = _current_final(db_path, project_id)
    conn = sqlite3.connect(str(db_path))
    conn.execute("INSERT INTO games (id, name, blake3_hash, status) VALUES (7, 'Game', 'abc123', 'ready')")
    conn.execute("INSERT INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) VALUES ('abc123', 100, '2020-01-01T00:00:00')")
    conn.commit()
    conn.close()

    info = await redo_info(final["id"])

    assert info["game_video_available"] is False
