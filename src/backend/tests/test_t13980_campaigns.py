"""T13980: admin-created campaigns -- short id in the link, name as the label,
id recognised in any attribution field at signup.

Attribution is driven through the REAL signup path: POST /api/auth/verify-otp
with the captured URL params in the body -> _determine_origin ->
user_segments.origin. No resolver mock.
"""

import logging
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

_EMAIL_DOMAIN = "@t13980.test"
_ADMIN_HEADERS = {"X-User-ID": "admin-user"}
_REGULAR_HEADERS = {"X-User-ID": "regular-user"}


def _cleanup(cur):
    cur.execute("SELECT to_regclass('campaigns') AS t")
    if cur.fetchone()["t"]:
        cur.execute("DELETE FROM campaigns")
    cur.execute(
        "SELECT user_id FROM users WHERE email LIKE %s", ("%" + _EMAIL_DOMAIN,)
    )
    ids = [r["user_id"] for r in cur.fetchall()]
    if ids:
        cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM user_segments WHERE user_id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM credit_transactions WHERE user_id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM credits WHERE user_id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM users WHERE user_id = ANY(%s)", (ids,))
    cur.execute("DELETE FROM otp_codes WHERE email LIKE %s", ("%" + _EMAIL_DOMAIN,))


@pytest.fixture()
def client(pg_conn, tmp_path):
    from app.services.auth_db import create_user
    from app.services.pg import get_pg

    create_user("admin-user", email="test-admin@test.local")
    create_user("regular-user", email="other@test.local")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING"
        )
        _cleanup(cur)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.routers.auth._send_welcome_email", new=AsyncMock()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)
    with get_pg() as conn:
        _cleanup(conn.cursor())


def _signup(client, local_part: str, **params) -> str:
    """Sign a brand-new user up via OTP with the given captured URL params;
    returns the stored user_segments.origin."""
    from app.services.pg import get_pg

    email = local_part + _EMAIL_DOMAIN
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO otp_codes (email, code, expires_at) VALUES (%s, %s, now() + interval '10 min')",
            (email, "123456"),
        )
    r = client.post("/api/auth/verify-otp", json={"email": email, "code": "123456", **params})
    assert r.status_code == 200, r.text
    # The new user's session cookie would otherwise outrank X-User-ID on later
    # admin calls from this client.
    client.cookies.clear()
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT s.origin FROM user_segments s JOIN users u ON u.user_id = s.user_id WHERE u.email = %s",
            (email,),
        )
        row = cur.fetchone()
    assert row is not None, "signup wrote no user_segments row"
    return row["origin"]


def _create(client, name: str):
    return client.post("/api/admin/campaigns", json={"name": name}, headers=_ADMIN_HEADERS)


class TestCreateCampaign:
    def test_create_returns_short_id_and_ref_url(self, client):
        r = _create(client, "Fall Tryouts 2026")
        assert r.status_code == 200, r.text
        body = r.json()
        cid = body["id"]
        assert len(cid) == 5
        assert set(cid) <= set("abcdefghjkmnpqrstuvwxyz23456789")
        assert body["name"] == "Fall Tryouts 2026"
        assert body["url"].endswith(f"/?ref={cid}")
        assert body["signups"] == 0

    def test_name_is_trimmed(self, client):
        r = _create(client, "  Spring Clinic  ")
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "Spring Clinic"

    @pytest.mark.parametrize("name", ["", "   ", "x" * 81])
    def test_invalid_name_fails_and_writes_nothing(self, client, name):
        r = _create(client, name)
        assert r.status_code in (400, 422), r.text
        listed = client.get("/api/admin/campaigns", headers=_ADMIN_HEADERS).json()["campaigns"]
        assert listed == []

    def test_duplicate_name_case_insensitive_fails(self, client):
        assert _create(client, "Fall Tryouts 2026").status_code == 200
        r = _create(client, "fall TRYOUTS 2026")
        assert r.status_code == 409, r.text
        listed = client.get("/api/admin/campaigns", headers=_ADMIN_HEADERS).json()["campaigns"]
        assert [c["name"] for c in listed] == ["Fall Tryouts 2026"]

    def test_list_newest_first(self, client):
        _create(client, "First")
        _create(client, "Second")
        listed = client.get("/api/admin/campaigns", headers=_ADMIN_HEADERS).json()["campaigns"]
        assert [c["name"] for c in listed] == ["Second", "First"]
        assert all(c["url"].endswith("/?ref=" + c["id"]) for c in listed)


class TestCampaignIdGenerator:
    def test_never_invite_shape_or_reserved_bucket(self):
        from app.analytics import (
            INVITE_CODE_RE,
            _is_reserved_origin,
            generate_campaign_id,
        )
        for _ in range(500):
            cid = generate_campaign_id()
            assert len(cid) == 5
            assert not INVITE_CODE_RE.match(cid)
            assert not _is_reserved_origin(cid)

    def test_reserved_origins(self):
        from app.analytics import _is_reserved_origin
        assert _is_reserved_origin("organic")
        assert _is_reserved_origin("seo")
        assert _is_reserved_origin("community")
        assert _is_reserved_origin("social-tiktok")
        assert _is_reserved_origin("fb_unknown")
        assert not _is_reserved_origin("k7x2m")


