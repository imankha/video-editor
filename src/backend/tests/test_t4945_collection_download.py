"""T4945 -- Core stitch + owner collection download.

`GET /api/collections/download?scope_type&aspect_ratio&game_id?&tags?&budget_sec?`
streams a collection as ONE stitched MP4: members in rank/playback order, the
collection's OWN resolved intro card at the front, exactly ONE branded outro at
the end. Read-only over member sources throughout; the only writes are to a
per-request temp dir (rmtree'd) + a disposable `temp/collection_stitch/` R2
scratch key (best-effort deleted) -- nothing touches final_videos/export_jobs.

Compute location honors MODAL_ENABLED (EPIC decision 1): local ffmpeg when
false, the CPU-only Modal `stitch_members` function when true. The intro/outro
compose ALWAYS runs app-side (the card render engines are app-side; T3950
invariant) -- Modal only ever muxes the raw member concat.

These tests patch the ffmpeg / R2 / Modal boundaries (there is no real R2 or
ffmpeg in the unit sandbox) and assert the CONTROL FLOW + the invariants:
segment order, single outro, compute-location branch, non-fatal degradation,
never-touch-a-source, and the "resolve everything before the generator runs"
gotcha. Real mixed-resolution validity is a QA/e2e (real-ffmpeg) concern.

Pre-implementation this whole file is RED: the route 404s and the helpers
`app.routers.collections._stitch_members_local` /
`app.services.modal_client.call_modal_stitch_members` do not exist yet.

Mirrors test_t6700_intro_playback_endpoints.py's TestClient + tmp_path SQLite
seeding harness (no Postgres -- owner same-account reads only).
"""

import os
import sqlite3
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

USER_ID = "t4945-owner"
PROFILE_ID = "t4945prof"


@pytest.fixture()
def client(tmp_path):
    from app.session_init import _init_cache
    _init_cache[USER_ID] = {"profile_id": PROFILE_ID, "is_new_user": False}
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.database import ensure_database
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id

        set_current_user_id(USER_ID)
        set_current_profile_id(PROFILE_ID)
        ensure_database()

        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _auth_headers() -> dict:
    return {"X-User-ID": USER_ID}


def _db_path():
    from app.database import get_database_path
    return get_database_path()


def _connect(path):
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_card(db_path, name="Collection Card", is_default=0):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO intro_cards (name, shown_fields, treatment, is_default) "
        "VALUES (?, '[]', 'gold', ?)",
        (name, is_default),
    )
    card_id = cur.lastrowid
    conn.commit()
    conn.close()
    return card_id


def _seed_member(db_path, *, game_ids=None, duration=15.0, aspect_ratio="9:16",
                 clip_count=1, rating=None, quality_score=None, tags=None):
    """A published, single-clip member reel for the collection resolver.
    `rating`/`quality_score` let a test force a deterministic ORDER_BY_RANK
    ordering (rating DESC, quality DESC, recency). Returns (fv_id, filename)."""
    from app.utils.encoding import encode_data
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', ?)", (aspect_ratio,))
    project_id = cur.lastrowid
    filename = f"f{project_id}.mp4"
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, "
        "duration, aspect_ratio, published_at, clip_count, game_ids, tags, rating, quality_score) "
        "VALUES (?, ?, 1, 'custom_project', 'Reel', ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)",
        (project_id, filename, duration, aspect_ratio, clip_count,
         encode_data(game_ids) if game_ids is not None else None,
         encode_data(tags) if tags else None, rating, quality_score),
    )
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, project_id))
    conn.commit()
    conn.close()
    return fv_id, filename


def _attach_collection_card(db_path, card_id, *, scope_type="game", game_id=9,
                            aspect_ratio="9:16", tags=None):
    from app.services.intro_cards import (
        collection_intro_settings_key,
        set_collection_intro_card_id,
    )
    conn = _connect(db_path)
    key = collection_intro_settings_key(scope_type, game_id=game_id, tags=tags, aspect_ratio=aspect_ratio)
    cur = conn.cursor()
    set_collection_intro_card_id(cur, key, card_id)
    conn.commit()
    conn.close()


class _FakeIntro:
    """Stand-in for an IntroSpec: only .cleanup() is exercised by the endpoint."""
    def __init__(self):
        self.cleaned = False

    def cleanup(self):
        self.cleaned = True


