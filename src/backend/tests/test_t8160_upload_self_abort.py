"""
T8160: regression tests for the prepare-upload self-abort outage (bug 47p).

Root cause (reproduced live against prod R2 on 2026-08-31): Cloudflare R2's
ListMultipartUploads returns a DIFFERENT UploadId string on EVERY call — the
created id and each listed id are all distinct, equally valid ALIASES of the
same multipart (abort/list_parts accept any of them). T7950's orphan reclaim
(`r2_abort_orphan_multipart_uploads(key, keep_upload_id=created_id)`) spares
the keeper by string equality, which therefore NEVER matches on R2 — so every
fresh prepare aborted the multipart it had just created, and every client part
PUT got 404 NoSuchUpload. All non-dedup prod uploads failed from the ~2026-08-30
deploy of build 2a906b5a until this fix.

Fix under test:
  - Sparing is AGE-based: only uploads Initiated more than
    ORPHAN_MULTIPART_MIN_AGE_SECONDS ago may be reclaimed as orphans. A
    just-created keeper (seconds old) is structurally safe, and so is any
    other user's ACTIVE upload on the same shared content-hash key (closes
    the cross-user residual documented in test_t7950_double_uploadid_leak).
    keep_upload_id stays as a belt-and-suspenders guard for S3
    implementations with stable ids.
  - prepare_upload keeper post-check: if the reclaim aborted anything, the
    keeper must still be valid, else prepare fails LOUDLY (500 + CRITICAL
    log) instead of handing out presigned URLs for a dead upload.

The fake R2 client below models the REAL R2 behavior the T7950 fakes missed:
list returns a fresh alias string per call; abort resolves aliases.
"""

import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app import storage
from app.routers import games_upload

# ---------------------------------------------------------------------------
# Fake R2 with UNSTABLE listed UploadIds (the real R2 behavior)
# ---------------------------------------------------------------------------


def _unstable_id_fake_r2_client(key: str):
    """Fake R2 where ListMultipartUploads mints a NEW alias string per call
    for each open upload, and abort/list_parts resolve any alias back to the
    canonical upload. `open_uploads` maps canonical id -> Initiated ts and is
    the ground truth."""
    open_uploads: dict[str, datetime] = {}
    alias_to_canonical: dict[str, str] = {}
    list_call_counter = {"n": 0}
    client = MagicMock()

    def _resolve(uid: str) -> str:
        return alias_to_canonical.get(uid, uid)

    def _create_side_effect(**kwargs):
        canonical = f"canon-{len(open_uploads) + 1}"
        open_uploads[canonical] = datetime.now(UTC)
        return {"UploadId": canonical}

    def _list_side_effect(**kwargs):
        list_call_counter["n"] += 1
        uploads = []
        for canonical, ts in open_uploads.items():
            alias = f"alias-{list_call_counter['n']}-{canonical}"
            alias_to_canonical[alias] = canonical
            uploads.append({"Key": key, "UploadId": alias, "Initiated": ts})
        return {"Uploads": uploads, "IsTruncated": False}

    def _abort_side_effect(**kwargs):
        canonical = _resolve(kwargs.get("UploadId"))
        open_uploads.pop(canonical, None)
        return {}

    def _list_parts_side_effect(**kwargs):
        canonical = _resolve(kwargs.get("UploadId"))
        if canonical not in open_uploads:
            raise client.exceptions.NoSuchUpload(
                {"Error": {"Code": "NoSuchUpload"}}, "ListParts"
            )
        return {"Parts": [], "IsTruncated": False}

    class _NoSuchUpload(Exception):
        def __init__(self, *args, **kwargs):
            super().__init__("NoSuchUpload")

    client.exceptions.NoSuchUpload = _NoSuchUpload
    client.create_multipart_upload.side_effect = _create_side_effect
    client.list_multipart_uploads.side_effect = _list_side_effect
    client.abort_multipart_upload.side_effect = _abort_side_effect
    client.list_parts.side_effect = _list_parts_side_effect
    return client, open_uploads


