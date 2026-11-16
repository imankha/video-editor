"""T16540: finish the highlights stranded before the server finish (T16520) shipped.

A stranded highlight is a non-archived project the parent paid to sharpen whose latest
video never reached Highlights: (a) a working video and no final video at all (sharpened,
Finish never tapped), or (b) a latest final video that is unpublished (spotlight rendered,
Finish never tapped). The owner's next session finishes them before the archive sweep.

Mocked: R2 copy/probe/poster/sync (external). Real: the profile DB, publish_final_video,
mark_published, list_downloads, record_milestone, user_session_init.
"""

import logging
import sqlite3
from unittest.mock import patch
from uuid import uuid4

import pytest

from tests.test_t16510_record_finish import user_actions  # noqa: F401  (fixture)
from tests.test_t16520_server_finish import r2  # noqa: F401  (fixture)

FINISH_EVENT = "highlight_finished"


def _seed_stranded(db_path, *, spotlight: bool) -> dict:
    """A sharpened project; with `spotlight`, also its rendered but unpublished final video."""
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Stranded', '9:16')")
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, video_sequence) "
        "VALUES ('raw.mp4', 5, 1.0, ?, 7, 0)", (20.0 + project_id,))
    cur.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order, crop_data, segments_data) "
        "VALUES (?, ?, 1, 0, ?, ?)", (project_id, cur.lastrowid, b"\x91\x80", b"\x80"))
    cur.execute(
        "INSERT INTO working_videos (project_id, filename, version, duration) VALUES (?, ?, 1, 4.0)",
        (project_id, f"wv_{project_id}.mp4"))
    working_video_id = cur.lastrowid
    cur.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (working_video_id, project_id))
    final_video_id = None
    if spotlight:
        cur.execute(
            "INSERT INTO final_videos (project_id, filename, version, duration, aspect_ratio, name) "
            "VALUES (?, ?, 1, 4.0, '9:16', 'Stranded')", (project_id, f"final_spot_{project_id}.mp4"))
        final_video_id = cur.lastrowid
        cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (final_video_id, project_id))
    conn.commit()
    conn.close()
    return {"project_id": project_id, "working_video_id": working_video_id,
            "final_video_id": final_video_id}


def _rows(db_path, sql, params=()):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    conn.close()
    return rows



@pytest.fixture
def account(r2):  # noqa: F811
    """A registered account and profile; `open()` is the owner's next session start."""
    from app.database import ensure_database, get_database_path
    from app.profile_context import set_current_profile_id
    from app.services.user_db import create_profile, ensure_user_database, set_selected_profile_id
    from app.session_init import _init_cache, user_session_init
    from app.user_context import set_current_user_id

    uid = f"t16540_{uuid4().hex[:8]}"
    pid = uuid4().hex[:8]
    set_current_user_id(uid)
    set_current_profile_id(pid)
    ensure_user_database(uid)
    ensure_database()
    create_profile(uid, pid, "Test", "#000", is_default=True)
    set_selected_profile_id(uid, pid)
    archived = []

    def open_session():
        _init_cache.pop(uid, None)
        # The archive sweep's R2 upload is external; record which projects it archives.
        with patch("app.services.project_archive.archive_project",
                   lambda project_id, user_id: archived.append(project_id) or True):
            user_session_init(uid)

    return {"uid": uid, "db": get_database_path(), "open": open_session, "archived": archived}


@pytest.mark.asyncio
async def test_t16540_c1_a_stranded_highlight_is_in_highlights_marked_new(account, user_actions, r2):  # noqa: F811
    from app.routers.downloads import list_downloads

    s = _seed_stranded(account["db"], spotlight=False)
    account["open"]()

    highlights = (await list_downloads()).downloads
    assert [h.project_id for h in highlights] == [s["project_id"]]
    fv = _rows(account["db"], "SELECT * FROM final_videos WHERE project_id = ?", (s["project_id"],))
    assert len(fv) == 1 and fv[0]["published_at"] is not None
    assert fv[0]["watched_at"] is None, "the highlight carries the 'new' mark"
    assert r2["copies"] == [(f"working_videos/wv_{s['project_id']}.mp4",
                             f"final_videos/final_{s['project_id']}_wv{s['working_video_id']}.mp4")]
    assert account["archived"] == [s["project_id"]], "finished before the session's archive sweep"
    assert (account["uid"], FINISH_EVENT) not in user_actions, "a backfill is not a parent's finish"