def _install_stub_pipeline(stack, *, modal=False, compose_returns=True, compose_raises=False,
                           intro=None, captured=None):
    """Patch the ffmpeg/R2/Modal boundaries so the endpoint streams a byte or
    two without a real engine. `captured` (a dict) collects call arguments the
    tests assert on. Returns the patched mocks keyed for convenience."""
    captured = captured if captured is not None else {}

    def _local_stitch(user_id, profile_id, member_keys, out_path, tmp_dir):
        captured["local_member_keys"] = list(member_keys)
        with open(out_path, "wb") as f:
            f.write(b"STITCH")

    async def _modal_stitch(user_prefix, input_keys, output_key):
        captured["modal_user_prefix"] = user_prefix
        captured["modal_member_keys"] = list(input_keys)
        captured["modal_output_key"] = output_key
        return {"output_key": output_key, "duration": 42.0}

    def _dl_global(key, local_path, progress_callback=None):
        captured["downloaded_scratch"] = key
        with open(local_path, "wb") as f:
            f.write(b"STITCH")
        return True

    def _del_global(key):
        captured.setdefault("deleted_keys", []).append(key)
        return True

    def _resolve_intro(user_id, profile_id, raw_card_id, total_duration, reel_id, **kw):
        captured["intro_args"] = (user_id, profile_id, raw_card_id, total_duration, reel_id)
        return intro

    def _compose(reel_path, out_path, *, intro=None, outro=True, metadata_hook=None):
        captured.setdefault("compose_calls", []).append(
            {"reel_path": reel_path, "intro": intro, "outro": outro}
        )
        if compose_raises:
            raise RuntimeError("forced compose failure")
        if compose_returns:
            with open(out_path, "wb") as f:
                f.write(b"COMPOSED")
            return True
        return False

    stack.enter_context(patch("app.services.modal_client.modal_enabled", return_value=modal))
    stack.enter_context(patch("app.routers.collections._stitch_members_local", _local_stitch))
    stack.enter_context(patch("app.services.modal_client.call_modal_stitch_members", _modal_stitch))
    stack.enter_context(patch("app.storage.download_from_r2_global", _dl_global))
    stack.enter_context(patch("app.storage.r2_delete_object_global", _del_global))
    stack.enter_context(patch("app.services.intro_egress.resolve_intro_for_reel", _resolve_intro))
    stack.enter_context(patch("app.services.serve_time_video.compose_serve_time", _compose))
    return captured


# ===========================================================================
# 1. Membership -> segments
# ===========================================================================

def test_404_when_collection_has_no_members(client):
    resp = client.get(
        "/api/collections/download",
        params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 999},
        headers=_auth_headers(),
    )
    assert resp.status_code == 404


def test_segments_stitched_in_playback_rank_order(client):
    from contextlib import ExitStack
    db = _db_path()
    # rating DESC is the primary rank key -> expected order 3,2,1.
    _, f_low = _seed_member(db, game_ids=[9], rating=1)
    _, f_high = _seed_member(db, game_ids=[9], rating=3)
    _, f_mid = _seed_member(db, game_ids=[9], rating=2)

    with ExitStack() as stack:
        cap = _install_stub_pipeline(stack, modal=False)
        resp = client.get(
            "/api/collections/download",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9},
            headers=_auth_headers(),
        )
    assert resp.status_code == 200
    assert cap["local_member_keys"] == [
        f"final_videos/{f_high}", f"final_videos/{f_mid}", f"final_videos/{f_low}"
    ], "members must reach the stitch in rank/playback order (rating DESC)"


def test_exactly_one_outro_never_per_member(client):
    from contextlib import ExitStack
    db = _db_path()
    _seed_member(db, game_ids=[9], rating=3)
    _seed_member(db, game_ids=[9], rating=2)
    _seed_member(db, game_ids=[9], rating=1)

    with ExitStack() as stack:
        cap = _install_stub_pipeline(stack, modal=False)
        resp = client.get(
            "/api/collections/download",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9},
            headers=_auth_headers(),
        )
    assert resp.status_code == 200
    # compose_serve_time (which owns the ONE outro) runs exactly ONCE over the
    # whole stitch -- never once per member.
    assert len(cap["compose_calls"]) == 1
    call = cap["compose_calls"][0]
    assert call["outro"] is True
    assert call["reel_path"].endswith("stitched.mp4")


# ===========================================================================
# 2. Intro (the collection's OWN card, one at the front)
# ===========================================================================

