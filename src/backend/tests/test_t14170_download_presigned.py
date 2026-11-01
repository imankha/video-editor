"""T14170 -- Downloads are served from a presigned R2 URL, stamped once.

`GET /api/downloads/{id}/file-url` replaces the byte-proxied
`GET /api/downloads/{id}/file` for the R2 path. The composed-download cache
(T11590) now holds the STAMPED file, keyed on the stamp inputs too (tags +
poster), so:

- C1: a download whose stamped object already exists runs no compose, no
  ffmpeg stamp and no R2 GET on the API machine; the response is a presigned
  URL, not video bytes.
- C2: a reel exported before this change (no stamped object yet, or only a
  pre-T14170 unstamped composed cache object) still downloads: the first
  request builds + stamps it once and stores it; later requests are C1.

The R2 boundary is an in-memory store and the compose/stamp engines are
counting stubs (no real R2 or ffmpeg in the unit sandbox).
"""

import hashlib
import json
import os
import shutil
import sqlite3
from contextlib import ExitStack
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

USER_ID = "t14170-owner"
PROFILE_ID = "t14170prof"
PRESIGN_BASE = "https://r2.example/"


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


def _seed_final_video(name="Reel"):
    from app.database import get_database_path
    conn = sqlite3.connect(str(get_database_path()))
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES (?, '9:16')", (name,))
    project_id = cur.lastrowid
    filename = f"f{project_id}.mp4"
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, duration) "
        "VALUES (?, ?, 1, 'custom_project', ?, 15.0)",
        (project_id, filename, name),
    )
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, project_id))
    conn.commit()
    conn.close()
    return fv_id, filename


def _install(stack, store, counters, *, source_present=True, full_fidelity=True,
             athlete="Sam Player"):
    """R2 on; in-memory R2 store; counting compose/stamp/source-GET stubs."""
    def _head_global(key):
        return {"ContentLength": len(store[key])} if key in store else None

    def _dl_global(key, local_path, progress_callback=None):
        counters["cache_get"] += 1
        if key not in store:
            return False
        with open(local_path, "wb") as f:
            f.write(store[key])
        return True

    def _upload_global(key, local_path, content_type=None):
        with open(local_path, "rb") as f:
            store[key] = f.read()
        return True

    def _source_get(user_id, relative_path, local_path, progress_callback=None, **kw):
        counters["source_get"] += 1
        if not source_present:
            return False
        with open(local_path, "wb") as f:
            f.write(b"ORIGINAL")
        return True

    def _compose(reel_path, out_path, *, user_id=None, intro=None, outro=True, report=None):
        counters["compose"] += 1
        if report is not None:
            report["full_fidelity"] = full_fidelity
        with open(out_path, "wb") as f:
            f.write(b"COMPOSED")
        return True

    def _stamp(serve_path, tmp_dir, meta, user_id, profile_id):
        counters["stamp"] += 1
        stamped = os.path.join(tmp_dir, "stamped.mp4")
        shutil.copyfile(serve_path, stamped)
        with open(stamped, "ab") as f:
            f.write(b"+STAMP:" + json.dumps(meta["tags"], sort_keys=True).encode())
        return stamped

    stack.enter_context(patch("app.routers.downloads.R2_ENABLED", True))
    stack.enter_context(patch("app.routers.downloads.r2_head_object_global", _head_global))
    stack.enter_context(patch("app.routers.downloads.download_from_r2_global", _dl_global))
    stack.enter_context(patch("app.routers.downloads.upload_file_to_r2_global", _upload_global))
    stack.enter_context(patch("app.storage.download_from_r2", _source_get))
    stack.enter_context(patch(
        "app.storage.generate_presigned_url_global",
        lambda key, expires_in=3600: PRESIGN_BASE + key,
    ))
    stack.enter_context(patch("app.services.serve_time_video.compose_serve_time_dispatched", _compose))
    stack.enter_context(patch("app.routers.downloads._stamp_download", _stamp))
    stack.enter_context(patch(
        "app.services.download_metadata._athlete_name", lambda user_id, profile_id: athlete,
    ))


def _counters():
    return {"compose": 0, "stamp": 0, "source_get": 0, "cache_get": 0}


def _file_url(client, fv_id):
    return client.get(f"/api/downloads/{fv_id}/file-url", headers={"X-User-ID": USER_ID})


def _key_from(resp):
    body = resp.json()
    assert body["url"].startswith(PRESIGN_BASE), body
    return body["url"][len(PRESIGN_BASE):]


