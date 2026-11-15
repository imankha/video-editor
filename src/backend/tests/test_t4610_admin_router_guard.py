"""T4610: the admin check is attached once, at router level.

Every /api/admin route except the two that are open by design must carry the
`require_admin` dependency, so a handler added without remembering the check is
still guarded. The meta-tests iterate the live app's routes: a future admin
route is covered without editing this file.
"""

from unittest.mock import patch

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.routers import admin

# The only admin routes meant to be open to every user (see admin.py docstring).
OPEN_ADMIN_ROUTES = {
    ("GET", "/api/admin/me"),
    ("POST", "/api/admin/impersonate/stop"),
}


def _admin_routes():
    from app.main import app
    out = []
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path.startswith("/api/admin/"):
            for method in sorted(route.methods):
                out.append((method, route.path, route))
    return out


def _is_guarded(route: APIRoute) -> bool:
    return any(dep.call is admin.require_admin for dep in route.dependant.dependencies)


def test_every_admin_route_carries_the_router_level_guard():
    routes = _admin_routes()
    assert len(routes) > 50, "admin routes not found on the app"
    unguarded = {(m, p) for m, p, r in routes if not _is_guarded(r)}
    assert unguarded == OPEN_ADMIN_ROUTES


def test_the_guard_is_attached_to_the_router_not_per_handler():
    assert any(dep.dependency is admin.require_admin for dep in admin.router.dependencies)
    assert not any(dep.dependency is admin.require_admin for dep in admin.open_router.dependencies)


def test_a_route_added_to_the_admin_router_is_guarded_without_naming_the_check():
    """The [DEP] payoff: a new handler on `admin.router` that never mentions the check."""
    from fastapi import APIRouter, FastAPI

    probe = APIRouter(prefix="/admin", dependencies=admin.router.dependencies)

    @probe.get("/t4610-probe")
    def _probe():
        return {"ok": True}

    app = FastAPI()
    app.include_router(probe, prefix="/api")
    route = next(r for r in app.routes if isinstance(r, APIRoute) and r.path == "/api/admin/t4610-probe")
    assert _is_guarded(route)


@pytest.fixture()
def client(pg_conn, tmp_path):
    from app.services.auth_db import create_user
    from app.services.pg import get_pg
    create_user("admin-user", email="test-admin@test.local")
    create_user("regular-user", email="other@test.local")
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING"
        )
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def test_every_guarded_admin_route_rejects_a_non_admin(client):
    """Hit every guarded admin route as a regular user: each must 403 before its body runs."""
    guarded = [(m, p) for m, p, r in _admin_routes() if (m, p) not in OPEN_ADMIN_ROUTES]
    failures = []
    for method, path in guarded:
        url = path.replace("{", "").replace("}", "")  # fill path params with their own names
        resp = client.request(method, url, headers={"X-User-ID": "regular-user"})
        if resp.status_code != 403:
            failures.append((method, path, resp.status_code))
    assert failures == []


def test_open_routes_stay_open_to_a_non_admin(client):
    me = client.get("/api/admin/me", headers={"X-User-ID": "regular-user"})
    assert me.status_code == 200 and me.json()["is_admin"] is False
    # Must reach stop_impersonation (400 not_impersonating), not be swallowed by the
    # guarded /impersonate/{target_user_id} route and 403'd.
    stop = client.post("/api/admin/impersonate/stop", headers={"X-User-ID": "regular-user"})
    assert stop.status_code == 400 and stop.json()["detail"] == "not_impersonating"


def test_admin_still_reaches_guarded_routes(client):
    resp = client.get("/api/admin/dashboard", headers={"X-User-ID": "admin-user"})
    assert resp.status_code == 200, resp.text
    assert {"users", "pulse"} <= set(resp.json())
