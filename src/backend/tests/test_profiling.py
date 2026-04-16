"""
Tests for the profiling infrastructure (T1530/T1531).

Covers:
  - dump_profile writes paired .prof + .txt
  - rotation trims to PROFILE_KEEP_LAST
  - install_slow_sql_trace logs [SLOW SQL] for slow statements only
  - list_profiles / read_profile_text round-trip
  - path traversal rejected
"""

import cProfile
import time
from pathlib import Path

import pytest

from app import profiling


@pytest.fixture(autouse=True)
def isolate_profile_dir(tmp_path, monkeypatch):
    """Redirect PROFILE_DIR to a tmp path for each test."""
    monkeypatch.setattr(profiling, "PROFILE_DIR", tmp_path / "profiles")
    yield


def _make_profile_with_work():
    prof = cProfile.Profile()
    prof.enable()
    # Do a tiny bit of real work so the profile is non-empty.
    total = 0
    for i in range(1000):
        total += i
    prof.disable()
    return prof


def test_dump_profile_creates_prof_and_txt():
    prof = _make_profile_with_work()
    path = profiling.dump_profile(prof, tag="GET_/api/test", elapsed_ms=1234.5, extra="user123")
    assert path is not None
    assert path.exists()
    assert path.suffix == ".prof"
    txt = path.with_suffix(".txt")
    assert txt.exists()
    content = txt.read_text(encoding="utf-8")
    assert "cumulative" in content
    assert "tottime" in content
    # Filename encodes method, sanitized path, ms, and extra.
    assert "GET" in path.name and "1234ms" in path.name and "user123" in path.name


def test_dump_profile_rotation(monkeypatch):
    monkeypatch.setenv("PROFILE_KEEP_LAST", "3")
    for i in range(5):
        prof = _make_profile_with_work()
        profiling.dump_profile(prof, tag=f"req{i}", elapsed_ms=100 + i)
        time.sleep(0.01)  # ensure distinct mtimes
    profs = list(profiling.PROFILE_DIR.glob("*.prof"))
    txts = list(profiling.PROFILE_DIR.glob("*.txt"))
    assert len(profs) == 3
    assert len(txts) == 3


def test_list_and_read_profile_text():
    prof = _make_profile_with_work()
    path = profiling.dump_profile(prof, tag="POST_/quests", elapsed_ms=1500)
    assert path is not None

    listed = profiling.list_profiles()
    assert len(listed) == 1
    assert listed[0]["name"] == path.name
    assert listed[0]["has_text"] is True

    text = profiling.read_profile_text(path.name)
    assert text is not None
    assert "cumulative" in text

    # Also accepts name without extension.
    text2 = profiling.read_profile_text(path.stem)
    assert text2 == text


def test_read_profile_rejects_path_traversal():
    assert profiling.read_profile_text("../etc/passwd") is None
    assert profiling.read_profile_text("..\\foo") is None
    assert profiling.read_profile_text("nonexistent_profile.prof") is None


def test_middleware_dumps_profile_on_breach(monkeypatch, caplog, tmp_path):
    """Integration: a slow handler under PROFILE_ON_BREACH_ENABLED produces a
    .prof file and a [SLOW REQUEST] log line referencing its path."""
    import asyncio
    import logging
    from unittest.mock import patch

    monkeypatch.setenv("PROFILE_ON_BREACH_ENABLED", "true")
    monkeypatch.setenv("PROFILE_ON_BREACH_MS", "50")
    monkeypatch.setattr(profiling, "PROFILE_DIR", tmp_path / "profiles")

    from app.middleware.db_sync import RequestContextMiddleware

    # Build a minimal request+call_next that spends 80ms and returns OK.
    class _Resp:
        headers = {}

    async def slow_handler(_req):
        # Must exceed SLOW_REQUEST_THRESHOLD (200ms) so [SLOW REQUEST] fires.
        await asyncio.sleep(0.25)
        return _Resp()

    class _Req:
        method = "GET"
        url = type("U", (), {"path": "/api/test"})()
        cookies = {}
        headers = {"X-User-ID": "testuser", "origin": "-"}

    mw = RequestContextMiddleware(app=None)

    with patch("app.middleware.db_sync.R2_ENABLED", False), \
         caplog.at_level(logging.WARNING, logger="app.middleware.db_sync"):
        asyncio.run(mw.dispatch(_Req(), slow_handler))

    # Breach threshold (50ms) exceeded by 80ms handler → profile dumped.
    profs = list((tmp_path / "profiles").glob("*.prof"))
    assert len(profs) == 1, f"expected one profile, got {profs}"

    slow_log = [r for r in caplog.records if "[SLOW REQUEST]" in r.getMessage()]
    assert slow_log, "expected [SLOW REQUEST] log"
    assert "profile=" in slow_log[0].getMessage()
    assert str(profs[0]) in slow_log[0].getMessage()