def test_t14170_c1_download_runs_no_ffmpeg_and_no_byte_proxy(client):
    """T14170:C1 -- once the stamped object exists, a download is a presigned
    URL: no compose, no stamp, no R2 GET (source or cache) on the API machine."""
    fv_id, _ = _seed_final_video()
    store, counters = {}, _counters()
    with ExitStack() as stack:
        _install(stack, store, counters)
        first = _file_url(client, fv_id)
        assert first.status_code == 200
        before = dict(counters)

        resp = _file_url(client, fv_id)

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json"), "no video bytes proxied"
    body = resp.json()
    assert body["filename"] == "Reel_ReelBallers.mp4"
    assert body["proxied"] is False
    assert counters == before, f"a hit must do no compose/stamp/R2 GET: {before} -> {counters}"
    key = _key_from(resp)
    assert store[key].startswith(b"COMPOSED+STAMP:"), "the presigned object is the STAMPED file"


def test_t14170_c2_pre_change_export_stamps_lazily_once(client):
    """T14170:C2 -- an export from before this change has only the old
    UNSTAMPED composed cache object (or none). It must never be served as the
    download; the first request builds + stamps once, later requests reuse it."""
    from app.routers.downloads import _card_content_hash
    from app.storage import r2_user_prefix

    fv_id, filename = _seed_final_video()
    store, counters = {}, _counters()
    # The pre-T14170 cache key: same fingerprint minus the stamp inputs.
    legacy_fp = "\n".join([
        f"filename={filename}", "card=None", f"cardhash={_card_content_hash(None)}",
        "facts=", "outro=1",
    ])
    legacy_key = (
        f"{r2_user_prefix(USER_ID)}/reel_downloads/"
        f"{hashlib.sha256(legacy_fp.encode()).hexdigest()}.mp4"
    )
    store[legacy_key] = b"COMPOSED-UNSTAMPED"

    with ExitStack() as stack:
        _install(stack, store, counters)
        r1 = _file_url(client, fv_id)
        r2 = _file_url(client, fv_id)
        r3 = _file_url(client, fv_id)

    assert r1.status_code == r2.status_code == r3.status_code == 200
    assert counters["compose"] == 1 and counters["stamp"] == 1, counters
    key = _key_from(r1)
    assert key != legacy_key, "the unstamped legacy object must not be served"
    assert _key_from(r2) == _key_from(r3) == key
    assert store[key].startswith(b"COMPOSED+STAMP:")


def test_t14170_rename_rebuilds_with_live_artist(client):
    """The stamp is cached, so its inputs are in the key: a profile rename
    (live `artist`) is a miss and the next download carries the new name."""
    fv_id, _ = _seed_final_video()
    store, counters = {}, _counters()
    with ExitStack() as stack:
        _install(stack, store, counters, athlete="Old Name")
        k1 = _key_from(_file_url(client, fv_id))
    with ExitStack() as stack:
        _install(stack, store, counters, athlete="New Name")
        k2 = _key_from(_file_url(client, fv_id))

    assert k1 != k2
    assert counters["stamp"] == 2
    assert b"New Name" in store[k2]


def test_t14170_degraded_build_is_served_but_not_cached(client):
    """A degraded compose still downloads (a presigned one-off object) but is
    never stored under the cache key, so the next request retries a full build."""
    fv_id, _ = _seed_final_video()
    store, counters = {}, _counters()
    with ExitStack() as stack:
        _install(stack, store, counters, full_fidelity=False)
        r1 = _file_url(client, fv_id)
        r2 = _file_url(client, fv_id)

    assert r1.status_code == r2.status_code == 200
    assert counters["compose"] == 2, "degraded output must not satisfy the next request"
    assert "/reel_downloads/degraded/" in _key_from(r1)


def test_t14170_missing_source_is_404(client):
    fv_id, _ = _seed_final_video()
    store, counters = {}, _counters()
    with ExitStack() as stack:
        _install(stack, store, counters, source_present=False)
        resp = _file_url(client, fv_id)
    assert resp.status_code == 404
    assert counters["compose"] == 0
    assert store == {}


def test_t14170_local_storage_mode_points_at_the_proxy(client):
    """R2 disabled (local dev): there is no presignable object, so the
    response says to use the `/file` endpoint."""
    fv_id, _ = _seed_final_video()
    resp = _file_url(client, fv_id)
    assert resp.status_code == 200
    assert resp.json() == {"url": None, "filename": "Reel_ReelBallers.mp4", "proxied": True}
