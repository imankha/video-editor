"""T7520: impersonation must not create a cross-tenant profile DB.

During an impersonation start/stop the old page can fire a request carrying the
NEW session's user together with the STALE impersonated X-Profile-ID header.
Pre-fix, the middleware only format-checked the header, so it set that foreign
profile as the context and ensure_database() materialized a profile.sqlite under
the wrong user's directory (later uploaded to R2 as an orphan).

Two client-input entry points are guarded:
  A) middleware X-Profile-ID header (db_sync.py) -> 404, no DB, no R2 upload
  B) session_init hint_profile_id (cold cache) -> ignore the unregistered hint,
     resolve to the real selected profile, create nothing for the hint.

These tests isolate USER_DATA_BASE to a tmp dir and assert NO profile.sqlite is
created for the foreign/unregistered profile. The conftest `_register_test_profiles`
fixture treats a user's OWN registered/on-disk profiles as owned, so a profile
constructed under a DIFFERENT user (or never created at all) is genuinely foreign.
"""

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


VICTIM_USER = "t7520-victim"
OWNED_PROFILE = "aaaa1111"   # 8-hex, registered to VICTIM_USER
FOREIGN_PROFILE = "ffff9999"  # 8-hex, never registered to VICTIM_USER


@pytest.fixture
def isolated_base(tmp_path):
    """Point every USER_DATA_BASE binding at a tmp dir so we can assert exactly
    which profile directories get created."""
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path):
        yield tmp_path


def _seed_user_with_profile(user_id: str, profile_id: str) -> None:
    """Register `profile_id` as `user_id`'s selected profile in user.sqlite."""
    from app.services.user_db import (
        create_profile,
        ensure_user_database,
        set_selected_profile_id,
    )
    ensure_user_database(user_id)
    create_profile(user_id, profile_id, "Owned", "#3B82F6", is_default=True)
    set_selected_profile_id(user_id, profile_id)


def _profile_db_path(base: Path, user_id: str, profile_id: str) -> Path:
    return base / user_id / "profiles" / profile_id / "profile.sqlite"


# ---------------------------------------------------------------------------
# Entry point A — middleware X-Profile-ID header
# ---------------------------------------------------------------------------

def test_foreign_profile_header_rejected_404(isolated_base):
    """A valid session user sending a foreign 8-hex X-Profile-ID gets 404, and
    no profile.sqlite is materialized under their directory."""
    from fastapi.testclient import TestClient

    from app.main import app

    _seed_user_with_profile(VICTIM_USER, OWNED_PROFILE)

    with patch("app.middleware.db_sync.sync_db_to_r2_explicit") as mock_sync:
        client = TestClient(app)
        resp = client.get(
            "/api/profiles",
            headers={"X-User-ID": VICTIM_USER, "X-Profile-ID": FOREIGN_PROFILE},
        )

    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"] == "Profile not found"
    # No cross-tenant DB materialized for the foreign profile...
    assert not _profile_db_path(isolated_base, VICTIM_USER, FOREIGN_PROFILE).exists()
    # ...and the request never reached any R2 upload.
    mock_sync.assert_not_called()


def test_owned_profile_header_passes(isolated_base):
    """The same request with the user's OWN profile id succeeds (positive
    control — the guard doesn't reject legitimate traffic)."""
    from fastapi.testclient import TestClient

    from app.main import app

    _seed_user_with_profile(VICTIM_USER, OWNED_PROFILE)

    client = TestClient(app)
    resp = client.get(
        "/api/profiles",
        headers={"X-User-ID": VICTIM_USER, "X-Profile-ID": OWNED_PROFILE},
    )

    assert resp.status_code == 200, resp.text
    ids = [p["id"] for p in resp.json()["profiles"]]
    assert OWNED_PROFILE in ids


