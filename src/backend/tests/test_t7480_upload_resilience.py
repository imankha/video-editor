"""
T7480: prod game-upload resilience + observability.

Covers the confirmed-root-cause fix set:
- PART_SIZE reduced 25MB -> 5MB (the outage: a single 25MB part couldn't beat the
  client's per-part budget on a slow uplink).
- Resume part-size guard: an old 25MB-chunked multipart must NOT be resumed under
  the new 5MB size (would finalize a corrupt object).
- UploadId hygiene: orphan multiparts on a key are aborted before a fresh create
  (kills the double-UploadId accumulation).
- Client failure beacon endpoint: accepts POST, never throws on bad input, logs only.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.routers import games_upload

# ---------------------------------------------------------------------------
# PART_SIZE — the core outage fix
# ---------------------------------------------------------------------------

def test_part_size_is_5mb():
    """Regression pin: PART_SIZE is 5MB (R2/S3 minimum). At 25MB a 17.8MB phone
    video was a single part that couldn't clear the client budget on cell uplinks."""
    assert games_upload.PART_SIZE == 5 * 1024 * 1024


# ---------------------------------------------------------------------------
# Resume part-size guard (r2_multipart_parts_match_size)
# ---------------------------------------------------------------------------

def _mock_client_with_parts(parts):
    """Build a mock R2 client whose list_parts returns `parts` (as R2 shapes them)."""
    client = MagicMock()
    client.exceptions.NoSuchUpload = type("NoSuchUpload", (Exception,), {})
    client.list_parts.return_value = {"Parts": parts, "IsTruncated": False}
    return client


def test_parts_match_size_all_current_parts_true():
    """A 12MB file at 5MB parts: [5MB, 5MB, 2MB tail] -> compatible resume."""
    parts = [
        {"PartNumber": 1, "Size": 5 * 1024 * 1024, "ETag": "a"},
        {"PartNumber": 2, "Size": 5 * 1024 * 1024, "ETag": "b"},
        {"PartNumber": 3, "Size": 2 * 1024 * 1024, "ETag": "c"},  # tail
    ]
    file_size = 12 * 1024 * 1024
    with patch("app.storage.get_r2_client", return_value=_mock_client_with_parts(parts)):
        assert games_upload.r2_multipart_parts_match_size(
            "games/x.mp4", "uid", file_size, games_upload.PART_SIZE
        ) is True


def test_parts_match_size_rejects_old_25mb_part():
    """An old 25MB-chunked part must be rejected so it isn't spliced with 5MB parts."""
    parts = [{"PartNumber": 1, "Size": 25 * 1024 * 1024, "ETag": "a"}]
    file_size = 40 * 1024 * 1024
    with patch("app.storage.get_r2_client", return_value=_mock_client_with_parts(parts)):
        assert games_upload.r2_multipart_parts_match_size(
            "games/x.mp4", "uid", file_size, games_upload.PART_SIZE
        ) is False


def test_parts_match_size_rejects_non_tail_short_part():
    """A short part that is NOT the file's last part means a different chunking."""
    # 12MB file -> last part is #3. A short part at #1 is incompatible.
    parts = [
        {"PartNumber": 1, "Size": 3 * 1024 * 1024, "ETag": "a"},
        {"PartNumber": 2, "Size": 5 * 1024 * 1024, "ETag": "b"},
    ]
    file_size = 12 * 1024 * 1024
    with patch("app.storage.get_r2_client", return_value=_mock_client_with_parts(parts)):
        assert games_upload.r2_multipart_parts_match_size(
            "games/x.mp4", "uid", file_size, games_upload.PART_SIZE
        ) is False


def test_parts_match_size_empty_parts_false():
    """No parts / unreadable multipart -> not resumable (safe default: restart)."""
    with patch("app.storage.get_r2_client", return_value=_mock_client_with_parts([])):
        assert games_upload.r2_multipart_parts_match_size(
            "games/x.mp4", "uid", 12 * 1024 * 1024, games_upload.PART_SIZE
        ) is False


# ---------------------------------------------------------------------------
# UploadId hygiene (orphan abort) + double-UploadId anomaly
# ---------------------------------------------------------------------------

def test_list_multipart_uploads_filters_by_exact_key():
    """list_multipart_uploads filters R2's prefix results down to the exact key."""
    client = MagicMock()
    client.list_multipart_uploads.return_value = {
        "Uploads": [
            {"Key": "games/x.mp4", "UploadId": "u1"},
            {"Key": "games/x.mp4v2", "UploadId": "u2"},  # prefix match, not exact
        ],
        "IsTruncated": False,
    }
    from app.storage import r2_list_multipart_uploads
    with patch("app.storage.get_r2_client", return_value=client):
        got = r2_list_multipart_uploads("games/x.mp4")
    assert [u["UploadId"] for u in got] == ["u1"]


def test_list_multipart_uploads_by_prefix_returns_every_key_under_prefix():
    """T7880: unlike the exact-key lister, the prefix lister returns EVERY open
    multipart under a prefix (e.g. 'games/'), across different hashes/keys -- the
    primitive an admin sweep needs to find stranded uploads with no local record."""
    client = MagicMock()
    client.list_multipart_uploads.return_value = {
        "Uploads": [
            {"Key": "games/aaa.mp4", "UploadId": "u1"},
            {"Key": "games/bbb.mp4", "UploadId": "u2"},
            {"Key": "games/bbb.mp4", "UploadId": "u3"},  # double-UploadId anomaly
        ],
        "IsTruncated": False,
    }
    from app.storage import r2_list_multipart_uploads_by_prefix
    with patch("app.storage.get_r2_client", return_value=client):
        got = r2_list_multipart_uploads_by_prefix("games/")
    assert {(u["Key"], u["UploadId"]) for u in got} == {
        ("games/aaa.mp4", "u1"), ("games/bbb.mp4", "u2"), ("games/bbb.mp4", "u3"),
    }
    call_kwargs = client.list_multipart_uploads.call_args.kwargs
    assert call_kwargs["Prefix"] == "games/"


