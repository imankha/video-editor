"""T11590 -- Cache the composed download/share file.

`GET /api/downloads/{id}/file` now caches its composed MP4 in a disposable R2
object keyed on EVERYTHING that changes the bytes (the stored final_video
filename + the resolved intro card id + its content hash + the burned intro
FACTS from user.sqlite + the BRANDED_OUTRO_ENABLED flag). A repeat
download/share of an UNCHANGED reel serves straight from that key
(HEAD-before-build) with NO re-fetch/recompose; any single input change is a
natural miss -> fresh build -> write-after-build. No DB row, no migration:
existence is fully derivable from the R2 key. Mirrors T4947's identical
collection-download cache (test_t4947_cache_stitched_downloads.py).

These tests patch the R2 boundary with an in-memory store (there is no real R2
in the unit sandbox, R2_ENABLED=False) and the compose engine with a counting
stub, then assert the CONTROL FLOW: hit == no compose call, each dimension
change == a fresh build, two concurrent requests for the same uncached key
don't corrupt each other's output, and the metadata/cover stamp is still
applied fresh on every request (including a cache hit).

Section 5 exercises the SAME cache logic through the PRODUCTION `R2_ENABLED=True`
source branch (`_stream_composed_r2`), not just the local-disk branch every test
above runs through -- the two branches each do their own independent
write-after-build call, so a bug isolated to one is invisible to tests that only
ever exercise the other. These patch `get_download_file_url` (skips the real
presign/HEAD-verify) and `httpx.AsyncClient` (a fake async context manager /
streaming response standing in for the real R2 GET) so the cache HEAD/download/
upload calls -- the thing actually under test -- still run for real.

Section 6 proves the T11590 gap-3 fix: the write-after-build runs as a
DETACHED `asyncio.Task` (never awaited by the request handler), so an R2 PUT
can never block the first byte -- a cache MISS never pays the cache write
before its first streamed byte (not a blanket "never slower than before"
claim; see the correcting note on Section 9 below, which closes the other
real-but-smaller sequential-HEAD regression this same write-after-build fix
left in place). Since the background task may still be running on
TestClient's own portal thread/event loop after `client.get()` returns, `_get()`
below drains pending background tasks (polls `_BACKGROUND_CACHE_WRITE_TASKS`)
after every call so the rest of the suite observes a SETTLED cache state
before asserting on it, exactly like a real caller would see eventual (not
immediate) consistency.
"""

import asyncio
import sqlite3
import threading
import time
from contextlib import ExitStack
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

USER_ID = "t11590-owner"
PROFILE_ID = "t11590prof"


@pytest.fixture()
def client(tmp_path):
    from app.session_init import _init_cache
    _init_cache[USER_ID] = {"profile_id": PROFILE_ID, "is_new_user": False}
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.routers.downloads.R2_ENABLED", False), \
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


def _seed_card(db_path, name="Download Card"):
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


