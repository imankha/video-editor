"""T15070: end-card sign-ups are attributable to the sharer (K becomes measurable).

Driven through the real sign-up path, POST /api/auth/verify-otp. Claim-after-sign-up
lives in test_t5730_claim_import_flow.py, the payload fields in test_shares.py and
test_t5720_public_game_link.py.
"""

import hashlib
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.services.auth_db import create_user
from app.services.sharing_db import persist_invite_code
from tests.conftest import register_test_user_ids

SHARER = "t15070-sharer"
CODE = hashlib.sha256(SHARER.encode()).hexdigest()[:8]


def _pg():
    from app.services import pg  # looked up at call time: pg_conn patches pg.get_pg
    return pg.get_pg()


@pytest.fixture()
def client(pg_conn, tmp_path):
    register_test_user_ids(SHARER)
    create_user(SHARER, email="t15070-sharer@test.local")
    persist_invite_code(SHARER, CODE)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.routers.auth._send_welcome_email", new=AsyncMock()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _signup(client, email, **params) -> dict:
    with _pg() as conn:
        conn.cursor().execute(
            "INSERT INTO otp_codes (email, code, expires_at) "
            "VALUES (%s, '123456', now() + interval '10 min')", (email,))
    r = client.post("/api/auth/verify-otp", json={"email": email, "code": "123456", **params})
    assert r.status_code == 200, r.text
    client.cookies.clear()
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT u.user_id, r.referrer_id AS referral_referrer, r.channel,
                      s.referrer_id AS segment_referrer
               FROM users u
               LEFT JOIN referrals r ON r.referred_id = u.user_id
               LEFT JOIN user_segments s ON s.user_id = u.user_id
               WHERE u.email = %s""", (email,))
        row = cur.fetchone()
        cur.execute("DELETE FROM otp_codes WHERE email = %s", (email,))
    register_test_user_ids(row["user_id"])
    return row


def test_end_card_signup_records_endcard_channel_and_referrer(client):
    row = _signup(client, "t15070-a@test.local", ref=CODE, utm_source="share_endcard",
                  utm_medium="viral", utm_campaign="reel_endcard")
    assert row["channel"] == "endcard"
    assert row["referral_referrer"] == SHARER
    assert row["segment_referrer"] == SHARER


def test_plain_invite_link_stays_invite_link(client):
    row = _signup(client, "t15070-b@test.local", ref=CODE)
    assert row["channel"] == "invite_link"
    assert row["segment_referrer"] == SHARER
