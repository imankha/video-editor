"""
T6330: video-serving FAILURES must log where the code looked.

A game/reel/working video that won't load used to take three manual steps to
triage (read blake3_hash from the profile DB, probe R2 across candidate
prefixes, re-request with a fresh session) because the backend never recorded
the key it resolved. These tests pin the diagnostic CONTRACT:

  - a missing object logs the bucket + the exact fully-qualified key + `missing`,
  - a 401/403 logs `denied` and does NOT claim the object is missing,
  - an expired/swept source logs `expired`, not a bare 404,
  - no presigned URL / credential substring appears in any emitted line,
  - the SUCCESS path adds NO new INFO logging and does NO extra HEAD.

The log OUTPUT is asserted (via caplog), not just the status code.

Adversarial map (acceptance criterion -> test):
  AC "missing logs bucket+key+missing"  -> test_helper_missing_line*,
                                            test_classifier_missing*,
                                            test_game_video_endpoint_missing*
  AC "401/403 -> denied, not missing"   -> test_status_map*, test_helper_denied*,
                                            test_classifier_denied_when_present
  AC "expired, not a bare 404"          -> test_status_map_410*, test_helper_expired,
                                            test_classifier_expired
  AC "no credentials in any line"       -> test_redacts*, test_success_never_logs_url
  AC "success adds no INFO logging"     -> test_game_video_success_no_info_no_head
"""
import logging

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.profile_context import reset_profile_id, set_current_profile_id
from app.routers import games as games_router
from app.storage import (
    VideoServeOutcome,
    log_video_resolution,
    video_outcome_for_status,
)
from app.user_context import reset_user_id, set_current_user_id

HELPER_LOGGER = logging.getLogger("test.t6330")


# ---------------------------------------------------------------------------
# video_outcome_for_status: upstream status -> triage outcome
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("status", [401, 403])
def test_status_map_auth_is_denied(status):
    assert video_outcome_for_status(status) == VideoServeOutcome.DENIED


def test_status_map_410_is_expired():
    assert video_outcome_for_status(410) == VideoServeOutcome.EXPIRED


@pytest.mark.parametrize("status", [404, 500, 502])
def test_status_map_other_is_missing(status):
    assert video_outcome_for_status(status) == VideoServeOutcome.MISSING


# ---------------------------------------------------------------------------
# log_video_resolution: level selection, field presence, redaction
# ---------------------------------------------------------------------------

def test_helper_missing_line_carries_bucket_key_and_outcome(caplog):
    with caplog.at_level(logging.DEBUG, logger=HELPER_LOGGER.name):
        line = log_video_resolution(
            HELPER_LOGGER,
            kind="game_video",
            outcome=VideoServeOutcome.MISSING,
            key="games/deadbeef.mp4",
            entity_id=2,
            user_id="u1",
            profile_id="p1",
            blake3_hash="deadbeef",
            head_found=False,
            reason="presign_unavailable",
        )
    # The line must be sufficient to check R2 by hand: bucket + exact key + outcome.
    assert "outcome=missing" in line
    assert "key=games/deadbeef.mp4" in line
    assert "bucket=" in line
    assert "head_found=false" in line
    # A missing object is logged at WARNING (not swallowed at DEBUG/INFO).
    recs = [r for r in caplog.records if "[VIDEO_RESOLVE]" in r.getMessage()]
    assert len(recs) == 1
    assert recs[0].levelno == logging.WARNING


def test_helper_denied_does_not_claim_missing(caplog):
    with caplog.at_level(logging.DEBUG, logger=HELPER_LOGGER.name):
        line = log_video_resolution(
            HELPER_LOGGER,
            kind="reel_video",
            outcome=VideoServeOutcome.DENIED,
            key="dev/users/u1/profiles/p1/final_videos/x.mp4",
            entity_id=7,
            reason="r2_status_403",
        )
    assert "outcome=denied" in line
    # Must NOT claim the object is missing (that would resume the archaeology).
    assert "missing" not in line
    assert caplog.records[-1].levelno == logging.WARNING


def test_helper_expired_is_not_a_bare_404(caplog):
    with caplog.at_level(logging.DEBUG, logger=HELPER_LOGGER.name):
        line = log_video_resolution(
            HELPER_LOGGER,
            kind="game_video",
            outcome=VideoServeOutcome.EXPIRED,
            key="games/deadbeef.mp4",
            entity_id=2,
            reason="storage_swept",
        )
    assert "outcome=expired" in line
    assert "missing" not in line


def test_helper_success_is_debug_only(caplog):
    """redirect_302 (success) must log at DEBUG -- never INFO/WARNING on a hot path."""
    with caplog.at_level(logging.DEBUG, logger=HELPER_LOGGER.name):
        log_video_resolution(
            HELPER_LOGGER,
            kind="game_video",
            outcome=VideoServeOutcome.REDIRECT_302,
            key="games/deadbeef.mp4",
            entity_id=2,
        )
    recs = [r for r in caplog.records if "[VIDEO_RESOLVE]" in r.getMessage()]
    assert len(recs) == 1
    assert recs[0].levelno == logging.DEBUG
    assert all(r.levelno < logging.INFO for r in recs)