def _seed_final_video(db_path, *, name="Reel", intro_card_id=None, duration=15.0):
    """A final_videos row (+ owning project) for the single-reel download
    endpoint. Returns (download_id, filename)."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES (?, '9:16')", (name,))
    project_id = cur.lastrowid
    filename = f"f{project_id}.mp4"
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, "
        "duration, intro_card_id) VALUES (?, ?, 1, 'custom_project', ?, ?, ?)",
        (project_id, filename, name, duration, intro_card_id),
    )
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, project_id))
    conn.commit()
    conn.close()
    return fv_id, filename


def _attach_card(db_path, download_id, card_id):
    conn = _connect(db_path)
    conn.execute("UPDATE final_videos SET intro_card_id = ? WHERE id = ?", (card_id, download_id))
    conn.commit()
    conn.close()


def _write_local_final_video(filename: str, content: bytes = b"ORIGINAL"):
    from app.database import get_final_videos_path
    path = get_final_videos_path()
    path.mkdir(parents=True, exist_ok=True)
    (path / filename).write_bytes(content)


def _install_cached_pipeline(stack, store, counters, *, barrier=None,
                              compose_bytes=b"COMPOSED", compose_full_fidelity=True,
                              field_values=None, upload_hook=None):
    """Patch the compose engine with a COUNTING stub and the R2 cache boundary
    with an in-memory `store` dict (key -> bytes). `counters` tracks how many
    times the heavy compose actually ran, so a cache hit is provable by the
    count NOT advancing. `barrier` forces two concurrent composes to overlap
    for the race test. `upload_hook(key, local_path)`, when supplied, runs
    BEFORE `store` is populated -- used to simulate an artificially slow R2
    PUT (e.g. blocking on a `threading.Event`) for the background-write
    proof, without changing the eventual (store IS populated) outcome."""
    def _head_global(key):
        return {"ContentLength": len(store[key])} if key in store else None

    def _dl_global(key, local_path, progress_callback=None):
        if key not in store:
            return False
        with open(local_path, "wb") as f:
            f.write(store[key])
        return True

    def _upload_file_global(key, local_path, content_type=None):
        if upload_hook is not None:
            upload_hook(key, local_path)
        with open(local_path, "rb") as f:
            store[key] = f.read()
        return True

    class _FakeIntro:
        def cleanup(self):
            pass

    def _resolve_intro(user_id, profile_id, intro_card_id, reel_duration, reel_id, **kw):
        if intro_card_id is None:
            return None
        if barrier is not None:
            barrier.wait(timeout=10)
        return _FakeIntro()  # non-None sentinel with the real IntroSpec.cleanup() contract

    def _compose(reel_path, out_path, *, user_id=None, user_prefix=None,
                 intro=None, outro=True, report=None):
        counters["compose"] += 1
        if report is not None:
            report["full_fidelity"] = compose_full_fidelity
        with open(out_path, "wb") as f:
            f.write(compose_bytes)
        return True

    def _stamp(serve_path, tmp_dir, meta, user_id, profile_id):
        counters["stamp"] = counters.get("stamp", 0) + 1
        counters.setdefault("stamp_calls", []).append(dict(meta) if meta else {})
        return serve_path

    def _load_fv(user_id, profile_id):
        return field_values if field_values is not None else {}

    stack.enter_context(patch("app.routers.downloads.r2_head_object_global", _head_global))
    stack.enter_context(patch("app.routers.downloads.download_from_r2_global", _dl_global))
    stack.enter_context(patch("app.routers.downloads.upload_file_to_r2_global", _upload_file_global))
    stack.enter_context(patch("app.services.intro_egress.resolve_intro_for_reel", _resolve_intro))
    stack.enter_context(patch("app.services.intro_egress._load_field_values", _load_fv))
    stack.enter_context(patch("app.services.serve_time_video.compose_serve_time_dispatched", _compose))
    stack.enter_context(patch("app.routers.downloads._stamp_download", _stamp))


def _drain_background_cache_writes(timeout=2.0, interval=0.02):
    """Block until no T11590 background cache-write task is pending, or
    `timeout` elapses. The write-after-build runs as a detached `asyncio.Task`
    (gap 3) possibly on TestClient's own portal thread/event loop, so a plain
    `time.sleep` poll on the module-level task-tracking set (not a direct
    `await`, which would need to run on that same loop) is how a DIFFERENT
    thread observes it settle."""
    from app.routers import downloads as downloads_module
    deadline = time.monotonic() + timeout
    while downloads_module._BACKGROUND_CACHE_WRITE_TASKS and time.monotonic() < deadline:
        time.sleep(interval)


def _get(client, download_id):
    """Drains pending background cache-write tasks after every call, so the
    rest of a test observes a SETTLED cache state -- both so a hit-after-miss
    assertion isn't racing its own prior write, and so a slow-finishing
    background task never leaks execution past the `ExitStack` block whose
    patches it depends on."""
    resp = client.get(f"/api/downloads/{download_id}/file", headers=_auth_headers())
    _drain_background_cache_writes()
    return resp


# ===========================================================================
# R2-source fakes: stand in for the real presigned-URL fetch + httpx stream
# the PRODUCTION R2_ENABLED=True branch (`_stream_composed_r2`) uses, so that
# branch's own independent write-after-build call runs for real under test.
# ===========================================================================

class _FakeR2Response:
    def __init__(self, data: bytes, status_code: int = 200):
        self.status_code = status_code
        self._data = data

    async def aiter_bytes(self, chunk_size=1024 * 1024):
        yield self._data


class _FakeR2StreamCtx:
    def __init__(self, data: bytes, status_code: int = 200):
        self._resp = _FakeR2Response(data, status_code)

    async def __aenter__(self):
        return self._resp

    async def __aexit__(self, *exc):
        return False


class _FakeR2AsyncClient:
    """Stands in for `httpx.AsyncClient` -- `downloads.py` imports `httpx`
    LOCALLY inside `download_file` (`import httpx`), so patching the real
    `httpx.AsyncClient` class (not a downloads.py attribute) is what actually
    intercepts the call."""

    def __init__(self, reel_bytes: bytes, status_code: int = 200):
        self._reel_bytes = reel_bytes
        self._status_code = status_code

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def stream(self, method, url):
        return _FakeR2StreamCtx(self._reel_bytes, self._status_code)


def _install_r2_source_pipeline(stack, store, counters, *, reel_bytes=b"ORIGINAL-FROM-R2",
                                 **kwargs):
    """Layers the PRODUCTION R2-source branch on top of `_install_cached_pipeline`:
    flips `R2_ENABLED` True, stubs `get_download_file_url` (skips the real
    presign/HEAD-verify), and fakes `httpx.AsyncClient` so `_stream_composed_r2`
    runs its real control flow -- including its OWN write-after-build call --
    end to end."""
    _install_cached_pipeline(stack, store, counters, **kwargs)
    stack.enter_context(patch("app.routers.downloads.R2_ENABLED", True))
    stack.enter_context(patch(
        "app.routers.downloads.get_download_file_url",
        lambda filename, verify_exists=False: "https://fake-r2.example/presigned",
    ))
    stack.enter_context(patch("httpx.AsyncClient", _FakeR2AsyncClient(reel_bytes)))


# ===========================================================================
# 1. Cache HIT: identical inputs -> served from cache, no recompute
# ===========================================================================

def test_identical_request_hits_cache_no_recompute(client):
    db = _db_path()
    fv_id, filename = _seed_final_video(db)
    _write_local_final_video(filename)

    store, counters = {}, {"compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)

        r1 = _get(client, fv_id)
        assert r1.status_code == 200
        assert counters["compose"] == 1, "first request builds"
        assert len(store) == 1, "write-after-build populated the cache"

        r2 = _get(client, fv_id)
        assert r2.status_code == 200
        # THE assertion: compose did not run a second time.
        assert counters["compose"] == 1, "second request must NOT recompute"
        assert r2.content == r1.content == b"COMPOSED", "cache served the identical bytes"


# ===========================================================================
# 2. Cache MISS: any single input change -> fresh build
# ===========================================================================

def test_card_attach_misses(client):
    db = _db_path()
    fv_id, filename = _seed_final_video(db)
    _write_local_final_video(filename)
    card_id = _seed_card(db)

    store, counters = {}, {"compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)
        assert _get(client, fv_id).status_code == 200  # no card
        assert counters["compose"] == 1
        _attach_card(db, fv_id, card_id)
        assert _get(client, fv_id).status_code == 200
        assert counters["compose"] == 2, "attaching an intro card must be a cache miss"


def test_card_content_edit_misses(client):
    """Same card id, EDITED content -> the content hash in the key changes ->
    a fresh build, so a re-styled card is never served stale from cache."""
    db = _db_path()
    card_id = _seed_card(db)
    fv_id, filename = _seed_final_video(db, intro_card_id=card_id)
    _write_local_final_video(filename)

    store, counters = {}, {"compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)
        assert _get(client, fv_id).status_code == 200
        assert counters["compose"] == 1
        conn = _connect(db)
        conn.execute(
            "UPDATE intro_cards SET subtitle_text = 'new', updated_at = '2099-01-01' WHERE id = ?",
            (card_id,),
        )
        conn.commit()
        conn.close()
        assert _get(client, fv_id).status_code == 200
        assert counters["compose"] == 2, "editing the card's content must be a cache miss"


def test_outro_flag_change_misses(client):
    import os
    db = _db_path()
    fv_id, filename = _seed_final_video(db)
    _write_local_final_video(filename)

    store, counters = {}, {"compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)
        with patch.dict(os.environ, {"BRANDED_OUTRO_ENABLED": "true"}):
            assert _get(client, fv_id).status_code == 200
            assert counters["compose"] == 1
        with patch.dict(os.environ, {"BRANDED_OUTRO_ENABLED": "false"}):
            assert _get(client, fv_id).status_code == 200
            assert counters["compose"] == 2, "toggling BRANDED_OUTRO_ENABLED must be a cache miss"


def test_burned_profile_fact_change_misses(client):
    """The burned intro facts (profile full_name / shown fields) live in
    user.sqlite, not the card row, so editing one never bumps the card's
    updated_at. They must still invalidate the cache via field_values_fp."""
    db = _db_path()
    card_id = _seed_card(db)
    fv_id, filename = _seed_final_video(db, intro_card_id=card_id)
    _write_local_final_video(filename)

    store, counters = {}, {"compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters, field_values={"full_name": "Alex"})
        assert _get(client, fv_id).status_code == 200
        assert counters["compose"] == 1

    # Second patch install, SAME store/counters, a renamed burned fact.
    with ExitStack() as stack:
        _install_cached_pipeline(
            stack, store, counters, field_values={"full_name": "Alex Renamed"},
        )
        assert _get(client, fv_id).status_code == 200
        assert counters["compose"] == 2, "a renamed burned profile fact must be a cache miss"


def test_reexport_never_serves_stale_cached_file(client):
    """A re-export makes a NEW final_videos row/filename (T4010/T10860) -- the
    cache must never serve the OLD row's cached bytes under the new id."""
    db = _db_path()
    fv_id, filename = _seed_final_video(db, name="Reel")
    _write_local_final_video(filename)

    store, counters = {}, {"compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters, compose_bytes=b"COMPOSED-V1")
        r1 = _get(client, fv_id)
        assert r1.status_code == 200
        assert r1.content == b"COMPOSED-V1"
        assert counters["compose"] == 1

    # Re-export: a brand new final_videos row with a DIFFERENT filename.
    fv_id2, filename2 = _seed_final_video(db, name="Reel")
    assert filename2 != filename
    _write_local_final_video(filename2)

    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters, compose_bytes=b"COMPOSED-V2")
        r2 = _get(client, fv_id2)
        assert r2.status_code == 200
        assert counters["compose"] == 2, "a new final_video row/filename must be a cache miss"
        assert r2.content == b"COMPOSED-V2", "must not serve the OLD row's cached bytes"


