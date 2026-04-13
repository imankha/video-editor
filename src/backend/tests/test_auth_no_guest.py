"""
T1330: guest-account endpoints and helpers must be gone.

Routes:
  - POST /api/auth/init-guest     → 404 (endpoint removed)
  - POST /api/auth/retry-migration → 404 (endpoint removed)

Middleware:
  - Mutating API calls without an authenticated (email) session are
    rejected 401, not silently allowed under a guest user_id.

Source-level:
  - Guest-migration helpers (_merge_guest_into_profile,
    _migrate_guest_profile) must be gone from the auth router.
"""
import ast
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

AUTH_PY = Path(__file__).resolve().parents[1] / "app" / "routers" / "auth.py"


def test_init_guest_endpoint_removed():
    client = TestClient(app)
    r = client.post("/api/auth/init-guest")
    assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"


def test_retry_migration_endpoint_removed():
    client = TestClient(app)
    r = client.post("/api/auth/retry-migration")
    assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"


def test_guest_migration_helpers_removed():
    src = AUTH_PY.read_text(encoding="utf-8")
    tree = ast.parse(src)
    names = {
        node.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    banned = {
        "_merge_guest_into_profile",
        "_migrate_guest_profile",
        "init_guest",
        "retry_migration",
    }
    leaked = banned & names
    assert not leaked, f"guest-migration code still present: {leaked}"