# ---------------------------------------------------------------------------
# Test 1 — the outage: reclaim must NOT kill the just-created keeper
# ---------------------------------------------------------------------------


def test_abort_orphans_spares_fresh_keeper_despite_unstable_listed_ids():
    """RED on pre-T8160 code: with R2's per-call alias UploadIds, the
    keep_upload_id equality never matches, so the reclaim aborts the upload
    it was told to keep — the bug 47p outage. The fix must leave a
    seconds-old upload alive regardless of id (in)stability."""
    key = "games/" + "ab" * 32 + ".mp4"
    client, open_uploads = _unstable_id_fake_r2_client(key)

    with patch("app.storage.get_r2_client", return_value=client):
        created = storage.r2_create_multipart_upload(key)
        assert created in open_uploads
        storage.r2_abort_orphan_multipart_uploads(key, keep_upload_id=created)

    assert created in open_uploads, (
        "orphan reclaim aborted the just-created keeper: with R2's unstable "
        "listed UploadIds the equality spare never matches — sparing must be "
        "age-based, never id-based (bug 47p / T8160 outage)"
    )


# ---------------------------------------------------------------------------
# Test 2 — genuine old orphans are still reclaimed
# ---------------------------------------------------------------------------


def test_abort_orphans_still_reclaims_old_orphans():
    """The reclaim's purpose (T7950: leaked executed-but-unacked creates)
    survives the fix: uploads older than the age threshold are aborted,
    while the fresh keeper stays."""
    key = "games/" + "cd" * 32 + ".mp4"
    client, open_uploads = _unstable_id_fake_r2_client(key)

    # A genuine orphan from a prior session, well past the threshold.
    stale_age = storage.ORPHAN_MULTIPART_MIN_AGE_SECONDS * 2
    open_uploads["old-orphan"] = datetime.now(UTC) - timedelta(seconds=stale_age)

    with patch("app.storage.get_r2_client", return_value=client):
        created = storage.r2_create_multipart_upload(key)
        aborted = storage.r2_abort_orphan_multipart_uploads(key, keep_upload_id=created)

    assert aborted == 1
    assert "old-orphan" not in open_uploads, "stale orphan must be reclaimed"
    assert created in open_uploads, "fresh keeper must survive the reclaim"


def test_abort_orphans_spares_missing_initiated():
    """An upload whose Initiated timestamp is missing cannot be proven old —
    the safe direction is to leave it alone (never abort a possibly-live
    upload on ambiguity)."""
    key = "games/" + "ef" * 32 + ".mp4"
    client, open_uploads = _unstable_id_fake_r2_client(key)
    open_uploads["unknown-age"] = None  # list will carry Initiated=None

    with patch("app.storage.get_r2_client", return_value=client):
        aborted = storage.r2_abort_orphan_multipart_uploads(key)

    assert aborted == 0
    assert "unknown-age" in open_uploads


# ---------------------------------------------------------------------------
# Test 3 — prepare_upload keeper post-check fails loudly
# ---------------------------------------------------------------------------

TEST_USER_ID = None  # set in setup_module
TEST_PROFILE_ID = "ab12cd34"


def setup_module():
    global TEST_USER_ID
    TEST_USER_ID = f"test_t8160_{uuid.uuid4().hex[:8]}"
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def teardown_module():
    import shutil

    from app.database import USER_DATA_BASE
    from app.profile_context import set_current_profile_id
    from app.user_context import reset_user_id, set_current_user_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


def _fresh_hash() -> str:
    return uuid.uuid4().hex + uuid.uuid4().hex[:32]


