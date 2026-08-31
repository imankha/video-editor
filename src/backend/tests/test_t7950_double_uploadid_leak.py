"""
T7950: regression tests for the double-UploadId multipart leak.

Design doc: docs/plans/tasks/T7950-design.md (APPROVED 2026-08-28).

Two compounding defects on the GLOBAL, env-prefix-free R2 key
`games/{blake3_hash}.mp4` (persistence-sync.md):

  H1 (storage.py:r2_create_multipart_upload) — the non-idempotent
  `CreateMultipartUpload` call is wrapped in `retry_r2_call` (TIER_3, 2
  attempts). A lost ack (ReadTimeoutError) after R2 already minted an
  UploadId triggers a SECOND CreateMultipartUpload, minting a second,
  unrelated UploadId. The handler stores only the second one; the first is
  live and unknown to the server -> stranded orphan.

  H3 (games_upload.py:prepare_upload fresh-create path) — the orphan-abort
  call at the top of the fresh-create path runs BEFORE create and with no
  `keep_upload_id`, so a second/concurrent prepare for the same global hash
  can abort the UploadId a first prepare already stored.

Approved fix (design doc SS5):
  B1 - r2_create_multipart_upload stops wrapping the create call in
       retry_r2_call. Single attempt. On a transient exception
       (retry.py's existing is_transient_error), list open multiparts on
       the key and adopt the newest by `Initiated`, aborting any extras.
       On a non-transient (definitive rejection) exception, return None
       immediately WITHOUT listing.
  B2 - prepare_upload's fresh-create path is reordered: create FIRST, hold
       upload_id, THEN r2_abort_orphan_multipart_uploads(key,
       keep_upload_id=upload_id), THEN insert into pending_uploads.

These tests target that fix. They are written against the CURRENT
(unfixed) tree and are expected to be RED for tests 1 and 3 until B1/B2
land; test 2 and test 4 pin contracts that must hold both before and
after.

--------------------------------------------------------------------------
RESIDUAL NOT COVERED HERE (intentional, documented in design doc SS4):
--------------------------------------------------------------------------
A genuinely CROSS-USER / CROSS-MACHINE concurrent `prepare_upload` for the
SAME global blake3_hash can still abort another prepare's in-use multipart:
B2 only spares the CURRENT prepare's own id (`keep_upload_id=upload_id`),
and the per-user write lock (`_USER_WRITE_LOCKS`, db_sync.py) is per-process
and keyed on user_id, not on the global hash. T8160 NARROWS this residual
(age-scoped reclaim: only multiparts older than ORPHAN_MULTIPART_MIN_AGE_
SECONDS are reclaimable, so only a RESUMED session older than the threshold
is still exposed) but does not close it. NOTE (T8160): the fakes in this
file model an S3 with STABLE UploadIds; real R2 mints a NEW alias per
response — see test_t8160_upload_self_abort.py for the R2-faithful fake.
These tests pin router wiring/ordering, not R2 id semantics. Closing that residual needs
Option A (a cross-machine idempotency/lock keyed on blake3_hash, e.g. a
Postgres advisory lock) - deferred, filed only if a future T7880 sweep
shows it recurring (design doc SS4/SS7). Do NOT write a two-different-users-
invert-each-other test expecting green: it cannot pass under B1+B2 alone.
B1+B2's guarantee is scoped to (a) create never mints a second multipart
via app-level retry, and (b) a single prepare never strands its OWN stored
id against its OWN abort call.
"""

import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import botocore.exceptions
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app import storage
from app.routers import games_upload

# ---------------------------------------------------------------------------
# Test 1 (B1) — no second mint on transient ack-loss
# ---------------------------------------------------------------------------

def _stateful_fake_r2_client(key: str):
    """A MagicMock R2 client that tracks open multiparts in a shared dict,
    modeling R2 ground truth (not the app's belief about it).

    create_multipart_upload: pops the next scripted behavior off a queue.
      Each behavior that "executes" mints a new UploadId into `open_uploads`
      BEFORE deciding whether to raise -- mirroring "executed at R2, ack
      lost" (the create really happened, the client just didn't hear back).
    list_multipart_uploads: returns the current open set in R2's shape.
    abort_multipart_upload: removes the given UploadId from the open set.
    """
    open_uploads: dict[str, datetime] = {}
    client = MagicMock()

    counter = {"n": 0}

    def _create_side_effect(**kwargs):
        counter["n"] += 1
        if counter["n"] == 1:
            # Call #1: executes at R2 (mints "A"), but the ack is lost.
            open_uploads["A"] = datetime.now(UTC)
            raise botocore.exceptions.ReadTimeoutError(endpoint_url="https://r2.example/")
        elif counter["n"] == 2:
            # Call #2 only happens if the app retries (today's bug). Mints
            # a second, unrelated UploadId "B" and returns successfully.
            open_uploads["B"] = datetime.now(UTC) + timedelta(seconds=1)
            return {"UploadId": "B"}
        raise AssertionError("create_multipart_upload called more than twice")

    def _list_side_effect(**kwargs):
        return {
            "Uploads": [
                {"Key": key, "UploadId": uid, "Initiated": ts}
                for uid, ts in open_uploads.items()
            ],
            "IsTruncated": False,
        }

    def _abort_side_effect(**kwargs):
        open_uploads.pop(kwargs.get("UploadId"), None)
        return {}

    client.create_multipart_upload.side_effect = _create_side_effect
    client.list_multipart_uploads.side_effect = _list_side_effect
    client.abort_multipart_upload.side_effect = _abort_side_effect
    return client, open_uploads


