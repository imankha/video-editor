"""T16520: the server finishes a highlight when sharpening ends.

The framing export's finalize (`finalize_export`, shared by the in-band request and the
`/modal-status` recovery) now runs the finish itself: it makes the shareable final video
from the sharpened working video, publishes it into Highlights and records
`highlight_finished` once. No browser call is involved anywhere in these tests.

Mocked: Modal detection, R2 copy/probe/poster/sync (external). Real: the profile DB,
upsert_working_video, publish_final_video, list_downloads, record_milestone.
"""

import logging
import sqlite3
from unittest.mock import patch

import pytest

from app.constants import ExportStage
from tests.test_t4050_publish_restore_roundtrip import USER_ID, env  # noqa: F401  (fixture)
from tests.test_t16510_record_finish import user_actions  # noqa: F401  (fixture)

FINISH_EVENT = "highlight_finished"


@pytest.fixture
def r2(monkeypatch):
    """External effects of a finish: the R2 copy, the dims probe, the poster, the sync."""
    calls = {"copies": [], "deletes": [], "fail_copy": False}

    async def fake_copy(user_id, source, dest):
        if calls["fail_copy"]:
            raise RuntimeError("forced R2 copy failure")
        calls["copies"].append((source, dest))
        return True

    async def fake_poster(*args, **kwargs):
        return None

    async def fake_detect(**kwargs):
        return [], {"frames": []}

    monkeypatch.setattr("app.storage.copy_file_in_r2", fake_copy)
    monkeypatch.setattr("app.services.poster.generate_poster_at_export", fake_poster)
    monkeypatch.setattr("app.routers.export.multi_clip.run_player_detection_for_highlights", fake_detect)
    monkeypatch.setattr("app.services.export_helpers.sync_export_db_to_r2", lambda u, p: True)
    monkeypatch.setattr(
        "app.services.publish_final_video.resolve_output_aspect_ratio",
        lambda **kw: kw.get("project_aspect_ratio"),
    )
    monkeypatch.setattr(
        "app.services.publish_final_video.delete_prior_final_object",
        lambda user_id, prior, new: calls["deletes"].append(prior),
    )
    return calls


def _seed_project(db_path) -> int:
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Sharpened', '9:16')")
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence) "
        "VALUES ('raw.mp4', 5, 1.0, ?, 7, 0)", (20.0 + project_id,))
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order, crop_data, segments_data) "
        "VALUES (?, ?, 1, 0, ?, ?)", (project_id, cur.lastrowid, b"\x91\x80", b"\x80"))
    conn.commit()
    conn.close()
    return project_id


def _seed_rendered_job(db_path, project_id: int, job_id: str) -> dict:
    """An export_jobs row whose Modal render is in R2 and not yet finalized."""
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT INTO export_jobs (id, project_id, type, status, input_data, stage, output_key) "
        "VALUES (?, ?, 'framing', 'processing', ?, ?, ?)",
        (job_id, project_id, b"\x80", ExportStage.RENDERED.value, f"working_videos/wv_{job_id}.mp4"))
    conn.commit()
    conn.close()
    return {"id": job_id, "project_id": project_id, "input_data": b"\x80", "output_video_id": None,
            "stage": ExportStage.RENDERED.value, "status": "processing"}


async def _sharpen(db_path, project_id: int, job_id: str) -> dict:
    from app.profile_context import get_current_profile_id
    from app.services.export_finalize import finalize_export

    job = _seed_rendered_job(db_path, project_id, job_id)
    return await finalize_export(job, output_key=f"working_videos/wv_{job_id}.mp4",
                                 user_id=USER_ID, profile_id=get_current_profile_id())


def _rows(db_path, sql, params=()):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return rows


@pytest.mark.asyncio
async def test_t16520_c1_sharpening_end_puts_the_highlight_in_highlights(env, user_actions, r2):  # noqa: F811
    db_path, _ = env
    from app.routers.downloads import list_downloads

    project_id = _seed_project(db_path)
    result = await _sharpen(db_path, project_id, "job-a")

    assert result["finalized"] is True
    highlights = (await list_downloads()).downloads
    assert [h.project_id for h in highlights] == [project_id]
    fv = _rows(db_path, "SELECT * FROM final_videos WHERE project_id = ?", (project_id,))
    assert len(fv) == 1 and fv[0]["published_at"] is not None
    assert fv[0]["source_working_video_id"] == result["working_video_id"]
    assert r2["copies"] == [("working_videos/wv_job-a.mp4",
                             f"final_videos/final_{project_id}_wv{result['working_video_id']}.mp4")]
    assert user_actions.get((USER_ID, FINISH_EVENT)) == 1
    job = _rows(db_path, "SELECT stage FROM export_jobs WHERE id = 'job-a'")[0]
    assert job["stage"] == ExportStage.COMPLETE.value
    # Archive waits for the next session's sweep (owner ruling 1).
    assert _rows(db_path, "SELECT archived_at FROM projects WHERE id = ?", (project_id,))[0]["archived_at"] is None