class TestAttribution:
    def test_id_in_ref_utm_campaign_or_utm_source_attributes(self, client):
        cid = _create(client, "Fall Tryouts 2026").json()["id"]
        assert _signup(client, "via-ref", ref=cid) == cid
        assert _signup(client, "via-utm-campaign", utm_campaign=cid) == cid
        # Platforms rewrite links; the id can survive only in a lower field, uppercased.
        assert _signup(client, "via-utm-source", utm_source=cid.upper(), utm_campaign="spring_push") == cid
        listed = client.get(
            "/api/admin/campaigns", params={"exclude_test": "false"}, headers=_ADMIN_HEADERS
        ).json()["campaigns"]
        assert listed[0]["signups"] == 3

    def test_unregistered_ref_kept_verbatim(self, client):
        _create(client, "Fall Tryouts 2026")
        assert _signup(client, "unregistered", ref="my-ad-manager-name") == "my-ad-manager-name"

    def test_signup_survives_missing_table_with_loud_log(self, client, caplog):
        from app.services.pg import get_pg
        with get_pg() as conn:
            conn.cursor().execute("ALTER TABLE campaigns RENAME TO campaigns_t13980_hidden")
        try:
            with caplog.at_level(logging.WARNING, logger="app.analytics"):
                assert _signup(client, "window", utm_source="k7x2m") == "organic"
            assert any("campaigns" in rec.getMessage() for rec in caplog.records
                       if rec.levelno >= logging.WARNING)
        finally:
            with get_pg() as conn:
                conn.cursor().execute("ALTER TABLE campaigns_t13980_hidden RENAME TO campaigns")


class TestDisplay:
    def test_channels_carry_name_and_rename_relabels(self, client):
        from app.services.pg import get_pg
        cid = _create(client, "Fall Tryouts 2026").json()["id"]
        _signup(client, "chan", ref=cid)

        def _row():
            chans = client.get(
                "/api/admin/analytics/channels", params={"exclude_test": "false"},
                headers=_ADMIN_HEADERS,
            ).json()["channels"]
            return next(c for c in chans if c["origin"] == cid)

        assert _row()["campaign_name"] == "Fall Tryouts 2026"

        r = client.patch(f"/api/admin/campaigns/{cid}", json={"name": "Fall Tryouts (U12)"},
                         headers=_ADMIN_HEADERS)
        assert r.status_code == 200, r.text
        assert _row()["campaign_name"] == "Fall Tryouts (U12)"
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT s.origin FROM user_segments s JOIN users u ON u.user_id = s.user_id "
                "WHERE u.email = %s", ("chan" + _EMAIL_DOMAIN,),
            )
            assert cur.fetchone()["origin"] == cid

    def test_rename_to_existing_name_fails(self, client):
        _create(client, "Alpha")
        cid = _create(client, "Beta").json()["id"]
        r = client.patch(f"/api/admin/campaigns/{cid}", json={"name": "ALPHA"}, headers=_ADMIN_HEADERS)
        assert r.status_code == 409

    def test_unregistered_origin_has_null_name(self, client):
        _signup(client, "plain", ref="my-ad-manager-name")
        chans = client.get(
            "/api/admin/analytics/channels", params={"exclude_test": "false"},
            headers=_ADMIN_HEADERS,
        ).json()["channels"]
        row = next(c for c in chans if c["origin"] == "my-ad-manager-name")
        assert row["campaign_name"] is None

    def test_users_and_journey_carry_name(self, client):
        from app.services.pg import get_pg
        cid = _create(client, "Fall Tryouts 2026").json()["id"]
        _signup(client, "listed", ref=cid)
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT user_id FROM users WHERE email = %s", ("listed" + _EMAIL_DOMAIN,))
            uid = cur.fetchone()["user_id"]
        users = client.get(
            "/api/admin/users", params={"exclude_test": "false", "origin": cid},
            headers=_ADMIN_HEADERS,
        ).json()["users"]
        assert [u["campaign_name"] for u in users] == ["Fall Tryouts 2026"]
        journey = client.get(f"/api/admin/analytics/journey/{uid}", headers=_ADMIN_HEADERS).json()
        assert journey["campaign_name"] == "Fall Tryouts 2026"


class TestAdminGate:
    def test_non_admin_403_everywhere(self, client):
        assert client.get("/api/admin/campaigns", headers=_REGULAR_HEADERS).status_code == 403
        assert client.post("/api/admin/campaigns", json={"name": "x"},
                           headers=_REGULAR_HEADERS).status_code == 403
        assert client.patch("/api/admin/campaigns/abcde", json={"name": "x"},
                            headers=_REGULAR_HEADERS).status_code == 403