def test_degraded_compose_is_not_cached(client):
    """A non-fatal intro/outro/concat degradation still streams (200) but must
    NOT populate the cache -- no self-heal otherwise. The next request
    re-misses and rebuilds."""
    db = _db_path()
    fv_id, filename = _seed_final_video(db)
    _write_local_final_video(filename)

    store, counters = {}, {"compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters, compose_full_fidelity=False)
        assert _get(client, fv_id).status_code == 200, "degraded compose still streams to this caller"
        assert counters["compose"] == 1
        assert store == {}, "a degraded (not full-fidelity) compose must NOT poison the cache"
        assert _get(client, fv_id).status_code == 200
        assert counters["compose"] == 2, "degraded output was not cached -> a fresh build"


# ===========================================================================
# 3. Metadata stamp stays PER-REQUEST, fresh on every request (incl. a hit)
# ===========================================================================

def test_metadata_stamped_fresh_on_every_request_including_cache_hit(client):
    """download_metadata.py's NOTE ON CACHING contract: `artist` is the live
    profile name and must never go stale in a cached file -- the stamp pass
    runs on EVERY request, cache hit or miss, never baked into the cached
    bytes."""
    db = _db_path()
    fv_id, filename = _seed_final_video(db)
    _write_local_final_video(filename)

    store, counters = {}, {"compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)
        assert _get(client, fv_id).status_code == 200
        assert counters["stamp"] == 1, "stamp runs on the miss path"
        assert _get(client, fv_id).status_code == 200
        assert counters["compose"] == 1, "second request is a cache hit (no recompute)"
        assert counters["stamp"] == 2, "stamp must ALSO run on a cache hit -- never baked into cache"


# ===========================================================================
# 4. Concurrency: two requests for the same uncached key don't corrupt output
# ===========================================================================

def test_concurrent_uncached_requests_dont_corrupt_output(client):
    """asyncio.gather of two requests against a FRESH key. A threading.Barrier
    forces both composes to overlap (via the patched intro resolver), so both
    are provably past the HEAD-miss before either writes. Each request streams
    its OWN freshly-built file, and an R2 object PUT is atomic, so both
    callers get a valid, byte-identical MP4 and the cached object is
    byte-complete (never a partial write)."""
    from app.profile_context import set_current_profile_id
    from app.routers.downloads import download_file
    from app.user_context import set_current_user_id

    db = _db_path()
    card_id = _seed_card(db)
    fv_id, filename = _seed_final_video(db, intro_card_id=card_id)
    _write_local_final_video(filename)

    store, counters = {}, {"compose": 0}
    barrier = threading.Barrier(2)

    async def _consume(resp):
        return b"".join([c async for c in resp.body_iterator])

    async def _run_two():
        set_current_user_id(USER_ID)
        set_current_profile_id(PROFILE_ID)
        r1, r2 = await asyncio.gather(download_file(fv_id), download_file(fv_id))
        bodies = await asyncio.gather(_consume(r1), _consume(r2))
        # The write-after-build is now a detached background task (gap 3) --
        # same event loop as this coroutine, so awaiting it directly (not
        # polling) is both possible and precise.
        from app.routers import downloads as downloads_module
        pending = list(downloads_module._BACKGROUND_CACHE_WRITE_TASKS)
        if pending:
            await asyncio.gather(*pending)
        return bodies

    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters, barrier=barrier)
        body1, body2 = asyncio.run(_run_two())

    assert counters["compose"] == 2, "both requests saw a miss and built (the race)"
    assert body1 == body2 == b"COMPOSED", "both callers got a valid, byte-identical MP4"
    assert len(store) == 1, "both writes targeted the ONE shared key"
    assert next(iter(store.values())) == b"COMPOSED", "cached object is byte-complete, not partial"


# ===========================================================================
# 5. PRODUCTION R2-source branch (R2_ENABLED=True, `_stream_composed_r2`):
#    the local-disk branch above never exercises this code path's OWN
#    write-after-build call.
# ===========================================================================

def test_r2_source_identical_request_hits_cache_no_recompute(client):
    """Mirrors `test_identical_request_hits_cache_no_recompute`, but through
    the real `R2_ENABLED=True` / `_stream_composed_r2` branch: the reel is
    fetched via a faked presigned URL + httpx stream (never local disk), and
    the SECOND request for the same key must still skip fetch+compose
    entirely."""
    db = _db_path()
    fv_id, _filename = _seed_final_video(db)
    # Deliberately NOT written to local disk -- the R2 branch never reads it.

    store, counters = {}, {"compose": 0}
    with ExitStack() as stack:
        _install_r2_source_pipeline(stack, store, counters)

        r1 = _get(client, fv_id)
        assert r1.status_code == 200
        assert counters["compose"] == 1, "first request builds (fetches via the faked R2 stream)"
        assert len(store) == 1, "the R2 branch's OWN write-after-build populated the cache"

        r2 = _get(client, fv_id)
        assert r2.status_code == 200
        # THE assertion: compose did not run a second time on the R2 branch either.
        assert counters["compose"] == 1, "second request must NOT recompute"
        assert r2.content == r1.content == b"COMPOSED", "cache served the identical bytes"


def test_r2_source_degraded_compose_is_not_cached(client):
    """Mirrors `test_degraded_compose_is_not_cached` on the R2 branch: a
    non-fatal degradation still streams (200) but the R2 branch's OWN
    write-after-build must NOT populate the cache."""
    db = _db_path()
    fv_id, _filename = _seed_final_video(db)

    store, counters = {}, {"compose": 0}
    with ExitStack() as stack:
        _install_r2_source_pipeline(stack, store, counters, compose_full_fidelity=False)
        assert _get(client, fv_id).status_code == 200, "degraded compose still streams to this caller"
        assert counters["compose"] == 1
        assert store == {}, "a degraded (not full-fidelity) compose must NOT poison the cache"
        assert _get(client, fv_id).status_code == 200
        assert counters["compose"] == 2, "degraded output was not cached -> a fresh build"


# ===========================================================================
# 6. GAP 3: the write-after-build runs in the BACKGROUND -- an R2 PUT must
#    never block the response. A live-measured real-R2 regression found the
#    ORIGINAL synchronous write made a cache MISS (including a first-ever
#    share/download) slower than the pre-T11590 behavior. Proven here by
#    mocking `upload_file_to_r2_global` to block on a `threading.Event`
#    (simulating an artificially slow R2 PUT, which blocks a thread-pool
#    thread via `asyncio.to_thread`, never the event loop) and asserting the
#    full streamed response completes WITHOUT waiting for it, then that the
#    cache object still lands once the upload is allowed to proceed. (This
#    section is specifically about the WRITE -- the background PUT. Section 9
#    below is a separate, smaller regression this fix did NOT address: the
#    two HEAD checks on the R2 branch running sequentially instead of
#    concurrently. Root-caused by a real-R2 benchmark; see Section 9.)
# ===========================================================================

def test_background_cache_write_does_not_block_streaming_local_branch(client):
    """Local-disk source branch (`_stream_composed_local`)."""
    from app.profile_context import set_current_profile_id
    from app.routers import downloads as downloads_module
    from app.routers.downloads import download_file
    from app.user_context import set_current_user_id

    db = _db_path()
    fv_id, filename = _seed_final_video(db)
    _write_local_final_video(filename)

    store, counters = {}, {"compose": 0}
    upload_started = threading.Event()
    upload_may_finish = threading.Event()

    def _slow_upload(key, local_path):
        upload_started.set()
        # Blocks a THREAD-POOL thread (asyncio.to_thread), never the event
        # loop driving the response -- the whole point under test.
        assert upload_may_finish.wait(timeout=5), "test harness: never unblocked"

    async def _run():
        set_current_user_id(USER_ID)
        set_current_profile_id(PROFILE_ID)
        t0 = time.monotonic()
        resp = await download_file(fv_id)
        body = b"".join([c async for c in resp.body_iterator])
        elapsed = time.monotonic() - t0

        assert upload_started.wait(timeout=1), "the background write must have started"
        assert elapsed < 1.0, (
            f"streaming must not wait for the background cache write "
            f"(took {elapsed:.2f}s; the mocked upload blocks for up to 5s)"
        )
        assert body == b"COMPOSED"
        assert store == {}, "the cache write has not completed yet -- still blocked"

        # Let the artificially slow upload proceed, then await it on THIS
        # SAME loop -- asyncio.run() cancels any task still pending when its
        # coroutine returns, so it must be drained here, not after.
        upload_may_finish.set()
        pending = list(downloads_module._BACKGROUND_CACHE_WRITE_TASKS)
        if pending:
            await asyncio.gather(*pending)

    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters, upload_hook=_slow_upload)
        asyncio.run(_run())

    assert store, "the cache write eventually completes in the background"


