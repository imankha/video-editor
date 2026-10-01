"""
Admin "reset test account data" endpoint -- the is_test_account gate is
the safety-critical part (explicitly requested: this must be reachable ONLY
for accounts flagged is_test_account in Postgres, never a UI-only restriction).
These tests stub Postgres and the data-layer service so they pin the ROUTER's
own gating/error-mapping logic without touching a real database or R2.
"""

import pytest
from fastapi import HTTPException


class FakeCursor:
    def __init__(self, row):
        self._row = row

    def execute(self, *a, **k):
        pass

    def fetchone(self):
        return self._row


class FakeConn:
    def __init__(self, row):
        self._row = row

    def cursor(self):
        return FakeCursor(self._row)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


ADMIN_ID = "admin-user-id"
TARGET_ID = "target-user-id"


@pytest.fixture
def admin_stub(monkeypatch):
    from app.routers import admin as m

    monkeypatch.setattr(m, "_require_admin", lambda: None)
    monkeypatch.setattr(m, "get_current_user_id", lambda: ADMIN_ID)
    return m


def _stub_user_row(monkeypatch, m, row):
    monkeypatch.setattr(m, "get_pg", lambda: FakeConn(row))


@pytest.mark.asyncio
async def test_unknown_user_is_404(admin_stub, monkeypatch):
    m = admin_stub
    _stub_user_row(monkeypatch, m, None)

    with pytest.raises(HTTPException) as exc:
        await m.admin_reset_test_account_data(TARGET_ID)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_non_test_account_is_403_and_never_touches_data_layer(admin_stub, monkeypatch):
    """The exact requirement this task was built around: a real (non-test)
    account must be refused server-side, not just hidden from the UI."""
    m = admin_stub
    _stub_user_row(monkeypatch, m, {"email": "real.user@example.com", "is_test_account": False})

    called = {"reset": False}
    import app.services.test_account_reset as svc
    monkeypatch.setattr(svc, "reset_test_account_data", lambda uid: called.__setitem__("reset", True))

    with pytest.raises(HTTPException) as exc:
        await m.admin_reset_test_account_data(TARGET_ID)
    assert exc.value.status_code == 403
    assert called["reset"] is False, "the data-clearing service must never run for a non-test account"


@pytest.mark.asyncio
async def test_test_account_success_returns_service_result(admin_stub, monkeypatch):
    m = admin_stub
    _stub_user_row(monkeypatch, m, {"email": "tester@example.com", "is_test_account": True})

    import app.services.test_account_reset as svc
    monkeypatch.setattr(
        svc, "reset_test_account_data",
        lambda uid: {"profiles_reset": [{"profile_id": "p1", "tables_cleared": {}, "r2_objects_deleted": 0}]},
    )

    resp = await m.admin_reset_test_account_data(TARGET_ID)
    assert resp["user_id"] == TARGET_ID
    assert resp["profiles_reset"][0]["profile_id"] == "p1"


@pytest.mark.asyncio
async def test_active_export_maps_to_409(admin_stub, monkeypatch):
    m = admin_stub
    _stub_user_row(monkeypatch, m, {"email": "tester@example.com", "is_test_account": True})

    import app.services.test_account_reset as svc

    def _raise(uid):
        raise svc.ActiveExportInProgress("profile p1 has 1 active export job(s)")

    monkeypatch.setattr(svc, "reset_test_account_data", _raise)

    with pytest.raises(HTTPException) as exc:
        await m.admin_reset_test_account_data(TARGET_ID)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_sync_failure_maps_to_503(admin_stub, monkeypatch):
    m = admin_stub
    _stub_user_row(monkeypatch, m, {"email": "tester@example.com", "is_test_account": True})

    import app.services.test_account_reset as svc

    def _raise(uid):
        raise svc.TestAccountResetFailed("profile p1: R2 sync returned conflict")

    monkeypatch.setattr(svc, "reset_test_account_data", _raise)

    with pytest.raises(HTTPException) as exc:
        await m.admin_reset_test_account_data(TARGET_ID)
    assert exc.value.status_code == 503
