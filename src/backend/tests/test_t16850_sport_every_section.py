"""T16850: the Admin Sport filter (arrival sport, `user_segments.utm_content` restricted to
the known sport keys; anything else is "unknown") reaches every section that counts people:
Pulse, Platform Breakdown, Pack Mix, Retention, Activation, Revenue Reconciliation and
Upload Failures. Seeds two hockey arrivals, one lacrosse arrival and one with no
utm_content, then shows each section's numbers follow the filter, and that "All sports"
(no `sport` param) counts all of them. Needs Postgres (pg_conn).

The shared dev DB holds unrelated users, so build-scoped sections assert exact counts and
the rest assert the change this seed causes (after minus before)."""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.analytics import create_user_segment, record_milestone
from app.services.auth_db import create_user

TEST_BUILD = 16850
PACK = "t16850_pack"
SEEDED = {"t16850-hockey-a": "hockey", "t16850-hockey-b": "hockey",
          "t16850-lax-a": "lacrosse", "t16850-direct": None}
EXPECTED = {"hockey": 2, "lacrosse": 1, "unknown": 1, None: 4}


def _auth():
    return {"X-User-ID": "admin-user"}


def _cleanup():
    from app.services.pg import get_pg
    ids = list(SEEDED)
    with get_pg() as conn:
        cur = conn.cursor()
        # payments and upload_failures need no cleanup: pg_conn truncates both per test.
        for table in ("user_actions", "user_segments", "users"):
            cur.execute(f"DELETE FROM {table} WHERE user_id = ANY(%s)", (ids,))


@pytest.fixture()
def client(pg_conn, tmp_path, monkeypatch):
    _cleanup()
    create_user("admin-user", email="test-admin@test.local")
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING")
    monkeypatch.setattr("stripe.api_key", "sk_test_dummy")
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)
    _cleanup()


def _seed():
    from app.services.pg import get_pg
    for i, (uid, sport) in enumerate(SEEDED.items()):
        create_user(uid, email=f"{uid}@test.com")
        create_user_segment(uid, "organic", None, "otp", utm_content=sport)
        record_milestone(uid, "clip_created")
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE user_segments SET signup_build = %s, acquired_at = CURRENT_DATE - 20 "
                        "WHERE user_id = %s", (TEST_BUILD, uid))
            cur.execute("""
                INSERT INTO payments (user_id, kind, amount_cents, currency, stripe_object_id,
                                      pack, occurred_at, source)
                VALUES (%s, 'purchase', 399, 'usd', %s, %s, now(), 'backfill')
            """, (uid, f"pi_t16850_{i}", PACK))
            cur.execute("""
                INSERT INTO upload_failures (user_id, profile_id, kind, stage, reason, terminal,
                                             origin, impersonated, app_build)
                VALUES (%s, 'prof-1', 'game', 'preparing', 'refused', TRUE, 'server', FALSE, 0)
            """, (uid,))


def _get(client, path, **params):
    params = {k: v for k, v in params.items() if v is not None}
    resp = client.get(path, params=params, headers=_auth())
    assert resp.status_code == 200, resp.text
    return resp.json()


def _pulse_signups(client, sport):
    body = _get(client, "/api/admin/analytics/pulse", build=TEST_BUILD, sport=sport)
    return sum(body["cards"]["signups"]["sparkline"])


def _platform_users(client, sport):
    return _get(client, "/api/admin/analytics/platforms", build=TEST_BUILD, sport=sport)["total_users"]


def _pack_purchases(client, sport):
    rows = _get(client, "/api/admin/analytics/pack-mix", sport=sport)["windows"]["all"]
    return next((r["purchases"] for r in rows if r["pack"] == PACK), 0)


def _retention_signups(client, sport):
    body = _get(client, "/api/admin/analytics/retention-chart", sport=sport)
    return sum(c["signups"] for c in body["triangle"]["cohorts"])


def _activation_signups(client, sport):
    body = _get(client, "/api/admin/analytics/activation", sport=sport)
    return sum(c["signups"] for c in body["cohorts"])


def _upload_failure_rows(client, sport):
    body = _get(client, "/api/admin/upload-failures", sport=sport, limit=500)
    return sum(1 for r in body["rows"] if r["user_id"] in SEEDED)


def _upload_game_failed(client, sport):
    return _get(client, "/api/admin/upload-failures", sport=sport)["rates"]["game"]["failed"]


def _reconciliation_rows(client, sport):
    from tests.test_revenue_reconciliation import make_pi
    intents = [make_pi(uid, 399, pi_id=f"pi_t16850_{i}") for i, uid in enumerate(SEEDED)]
    with patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=intents):
        body = _get(client, "/api/admin/revenue-reconciliation", sport=sport)
    return sum(1 for r in body["rows"] if r["user_id"] in SEEDED)


EXACT = [_pulse_signups, _platform_users, _pack_purchases, _upload_failure_rows, _reconciliation_rows]
DELTA = [_retention_signups, _activation_signups, _upload_game_failed]


@pytest.mark.parametrize("section", EXACT, ids=lambda f: f.__name__)
def test_section_counts_only_the_chosen_arrival_sport(client, section):
    _seed()
    for sport, expected in EXPECTED.items():
        assert section(client, sport) == expected, f"sport={sport}"


@pytest.mark.parametrize("section", DELTA, ids=lambda f: f.__name__)
def test_section_change_follows_the_chosen_arrival_sport(client, section):
    before = {sport: section(client, sport) for sport in EXPECTED}
    _seed()
    for sport, expected in EXPECTED.items():
        assert section(client, sport) - before[sport] == expected, f"sport={sport}"


def test_heal_all_drifted_touches_only_the_chosen_sport(client):
    from app.services.pg import get_pg
    from tests.test_revenue_reconciliation import make_pi
    _seed()
    # Every seeded user drifts: local cache 0, Stripe net 399.
    intents = [make_pi(uid, 399, pi_id=f"pi_t16850_{i}") for i, uid in enumerate(SEEDED)]
    with patch("app.services.revenue_reconciliation.fetch_stripe_intents", return_value=intents):
        resp = client.post("/api/admin/revenue-reconciliation/heal",
                           json={"all_drifted": True, "sport": "lacrosse"}, headers=_auth())
    assert resp.status_code == 200, resp.text
    healed = {r["user_id"] for r in resp.json()["results"] if r.get("healed")}
    assert healed == {"t16850-lax-a"}
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id, total_spent_cents FROM user_segments WHERE user_id = ANY(%s)",
                    (list(SEEDED),))
        spent = {r["user_id"]: r["total_spent_cents"] for r in cur.fetchall()}
    assert spent["t16850-lax-a"] == 399
    assert spent["t16850-hockey-a"] == 0