@pytest.mark.asyncio
async def test_t16540_c2_a_stranded_spotlight_keeps_its_spotlight(account, user_actions, r2):  # noqa: F811
    from app.routers.downloads import list_downloads

    s = _seed_stranded(account["db"], spotlight=True)
    account["open"]()

    fv = _rows(account["db"], "SELECT * FROM final_videos WHERE project_id = ?", (s["project_id"],))
    assert len(fv) == 1, "no new version replaces the rendered spotlight"
    assert fv[0]["id"] == s["final_video_id"] and fv[0]["filename"] == f"final_spot_{s['project_id']}.mp4"
    assert fv[0]["published_at"] is not None and fv[0]["watched_at"] is None
    assert r2["copies"] == []
    assert [h.id for h in (await list_downloads()).downloads] == [s["final_video_id"]]
    assert (account["uid"], FINISH_EVENT) not in user_actions


def test_t16540_c3_an_expired_source_is_skipped_and_counted(account, user_actions, r2, caplog):  # noqa: F811
    expired = _seed_stranded(account["db"], spotlight=False)
    ok = _seed_stranded(account["db"], spotlight=True)
    r2["fail_copy"] = True
    with caplog.at_level(logging.INFO):
        account["open"]()  # loads normally: never raises

    assert _rows(account["db"], "SELECT id FROM final_videos WHERE project_id = ?",
                 (expired["project_id"],)) == []
    assert _rows(account["db"], "SELECT published_at FROM final_videos WHERE project_id = ?",
                 (ok["project_id"],))[0]["published_at"] is not None
    assert any("[FinishStranded]" in r.getMessage() and "finished=1" in r.getMessage()
               and "failed=1" in r.getMessage() for r in caplog.records)


def test_t16540_c4_finishing_stranded_highlights_charges_nothing(account, user_actions, r2):  # noqa: F811
    from app.services import credit_ledger

    _seed_stranded(account["db"], spotlight=False)
    _seed_stranded(account["db"], spotlight=True)
    credit_calls = []
    names = ["debit", "grant", "set_balance", "reserve_credits", "confirm_reservation",
             "release_reservation", "deduct_credits", "refund_credits", "refund_export_charge"]
    patches = [patch.object(credit_ledger, n, lambda *a, _n=n, **k: credit_calls.append(_n)) for n in names]
    patches.append(patch("app.services.export_helpers.refund_failed_export",
                         lambda *a, **k: credit_calls.append("refund_failed_export")))
    # Session start's own credit steps (welcome grant, orphaned reservations) are not the finish.
    patches.append(patch("app.services.storage_credits.grant_welcome_credits", lambda u: {"granted": 0}))
    patches.append(patch("app.services.credit_ledger.recover_orphaned_reservations", lambda u: 0))
    for p in patches:
        p.start()
    try:
        account["open"]()
    finally:
        for p in patches:
            p.stop()

    published = _rows(account["db"], "SELECT id FROM final_videos WHERE published_at IS NOT NULL")
    assert len(published) == 2
    assert credit_calls == []


def test_t16540_c5_a_second_open_changes_nothing(account, user_actions, r2):  # noqa: F811
    _seed_stranded(account["db"], spotlight=False)
    _seed_stranded(account["db"], spotlight=True)
    account["open"]()
    before = _rows(account["db"], "SELECT * FROM final_videos ORDER BY id")
    assert len(before) == 2 and all(r["published_at"] for r in before)
    copies = list(r2["copies"])

    account["open"]()

    assert _rows(account["db"], "SELECT * FROM final_videos ORDER BY id") == before
    assert r2["copies"] == copies


def test_t16540_leaves_alone_an_export_in_flight_and_archived_projects(account, user_actions, r2, caplog):  # noqa: F811
    in_flight = _seed_stranded(account["db"], spotlight=False)
    archived = _seed_stranded(account["db"], spotlight=True)
    finishable = _seed_stranded(account["db"], spotlight=False)
    conn = sqlite3.connect(str(account["db"]))
    conn.execute("INSERT INTO export_jobs (id, project_id, type, status, input_data) "
                 "VALUES ('job-live', ?, 'framing', 'processing', ?)", (in_flight["project_id"], b"\x80"))
    conn.execute("UPDATE projects SET archived_at = CURRENT_TIMESTAMP WHERE id = ?", (archived["project_id"],))
    conn.commit()
    conn.close()

    with caplog.at_level(logging.INFO):
        account["open"]()

    published = _rows(account["db"], "SELECT project_id FROM final_videos WHERE published_at IS NOT NULL")
    assert [r["project_id"] for r in published] == [finishable["project_id"]]
    assert any("[FinishStranded]" in r.getMessage() and "skipped_active=1" in r.getMessage()
               for r in caplog.records)