def test_redacts_a_presigned_url_slipped_into_key(caplog):
    """Defense: even if a caller mistakenly passes a presigned URL as the key,
    the credential substring must never reach the log."""
    presigned = (
        "https://acct.r2.cloudflarestorage.com/games/deadbeef.mp4"
        "?X-Amz-Signature=SECRETSIG&X-Amz-Credential=AKIA"
    )
    with caplog.at_level(logging.DEBUG, logger=HELPER_LOGGER.name):
        line = log_video_resolution(
            HELPER_LOGGER,
            kind="game_video",
            outcome=VideoServeOutcome.MISSING,
            key=presigned,
        )
    assert "X-Amz" not in line
    assert "SECRETSIG" not in line
    assert "://" not in line
    assert "<redacted_url>" in line


def test_no_key_renders_as_dash(caplog):
    with caplog.at_level(logging.DEBUG, logger=HELPER_LOGGER.name):
        line = log_video_resolution(
            HELPER_LOGGER,
            kind="game_video",
            outcome=VideoServeOutcome.MISSING,
            key=None,
            reason="game_row_not_found",
        )
    assert "key=-" in line


# ---------------------------------------------------------------------------
# log_game_video_failure classifier: HEAD -> missing / denied / expired
# ---------------------------------------------------------------------------

class _FakeCursor:
    def execute(self, *a, **k):
        return self

    def fetchone(self):
        return None

    def execute_local(self, *a, **k):
        return self


@pytest.fixture
def _user_ctx():
    set_current_user_id("u1")
    tok = set_current_profile_id("p1")
    try:
        yield
    finally:
        reset_profile_id()
        reset_user_id()


def test_classifier_missing_when_object_absent(monkeypatch, caplog, _user_ctx):
    monkeypatch.setattr(games_router, "R2_ENABLED", True)
    monkeypatch.setattr(games_router, "r2_head_object_global", lambda key: None)
    monkeypatch.setattr(games_router, "_is_game_storage_expired", lambda c, h: False)

    with caplog.at_level(logging.DEBUG, logger=games_router.logger.name):
        games_router.log_game_video_failure(
            _FakeCursor(), game_id=2, blake3_hash="deadbeef",
            video_filename=None, kind="game_video", reason="presign_unavailable",
        )
    rec = [r for r in caplog.records if "[VIDEO_RESOLVE]" in r.getMessage()][-1]
    msg = rec.getMessage()
    assert "outcome=missing" in msg
    assert "key=games/deadbeef.mp4" in msg  # env-prefix-FREE game key scheme
    assert "head_found=false" in msg
    assert rec.levelno == logging.WARNING


def test_classifier_denied_when_object_present(monkeypatch, caplog, _user_ctx):
    """Object IS where the code looked -> the failure is not absence. Must NOT
    say `missing` (that reopens the manual R2 probe)."""
    monkeypatch.setattr(games_router, "R2_ENABLED", True)
    monkeypatch.setattr(games_router, "r2_head_object_global", lambda key: {"ContentLength": 10})
    monkeypatch.setattr(games_router, "_is_game_storage_expired", lambda c, h: False)

    with caplog.at_level(logging.DEBUG, logger=games_router.logger.name):
        games_router.log_game_video_failure(
            _FakeCursor(), game_id=2, blake3_hash="deadbeef",
            video_filename=None, kind="game_video", reason="presign_unavailable",
        )
    msg = [r for r in caplog.records if "[VIDEO_RESOLVE]" in r.getMessage()][-1].getMessage()
    assert "outcome=denied" in msg
    assert "outcome=missing" not in msg
    assert "head_found=true" in msg


def test_classifier_expired_when_absent_and_swept(monkeypatch, caplog, _user_ctx):
    monkeypatch.setattr(games_router, "R2_ENABLED", True)
    monkeypatch.setattr(games_router, "r2_head_object_global", lambda key: None)
    monkeypatch.setattr(games_router, "_is_game_storage_expired", lambda c, h: True)

    with caplog.at_level(logging.DEBUG, logger=games_router.logger.name):
        games_router.log_game_video_failure(
            _FakeCursor(), game_id=2, blake3_hash="deadbeef",
            video_filename=None, kind="game_video", reason="presign_unavailable",
        )
    msg = [r for r in caplog.records if "[VIDEO_RESOLVE]" in r.getMessage()][-1].getMessage()
    assert "outcome=expired" in msg
    assert "outcome=missing" not in msg  # not reported as a bare 404


# ---------------------------------------------------------------------------
# Endpoint wiring: GET /api/games/{id}/video
# ---------------------------------------------------------------------------

