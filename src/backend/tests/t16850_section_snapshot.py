"""T16850:C3 helper: every Sport-filtered Admin section read with NO sport param, as
JSON. test_t16850_all_sports_unchanged.py calls `snapshot` in-process (this revision) and
runs this file as a script against a checkout of the pre-task revision, so both read the
same seeded Postgres rows:

    python tests/t16850_section_snapshot.py <other src/backend dir> <user-data tmp dir>

The script puts the other checkout first on sys.path, so `app` is that revision's code."""
import json
import sys
from unittest.mock import patch

TEST_BUILD = 16850
SEEDED = ["t16850-hockey-a", "t16850-hockey-b", "t16850-lax-a", "t16850-direct"]
# Keys added beside the numbers after the base revision (not numbers themselves):
# sport_applied (T16850); highlight_finished_count and joined_at (T17270 admin user columns).
ADDED_KEYS = {"sport_applied", "highlight_finished_count", "joined_at"}

ENDPOINTS = [
    ("pulse", "/api/admin/analytics/pulse", {"build": TEST_BUILD}),
    ("platforms", "/api/admin/analytics/platforms", {"build": TEST_BUILD}),
    ("pack_mix", "/api/admin/analytics/pack-mix", {}),
    ("retention", "/api/admin/analytics/retention-chart", {}),
    ("activation", "/api/admin/analytics/activation", {}),
    ("upload_failures", "/api/admin/upload-failures", {"limit": 500}),
    ("reconciliation", "/api/admin/revenue-reconciliation", {}),
    ("dashboard", "/api/admin/dashboard", {"build": TEST_BUILD}),
]


def _stripe_intents():
    return [{"id": f"pi_t16850_{i}", "status": "succeeded", "metadata": {"user_id": uid},
             "amount_received": 399, "created": 1690000000,
             "latest_charge": {"amount_captured": 399, "amount_refunded": 0,
                               "disputed": False, "dispute": None}}
            for i, uid in enumerate(SEEDED)]


def _strip_added(value):
    if isinstance(value, dict):
        return {k: _strip_added(v) for k, v in value.items() if k not in ADDED_KEYS}
    if isinstance(value, list):
        return [_strip_added(v) for v in value]
    return value


def snapshot(client) -> dict:
    out = {}
    with patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=_stripe_intents()):
        for name, path, params in ENDPOINTS:
            resp = client.get(path, params=params, headers={"X-User-ID": "admin-user"})
            assert resp.status_code == 200, f"{name}: {resp.status_code} {resp.text}"
            out[name] = _strip_added(resp.json())
    # classify_users walks a set, so rows tied on delta come out in hash-seed order on
    # every revision: compare them in user_id order.
    out["reconciliation"]["rows"].sort(key=lambda r: r["user_id"])
    return out


if __name__ == "__main__":
    backend_dir, user_data = sys.argv[1], sys.argv[2]
    sys.path.insert(0, backend_dir)
    from pathlib import Path

    import stripe
    stripe.api_key = "sk_test_dummy"
    with patch("app.database.USER_DATA_BASE", Path(user_data)), \
         patch("app.services.user_db.USER_DATA_BASE", Path(user_data)), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from fastapi.testclient import TestClient

        import app as app_pkg
        from app.main import app
        from app.services.pg import init_pg_pool
        init_pg_pool()
        assert Path(app_pkg.__file__).resolve().is_relative_to(Path(backend_dir).resolve()), app_pkg.__file__
        print(json.dumps(snapshot(TestClient(app, raise_server_exceptions=True)), sort_keys=True, default=str))