def test_list_multipart_uploads_by_prefix_paginates():
    """A truncated first page must be followed using the Next*Marker fields."""
    client = MagicMock()
    client.list_multipart_uploads.side_effect = [
        {
            "Uploads": [{"Key": "games/aaa.mp4", "UploadId": "u1"}],
            "IsTruncated": True,
            "NextKeyMarker": "games/aaa.mp4",
            "NextUploadIdMarker": "u1",
        },
        {
            "Uploads": [{"Key": "games/zzz.mp4", "UploadId": "u2"}],
            "IsTruncated": False,
        },
    ]
    from app.storage import r2_list_multipart_uploads_by_prefix
    with patch("app.storage.get_r2_client", return_value=client):
        got = r2_list_multipart_uploads_by_prefix("games/")
    assert [u["UploadId"] for u in got] == ["u1", "u2"]
    assert client.list_multipart_uploads.call_count == 2
    second_kwargs = client.list_multipart_uploads.call_args_list[1].kwargs
    assert second_kwargs["KeyMarker"] == "games/aaa.mp4"
    assert second_kwargs["UploadIdMarker"] == "u1"


def test_abort_orphan_multipart_uploads_aborts_all_matching():
    """Two PROVABLY OLD open multiparts on a key (the double-UploadId leak) are
    both aborted. T8160: reclaim is age-scoped — only uploads Initiated beyond
    ORPHAN_MULTIPART_MIN_AGE_SECONDS are orphans; the fixtures carry stale
    timestamps accordingly."""
    from datetime import UTC, datetime, timedelta

    from app.storage import ORPHAN_MULTIPART_MIN_AGE_SECONDS
    stale = datetime.now(UTC) - timedelta(seconds=ORPHAN_MULTIPART_MIN_AGE_SECONDS * 2)
    client = MagicMock()
    client.list_multipart_uploads.return_value = {
        "Uploads": [
            {"Key": "games/x.mp4", "UploadId": "u1", "Initiated": stale},
            {"Key": "games/x.mp4", "UploadId": "u2", "Initiated": stale},
        ],
        "IsTruncated": False,
    }
    client.abort_multipart_upload.return_value = {}
    with patch("app.storage.get_r2_client", return_value=client):
        aborted = games_upload.r2_abort_orphan_multipart_uploads("games/x.mp4")
    assert aborted == 2
    assert client.abort_multipart_upload.call_count == 2


def test_abort_orphan_multipart_uploads_can_keep_one():
    """A FRESH upload is spared while the stale orphan is reclaimed. T8160:
    the spare is age-based (a just-created keeper is seconds old), because on
    real R2 keep_upload_id can never match a listed id (per-call aliases —
    the bug 47p outage). keep_upload_id remains a secondary guard only."""
    from datetime import UTC, datetime, timedelta

    from app.storage import ORPHAN_MULTIPART_MIN_AGE_SECONDS
    stale = datetime.now(UTC) - timedelta(seconds=ORPHAN_MULTIPART_MIN_AGE_SECONDS * 2)
    client = MagicMock()
    client.list_multipart_uploads.return_value = {
        "Uploads": [
            # Real-R2 shape: the keeper appears under an ALIAS id that does NOT
            # equal keep_upload_id — only its fresh age protects it.
            {"Key": "games/x.mp4", "UploadId": "keep-alias", "Initiated": datetime.now(UTC)},
            {"Key": "games/x.mp4", "UploadId": "orphan", "Initiated": stale},
        ],
        "IsTruncated": False,
    }
    client.abort_multipart_upload.return_value = {}
    with patch("app.storage.get_r2_client", return_value=client):
        aborted = games_upload.r2_abort_orphan_multipart_uploads(
            "games/x.mp4", keep_upload_id="keep"
        )
    assert aborted == 1
    aborted_ids = [c.kwargs["UploadId"] for c in client.abort_multipart_upload.call_args_list]
    assert aborted_ids == ["orphan"]


# ---------------------------------------------------------------------------
# Failure beacon endpoint — accepts POST, never throws on bad input, logs only
# ---------------------------------------------------------------------------

class _StubRequest:
    def __init__(self, body):
        self._body = body

    async def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


@pytest.mark.asyncio
async def test_beacon_returns_204_on_valid_body():
    req = _StubRequest({"phase": "uploading", "reason": "stalled", "session_id": "s1"})
    result = await games_upload.upload_failure_beacon(req)
    assert result is None  # 204 No Content


@pytest.mark.asyncio
async def test_beacon_never_throws_on_malformed_json():
    """A body that fails to parse must not raise — the failure path can't break."""
    req = _StubRequest(ValueError("not json"))
    result = await games_upload.upload_failure_beacon(req)
    assert result is None


@pytest.mark.asyncio
async def test_beacon_never_throws_on_non_dict_body():
    req = _StubRequest("just a string")
    result = await games_upload.upload_failure_beacon(req)
    assert result is None
