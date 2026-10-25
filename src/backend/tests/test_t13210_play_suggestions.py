"""T13210: play_suggestions table (v059) + import / list / shift / accept / dismiss / remove.

Real handlers against a real head-schema profile DB (ensure_database); only R2 is untouched.
"""
import asyncio
import shutil
import sqlite3
import uuid

import pytest
from fastapi import HTTPException

from app.database import USER_DATA_BASE, ensure_database, get_db_connection
from app.profile_context import set_current_profile_id
from app.user_context import set_current_user_id

PROFILE_ID = "testdefault"


@pytest.fixture
def db():
    user_id = f"test_t13210_{uuid.uuid4().hex[:8]}"
    set_current_user_id(user_id)
    set_current_profile_id(PROFILE_ID)
    ensure_database()
    yield user_id
    shutil.rmtree(USER_DATA_BASE / user_id, ignore_errors=True)


@pytest.fixture
def sg():
    from app.routers import suggestions
    return suggestions


def _add_game(*, durations=(600.0,), plays_only=False):
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO games (name, blake3_hash, status, plays_only_at) VALUES ('G', 'h1', 'ready', ?)",
            ("2026-01-01" if plays_only else None,),
        )
        gid = cur.lastrowid
        for i, d in enumerate(durations, start=1):
            cur.execute(
                "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration) VALUES (?, ?, ?, ?)",
                (gid, f"h{i}", i, d),
            )
        conn.commit()
    return gid


MOMENTS = [
    {"start": 100.0, "end": 115.0, "labels": ["Goal", "Shot on goal"]},
    {"start": 200.0, "end": 212.0, "labels": ["Attack"]},
]


def _import(sg, gid, moments=MOMENTS, seq=1):
    body = sg.ImportSuggestionsRequest(source="veo_zip", video_sequence=seq, moments=moments)
    return asyncio.run(sg.import_suggestions(gid, body))


def _rows(gid):
    with get_db_connection() as conn:
        return conn.execute(
            "SELECT * FROM play_suggestions WHERE game_id = ? ORDER BY start_time", (gid,)
        ).fetchall()


def test_fresh_db_has_table(db):
    with get_db_connection() as conn:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(play_suggestions)").fetchall()}
    assert {"game_id", "import_id", "video_sequence", "start_time", "end_time",
            "labels", "state", "raw_clip_id", "created_at"} <= cols


def test_migration_v059_adds_table_to_older_db(tmp_path):
    from app.migrations.profile_db.v059_play_suggestions import V059PlaySuggestions
    conn = sqlite3.connect(str(tmp_path / "p.sqlite"))
    conn.execute("CREATE TABLE games (id INTEGER PRIMARY KEY)")
    conn.execute("CREATE TABLE raw_clips (id INTEGER PRIMARY KEY)")
    V059PlaySuggestions().up(conn)
    V059PlaySuggestions().up(conn)  # idempotent
    assert conn.execute("SELECT COUNT(*) FROM play_suggestions").fetchone()[0] == 0


def test_import_twice_is_idempotent(db, sg):
    gid = _add_game()
    first = _import(sg, gid)
    second = _import(sg, gid)
    assert len(_rows(gid)) == 2
    assert first["inserted"] == 2 and second["inserted"] == 0
    assert second["import_id"] == first["import_id"]


def test_import_rejects_missing_video_and_short_video(db, sg):
    gid = _add_game(durations=(150.0,))
    with pytest.raises(HTTPException) as e:
        _import(sg, gid, seq=2)
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        _import(sg, gid)  # last end 212 > 150
    assert e.value.status_code == 422
    assert _rows(gid) == []


def test_import_refuses_plays_only_game(db, sg):
    gid = _add_game(plays_only=True)
    with pytest.raises(HTTPException) as e:
        _import(sg, gid)
    assert e.value.status_code == 409 and e.value.detail["code"] == "plays_only"


def test_shift_moves_only_that_import(db, sg):
    gid = _add_game(durations=(600.0, 600.0))
    a = _import(sg, gid)
    b = _import(sg, gid, moments=[{"start": 300.0, "end": 310.0, "labels": ["Goal"]}], seq=2)
    asyncio.run(sg.shift_import(gid, sg.ShiftRequest(import_id=a["import_id"], delta_s=-2.0)))
    starts = {r["start_time"]: r["import_id"] for r in _rows(gid)}
    assert set(starts) == {98.0, 198.0, 300.0}
    assert starts[300.0] == b["import_id"]
    ends = sorted(r["end_time"] for r in _rows(gid))
    assert ends == [113.0, 210.0, 310.0]