def test_one_intro_resolved_from_collections_own_card(client):
    from contextlib import ExitStack
    db = _db_path()
    card_id = _seed_card(db)
    _attach_collection_card(db, card_id, game_id=9)
    _seed_member(db, game_ids=[9], duration=15.0)
    _seed_member(db, game_ids=[9], duration=15.0)

    fake = _FakeIntro()
    with ExitStack() as stack:
        cap = _install_stub_pipeline(stack, modal=False, intro=fake)
        resp = client.get(
            "/api/collections/download",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9},
            headers=_auth_headers(),
        )
    assert resp.status_code == 200
    user_id, profile_id, raw_card_id, total_duration, reel_id = cap["intro_args"]
    assert raw_card_id == card_id, "intro resolved from the collection's OWN attached card id"
    assert reel_id is None, "collection-level intro, not any member reel's"
    assert total_duration == pytest.approx(30.0), "resolved against LIVE total member duration"
    # the resolved spec is threaded into the single compose call, and cleaned up
    assert cap["compose_calls"][0]["intro"] is fake
    assert fake.cleaned is True


def test_no_intro_when_collection_has_none(client):
    from contextlib import ExitStack
    db = _db_path()
    _seed_member(db, game_ids=[9], duration=15.0)

    with ExitStack() as stack:
        cap = _install_stub_pipeline(stack, modal=False, intro=None)
        resp = client.get(
            "/api/collections/download",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9},
            headers=_auth_headers(),
        )
    assert resp.status_code == 200
    assert cap["compose_calls"][0]["intro"] is None


# ===========================================================================
# 3. Compute location (Decision 1): MODAL_ENABLED branch
# ===========================================================================

def test_modal_branch_routes_stitch_to_modal_not_local(client):
    from contextlib import ExitStack
    db = _db_path()
    _, f1 = _seed_member(db, game_ids=[9], rating=2)
    _, f2 = _seed_member(db, game_ids=[9], rating=1)

    with ExitStack() as stack:
        cap = _install_stub_pipeline(stack, modal=True)
        resp = client.get(
            "/api/collections/download",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9},
            headers=_auth_headers(),
        )
    assert resp.status_code == 200
    # Modal muxed the member concat; the local path was never touched.
    assert "local_member_keys" not in cap
    assert cap["modal_member_keys"] == [f"final_videos/{f1}", f"final_videos/{f2}"]
    # scratch output is disposable + best-effort deleted, and it is NEVER a
    # member source key (read-only over sources).
    assert "temp/collection_stitch/" in cap["modal_output_key"]
    assert cap["downloaded_scratch"].endswith(cap["modal_output_key"])
    assert any("temp/collection_stitch/" in k for k in cap["deleted_keys"])
    assert all("final_videos/" not in k for k in cap["deleted_keys"]), \
        "a stitch/outro failure must never delete a member source"


def test_local_branch_runs_ffmpeg_locally_not_modal(client):
    from contextlib import ExitStack
    db = _db_path()
    _seed_member(db, game_ids=[9], rating=1)

    with ExitStack() as stack:
        cap = _install_stub_pipeline(stack, modal=False)
        resp = client.get(
            "/api/collections/download",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9},
            headers=_auth_headers(),
        )
    assert resp.status_code == 200
    assert "local_member_keys" in cap
    assert "modal_member_keys" not in cap


# ===========================================================================
# 4. Non-fatal degradation + budget + the closed-connection gotcha
# ===========================================================================

def test_compose_failure_still_streams_the_stitch_non_fatal(client):
    from contextlib import ExitStack
    db = _db_path()
    _seed_member(db, game_ids=[9], rating=1)

    with ExitStack() as stack:
        _install_stub_pipeline(stack, modal=False, compose_raises=True)
        resp = client.get(
            "/api/collections/download",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9},
            headers=_auth_headers(),
        )
    # A compose failure degrades to serving the bare stitch, never a 5xx.
    assert resp.status_code == 200
    assert resp.content == b"STITCH"


def test_budget_sec_trims_members_before_stitch(client):
    from contextlib import ExitStack
    db = _db_path()
    _seed_member(db, game_ids=[9], duration=20.0, rating=3)
    _seed_member(db, game_ids=[9], duration=20.0, rating=2)
    _seed_member(db, game_ids=[9], duration=20.0, rating=1)

    with ExitStack() as stack:
        cap = _install_stub_pipeline(stack, modal=False)
        resp = client.get(
            "/api/collections/download",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9,
                    "budget_sec": 25},
            headers=_auth_headers(),
        )
    assert resp.status_code == 200
    # 25s budget fits only the top-ranked 20s member (greedy-with-skip).
    assert len(cap["local_member_keys"]) == 1


