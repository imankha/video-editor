"""T6860: the attached intro card was missing from every DOWNLOADED reel on Fly
(both owner `/downloads/{id}/file` and single-reel share download), while in-app
playback still showed it.

Root cause (verified live on staging, commit 95632aa7): the burn/download egress is
the ONLY live caller of `download_from_r2_global`, which fetched the card image via
`get_r2_transfer_client().download_file`. That transfer-client path is exercised by
nothing else on the Fly web servers (playback + game export only ever *presign*), and
it failed non-transiently there -> `_download_card_image` raised -> `resolve_intro_for_reel`
degraded non-fatally to no-intro -> the composed download carried the outro but not the
intro. The per-user `download_from_r2` uses the DEFAULT sync client's `download_file` and
runs on Fly on every session-init, so the sync client is proven-good there.

Fix: `download_from_r2_global` uses `get_r2_client()` (sync), matching `download_from_r2`.

These are structural guards: the Fly-only failure cannot be reproduced in a unit test
(it downloads fine locally under either client), so we pin the client choice instead.
"""

from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError as BotoClientError


def _client_mock():
    c = MagicMock()
    c.exceptions.NoSuchKey = type("NoSuchKey", (BotoClientError,), {})
    return c


@patch("app.storage.get_r2_transfer_client")
@patch("app.storage.get_r2_client")
def test_global_download_uses_sync_client_not_transfer_client(mock_sync, mock_transfer, tmp_path):
    """The card-image download must go through the DEFAULT sync client (proven on Fly),
    never the transfer client (unproven, exercised by nothing else -> T6860 regression)."""
    from app.storage import download_from_r2_global

    sync = _client_mock()
    mock_sync.return_value = sync
    # If the code ever reaches for the transfer client again, fail loudly.
    mock_transfer.return_value = MagicMock(name="transfer-client-should-not-be-used")

    ok = download_from_r2_global("global/intro/card.png", tmp_path / "card.png")

    assert ok is True
    # Downloaded via the SYNC client...
    sync.download_file.assert_called_once()
    # ...and the transfer client's download_file was never touched.
    mock_transfer.return_value.download_file.assert_not_called()


@patch("app.storage.get_r2_transfer_client")
@patch("app.storage.get_r2_client")
def test_global_download_passes_key_and_dest_to_sync_client(mock_sync, mock_transfer, tmp_path):
    """Regression detail: the exact (bucket, key, local_path) reach the sync client's
    download_file, so the fix is a client swap only -- no key/path behavior change."""
    from app.storage import R2_BUCKET, download_from_r2_global

    sync = _client_mock()
    mock_sync.return_value = sync

    dest = tmp_path / "nested" / "card.png"
    download_from_r2_global("global/intro/card.png", dest)

    args, _ = sync.download_file.call_args
    assert args[0] == R2_BUCKET
    assert args[1] == "global/intro/card.png"
    assert args[2] == str(dest)
    # parent dir was created for the destination
    assert dest.parent.is_dir()
