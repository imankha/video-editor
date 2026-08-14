"""T4947 -- Cache stitched collection downloads.

`GET /api/collections/download` now caches its composed MP4 in a disposable R2
object keyed on EVERYTHING that changes the bytes (ordered member ids + each
member's filename + the resolved intro card id + its content hash + the
BRANDED_OUTRO_ENABLED flag + budget_sec). A repeat download of an UNCHANGED
collection serves straight from that key (HEAD-before-build) with NO recompute;
any single input change is a natural miss -> fresh build -> write-after-build.
No DB row, no migration: existence is fully derivable from the R2 key.

These tests patch the R2 boundary with an in-memory store (there is no real R2
in the unit sandbox, R2_ENABLED=False) and the stitch/compose engines with
counting stubs, then assert the CONTROL FLOW: hit == no stitch/compose call,
each dimension change == a fresh build, and two concurrent requests for the same
uncached key don't corrupt each other's output.

Mirrors test_t4945_collection_download.py's TestClient + tmp_path SQLite harness.
"""

import asyncio
import os
import sqlite3
import threading
from contextlib import ExitStack
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

USER_ID = "t4947-owner"
PROFILE_ID = "t4947prof"


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


def _seed_card(db_path, name="Collection Card"):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO intro_cards (name, shown_fields, treatment) VALUES (?, '[]', 'gold')",
        (name,),
    )
    card_id = cur.lastrowid
    conn.commit()
    conn.close()
    return card_id


def _attach_collection_card(db_path, card_id, *, scope_type="game", game_id=9,
                            aspect_ratio="9:16", tags=None):
    from app.services.intro_cards import (
        collection_intro_settings_key,
        set_collection_intro_card_id,
    )
    conn = _connect(db_path)
    key = collection_intro_settings_key(
        scope_type, game_id=game_id, tags=tags, aspect_ratio=aspect_ratio,
    )
    cur = conn.cursor()
    set_collection_intro_card_id(cur, key, card_id)
    conn.commit()
    conn.close()


def _seed_member(db_path, *, game_ids=None, duration=15.0, aspect_ratio="9:16",
                 clip_count=1, rating=None, quality_score=None, tags=None):
    """A published, single-clip member reel for the collection resolver.
    Returns (fv_id, filename)."""
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


def _set_member_rating(db_path, fv_id, rating):
    conn = _connect(db_path)
    conn.execute("UPDATE final_videos SET rating = ? WHERE id = ?", (rating, fv_id))
    conn.commit()
    conn.close()


def _install_cached_pipeline(stack, store, counters, *, modal=False, barrier=None,
                             compose_bytes=b"COMPOSED", compose_full_fidelity=True):
    """Patch the stitch/compose engines with COUNTING stubs and the R2 cache
    boundary with an in-memory `store` dict (key -> bytes). `counters` tracks how
    many times the heavy stitch/compose actually ran, so a cache hit is provable
    by the count NOT advancing. `barrier` (a threading.Barrier) forces two
    concurrent local stitches to overlap for the race test.
    `compose_full_fidelity=False` simulates a non-fatal compose degradation (the
    reel is still served, but the intro/outro didn't land) -- which must NOT be
    cached."""
    def _local_stitch(user_id, profile_id, member_keys, out_path, tmp_dir):
        counters["stitch"] += 1
        if barrier is not None:
            barrier.wait(timeout=10)
        with open(out_path, "wb") as f:
            f.write(b"STITCH")

    async def _modal_stitch(user_prefix, input_keys, output_key):
        counters["stitch"] += 1
        return {"output_key": output_key, "duration": 1.0}

    def _head_global(key):
        return {"ContentLength": len(store[key])} if key in store else None

    def _dl_global(key, local_path, progress_callback=None):
        # Cache keys resolve from the in-memory store; the Modal branch's scratch
        # output (a `temp/collection_stitch/` key) is simulated present, mirroring
        # test_t4945's stub, so the modal path reaches compose.
        if key in store:
            data = store[key]
        elif "temp/collection_stitch/" in key:
            data = b"STITCH"
        else:
            return False
        with open(local_path, "wb") as f:
            f.write(data)
        return True

    def _upload_file_global(key, local_path, content_type=None):
        with open(local_path, "rb") as f:
            store[key] = f.read()
        return True

    def _del_global(key):
        return True

    def _resolve_intro(user_id, profile_id, raw_card_id, total_duration, reel_id, **kw):
        return None

    def _compose(reel_path, out_path, *, intro=None, outro=True, metadata_hook=None, report=None):
        counters["compose"] += 1
        if report is not None:
            report["full_fidelity"] = compose_full_fidelity
        with open(out_path, "wb") as f:
            f.write(compose_bytes)
        return True

    stack.enter_context(patch("app.services.modal_client.modal_enabled", return_value=modal))
    stack.enter_context(patch("app.routers.collections._stitch_members_local", _local_stitch))
    stack.enter_context(patch("app.services.modal_client.call_modal_stitch_members", _modal_stitch))
    stack.enter_context(patch("app.routers.collections.r2_head_object_global", _head_global))
    stack.enter_context(patch("app.routers.collections.download_from_r2_global", _dl_global))
    stack.enter_context(patch("app.routers.collections.upload_file_to_r2_global", _upload_file_global))
    stack.enter_context(patch("app.routers.collections.r2_delete_object_global", _del_global))
    stack.enter_context(patch("app.services.intro_egress.resolve_intro_for_reel", _resolve_intro))
    stack.enter_context(patch("app.services.serve_time_video.compose_serve_time", _compose))