def test_everything_resolved_before_the_generator_runs(client):
    """The generator body runs AFTER the request's DB connection has closed
    (T5220 gotcha). Prove the heavy stitch only fires once the connection
    context has exited -- i.e. members/card were resolved up front."""
    from contextlib import ExitStack
    import app.routers.collections as collections_mod

    db = _db_path()
    _seed_member(db, game_ids=[9], rating=1)

    real_get_conn = collections_mod.get_db_connection
    state = {"conn_open": False, "conn_open_when_stitch_ran": None}

    class _TrackingConn:
        def __init__(self, cm):
            self._cm = cm

        def __enter__(self):
            state["conn_open"] = True
            return self._cm.__enter__()

        def __exit__(self, *a):
            state["conn_open"] = False
            return self._cm.__exit__(*a)

    def _tracking_get_conn(*a, **k):
        return _TrackingConn(real_get_conn(*a, **k))

    def _local_stitch(user_id, profile_id, member_keys, out_path, tmp_dir):
        state["conn_open_when_stitch_ran"] = state["conn_open"]
        with open(out_path, "wb") as f:
            f.write(b"STITCH")

    with ExitStack() as stack:
        _install_stub_pipeline(stack, modal=False)
        stack.enter_context(patch.object(collections_mod, "get_db_connection", _tracking_get_conn))
        stack.enter_context(patch("app.routers.collections._stitch_members_local", _local_stitch))
        resp = client.get(
            "/api/collections/download",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9},
            headers=_auth_headers(),
        )
    assert resp.status_code == 200
    assert state["conn_open_when_stitch_ran"] is False, \
        "the stitch must run only after the request DB connection has closed"


# ===========================================================================
# 5. Mixed-resolution: the local stitch delegates to concat_segments (which
#    owns the re-encode fallback) -- no bespoke normalization in this task.
# ===========================================================================

def test_local_stitch_delegates_to_concat_segments_for_mixed_resolution(tmp_path):
    """Decision 7: mixed-resolution safety comes from concat_segments' built-in
    re-encode fallback, not any resolution-picking here. Assert the local stitch
    downloads members read-only and hands them to concat_segments in order."""
    from app.routers.collections import _stitch_members_local

    seen = {}

    def _fake_download(user_id, relative_path, local_path, progress_callback=None, profile_id=None):
        seen.setdefault("downloaded", []).append(relative_path)
        with open(local_path, "wb") as f:
            f.write(b"X")
        return True

    def _fake_probe(path):
        return {"width": 1080, "height": 1920, "pix_fmt": "yuv420p", "has_audio": True}

    def _fake_concat(segments, out_path, probe):
        seen["concat_segments"] = [os.path.basename(s) for s in segments]
        with open(out_path, "wb") as f:
            f.write(b"OUT")
        return True

    out = str(tmp_path / "stitched.mp4")
    with patch("app.storage.R2_ENABLED", True), \
         patch("app.storage.download_from_r2", _fake_download), \
         patch("app.services.ffmpeg_concat.probe_media", _fake_probe), \
         patch("app.services.ffmpeg_concat.concat_segments", _fake_concat):
        _stitch_members_local(
            USER_ID, PROFILE_ID,
            ["final_videos/a.mp4", "final_videos/b.mp4", "final_videos/c.mp4"],
            out, str(tmp_path),
        )

    assert seen["downloaded"] == ["final_videos/a.mp4", "final_videos/b.mp4", "final_videos/c.mp4"]
    assert len(seen["concat_segments"]) == 3, "all members handed to concat_segments in order"
    assert os.path.exists(out)


def test_local_stitch_single_member_needs_no_concat(tmp_path):
    """One member -> the stitched file is just that member (no concat), so
    compose still gets a single file to prepend the intro / append the outro."""
    from app.routers.collections import _stitch_members_local

    def _fake_download(user_id, relative_path, local_path, progress_callback=None, profile_id=None):
        with open(local_path, "wb") as f:
            f.write(b"SOLO")
        return True

    called = {"concat": False}

    def _fake_concat(segments, out_path, probe):
        called["concat"] = True
        return True

    out = str(tmp_path / "stitched.mp4")
    with patch("app.storage.R2_ENABLED", True), \
         patch("app.storage.download_from_r2", _fake_download), \
         patch("app.services.ffmpeg_concat.concat_segments", _fake_concat):
        _stitch_members_local(USER_ID, PROFILE_ID, ["final_videos/solo.mp4"], out, str(tmp_path))

    assert called["concat"] is False
    with open(out, "rb") as f:
        assert f.read() == b"SOLO"
