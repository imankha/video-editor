"""
T2900: Tests for the invite-code endpoint.

Tests:
- GET /api/me/invite-code returns consistent 8-char hex for same user
- Different user_ids produce different codes
- Response includes properly formed invite_url
- Endpoint requires authentication (401 without session)
"""
import hashlib

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_invite_code_requires_auth():
    r = client.get("/api/me/invite-code")
    assert r.status_code == 401


def test_invite_code_returns_consistent_code():
    user_id = "test-user-invite-001"
    r = client.get("/api/me/invite-code", headers={"X-User-ID": user_id})
    assert r.status_code == 200
    data = r.json()
    assert "invite_code" in data
    assert len(data["invite_code"]) == 8

    r2 = client.get("/api/me/invite-code", headers={"X-User-ID": user_id})
    assert r2.json()["invite_code"] == data["invite_code"]


def test_invite_code_differs_per_user():
    r1 = client.get("/api/me/invite-code", headers={"X-User-ID": "user-a"})
    r2 = client.get("/api/me/invite-code", headers={"X-User-ID": "user-b"})
    assert r1.json()["invite_code"] != r2.json()["invite_code"]


def test_invite_code_matches_sha256():
    user_id = "test-user-sha-check"
    expected = hashlib.sha256(user_id.encode()).hexdigest()[:8]
    r = client.get("/api/me/invite-code", headers={"X-User-ID": user_id})
    assert r.json()["invite_code"] == expected


def test_invite_url_format():
    user_id = "test-user-url-check"
    r = client.get("/api/me/invite-code", headers={"X-User-ID": user_id})
    data = r.json()
    assert data["invite_url"] == f"https://www.reelballers.com?ref={data['invite_code']}"