def test_shift_clamps_at_zero_and_unknown_import_404(db, sg):
    gid = _add_game()
    a = _import(sg, gid, moments=[{"start": 1.0, "end": 9.0, "labels": ["Goal"]}])
    asyncio.run(sg.shift_import(gid, sg.ShiftRequest(import_id=a["import_id"], delta_s=-5.0)))
    assert _rows(gid)[0]["start_time"] == 0.0
    with pytest.raises(HTTPException) as e:
        asyncio.run(sg.shift_import(gid, sg.ShiftRequest(import_id="nope", delta_s=1.0)))
    assert e.value.status_code == 404


def test_accept_creates_rated_play_and_links(db, sg):
    gid = _add_game()
    _import(sg, gid)
    sid = _rows(gid)[0]["id"]
    out = asyncio.run(sg.accept_suggestion(
        sid, sg.AcceptRequest(rating=4, name="Goal 01:40", tags=["Goal"], notes="Veo: Goal")))
    row = _rows(gid)[0]
    assert row["state"] == "accepted" and row["raw_clip_id"] == out["raw_clip_id"]
    with get_db_connection() as conn:
        clip = conn.execute("SELECT * FROM raw_clips WHERE id = ?", (out["raw_clip_id"],)).fetchone()
    assert (clip["start_time"], clip["end_time"], clip["rating"], clip["game_id"],
            clip["video_sequence"]) == (100.0, 115.0, 4, gid, 1)
    assert clip["name"] == "Goal 01:40"
    # a second accept (retry) does not create a second play
    again = asyncio.run(sg.accept_suggestion(sid, sg.AcceptRequest(rating=4, name="Goal 01:40")))
    assert again["raw_clip_id"] == out["raw_clip_id"]
    with get_db_connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM raw_clips").fetchone()[0] == 1


def test_deleting_play_reopens_suggestion(db, sg):
    from app.routers.clips import delete_raw_clip
    gid = _add_game()
    _import(sg, gid)
    sid = _rows(gid)[0]["id"]
    out = asyncio.run(sg.accept_suggestion(sid, sg.AcceptRequest(rating=5, name="x")))
    asyncio.run(delete_raw_clip(out["raw_clip_id"]))
    row = _rows(gid)[0]
    assert row["state"] == "open" and row["raw_clip_id"] is None


def test_dismiss_and_reopen(db, sg):
    gid = _add_game()
    _import(sg, gid)
    sid = _rows(gid)[0]["id"]
    asyncio.run(sg.set_state(sid, sg.StateRequest(state="dismissed")))
    assert _rows(gid)[0]["state"] == "dismissed"
    asyncio.run(sg.set_state(sid, sg.StateRequest(state="open")))
    assert _rows(gid)[0]["state"] == "open"
    with pytest.raises(HTTPException):
        asyncio.run(sg.set_state(sid, sg.StateRequest(state="accepted")))


def test_remove_import_deletes_rows_but_not_plays(db, sg):
    gid = _add_game()
    a = _import(sg, gid)
    sid = _rows(gid)[0]["id"]
    out = asyncio.run(sg.accept_suggestion(sid, sg.AcceptRequest(rating=5, name="x")))
    asyncio.run(sg.remove_import(gid, a["import_id"]))
    assert _rows(gid) == []
    with get_db_connection() as conn:
        assert conn.execute("SELECT id FROM raw_clips WHERE id = ?", (out["raw_clip_id"],)).fetchone()


def test_list_returns_all_states(db, sg):
    gid = _add_game()
    _import(sg, gid)
    sid = _rows(gid)[0]["id"]
    asyncio.run(sg.set_state(sid, sg.StateRequest(state="dismissed")))
    out = asyncio.run(sg.list_suggestions(gid))
    assert [s["state"] for s in out["suggestions"]] == ["dismissed", "open"]
    assert out["suggestions"][0]["labels"] == ["Goal", "Shot on goal"]


def test_suggestions_never_leak_into_plays_surfaces(db, sg):
    from app.routers import games as games_router
    gid = _add_game()
    _import(sg, gid)
    assert games_router.load_annotations_from_db(gid) == []
    recap = asyncio.run(games_router.get_recap_data(gid))
    assert recap.get("clips", []) == []
    load = asyncio.run(games_router.load_game(gid))
    assert load["game"]["clip_count"] == 0
    assert "suggest" not in str(load["game"]["annotations"]).lower()


def test_game_delete_cascades(db, sg):
    gid = _add_game()
    _import(sg, gid)
    with get_db_connection() as conn:
        conn.execute("DELETE FROM games WHERE id = ?", (gid,))
        conn.commit()
        assert conn.execute("SELECT COUNT(*) FROM play_suggestions").fetchone()[0] == 0


