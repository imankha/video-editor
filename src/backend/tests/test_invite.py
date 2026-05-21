"""
T2900: Tests for invite-code endpoint and auth ref parameter handling.

Tests:
- GET /api/me/invite-code: auth guard, consistency, format, correctness
- POST /api/auth/google: accepts ref param without error
- POST /api/auth/verify-otp: accepts ref param without error
- _find_or_create_user: ref param logging (new user vs existing)
"""
import hashlib
import re
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


# ---------------------------------------------------------------------------
# GET /api/me/invite-code
# ---------------------------------------------------------------------------

class TestInviteCodeEndpoint:
    """Tests for the invite-code generation endpoint."""

    def test_requires_auth_returns_401(self):
        r = client.get("/api/me/invite-code")
        assert r.status_code == 401

    def test_returns_200_with_valid_user(self):
        r = client.get("/api/me/invite-code", headers={"X-User-ID": "test-user-001"})
        assert r.status_code == 200

    def test_response_has_invite_code_field(self):
        r = client.get("/api/me/invite-code", headers={"X-User-ID": "test-user-001"})
        data = r.json()
        assert "invite_code" in data

    def test_response_has_invite_url_field(self):
        r = client.get("/api/me/invite-code", headers={"X-User-ID": "test-user-001"})
        data = r.json()
        assert "invite_url" in data

    def test_invite_code_is_8_chars(self):
        r = client.get("/api/me/invite-code", headers={"X-User-ID": "test-user-001"})
        assert len(r.json()["invite_code"]) == 8

    def test_invite_code_is_hex(self):
        r = client.get("/api/me/invite-code", headers={"X-User-ID": "test-user-001"})
        code = r.json()["invite_code"]
        assert re.match(r'^[0-9a-f]{8}$', code)

    def test_consistent_for_same_user(self):
        uid = "consistency-test-user"
        r1 = client.get("/api/me/invite-code", headers={"X-User-ID": uid})
        r2 = client.get("/api/me/invite-code", headers={"X-User-ID": uid})
        assert r1.json()["invite_code"] == r2.json()["invite_code"]

    def test_different_for_different_users(self):
        r1 = client.get("/api/me/invite-code", headers={"X-User-ID": "user-alpha"})
        r2 = client.get("/api/me/invite-code", headers={"X-User-ID": "user-beta"})
        assert r1.json()["invite_code"] != r2.json()["invite_code"]

    def test_matches_sha256_first_8(self):
        uid = "sha-verification-user"
        expected = hashlib.sha256(uid.encode()).hexdigest()[:8]
        r = client.get("/api/me/invite-code", headers={"X-User-ID": uid})
        assert r.json()["invite_code"] == expected

    def test_invite_url_contains_code(self):
        r = client.get("/api/me/invite-code", headers={"X-User-ID": "url-test-user"})
        data = r.json()
        assert data["invite_code"] in data["invite_url"]

    def test_invite_url_has_correct_domain(self):
        r = client.get("/api/me/invite-code", headers={"X-User-ID": "url-test-user"})
        url = r.json()["invite_url"]
        assert url.startswith("https://www.reelballers.com?ref=")

    def test_invite_url_format_exact(self):
        uid = "exact-url-user"
        code = hashlib.sha256(uid.encode()).hexdigest()[:8]
        r = client.get("/api/me/invite-code", headers={"X-User-ID": uid})
        assert r.json()["invite_url"] == f"https://www.reelballers.com?ref={code}"

    def test_special_chars_in_user_id(self):
        uid = "user-with-special_chars.123@test"
        r = client.get("/api/me/invite-code", headers={"X-User-ID": uid})
        assert r.status_code == 200
        assert len(r.json()["invite_code"]) == 8


# ---------------------------------------------------------------------------
# Auth endpoints accept ref param
# ---------------------------------------------------------------------------

