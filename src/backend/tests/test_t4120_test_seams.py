"""
T4120 — durability test-seam gating (security-critical).

Asserts the seams are inert on production AND staging across all three layers:
  1. compute-time gate (`_force_r2_sync_failure`, the explicit sync fns),
  2. router mount decision (`_test_seams_enabled` drives main.py include),
  3. per-handler re-check (404 even if the route were reachable).

These tests need NO Postgres: they exercise the gate functions directly and a
minimal FastAPI app that mounts only the test-seams router.
"""

import asyncio

import pytest
from fastapi import HTTPException

import app.storage as storage
from app.storage import (
    _test_seams_enabled,
    _force_r2_sync_failure,
    set_force_r2_sync_failure,
)


@pytest.fixture(autouse=True)
def _reset_override():
    set_force_r2_sync_failure(None)
    yield
    set_force_r2_sync_failure(None)


# --- Layer 1/2: the gate allowlist -----------------------------------------

@pytest.mark.parametrize("env", ["dev", "development", "local", "test"])
def test_seams_enabled_in_dev_envs(monkeypatch, env):
    monkeypatch.setattr(storage, "APP_ENV", env)
    assert _test_seams_enabled() is True


@pytest.mark.parametrize("env", ["production", "prod", "staging", "PRODUCTION", "anything-else"])
def test_seams_disabled_outside_dev(monkeypatch, env):
    monkeypatch.setattr(storage, "APP_ENV", env)
    assert _test_seams_enabled() is False


# --- Layer 1: force-sync-failure is inert on prod/staging -------------------

def test_force_failure_respects_runtime_override_in_dev(monkeypatch):
    monkeypatch.setattr(storage, "APP_ENV", "dev")
    assert _force_r2_sync_failure() is False
    set_force_r2_sync_failure(True)
    assert _force_r2_sync_failure() is True
    set_force_r2_sync_failure(False)
    assert _force_r2_sync_failure() is False


def test_force_failure_reads_env_var_in_dev(monkeypatch):
    monkeypatch.setattr(storage, "APP_ENV", "dev")
    monkeypatch.setenv("FORCE_R2_SYNC_FAILURE", "1")
    assert _force_r2_sync_failure() is True


@pytest.mark.parametrize("env", ["production", "prod", "staging"])
def test_force_failure_inert_outside_dev_even_when_set(monkeypatch, env):
    """Both the runtime override AND a leaked env var are ignored on prod/staging."""
    monkeypatch.setattr(storage, "APP_ENV", env)
    monkeypatch.setenv("FORCE_R2_SYNC_FAILURE", "1")
    set_force_r2_sync_failure(True)
    assert _force_r2_sync_failure() is False


# --- Layer 1: the explicit sync fns honor the gate --------------------------
# R2_ENABLED is False in the test env, so a NON-short-circuited call returns True
# (the `if not R2_ENABLED: return True` path). A forced fault returns False BEFORE
# that. So: dev+forced -> False; prod+forced -> True (guard inert, real path runs).

def test_explicit_sync_short_circuits_in_dev(monkeypatch):
    import app.database as database
    monkeypatch.setattr(storage, "APP_ENV", "dev")
    set_force_r2_sync_failure(True)
    assert database.sync_db_to_r2_explicit("u-test", "p-test") is False
    assert database.sync_user_db_to_r2_explicit("u-test") is False


@pytest.mark.parametrize("env", ["production", "staging"])
def test_explicit_sync_not_short_circuited_outside_dev(monkeypatch, env):
    import app.database as database
    monkeypatch.setattr(storage, "APP_ENV", env)
    monkeypatch.setenv("FORCE_R2_SYNC_FAILURE", "1")
    set_force_r2_sync_failure(True)
    # Guard inert -> falls through to the real path; R2 disabled in tests -> True.
    assert database.sync_db_to_r2_explicit("u-test", "p-test") is True
    assert database.sync_user_db_to_r2_explicit("u-test") is True


# --- Layer 3: per-handler re-check 404s when disabled -----------------------
# Call the handlers directly (no TestClient) so the gate — not HTTP plumbing — is
# what's under test.

def test_sync_fault_handler_toggles_in_dev(monkeypatch):
    from app.routers.test_seams import set_sync_fault, SyncFaultRequest
    monkeypatch.setattr(storage, "APP_ENV", "dev")
    result = asyncio.run(set_sync_fault(SyncFaultRequest(enabled=True)))
    assert result["force_r2_sync_failure"] is True
    assert _force_r2_sync_failure() is True  # really flipped the process global


@pytest.mark.parametrize("env", ["production", "staging"])
def test_handlers_404_outside_dev(monkeypatch, env):
    """The per-handler gate raises 404 on prod/staging, before any side effect."""
    from app.routers.test_seams import (
        set_sync_fault, simulate_machine_cycle, SyncFaultRequest,
    )
    monkeypatch.setattr(storage, "APP_ENV", env)

    with pytest.raises(HTTPException) as ei:
        asyncio.run(set_sync_fault(SyncFaultRequest(enabled=True)))
    assert ei.value.status_code == 404

    with pytest.raises(HTTPException) as ei2:
        asyncio.run(simulate_machine_cycle())
    assert ei2.value.status_code == 404

    # ...and nothing was flipped.
    assert storage._force_sync_failure_override is None
