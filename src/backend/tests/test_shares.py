"""
Tests for T1750: Share Backend Model & API.

Covers:
- sharing_db CRUD operations
- POST /api/gallery/{video_id}/share (create shares)
- GET /api/gallery/{video_id}/shares (list shares)
- GET /api/shared/{token} (public + private access control)
- PATCH /api/shared/{token} (toggle visibility)
- DELETE /api/shared/{token} (revoke)
- 410 Gone for revoked shares
- is_existing_user flag on create response
"""

import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SHARER_ID = "sharer-user"
SHARER_EMAIL = "sharer@example.com"
RECIPIENT_ID = "recipient-user"
RECIPIENT_EMAIL = "recipient@example.com"
UNKNOWN_EMAIL = "stranger@example.com"


@pytest.fixture()
def isolated_auth_db(tmp_path):
    db_path = tmp_path / "auth.sqlite"
    with patch("app.services.auth_db.AUTH_DB_PATH", db_path), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True):
        from app.services.auth_db import init_auth_db, create_user
        init_auth_db()
        create_user(SHARER_ID, email=SHARER_EMAIL)
        create_user(RECIPIENT_ID, email=RECIPIENT_EMAIL)
        yield db_path


@pytest.fixture()
def isolated_sharing_db(tmp_path):
    db_path = tmp_path / "sharing.sqlite"
    with patch("app.services.sharing_db.SHARING_DB_PATH", db_path), \
         patch("app.services.sharing_db.sync_sharing_db_to_r2", return_value=True):
        from app.services.sharing_db import init_sharing_db
        init_sharing_db()
        yield db_path


@pytest.fixture()
def client(isolated_auth_db, isolated_sharing_db, tmp_path):
    from app.session_init import _init_cache
    _init_cache[SHARER_ID] = {"profile_id": "testdefault", "is_new_user": False}
    _init_cache[RECIPIENT_ID] = {"profile_id": "testdefault", "is_new_user": False}
    with patch("app.services.auth_db.AUTH_DB_PATH", isolated_auth_db), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True), \
         patch("app.services.sharing_db.SHARING_DB_PATH", isolated_sharing_db), \
         patch("app.services.sharing_db.sync_sharing_db_to_r2", return_value=True), \
         patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _auth_headers(user_id: str) -> dict:
    return {"X-User-ID": user_id}