class TestAuthRefParam:
    """Tests that auth endpoints accept the optional ref parameter."""

    def test_google_auth_accepts_ref_field(self):
        """POST /api/auth/google should not reject body with ref field."""
        r = client.post("/api/auth/google", json={
            "token": "invalid-token-for-test",
            "ref": "abc12345",
        })
        # Will fail on token verification (503 or 401), not on request validation (422)
        assert r.status_code != 422, f"ref field rejected: {r.text}"

    def test_google_auth_works_without_ref(self):
        """POST /api/auth/google should still work without ref field."""
        r = client.post("/api/auth/google", json={"token": "invalid-token"})
        assert r.status_code != 422

    def test_google_auth_ref_null(self):
        """POST /api/auth/google should accept explicit null ref."""
        r = client.post("/api/auth/google", json={"token": "x", "ref": None})
        assert r.status_code != 422

    def test_verify_otp_accepts_ref_field(self):
        """POST /api/auth/verify-otp should not reject body with ref field."""
        r = client.post("/api/auth/verify-otp", json={
            "email": "test@example.com",
            "code": "123456",
            "ref": "abc12345",
        })
        # Will fail on OTP validation (400), not on request validation (422)
        assert r.status_code != 422, f"ref field rejected: {r.text}"

    def test_verify_otp_works_without_ref(self):
        """POST /api/auth/verify-otp should still work without ref field."""
        r = client.post("/api/auth/verify-otp", json={
            "email": "test@example.com",
            "code": "123456",
        })
        assert r.status_code != 422

    def test_verify_otp_ref_null(self):
        """POST /api/auth/verify-otp should accept explicit null ref."""
        r = client.post("/api/auth/verify-otp", json={
            "email": "test@example.com",
            "code": "123456",
            "ref": None,
        })
        assert r.status_code != 422


# ---------------------------------------------------------------------------
# _find_or_create_user ref logging
# ---------------------------------------------------------------------------

class TestFindOrCreateUserRef:
    """Tests that _find_or_create_user properly handles the ref parameter."""

    @patch("app.routers.auth.get_user_by_email")
    @patch("app.routers.auth.create_user")
    @patch("app.routers.auth.generate_user_id", return_value="new-user-id")
    def test_new_user_with_ref_logs_referral(self, mock_gen, mock_create, mock_get):
        mock_get.return_value = None  # User doesn't exist
        from app.routers.auth import _find_or_create_user

        with patch("app.routers.auth.logger") as mock_logger:
            _find_or_create_user("new@test.com", ref="ref123")
            log_calls = [str(c) for c in mock_logger.info.call_args_list]
            assert any("ref123" in c for c in log_calls)

    @patch("app.routers.auth.get_user_by_email")
    @patch("app.routers.auth.create_user")
    @patch("app.routers.auth.generate_user_id", return_value="new-user-id")
    def test_new_user_without_ref_no_referral_log(self, mock_gen, mock_create, mock_get):
        mock_get.return_value = None
        from app.routers.auth import _find_or_create_user

        with patch("app.routers.auth.logger") as mock_logger:
            _find_or_create_user("new2@test.com", ref=None)
            log_calls = [str(c) for c in mock_logger.info.call_args_list]
            assert not any("referred_by" in c for c in log_calls)

    @patch("app.routers.auth.get_user_by_email")
    @patch("app.routers.auth.update_last_seen")
    def test_existing_user_with_ref_does_not_create(self, mock_update, mock_get):
        mock_get.return_value = {"user_id": "existing-123", "email": "exists@test.com"}
        from app.routers.auth import _find_or_create_user

        user_id, is_new = _find_or_create_user("exists@test.com", ref="ref456")
        assert user_id == "existing-123"
        assert is_new is False

    @patch("app.routers.auth.get_user_by_email")
    @patch("app.routers.auth.create_user")
    @patch("app.routers.auth.generate_user_id", return_value="brand-new-id")
    def test_new_user_returns_new_id(self, mock_gen, mock_create, mock_get):
        mock_get.return_value = None
        from app.routers.auth import _find_or_create_user

        user_id, is_new = _find_or_create_user("brand@new.com", ref="refXYZ")
        assert user_id == "brand-new-id"
        assert is_new is True


# ---------------------------------------------------------------------------
# Invite code determinism and collision resistance
# ---------------------------------------------------------------------------

class TestInviteCodeProperties:
    """Property-based tests for invite code generation."""

    def test_codes_are_deterministic_across_calls(self):
        """Same input always gives same output (no randomness)."""
        from app.routers.users import get_invite_code
        # Call the function directly if it existed, or use endpoint
        uid = "determinism-check"
        r1 = client.get("/api/me/invite-code", headers={"X-User-ID": uid})
        r2 = client.get("/api/me/invite-code", headers={"X-User-ID": uid})
        r3 = client.get("/api/me/invite-code", headers={"X-User-ID": uid})
        codes = {r1.json()["invite_code"], r2.json()["invite_code"], r3.json()["invite_code"]}
        assert len(codes) == 1

    def test_no_collisions_in_sample(self):
        """100 different user IDs should produce 100 unique codes."""
        codes = set()
        for i in range(100):
            r = client.get("/api/me/invite-code", headers={"X-User-ID": f"collision-test-{i}"})
            codes.add(r.json()["invite_code"])
        assert len(codes) == 100