def _get(client, **params):
    p = {"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9, **params}
    return client.get("/api/collections/download", params=p, headers=_auth_headers())


# ===========================================================================
# 1. Cache HIT: identical inputs -> served from cache, no recompute
# ===========================================================================

def test_identical_inputs_hit_cache_no_recompute(client):
    db = _db_path()
    _seed_member(db, game_ids=[9], rating=2)
    _seed_member(db, game_ids=[9], rating=1)

    store, counters = {}, {"stitch": 0, "compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)

        r1 = _get(client)
        assert r1.status_code == 200
        assert counters == {"stitch": 1, "compose": 1}, "first request builds"
        assert len(store) == 1, "write-after-build populated the cache"

        r2 = _get(client)
        assert r2.status_code == 200
        # THE assertion: neither the stitch nor the compose ran a second time.
        assert counters == {"stitch": 1, "compose": 1}, "second request must NOT recompute"
        assert r2.content == r1.content == b"COMPOSED", "cache served the identical bytes"


def test_cache_hit_works_on_the_modal_branch_too(client):
    db = _db_path()
    _seed_member(db, game_ids=[9], rating=1)

    store, counters = {}, {"stitch": 0, "compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters, modal=True)
        assert _get(client).status_code == 200
        assert counters["stitch"] == 1
        assert _get(client).status_code == 200
        assert counters["stitch"] == 1, "Modal stitch must not re-run on a cache hit"


# ===========================================================================
# 2. Cache MISS: any single input change -> fresh build (one test per dimension)
# ===========================================================================

def test_member_set_change_misses(client):
    db = _db_path()
    _seed_member(db, game_ids=[9], rating=2)
    _seed_member(db, game_ids=[9], rating=1)

    store, counters = {}, {"stitch": 0, "compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)
        assert _get(client).status_code == 200
        assert counters["stitch"] == 1
        # Add a member -> the ordered id/filename set changes -> different key.
        _seed_member(db, game_ids=[9], rating=3)
        assert _get(client).status_code == 200
        assert counters["stitch"] == 2, "adding a member must be a cache miss"


def test_rank_order_change_misses(client):
    db = _db_path()
    a, _ = _seed_member(db, game_ids=[9], rating=1)
    _seed_member(db, game_ids=[9], rating=2)  # order: b, a

    store, counters = {}, {"stitch": 0, "compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)
        assert _get(client).status_code == 200
        assert counters["stitch"] == 1
        # Same members, DIFFERENT order (a now outranks b) -> ordered ids differ.
        _set_member_rating(db, a, 3)  # order: a, b
        assert _get(client).status_code == 200
        assert counters["stitch"] == 2, "reordering the same members must be a cache miss"


def test_card_change_misses(client):
    db = _db_path()
    _seed_member(db, game_ids=[9], rating=1)

    store, counters = {}, {"stitch": 0, "compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)
        assert _get(client).status_code == 200  # no card
        assert counters["stitch"] == 1
        # Attach an intro card -> resolved_card_id changes -> different key.
        _attach_collection_card(db, _seed_card(db), game_id=9)
        assert _get(client).status_code == 200
        assert counters["stitch"] == 2, "attaching an intro card must be a cache miss"


def test_card_content_edit_misses(client):
    """Same card id, EDITED content (its `updated_at`/fields change) -> the
    content hash in the key changes -> a fresh build, so a re-styled card is
    never served stale from cache."""
    db = _db_path()
    _seed_member(db, game_ids=[9], rating=1)
    card_id = _seed_card(db)
    _attach_collection_card(db, card_id, game_id=9)

    store, counters = {}, {"stitch": 0, "compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)
        assert _get(client).status_code == 200
        assert counters["stitch"] == 1
        # Edit the SAME card's content (subtitle + bumped updated_at).
        conn = _connect(db)
        conn.execute(
            "UPDATE intro_cards SET subtitle_text = 'new', updated_at = '2099-01-01' WHERE id = ?",
            (card_id,),
        )
        conn.commit()
        conn.close()
        assert _get(client).status_code == 200
        assert counters["stitch"] == 2, "editing the card's content must be a cache miss"


def test_outro_flag_change_misses(client):
    db = _db_path()
    _seed_member(db, game_ids=[9], rating=1)

    store, counters = {}, {"stitch": 0, "compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)
        with patch.dict(os.environ, {"BRANDED_OUTRO_ENABLED": "true"}):
            assert _get(client).status_code == 200
            assert counters["stitch"] == 1
        # Flip the branded-outro flag OFF -> the composed bytes differ -> miss.
        with patch.dict(os.environ, {"BRANDED_OUTRO_ENABLED": "false"}):
            assert _get(client).status_code == 200
            assert counters["stitch"] == 2, "toggling BRANDED_OUTRO_ENABLED must be a cache miss"


def test_burned_profile_fact_change_misses(client):
    """The burned intro TITLE/facts (profile full_name + shown fields) live in
    user.sqlite, NOT the intro-card row, so editing one never bumps the card's
    updated_at. They must still invalidate: attach a card, download (caches),
    then edit a profile fact -> the next download must MISS, never serve the
    stale burned name/fact from cache."""
    from app.services.user_db import set_intro_fact

    db = _db_path()
    _seed_member(db, game_ids=[9], rating=1)
    _attach_collection_card(db, _seed_card(db), game_id=9)

    store, counters = {}, {"stitch": 0, "compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)
        assert _get(client).status_code == 200
        assert counters["stitch"] == 1
        # Edit a burned profile fact (lives in user.sqlite, not the card row).
        set_intro_fact(USER_ID, PROFILE_ID, "team", "New Team FC")
        assert _get(client).status_code == 200
        assert counters["stitch"] == 2, "editing a burned profile fact must be a cache miss"


def test_degraded_compose_is_not_cached(client):
    """compose_serve_time is non-fatal: a transient intro/outro/concat hiccup
    degrades to the bare stitch but still returns True. Caching that would freeze
    the degraded (e.g. outro-less) bytes and serve them on every future hit with
    no self-heal. A degraded serve must stream to THIS caller (200) but NOT
    populate the cache -- the next request re-misses and rebuilds."""
    db = _db_path()
    _seed_member(db, game_ids=[9], rating=1)

    store, counters = {}, {"stitch": 0, "compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters, compose_full_fidelity=False)
        assert _get(client).status_code == 200, "degraded compose still streams to this caller"
        assert counters["stitch"] == 1
        assert store == {}, "a degraded (not full-fidelity) compose must NOT poison the cache"
        # Prove no self-poison: the next request re-misses and rebuilds.
        assert _get(client).status_code == 200
        assert counters["stitch"] == 2, "degraded output was not cached -> a fresh build"


def test_budget_change_misses_even_with_same_members(client):
    """Two budgets that both admit ALL members still key differently (budget_sec
    is part of the key), so the dimension is isolated from the member set."""
    db = _db_path()
    _seed_member(db, game_ids=[9], duration=10.0, rating=2)
    _seed_member(db, game_ids=[9], duration=10.0, rating=1)  # 20s total

    store, counters = {}, {"stitch": 0, "compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)
        assert _get(client, budget_sec=100).status_code == 200  # all fit
        assert counters["stitch"] == 1
        assert _get(client, budget_sec=50).status_code == 200   # still all fit
        assert counters["stitch"] == 2, "a different budget_sec must be a cache miss"


# ===========================================================================
# 3. Concurrency: two requests for the same uncached key don't corrupt output
# ===========================================================================

def test_concurrent_uncached_requests_dont_corrupt_output(client):
    """asyncio.gather of two requests against a FRESH key. A threading.Barrier
    forces both local stitches to overlap, so both are provably past the
    HEAD-miss before either writes -- the exact race the cache must tolerate.
    Each request streams its OWN freshly-built file, and an R2 object PUT is
    atomic, so both callers get a valid, byte-identical MP4 and the cached
    object is byte-complete (never a partial write)."""
    from app.routers.collections import download_collection

    db = _db_path()
    _seed_member(db, game_ids=[9], rating=2)
    _seed_member(db, game_ids=[9], rating=1)

    store, counters = {}, {"stitch": 0, "compose": 0}
    barrier = threading.Barrier(2)

    async def _consume(resp):
        return b"".join([c async for c in resp.body_iterator])

    async def _run_two():
        r1, r2 = await asyncio.gather(
            download_collection(scope_type="game", aspect_ratio="9:16", game_id=9),
            download_collection(scope_type="game", aspect_ratio="9:16", game_id=9),
        )
        return await asyncio.gather(_consume(r1), _consume(r2))

    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters, barrier=barrier)
        body1, body2 = asyncio.run(_run_two())

    assert counters["stitch"] == 2, "both requests saw a miss and built (the race)"
    assert body1 == body2 == b"COMPOSED", "both callers got a valid, byte-identical MP4"
    assert len(store) == 1, "both writes targeted the ONE shared key"
    assert next(iter(store.values())) == b"COMPOSED", "cached object is byte-complete, not partial"