def test_guard_applies_to_admin_route_regardless_of_auth_source(isolated_base):
    """Landmine 4: X-User-ID auth reaches /api/admin/* in prod. The ownership
    guard is keyed on the resolved user, NOT the auth source, so a foreign
    profile is rejected there too (no escape hatch)."""
    from fastapi.testclient import TestClient

    from app.main import app

    _seed_user_with_profile(VICTIM_USER, OWNED_PROFILE)

    client = TestClient(app)
    resp = client.get(
        "/api/admin/migration-status",
        headers={"X-User-ID": VICTIM_USER, "X-Profile-ID": FOREIGN_PROFILE},
    )

    # Rejected by the profile guard before the admin handler runs.
    assert resp.status_code == 404, resp.text
    assert not _profile_db_path(isolated_base, VICTIM_USER, FOREIGN_PROFILE).exists()


# ---------------------------------------------------------------------------
# Entry point B — session_init hint_profile_id (cold cache)
# ---------------------------------------------------------------------------

def test_unregistered_hint_creates_nothing_resolves_to_selected(isolated_base):
    """Cold-cache session init with an unregistered hint must NOT create the
    hinted profile's DB; it resolves to the real selected profile instead."""
    from app import session_init
    from app.session_init import _init_slow_path
    from app.user_context import set_current_user_id

    set_current_user_id(VICTIM_USER)  # middleware normally sets this before init
    _seed_user_with_profile(VICTIM_USER, OWNED_PROFILE)
    # Cold cache: this user must not be pre-resolved.
    session_init._init_cache.pop(VICTIM_USER, None)
    session_init._profile_registry_cache.pop(VICTIM_USER, None)

    result = _init_slow_path(VICTIM_USER, hint_profile_id=FOREIGN_PROFILE)

    assert result["profile_id"] == OWNED_PROFILE
    # The foreign hint never materialized a profile DB...
    assert not _profile_db_path(isolated_base, VICTIM_USER, FOREIGN_PROFILE).exists()
    # ...while the real selected profile's DB was created normally.
    assert _profile_db_path(isolated_base, VICTIM_USER, OWNED_PROFILE).exists()


def test_new_user_with_hint_does_not_leave_stale_registry_cache(isolated_base):
    """Regression: in the hint path, the registry cache is loaded (empty) during
    hint validation, then a brand-new user's profile is created. If that create
    doesn't drop the cache, the middleware guard would 404 the user's OWN new
    profile on the next request. Assert the cache entry is dropped (forcing a
    fresh load) rather than left holding the pre-create empty snapshot."""
    from app import session_init
    from app.session_init import _init_slow_path
    from app.user_context import set_current_user_id

    new_user = "t7520-brandnew"
    set_current_user_id(new_user)
    session_init._init_cache.pop(new_user, None)
    session_init._profile_registry_cache.pop(new_user, None)

    result = _init_slow_path(new_user, hint_profile_id="deadbeef")

    assert result["is_new_user"] is True
    created = result["profile_id"]
    assert created != "deadbeef"  # the foreign hint was never adopted
    # The stale empty snapshot from hint validation must have been dropped...
    assert session_init._profile_registry_cache.get(new_user) is None
    # ...so a fresh load sees the just-created profile (guard would accept it).
    assert created in session_init.load_registered_profile_ids(new_user)


def test_registered_selected_hint_is_honored(isolated_base):
    """A hint that IS the registered, selected profile still resolves to it
    (the pre-T7520 happy path is preserved)."""
    from app import session_init
    from app.session_init import _init_slow_path
    from app.user_context import set_current_user_id

    set_current_user_id(VICTIM_USER)  # middleware normally sets this before init
    _seed_user_with_profile(VICTIM_USER, OWNED_PROFILE)
    session_init._init_cache.pop(VICTIM_USER, None)
    session_init._profile_registry_cache.pop(VICTIM_USER, None)

    result = _init_slow_path(VICTIM_USER, hint_profile_id=OWNED_PROFILE)

    assert result["profile_id"] == OWNED_PROFILE
    assert _profile_db_path(isolated_base, VICTIM_USER, OWNED_PROFILE).exists()