@pytest.mark.asyncio
async def test_t16520_c1_an_interrupted_finish_is_resumed_once(env, user_actions, r2):  # noqa: F811
    """A crash after persist (stage 'finishing') is finished by the next session's recovery."""
    db_path, _ = env
    from app.services.export_finalize import resume_interrupted_finishes

    project_id = _seed_project(db_path)
    with patch("app.services.finish_highlight.finish_highlight", side_effect=SystemExit("crash")), \
            pytest.raises(SystemExit):
        await _sharpen(db_path, project_id, "job-b")
    assert _rows(db_path, "SELECT stage FROM export_jobs WHERE id = 'job-b'")[0]["stage"] == "finishing"
    assert _rows(db_path, "SELECT id FROM final_videos WHERE project_id = ?", (project_id,)) == []

    await resume_interrupted_finishes()
    await resume_interrupted_finishes()

    fv = _rows(db_path, "SELECT published_at FROM final_videos WHERE project_id = ?", (project_id,))
    assert len(fv) == 1 and fv[0]["published_at"] is not None
    assert user_actions.get((USER_ID, FINISH_EVENT)) == 1
    assert _rows(db_path, "SELECT stage FROM export_jobs WHERE id = 'job-b'")[0]["stage"] == "complete"


@pytest.mark.asyncio
async def test_t16520_c1_resharpening_replaces_the_video_and_counts_once(env, user_actions, r2):  # noqa: F811
    db_path, _ = env
    project_id = _seed_project(db_path)
    await _sharpen(db_path, project_id, "job-c1")
    second = await _sharpen(db_path, project_id, "job-c2")

    fv = _rows(db_path, "SELECT * FROM final_videos WHERE project_id = ?", (project_id,))
    assert len(fv) == 1 and fv[0]["published_at"] is not None
    assert fv[0]["source_working_video_id"] == second["working_video_id"]
    assert user_actions.get((USER_ID, FINISH_EVENT)) == 1


@pytest.mark.asyncio
async def test_t16520_c3_spotlight_render_replaces_the_finished_video_without_a_tap(env, user_actions, r2):  # noqa: F811
    db_path, _ = env
    from app.routers.export.overlay import _finalize_overlay_export

    project_id = _seed_project(db_path)
    await _sharpen(db_path, project_id, "job-d")
    first = _rows(db_path, "SELECT id, filename FROM final_videos WHERE project_id = ?", (project_id,))[0]

    # A share link was made for the finished video before the spotlight render.
    with patch("app.services.publish_final_video.prior_final_is_shared", lambda name: True):
        new_id, *_ = _finalize_overlay_export(project_id, "final_spot.mp4", "overlay-job-d", USER_ID)

    fv = {r["id"]: r for r in _rows(db_path, "SELECT * FROM final_videos WHERE project_id = ?", (project_id,))}
    assert fv[new_id]["published_at"] is not None, "the spotlight version is in Highlights without a Finish tap"
    assert first["id"] in fv, "the shared prior row stays so its link still plays"
    assert first["filename"] not in r2["deletes"]
    assert user_actions.get((USER_ID, FINISH_EVENT)) == 1


@pytest.mark.asyncio
async def test_t16520_c4_a_failed_finish_leaves_the_old_state_and_logs(env, user_actions, r2, caplog):  # noqa: F811
    db_path, _ = env
    from app.routers.export.overlay import _finalize_overlay_export

    project_id = _seed_project(db_path)
    r2["fail_copy"] = True
    with caplog.at_level(logging.ERROR):
        result = await _sharpen(db_path, project_id, "job-e")

    assert result["finalized"] is True, "the sharpen itself is saved and announced as today"
    assert result["finish"]["finished"] is False
    assert _rows(db_path, "SELECT id FROM final_videos WHERE project_id = ?", (project_id,)) == []
    assert any("[Finish] FAILED" in r.getMessage() and f"project={project_id}" in r.getMessage()
               for r in caplog.records if r.levelno >= logging.ERROR)
    assert (USER_ID, FINISH_EVENT) not in user_actions

    # The Finish button still works: its render (no-keyframes copy) publishes the highlight.
    _finalize_overlay_export(project_id, "final_tap.mp4", "overlay-job-e", USER_ID)
    fv = _rows(db_path, "SELECT published_at FROM final_videos WHERE project_id = ?", (project_id,))
    assert len(fv) == 1 and fv[0]["published_at"] is not None


@pytest.mark.asyncio
async def test_t16520_c5_the_finish_charges_and_refunds_nothing(env, user_actions, r2):  # noqa: F811
    db_path, _ = env
    from app.services import credit_ledger

    credit_calls = []
    names = ["debit", "grant", "reserve_credits", "confirm_reservation", "release_reservation",
             "deduct_credits", "refund_credits", "refund_export_charge"]
    patches = [patch.object(credit_ledger, n, lambda *a, _n=n, **k: credit_calls.append(_n)) for n in names]
    patches.append(patch("app.services.export_helpers.refund_failed_export",
                         lambda *a, **k: credit_calls.append("refund_failed_export")))
    for p in patches:
        p.start()
    try:
        project_id = _seed_project(db_path)
        await _sharpen(db_path, project_id, "job-f")
    finally:
        for p in patches:
            p.stop()

    fv = _rows(db_path, "SELECT published_at FROM final_videos WHERE project_id = ?", (project_id,))
    assert len(fv) == 1 and fv[0]["published_at"] is not None
    assert credit_calls == []