def test_create_multipart_upload_adopts_on_ack_loss_no_second_mint():
    """B1: a ReadTimeoutError on create (ack lost, but R2 executed it) must
    NOT trigger a second CreateMultipartUpload. The fix lists open
    multiparts on the key and adopts the one R2 actually created.

    RED on today's code: r2_create_multipart_upload wraps the call in
    retry_r2_call(**TIER_3), so the ReadTimeoutError triggers a SECOND
    CreateMultipartUpload (mints "B"), returns "B", and leaves BOTH "A"
    and "B" open -- list_multipart_uploads is never called at all.
    """
    key = "games/deadbeef.mp4"
    client, open_uploads = _stateful_fake_r2_client(key)

    with patch("app.storage.get_r2_client", return_value=client):
        result = storage.r2_create_multipart_upload(key)

    # Fix behavior: exactly one create call (no app-level retry of a
    # non-idempotent op), and the returned id is the one live multipart.
    assert client.create_multipart_upload.call_count == 1, (
        "create_multipart_upload must be called exactly once; a retry "
        "mints a second, unrelated UploadId on a non-idempotent op"
    )
    assert client.list_multipart_uploads.called, (
        "on a transient create failure, the fix must list open multiparts "
        "to discover whether R2 actually minted one (adopt path)"
    )
    assert result == "A", f"expected adoption of the live multipart 'A', got {result!r}"
    assert list(open_uploads.keys()) == ["A"], (
        f"expected exactly one live multipart ('A'); found {open_uploads!r}"
    )


# ---------------------------------------------------------------------------
# Test 2 (B1) — fail-fast on non-transient rejection, no list call
# ---------------------------------------------------------------------------

def test_create_multipart_upload_non_transient_rejection_returns_none_no_list():
    """B1: a definitive rejection (e.g. 403 AccessDenied) means nothing was
    created at R2 -- the fix must return None immediately WITHOUT calling
    list_multipart_uploads (there is nothing to adopt).

    Locks the classification contract: only *transient* create failures
    trigger list-and-adopt; non-transient ones fail fast.
    """
    key = "games/deadbeef.mp4"
    client = MagicMock()
    client.create_multipart_upload.side_effect = botocore.exceptions.ClientError(
        {"Error": {"Code": "403", "Message": "AccessDenied"}},
        "CreateMultipartUpload",
    )

    with patch("app.storage.get_r2_client", return_value=client):
        result = storage.r2_create_multipart_upload(key)

    assert result is None
    assert not client.list_multipart_uploads.called, (
        "a definitive (non-transient) rejection means nothing could have "
        "been created -- list_multipart_uploads must not be called"
    )


# ---------------------------------------------------------------------------
# Test 3 (B2) — prepare_upload creates before it aborts, sparing its own id
# ---------------------------------------------------------------------------

TEST_USER_ID = None  # set in setup_module
TEST_PROFILE_ID = "ab12cd34"  # valid 8-char hex for middleware regex


def setup_module():
    global TEST_USER_ID
    TEST_USER_ID = f"test_t7950_{uuid.uuid4().hex[:8]}"
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
    """A syntactically valid 64-hex blake3 hash, unique per test."""
    return uuid.uuid4().hex + uuid.uuid4().hex[:32]


def _pending_upload_row(blake3_hash: str):
    from app.database import get_db_connection
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, r2_upload_id FROM pending_uploads WHERE blake3_hash = ?",
            (blake3_hash,),
        )
        return cursor.fetchone()