def test_background_cache_write_does_not_block_streaming_r2_source_branch(client):
    """Production `R2_ENABLED=True` source branch (`_stream_composed_r2`) --
    the local-disk branch above never exercises this branch's OWN
    independent write-after-build call."""
    from app.profile_context import set_current_profile_id
    from app.routers import downloads as downloads_module
    from app.routers.downloads import download_file
    from app.user_context import set_current_user_id

    db = _db_path()
    fv_id, _filename = _seed_final_video(db)

    store, counters = {}, {"compose": 0}
    upload_started = threading.Event()
    upload_may_finish = threading.Event()

    def _slow_upload(key, local_path):
        upload_started.set()
        assert upload_may_finish.wait(timeout=5), "test harness: never unblocked"

    async def _run():
        set_current_user_id(USER_ID)
        set_current_profile_id(PROFILE_ID)
        t0 = time.monotonic()
        resp = await download_file(fv_id)
        body = b"".join([c async for c in resp.body_iterator])
        elapsed = time.monotonic() - t0

        assert upload_started.wait(timeout=1), "the background write must have started"
        assert elapsed < 1.0, (
            f"streaming must not wait for the background cache write "
            f"(took {elapsed:.2f}s; the mocked upload blocks for up to 5s)"
        )
        assert body == b"COMPOSED"
        assert store == {}, "the cache write has not completed yet -- still blocked"

        upload_may_finish.set()
        pending = list(downloads_module._BACKGROUND_CACHE_WRITE_TASKS)
        if pending:
            await asyncio.gather(*pending)

    with ExitStack() as stack:
        _install_r2_source_pipeline(stack, store, counters, upload_hook=_slow_upload)
        asyncio.run(_run())

    assert store, "the cache write eventually completes in the background"