def _import_raw(sg, gid, **kw):
    body = sg.ImportSuggestionsRequest(source="veo_zip", **kw)
    return asyncio.run(sg.import_suggestions(gid, body))


def _pm(seq, labels=("Shot on goal",), start=0.0, end=10.0):
    return {"start": start, "end": end, "labels": list(labels), "video_sequence": seq}


def test_per_moment_sequence_same_labels_start_zero_two_rows(db, sg):
    gid = _add_game(durations=(60.0, 60.0))
    first = _import_raw(sg, gid, moments=[_pm(1), _pm(2)])
    assert first["inserted"] == 2
    rows = _rows(gid)
    assert sorted(r["video_sequence"] for r in rows) == [1, 2]
    assert len({r["import_id"] for r in rows}) == 1
    again = _import_raw(sg, gid, moments=[_pm(1), _pm(2)])
    assert again["inserted"] == 0 and again["import_id"] == first["import_id"]
    assert len(_rows(gid)) == 2


def test_per_moment_sequence_missing_or_short_video_422(db, sg):
    gid = _add_game(durations=(60.0, 5.0))
    with pytest.raises(HTTPException) as e:
        _import_raw(sg, gid, moments=[_pm(1), _pm(3)])
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        _import_raw(sg, gid, moments=[_pm(1), _pm(2)])  # seq 2 is 5s, end 10
    assert e.value.status_code == 422
    assert _rows(gid) == []


def test_mixed_or_absent_sequence_forms_422(db, sg):
    gid = _add_game(durations=(60.0, 60.0))
    with pytest.raises(HTTPException) as e:
        _import_raw(sg, gid, video_sequence=1, moments=[_pm(2)])
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        _import_raw(sg, gid, moments=[_pm(1), {"start": 0.0, "end": 9.0, "labels": ["Goal"]}])
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        _import_raw(sg, gid, moments=[{"start": 0.0, "end": 9.0, "labels": ["Goal"]}])
    assert e.value.status_code == 422
    assert _rows(gid) == []


def test_list_carries_each_suggestion_video_offset_for_game_axis_stamps(db, sg):
    """T13245: the row stamp is video offset + start. The list carries the offset so a
    ONE-video Veo game (clip placed at 320 s) reads "5:20", not "0:00", with no client video list."""
    gid = _add_game(durations=(25.0,))
    with get_db_connection() as conn:
        conn.execute("UPDATE game_videos SET offset_seconds = 320 WHERE game_id = ? AND sequence = 1", (gid,))
        conn.commit()
    _import_raw(sg, gid, moments=[_pm(1)])
    out = asyncio.run(sg.list_suggestions(gid))
    assert [s["video_offset_seconds"] for s in out["suggestions"]] == [320.0]


def test_list_video_offset_is_zero_for_a_normal_single_video_game(db, sg):
    gid = _add_game()
    with get_db_connection() as conn:  # every real insert writes the offset (0 for video 1)
        conn.execute("UPDATE game_videos SET offset_seconds = 0 WHERE game_id = ?", (gid,))
        conn.commit()
    _import(sg, gid)
    out = asyncio.run(sg.list_suggestions(gid))
    assert {s["video_offset_seconds"] for s in out["suggestions"]} == {0.0}


def test_list_passes_a_missing_offset_through_as_null_never_invents_one(db, sg):
    gid = _add_game()  # fixture rows carry no offset_seconds
    _import(sg, gid)
    out = asyncio.run(sg.list_suggestions(gid))
    assert {s["video_offset_seconds"] for s in out["suggestions"]} == {None}


def test_accept_and_shift_responses_carry_the_video_offset_like_the_list(db, sg):
    """The client replaces a row with these responses, so they must keep the offset (else the
    row's stamp drops to its in-video start after a keep or a nudge)."""
    gid = _add_game(durations=(25.0,))
    with get_db_connection() as conn:
        conn.execute("UPDATE game_videos SET offset_seconds = 320 WHERE game_id = ?", (gid,))
        conn.commit()
    imp = _import_raw(sg, gid, moments=[_pm(1, start=1.0, end=9.0)])
    sid = _rows(gid)[0]["id"]
    shifted = asyncio.run(sg.shift_import(gid, sg.ShiftRequest(import_id=imp["import_id"], delta_s=-1.0)))
    assert [s["video_offset_seconds"] for s in shifted["suggestions"]] == [320.0]
    kept = asyncio.run(sg.accept_suggestion(sid, sg.AcceptRequest(rating=5, name="Goal 5:20")))
    assert kept["suggestion"]["video_offset_seconds"] == 320.0
    again = asyncio.run(sg.accept_suggestion(sid, sg.AcceptRequest(rating=5, name="Goal 5:20")))
    assert again["suggestion"]["video_offset_seconds"] == 320.0