@pytest.mark.asyncio
async def test_prepare_upload_creates_before_abort_and_spares_own_id():
    """B2: on the fresh-create path, prepare_upload must call
    r2_create_multipart_upload BEFORE r2_abort_orphan_multipart_uploads,
    and the abort call must pass keep_upload_id= the id create returned
    (which is also the id written to pending_uploads.r2_upload_id).

    RED on today's code: games_upload.py:231 calls
    r2_abort_orphan_multipart_uploads(r2_key) with NO keep_upload_id BEFORE
    r2_create_multipart_upload is even called -- i.e. the order is
    inverted and the abort call is unscoped.
    """
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)

    blake3_hash = _fresh_hash()
    created_upload_id = "fresh-upload-id-123"

    mock_parent = MagicMock()

    def _fake_create(key, *args, **kwargs):
        mock_parent.r2_create_multipart_upload(key)
        return created_upload_id

    def _fake_abort(key, *args, **kwargs):
        mock_parent.r2_abort_orphan_multipart_uploads(key, **kwargs)
        return 0

    with patch("app.routers.games_upload.R2_ENABLED", True), \
         patch("app.routers.games_upload.r2_head_object_global", return_value=None), \
         patch("app.routers.games_upload.get_credit_balance", return_value={"balance": 10**9}), \
         patch("app.routers.games_upload.calculate_upload_cost", return_value=1), \
         patch("app.routers.games_upload.generate_multipart_urls", return_value=[]), \
         patch("app.routers.games_upload.r2_create_multipart_upload", side_effect=_fake_create), \
         patch("app.routers.games_upload.r2_abort_orphan_multipart_uploads", side_effect=_fake_abort):

        req = games_upload.PrepareUploadRequest(
            blake3_hash=blake3_hash,
            file_size=12 * 1024 * 1024,
            original_filename="clip.mp4",
        )
        result = await games_upload.prepare_upload(req)

    assert result["status"] == "upload_required"

    # --- order assertion ---
    call_names = [c[0] for c in mock_parent.mock_calls]
    assert "r2_create_multipart_upload" in call_names, "create was never called"
    assert "r2_abort_orphan_multipart_uploads" in call_names, "abort was never called"
    create_idx = call_names.index("r2_create_multipart_upload")
    abort_idx = call_names.index("r2_abort_orphan_multipart_uploads")
    assert create_idx < abort_idx, (
        f"expected create BEFORE abort, got call order {call_names!r} "
        "(today's code aborts first, unscoped, then creates)"
    )

    # --- keep_upload_id argument assertion ---
    abort_call = mock_parent.r2_abort_orphan_multipart_uploads.call_args
    assert abort_call is not None
    abort_kwargs = abort_call.kwargs
    assert abort_kwargs.get("keep_upload_id") == created_upload_id, (
        f"abort must spare the id this prepare is about to store; got "
        f"keep_upload_id={abort_kwargs.get('keep_upload_id')!r}, "
        f"expected {created_upload_id!r}"
    )

    # --- the id stored in pending_uploads must be the created id ---
    row = _pending_upload_row(blake3_hash)
    assert row is not None, "expected a pending_uploads row for the fresh upload"
    assert row["r2_upload_id"] == created_upload_id


# ---------------------------------------------------------------------------
# Test 4 — post-condition invariant (single clean prepare, sanity pin)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_prepare_upload_normal_fresh_create_single_live_multipart():
    """Sanity pin (green both before and after B1/B2): a normal fresh
    prepare_upload with no orphans and a clean create leaves exactly one
    live multipart on the key, and it is the one written to
    pending_uploads.r2_upload_id.
    """
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)

    blake3_hash = _fresh_hash()
    created_upload_id = "clean-fresh-id-456"

    # Fake R2 truth: starts with nothing open. create_multipart_upload mints
    # the id lazily (only when actually called) -- mirrors real R2, where a
    # multipart doesn't exist until CreateMultipartUpload executes. This
    # matters because today's code calls abort BEFORE create: if we pre-
    # seeded `open_uploads`, an unscoped abort-first call would wipe a
    # multipart that (in reality) doesn't exist yet, which is not the
    # invariant this pin is checking.
    open_uploads: dict[str, datetime] = {}

    def _fake_create(key, *args, **kwargs):
        open_uploads[created_upload_id] = datetime.now(UTC)
        return created_upload_id

    def _fake_abort_orphans(key, keep_upload_id=None):
        aborted = 0
        for uid in list(open_uploads.keys()):
            if uid != keep_upload_id:
                del open_uploads[uid]
                aborted += 1
        return aborted

    with patch("app.routers.games_upload.R2_ENABLED", True), \
         patch("app.routers.games_upload.r2_head_object_global", return_value=None), \
         patch("app.routers.games_upload.get_credit_balance", return_value={"balance": 10**9}), \
         patch("app.routers.games_upload.calculate_upload_cost", return_value=1), \
         patch("app.routers.games_upload.generate_multipart_urls", return_value=[]), \
         patch("app.routers.games_upload.r2_create_multipart_upload", side_effect=_fake_create), \
         patch("app.routers.games_upload.r2_abort_orphan_multipart_uploads", side_effect=_fake_abort_orphans):

        req = games_upload.PrepareUploadRequest(
            blake3_hash=blake3_hash,
            file_size=12 * 1024 * 1024,
            original_filename="clip.mp4",
        )
        result = await games_upload.prepare_upload(req)

    assert result["status"] == "upload_required"

    row = _pending_upload_row(blake3_hash)
    assert row is not None
    assert list(open_uploads.keys()) == [row["r2_upload_id"]], (
        f"expected exactly one live multipart matching the stored id; "
        f"found {open_uploads!r} vs stored {row['r2_upload_id']!r}"
    )