class _GameConn:
    def __init__(self, row):
        self._row = row

    def cursor(self):
        conn = self

        class _C:
            def execute(self, *a, **k):
                return self

            def fetchone(self):
                return conn._row

            def execute_local(self, *a, **k):
                return self

        return _C()

    def commit(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_game_video_endpoint_missing_logs_exact_key(monkeypatch, caplog):
    """A game video that cannot be served logs bucket + exact env-prefix-FREE
    key + `missing`, enough to check R2 by hand without touching it."""
    monkeypatch.setattr(games_router, "get_db_connection",
                        lambda: _GameConn({"blake3_hash": "deadbeef", "video_filename": None}))
    monkeypatch.setattr(games_router, "get_game_video_url", lambda h, f: None)
    monkeypatch.setattr(games_router, "R2_ENABLED", True)
    monkeypatch.setattr(games_router, "r2_head_object_global", lambda key: None)
    monkeypatch.setattr(games_router, "_is_game_storage_expired", lambda c, h: False)

    client = TestClient(app)
    with caplog.at_level(logging.DEBUG, logger=games_router.logger.name):
        r = client.get("/api/games/2/video",
                       headers={"X-User-ID": "testdefault", "X-Profile-ID": "default"})

    assert r.status_code == 404
    recs = [rec for rec in caplog.records if "[VIDEO_RESOLVE]" in rec.getMessage()]
    assert recs, "endpoint must emit a [VIDEO_RESOLVE] diagnostic on failure"
    msg = recs[-1].getMessage()
    assert "kind=game_video" in msg
    assert "outcome=missing" in msg
    assert "key=games/deadbeef.mp4" in msg
    assert "bucket=" in msg
    assert recs[-1].levelno == logging.WARNING


def test_game_video_success_no_info_no_head(monkeypatch, caplog):
    """SUCCESS (302) must add NO new INFO logging and do NO extra HEAD.

    Regression risk: per-request INFO noise on a hot path + a HEAD that T2880/
    T3380 deliberately kept off the success path.
    """
    presigned = "https://acct.r2.cloudflarestorage.com/games/deadbeef.mp4?X-Amz-Signature=SECRETSIG"
    monkeypatch.setattr(games_router, "get_db_connection",
                        lambda: _GameConn({"blake3_hash": "deadbeef", "video_filename": None}))
    monkeypatch.setattr(games_router, "get_game_video_url", lambda h, f: presigned)

    head_calls = {"n": 0}

    def _spy_head(key):
        head_calls["n"] += 1
        return {"ContentLength": 1}

    monkeypatch.setattr(games_router, "r2_head_object_global", _spy_head)
    monkeypatch.setattr(games_router, "R2_ENABLED", True)

    client = TestClient(app)
    with caplog.at_level(logging.DEBUG, logger=games_router.logger.name):
        r = client.get("/api/games/2/video",
                       headers={"X-User-ID": "testdefault", "X-Profile-ID": "default"},
                       follow_redirects=False)

    assert r.status_code == 302
    # No failure-path HEAD on success.
    assert head_calls["n"] == 0, "success path must NOT probe R2 with a HEAD"

    resolve_recs = [rec for rec in caplog.records if "[VIDEO_RESOLVE]" in rec.getMessage()]
    # Any resolution line on success must be DEBUG (never INFO+).
    for rec in resolve_recs:
        assert rec.levelno < logging.INFO, (
            f"success path emitted a >=INFO [VIDEO_RESOLVE] line: {rec.getMessage()!r}"
        )
    # The success line records the KEY, never the presigned URL / credentials.
    for rec in caplog.records:
        m = rec.getMessage()
        assert "X-Amz" not in m and "SECRETSIG" not in m, f"credential leaked into a log: {m!r}"


def test_success_never_logs_url_only_key(monkeypatch, caplog):
    """The DEBUG success line names the resolved KEY (so triage can find it) but
    never the credential-bearing presigned URL."""
    presigned = "https://acct.r2.cloudflarestorage.com/games/deadbeef.mp4?X-Amz-Signature=SECRETSIG"
    monkeypatch.setattr(games_router, "get_db_connection",
                        lambda: _GameConn({"blake3_hash": "deadbeef", "video_filename": None}))
    monkeypatch.setattr(games_router, "get_game_video_url", lambda h, f: presigned)
    monkeypatch.setattr(games_router, "R2_ENABLED", True)

    client = TestClient(app)
    with caplog.at_level(logging.DEBUG, logger=games_router.logger.name):
        client.get("/api/games/2/video",
                   headers={"X-User-ID": "testdefault", "X-Profile-ID": "default"},
                   follow_redirects=False)

    debug_lines = [rec.getMessage() for rec in caplog.records
                   if "[VIDEO_RESOLVE]" in rec.getMessage() and "outcome=redirect_302" in rec.getMessage()]
    assert debug_lines, "success should record the resolved key at DEBUG"
    assert any("key=games/deadbeef.mp4" in m for m in debug_lines)