# ===========================================================================
# 7. Review MAJOR: a failure in the copy step itself (NOT the upload) must
#    never break the user-facing response. The copy runs synchronously in
#    the request path (`_copy_for_background_cache_write`, awaited by
#    `_spawn_background_cache_write` before the background task is even
#    created) -- most plausibly failing with ENOSPC, since a MISS briefly
#    holds two copies of the reel on disk. Starlette's StreamingResponse has
#    already sent 200 headers before the first chunk, so an unguarded
#    exception here would cut the response off with zero body bytes -- the
#    user's actual download/share breaking, which this whole cache feature
#    must never do.
# ===========================================================================

def test_copy_failure_during_background_write_does_not_break_response(client):
    """Patches the REAL `shutil.copyfile` (what `downloads.py` actually
    calls) to raise `OSError(ENOSPC)`. The response must still complete 200
    with the full correct body, nothing must land in the cache store, and no
    `rb_dl_cache_write_*` tempdir must be left on disk (the copy step owns +
    cleans up its own partial tempdir on failure)."""
    import errno
    import glob
    import os
    import tempfile as _tempfile

    db = _db_path()
    fv_id, filename = _seed_final_video(db)
    _write_local_final_video(filename)

    store, counters = {}, {"compose": 0}

    def _raise_enospc(src, dst, *args, **kwargs):
        raise OSError(errno.ENOSPC, "No space left on device")

    leak_glob = os.path.join(_tempfile.gettempdir(), "rb_dl_cache_write_*")
    before = set(glob.glob(leak_glob))

    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)
        stack.enter_context(patch("shutil.copyfile", side_effect=_raise_enospc))

        resp = _get(client, fv_id)
        assert resp.status_code == 200, "a failed cache-write copy must not break the download"
        assert resp.content == b"COMPOSED", "the user's actual bytes must still stream correctly"
        assert counters["compose"] == 1, "compose itself is unaffected by the cache-write failure"
        assert store == {}, "nothing should land in the cache when the copy step failed"

    after = set(glob.glob(leak_glob))
    leaked = after - before
    assert not leaked, f"a failed copy must not leak a cache-write tempdir: {leaked}"


