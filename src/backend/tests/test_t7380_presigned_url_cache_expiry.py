"""T7380: generate_presigned_url_global must never serve a cached URL past its own
expires_in window, even when the outer TTLCache's eviction TTL is longer than that
window (poster.py calls with expires_in=3600 against the cache's 12600s outer ttl).
"""
from unittest.mock import MagicMock, patch

from app import storage


def _fake_client(counter):
    client = MagicMock()

    def _generate_presigned_url(operation, Params, ExpiresIn):
        counter["calls"] += 1
        return f"https://example.r2.cloudflarestorage.com/{Params['Key']}?call={counter['calls']}"

    client.generate_presigned_url.side_effect = _generate_presigned_url
    return client


def test_cache_hit_within_expires_in_window():
    """A second call well inside the signature's own expires_in reuses the cached URL."""
    storage._PRESIGNED_URL_CACHE.clear()
    counter = {"calls": 0}
    client = _fake_client(counter)

    with patch.object(storage, "get_r2_client", return_value=client), \
         patch.object(storage.time, "time", return_value=1000.0):
        first = storage.generate_presigned_url_global("games/abc.mp4", expires_in=3600)
        second = storage.generate_presigned_url_global("games/abc.mp4", expires_in=3600)

    assert first == second
    assert counter["calls"] == 1


def test_stale_entry_regenerated_after_its_own_expires_in_elapses():
    """T7380 regression: a short expires_in must NOT be served past its own window just
    because the outer TTLCache (12600s) hasn't evicted it yet."""
    storage._PRESIGNED_URL_CACHE.clear()
    counter = {"calls": 0}
    client = _fake_client(counter)

    with patch.object(storage, "get_r2_client", return_value=client), \
         patch.object(storage.time, "time", return_value=1000.0):
        first = storage.generate_presigned_url_global("games/abc.mp4", expires_in=3600)

    # 90 minutes later: past the 1h expires_in, but well within the cache's 3.5h outer ttl.
    with patch.object(storage, "get_r2_client", return_value=client), \
         patch.object(storage.time, "time", return_value=1000.0 + 5400.0):
        second = storage.generate_presigned_url_global("games/abc.mp4", expires_in=3600)

    assert first != second
    assert counter["calls"] == 2


def test_safety_margin_regenerates_slightly_before_actual_expiry():
    """A read landing inside the safety margin (but not yet technically expired) still
    regenerates, so a caller never receives a URL that expires moments after handoff."""
    storage._PRESIGNED_URL_CACHE.clear()
    counter = {"calls": 0}
    client = _fake_client(counter)

    with patch.object(storage, "get_r2_client", return_value=client), \
         patch.object(storage.time, "time", return_value=1000.0):
        storage.generate_presigned_url_global("games/abc.mp4", expires_in=3600)

    # 1 second inside the safety margin before the real expiry (1000 + 3600 - 30 + 1).
    with patch.object(storage, "get_r2_client", return_value=client), \
         patch.object(storage.time, "time", return_value=1000.0 + 3600.0 - 29.0):
        storage.generate_presigned_url_global("games/abc.mp4", expires_in=3600)

    assert counter["calls"] == 2