@pytest.mark.asyncio
async def test_prepare_upload_500s_when_reclaim_killed_the_keeper():
    """If the reclaim aborted something AND the keeper is no longer valid,
    prepare must raise 500 instead of returning presigned URLs against a
    dead upload (the silent failure mode behind every 'Part N upload
    failed: 404' in bug 47p)."""
    from fastapi import HTTPException

    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)

    with patch("app.routers.games_upload.R2_ENABLED", True), \
         patch("app.routers.games_upload.r2_head_object_global", return_value=None), \
         patch("app.routers.games_upload.get_credit_balance", return_value={"balance": 10**9}), \
         patch("app.routers.games_upload.calculate_upload_cost", return_value=1), \
         patch("app.routers.games_upload.generate_multipart_urls", return_value=[]), \
         patch("app.routers.games_upload.r2_create_multipart_upload", return_value="doomed-id"), \
         patch("app.routers.games_upload.r2_abort_orphan_multipart_uploads", return_value=1), \
         patch("app.routers.games_upload.r2_is_multipart_upload_valid", return_value=False):

        req = games_upload.PrepareUploadRequest(
            blake3_hash=_fresh_hash(),
            file_size=12 * 1024 * 1024,
            original_filename="clip.mp4",
        )
        with pytest.raises(HTTPException) as exc_info:
            await games_upload.prepare_upload(req)

    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_prepare_upload_skips_post_check_when_nothing_aborted():
    """The keeper post-check costs an extra R2 round-trip, so it only runs
    when the reclaim actually aborted something. A clean fresh prepare
    (aborted == 0) must not call the validity check at all."""
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)

    validity = MagicMock(return_value=True)

    with patch("app.routers.games_upload.R2_ENABLED", True), \
         patch("app.routers.games_upload.r2_head_object_global", return_value=None), \
         patch("app.routers.games_upload.get_credit_balance", return_value={"balance": 10**9}), \
         patch("app.routers.games_upload.calculate_upload_cost", return_value=1), \
         patch("app.routers.games_upload.generate_multipart_urls", return_value=[]), \
         patch("app.routers.games_upload.r2_create_multipart_upload", return_value="clean-id"), \
         patch("app.routers.games_upload.r2_abort_orphan_multipart_uploads", return_value=0), \
         patch("app.routers.games_upload.r2_is_multipart_upload_valid", validity):

        req = games_upload.PrepareUploadRequest(
            blake3_hash=_fresh_hash(),
            file_size=12 * 1024 * 1024,
            original_filename="clip.mp4",
        )
        result = await games_upload.prepare_upload(req)

    assert result["status"] == "upload_required"
    assert not validity.called


# ---------------------------------------------------------------------------
# Opt-in integration test against REAL R2 (mocks cannot catch this class of
# bug: the T7950 fakes modeled stable UploadIds and stayed green through the
# outage). Run with RUN_REAL_R2=1 and R2 env configured (dev/staging creds).
# Uses a synthetic games/ key; a multipart that is created and aborted never
# materializes an object.
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    __import__("os").environ.get("RUN_REAL_R2") != "1",
    reason="real-R2 integration test; set RUN_REAL_R2=1 to run",
)
def test_real_r2_fresh_keeper_survives_orphan_reclaim(monkeypatch):
    # app.storage reads R2_* env at import time, before any dotenv load in a
    # bare pytest run — patch the module constants from a fresh .env read so
    # this test is self-sufficient (standard gotcha; see conftest.pg_conn).
    import os

    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent.parent / ".env")
    monkeypatch.setattr(storage, "R2_ENABLED", True)
    for const in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        value = os.getenv(const)
        assert value, f"{const} missing from .env — cannot run real-R2 test"
        monkeypatch.setattr(storage, const, value)

    key = f"games/{uuid.uuid4().hex}{uuid.uuid4().hex}.mp4"
    created = storage.r2_create_multipart_upload(key)
    assert created, "create_multipart_upload failed against real R2"
    try:
        storage.r2_abort_orphan_multipart_uploads(key, keep_upload_id=created)
        assert storage.r2_is_multipart_upload_valid(key, created), (
            "keeper multipart died during orphan reclaim on real R2 — "
            "the bug 47p self-abort has regressed"
        )
    finally:
        storage.r2_abort_multipart_upload(key, created)