# ===========================================================================
# 8. HEAD-hit / GET-miss fallback: a transient blip (or the object being
#    evicted between the HEAD and the GET) must fall through to a fresh
#    build, never a 5xx.
# ===========================================================================

def test_cache_head_hit_but_download_fails_rebuilds_instead_of_erroring(client):
    """`r2_head_object_global` reports the key present, but the subsequent
    `download_from_r2_global` fails (transient blip / just-evicted). The
    HEAD-hit branch must tear down its temp dir and fall through to a fresh
    build -- the SAME request still succeeds (200, correct bytes), it just
    recomposes instead of serving a now-unreachable cached object."""
    db = _db_path()
    fv_id, filename = _seed_final_video(db)
    _write_local_final_video(filename)

    store, counters = {}, {"compose": 0}
    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)
        r1 = _get(client, fv_id)
        assert r1.status_code == 200
        assert counters["compose"] == 1
        assert len(store) == 1, "first request populated the cache"

    # Second request: HEAD still reports the object present (store still has
    # the key -- unchanged), but the GET transiently fails.
    def _dl_global_always_fails(key, local_path, progress_callback=None):
        return False

    with ExitStack() as stack:
        _install_cached_pipeline(stack, store, counters)
        stack.enter_context(
            patch("app.routers.downloads.download_from_r2_global", _dl_global_always_fails)
        )

        r2 = _get(client, fv_id)
        assert r2.status_code == 200, "a HEAD-hit/GET-miss blip must rebuild, never error"
        assert r2.content == b"COMPOSED", "the rebuilt bytes still stream correctly"
        assert counters["compose"] == 2, "the GET failure must fall through to a fresh build"