def _seed_final_video(client, user_id: str = SHARER_ID) -> int:
    """Insert a final_video row directly into the sharer's profile DB and return its id."""
    from app.database import get_db_connection
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(user_id)
    set_current_profile_id("testdefault")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO final_videos (filename, name, duration, version)
               VALUES (?, ?, ?, ?)""",
            ("test-video.mp4", "Test Video", 12.5, 1),
        )
        conn.commit()
        return cursor.lastrowid


# ---------------------------------------------------------------------------
# sharing_db unit tests
# ---------------------------------------------------------------------------

class TestSharingDbCrud:
    def test_create_shares(self, isolated_sharing_db):
        from app.services.sharing_db import create_shares, get_share_by_token

        with patch("app.services.sharing_db.sync_sharing_db_to_r2", return_value=True):
            shares = create_shares(
                video_id=1,
                sharer_user_id=SHARER_ID,
                sharer_profile_id="testdefault",
                video_filename="vid.mp4",
                video_name="My Video",
                video_duration=10.0,
                recipient_emails=[RECIPIENT_EMAIL, UNKNOWN_EMAIL],
                is_public=False,
            )

        assert len(shares) == 2
        assert shares[0]["recipient_email"] == RECIPIENT_EMAIL
        assert shares[1]["recipient_email"] == UNKNOWN_EMAIL

        share = get_share_by_token(shares[0]["share_token"])
        assert share is not None
        assert share["video_filename"] == "vid.mp4"
        assert share["is_public"] == 0

    def test_list_shares_for_video(self, isolated_sharing_db):
        from app.services.sharing_db import create_shares, list_shares_for_video

        with patch("app.services.sharing_db.sync_sharing_db_to_r2", return_value=True):
            create_shares(1, SHARER_ID, "p1", "v.mp4", "V", 5.0, ["a@b.com"], False)
            create_shares(1, SHARER_ID, "p1", "v.mp4", "V", 5.0, ["c@d.com"], True)
            create_shares(2, SHARER_ID, "p1", "w.mp4", "W", 8.0, ["e@f.com"], False)

        shares = list_shares_for_video(1, SHARER_ID)
        assert len(shares) == 2

        shares_other = list_shares_for_video(1, "other-user")
        assert len(shares_other) == 0

    def test_revoke_share(self, isolated_sharing_db):
        from app.services.sharing_db import create_shares, revoke_share, get_share_by_token

        with patch("app.services.sharing_db.sync_sharing_db_to_r2", return_value=True):
            shares = create_shares(1, SHARER_ID, "p1", "v.mp4", "V", 5.0, ["a@b.com"], False)
            token = shares[0]["share_token"]

            assert revoke_share(token, SHARER_ID) is True
            assert revoke_share(token, SHARER_ID) is False  # already revoked

        share = get_share_by_token(token)
        assert share["revoked_at"] is not None

    def test_revoke_wrong_user(self, isolated_sharing_db):
        from app.services.sharing_db import create_shares, revoke_share

        with patch("app.services.sharing_db.sync_sharing_db_to_r2", return_value=True):
            shares = create_shares(1, SHARER_ID, "p1", "v.mp4", "V", 5.0, ["a@b.com"], False)
            assert revoke_share(shares[0]["share_token"], "other-user") is False

    def test_update_visibility(self, isolated_sharing_db):
        from app.services.sharing_db import create_shares, update_share_visibility, get_share_by_token

        with patch("app.services.sharing_db.sync_sharing_db_to_r2", return_value=True):
            shares = create_shares(1, SHARER_ID, "p1", "v.mp4", "V", 5.0, ["a@b.com"], False)
            token = shares[0]["share_token"]

            assert update_share_visibility(token, True, SHARER_ID) is True

        share = get_share_by_token(token)
        assert share["is_public"] == 1

    def test_emails_normalized_to_lowercase(self, isolated_sharing_db):
        from app.services.sharing_db import create_shares

        with patch("app.services.sharing_db.sync_sharing_db_to_r2", return_value=True):
            shares = create_shares(1, SHARER_ID, "p1", "v.mp4", "V", 5.0, ["UPPER@EMAIL.COM"], False)

        assert shares[0]["recipient_email"] == "upper@email.com"


# ---------------------------------------------------------------------------
# API endpoint tests
# ---------------------------------------------------------------------------

class TestCreateShare:
    def test_create_share_returns_tokens(self, client):
        video_id = _seed_final_video(client)
        resp = client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [RECIPIENT_EMAIL], "is_public": False},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["shares"]) == 1
        assert data["shares"][0]["recipient_email"] == RECIPIENT_EMAIL
        assert "share_token" in data["shares"][0]

    def test_create_share_flags_existing_user(self, client):
        video_id = _seed_final_video(client)
        resp = client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [RECIPIENT_EMAIL, UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        data = resp.json()
        by_email = {s["recipient_email"]: s for s in data["shares"]}
        assert by_email[RECIPIENT_EMAIL]["is_existing_user"] is True
        assert by_email[UNKNOWN_EMAIL]["is_existing_user"] is False

    def test_create_share_video_not_found(self, client):
        resp = client.post(
            "/api/gallery/99999/share",
            json={"recipient_emails": ["a@b.com"]},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 404

    def test_create_share_empty_emails(self, client):
        video_id = _seed_final_video(client)
        resp = client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": []},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 400


class TestListShares:
    def test_list_shares(self, client):
        video_id = _seed_final_video(client)
        client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [RECIPIENT_EMAIL, UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        resp = client.get(
            f"/api/gallery/{video_id}/shares",
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_list_shares_empty_for_other_user(self, client):
        video_id = _seed_final_video(client)
        client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [RECIPIENT_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        resp = client.get(
            f"/api/gallery/{video_id}/shares",
            headers=_auth_headers(RECIPIENT_ID),
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 0


class TestGetSharedVideo:
    def _create_share(self, client, is_public=False) -> str:
        video_id = _seed_final_video(client)
        resp = client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [RECIPIENT_EMAIL], "is_public": is_public},
            headers=_auth_headers(SHARER_ID),
        )
        return resp.json()["shares"][0]["share_token"]

    def test_public_share_no_auth(self, client):
        token = self._create_share(client, is_public=True)
        with patch("app.routers.shares.generate_presigned_url_global", return_value="https://r2.example.com/video.mp4"):
            resp = client.get(f"/api/shared/{token}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["video_name"] == "Test Video"
        assert data["video_url"] == "https://r2.example.com/video.mp4"
        assert data["is_public"] is True

    def test_private_share_correct_recipient(self, client):
        token = self._create_share(client, is_public=False)
        with patch("app.routers.shares.generate_presigned_url_global", return_value="https://r2.example.com/video.mp4"):
            resp = client.get(f"/api/shared/{token}", headers=_auth_headers(RECIPIENT_ID))
        assert resp.status_code == 200

    def test_private_share_wrong_user(self, client):
        token = self._create_share(client, is_public=False)
        resp = client.get(f"/api/shared/{token}", headers=_auth_headers(SHARER_ID))
        assert resp.status_code == 403

    def test_private_share_no_auth(self, client):
        token = self._create_share(client, is_public=False)
        resp = client.get(f"/api/shared/{token}")
        assert resp.status_code == 403

    def test_share_not_found(self, client):
        resp = client.get("/api/shared/nonexistent-token")
        assert resp.status_code == 404

    def test_revoked_share_returns_410(self, client):
        token = self._create_share(client, is_public=True)
        client.delete(f"/api/shared/{token}", headers=_auth_headers(SHARER_ID))
        resp = client.get(f"/api/shared/{token}")
        assert resp.status_code == 410


class TestPatchShare:
    def _create_share(self, client) -> str:
        video_id = _seed_final_video(client)
        resp = client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [RECIPIENT_EMAIL], "is_public": False},
            headers=_auth_headers(SHARER_ID),
        )
        return resp.json()["shares"][0]["share_token"]

    def test_toggle_visibility(self, client):
        token = self._create_share(client)
        resp = client.patch(
            f"/api/shared/{token}",
            json={"is_public": True},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 200

        with patch("app.routers.shares.generate_presigned_url_global", return_value="https://r2.example.com/video.mp4"):
            detail = client.get(f"/api/shared/{token}")
        assert detail.status_code == 200
        assert detail.json()["is_public"] is True

    def test_patch_wrong_user(self, client):
        token = self._create_share(client)
        resp = client.patch(
            f"/api/shared/{token}",
            json={"is_public": True},
            headers=_auth_headers(RECIPIENT_ID),
        )
        assert resp.status_code == 403

    def test_patch_no_auth(self, client):
        token = self._create_share(client)
        resp = client.patch(
            f"/api/shared/{token}",
            json={"is_public": True},
        )
        assert resp.status_code == 401

    def test_patch_nonexistent_token(self, client):
        resp = client.patch(
            "/api/shared/nonexistent-token",
            json={"is_public": True},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 404

    def test_patch_revoked_share(self, client):
        token = self._create_share(client)
        client.delete(f"/api/shared/{token}", headers=_auth_headers(SHARER_ID))
        resp = client.patch(
            f"/api/shared/{token}",
            json={"is_public": True},
            headers=_auth_headers(SHARER_ID),
        )
        assert resp.status_code == 409


class TestDeleteShare:
    def _create_share(self, client) -> str:
        video_id = _seed_final_video(client)
        resp = client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [RECIPIENT_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        return resp.json()["shares"][0]["share_token"]

    def test_revoke_share(self, client):
        token = self._create_share(client)
        resp = client.delete(f"/api/shared/{token}", headers=_auth_headers(SHARER_ID))
        assert resp.status_code == 200

    def test_revoke_already_revoked(self, client):
        token = self._create_share(client)
        client.delete(f"/api/shared/{token}", headers=_auth_headers(SHARER_ID))
        resp = client.delete(f"/api/shared/{token}", headers=_auth_headers(SHARER_ID))
        assert resp.status_code == 409

    def test_revoke_wrong_user(self, client):
        token = self._create_share(client)
        resp = client.delete(f"/api/shared/{token}", headers=_auth_headers(RECIPIENT_ID))
        assert resp.status_code == 403

    def test_revoke_no_auth(self, client):
        token = self._create_share(client)
        resp = client.delete(f"/api/shared/{token}")
        assert resp.status_code == 401

    def test_revoke_nonexistent_token(self, client):
        resp = client.delete("/api/shared/nonexistent-token", headers=_auth_headers(SHARER_ID))
        assert resp.status_code == 404


class TestCreateShareMultipleEmails:
    def test_each_email_gets_unique_token(self, client):
        video_id = _seed_final_video(client)
        resp = client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [RECIPIENT_EMAIL, UNKNOWN_EMAIL, "third@example.com"]},
            headers=_auth_headers(SHARER_ID),
        )
        data = resp.json()
        tokens = [s["share_token"] for s in data["shares"]]
        assert len(tokens) == 3
        assert len(set(tokens)) == 3  # all unique

    def test_default_is_private(self, client):
        video_id = _seed_final_video(client)
        resp = client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [RECIPIENT_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        token = resp.json()["shares"][0]["share_token"]
        # Private share should reject unauthenticated access
        resp = client.get(f"/api/shared/{token}")
        assert resp.status_code == 403


class TestContacts:
    def test_contacts_empty(self, client):
        resp = client.get("/api/gallery/contacts", headers=_auth_headers(SHARER_ID))
        assert resp.status_code == 200
        assert resp.json()["contacts"] == []

    def test_contacts_returns_prior_recipients(self, client):
        video_id = _seed_final_video(client)
        client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [RECIPIENT_EMAIL, UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        resp = client.get("/api/gallery/contacts", headers=_auth_headers(SHARER_ID))
        assert resp.status_code == 200
        contacts = resp.json()["contacts"]
        assert RECIPIENT_EMAIL in contacts
        assert UNKNOWN_EMAIL in contacts

    def test_contacts_excludes_revoked(self, client):
        video_id = _seed_final_video(client)
        resp = client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [RECIPIENT_EMAIL, UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        token_to_revoke = resp.json()["shares"][0]["share_token"]
        client.delete(f"/api/shared/{token_to_revoke}", headers=_auth_headers(SHARER_ID))

        resp = client.get("/api/gallery/contacts", headers=_auth_headers(SHARER_ID))
        contacts = resp.json()["contacts"]
        assert len(contacts) == 1
        assert RECIPIENT_EMAIL not in contacts
        assert UNKNOWN_EMAIL in contacts

    def test_contacts_ordered_by_frequency(self, client):
        video_id = _seed_final_video(client)
        client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [RECIPIENT_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [RECIPIENT_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        resp = client.get("/api/gallery/contacts", headers=_auth_headers(SHARER_ID))
        contacts = resp.json()["contacts"]
        assert contacts[0] == RECIPIENT_EMAIL

    def test_contacts_isolated_per_user(self, client):
        video_id = _seed_final_video(client)
        client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        resp = client.get("/api/gallery/contacts", headers=_auth_headers(RECIPIENT_ID))
        assert resp.json()["contacts"] == []


class TestListSharesIncludesRevoked:
    def test_revoked_shares_visible_in_list(self, client):
        video_id = _seed_final_video(client)
        resp = client.post(
            f"/api/gallery/{video_id}/share",
            json={"recipient_emails": [RECIPIENT_EMAIL, UNKNOWN_EMAIL]},
            headers=_auth_headers(SHARER_ID),
        )
        tokens = [s["share_token"] for s in resp.json()["shares"]]
        # Revoke one share
        client.delete(f"/api/shared/{tokens[0]}", headers=_auth_headers(SHARER_ID))

        resp = client.get(f"/api/gallery/{video_id}/shares", headers=_auth_headers(SHARER_ID))
        shares = resp.json()
        assert len(shares) == 2  # both still visible
        revoked = [s for s in shares if s["revoked_at"] is not None]
        active = [s for s in shares if s["revoked_at"] is None]
        assert len(revoked) == 1
        assert len(active) == 1