# ===========================================================================
# 9. AC7 follow-up (root-caused by a real-R2 benchmark): on the R2_ENABLED
#    branch, the NEW cache-key HEAD check and the PRE-EXISTING source-verify
#    HEAD (inside get_download_file_url(verify_exists=True)) must run
#    CONCURRENTLY, not sequentially -- two round trips where there used to be
#    one before this cache existed. Proven by stubbing both HEAD calls with a
#    0.3s delay each and asserting the combined cost is ~0.3s, not ~0.6s.
# ===========================================================================

def test_cache_head_and_source_verify_head_run_concurrently_not_sequentially(client):
    """Before the fix: `r2_head_object_global` is awaited via `asyncio.to_thread`
    (0.3s off-loop), then `get_download_file_url` runs SYNCHRONOUSLY, blocking
    the event loop directly for another 0.3s -- ~0.6s total, sequential. After
    the fix: both run via `asyncio.to_thread` + `asyncio.gather` -- ~0.3s
    total, concurrent. A cache MISS (the HEAD returns None) is used so the
    request falls all the way through to the presign check, exercising both
    calls on the same request."""
    from app.profile_context import set_current_profile_id
    from app.routers.downloads import download_file
    from app.user_context import set_current_user_id

    db = _db_path()
    fv_id, _filename = _seed_final_video(db)

    store, counters = {}, {"compose": 0}

    def _slow_head(key):
        time.sleep(0.3)
        return None  # cache MISS -- falls through to the presign check

    def _slow_presign(filename, verify_exists=False):
        time.sleep(0.3)
        return "https://fake-r2.example/presigned"

    async def _run():
        set_current_user_id(USER_ID)
        set_current_profile_id(PROFILE_ID)
        t0 = time.monotonic()
        resp = await download_file(fv_id)
        body = b"".join([c async for c in resp.body_iterator])
        elapsed = time.monotonic() - t0
        return elapsed, body

    with ExitStack() as stack:
        _install_r2_source_pipeline(stack, store, counters)
        stack.enter_context(patch("app.routers.downloads.r2_head_object_global", _slow_head))
        stack.enter_context(patch("app.routers.downloads.get_download_file_url", _slow_presign))
        elapsed, body = asyncio.run(_run())

    assert elapsed < 0.45, (
        f"the cache-key HEAD and the source-verify HEAD must run CONCURRENTLY, "
        f"not sequentially (took {elapsed:.2f}s; two 0.3s sequential calls "
        f"would take ~0.6s)"
    )
    assert body == b"COMPOSED", "the miss path still composes and streams correctly"
    assert counters["compose"] == 1
