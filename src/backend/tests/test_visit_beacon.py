"""T7410: first-party visit beacon (landing + app, aggregate-only).

Pins the three acceptance criteria that are directly testable without a browser:
- bucket priority mirrors _determine_origin's order (invite > referral > click-id
  social > referrer-host seo/community > direct) -- T7410:C1
- visit_daily is an upsert-increment counter, queryable by day x source x page_class,
  reached by the schema ladder -- T7410:C3
- POST /api/t is unauthenticated and always 204 (full payload, empty payload, and a
  dropped/invalid page_class) -- never raises, never leaks the caller's IP

Run with: pytest tests/test_visit_beacon.py -v
"""

import sqlite3

from fastapi.testclient import TestClient

from app.analytics import bucket_visit_source
from app.services.analytics_store import _SCHEMA_STEPS, AnalyticsStore, _ensure_schema

CURRENT_VERSION = max(_SCHEMA_STEPS)


def _client():
    from app.main import app
    return TestClient(app, raise_server_exceptions=True)


# -- bucket priority (T7410:C1) ----------------------------------------------

def test_invite_ref_wins_over_everything():
    assert bucket_visit_source("a1b2c3d4", "fall-campaign", "fbclid", "instagram.com") == "invite"


def test_click_id_wins_over_bare_utm_source():
    # The acceptance example: ?utm_source=instagram&fbclid=... -> social-facebook.
    # utm_source alone (no utm_campaign) is not in _determine_origin's priority chain,
    # so click-id is the next applicable signal.
    assert bucket_visit_source(None, None, "fbclid", None) == "social-facebook"


def test_referral_beats_click_id():
    assert bucket_visit_source("my-friend-link", None, "fbclid", None) == "referral"
    assert bucket_visit_source(None, "spring-sale", "fbclid", None) == "referral"


def test_referrer_host_seo_and_community_fall_through_to_direct_order():
    assert bucket_visit_source(None, None, None, "google.com") == "seo"
    assert bucket_visit_source(None, None, None, "reddit.com") == "community"
    assert bucket_visit_source(None, None, None, "instagram.com") == "social-instagram"


def test_no_signal_is_direct():
    assert bucket_visit_source(None, None, None, None) == "direct"


# -- visit_daily schema + upsert-increment (T7410:C3) -------------------------

def test_schema_ladder_reaches_visit_daily():
    conn = sqlite3.connect(":memory:")
    _ensure_schema(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == CURRENT_VERSION
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert "visit_daily" in tables


def test_record_visit_flush_is_upsert_increment(tmp_path):
    store = AnalyticsStore(
        local_path=tmp_path / "analytics_data" / "analytics.sqlite",
        key="dev/analytics/shards/t7410-w1/analytics.sqlite",
        writer_id="t7410-w1",
        env="dev",
    )
    assert store.confirm_baseline() is True  # R2 disabled in tests -> local-only store

    store.record_visit("social-facebook", "landing")
    store.record_visit("social-facebook", "landing")
    store.record_visit("direct", "app")
    assert store.flush_local() is True

    counts = store.local_visit_counts()
    today_fb = next(v for k, v in counts.items() if k[1] == "social-facebook" and k[2] == "landing")
    today_direct = next(v for k, v in counts.items() if k[1] == "direct" and k[2] == "app")
    assert today_fb == 2
    assert today_direct == 1

    # A second flush with one more visit increments the existing row, not a new one.
    store.record_visit("social-facebook", "landing")
    assert store.flush_local() is True
    counts = store.local_visit_counts()
    assert len(counts) == 2  # still exactly 2 rows: (fb, landing) and (direct, app)
    today_fb = next(v for k, v in counts.items() if k[1] == "social-facebook" and k[2] == "landing")
    assert today_fb == 3


def test_sport_page_class_is_accepted(tmp_path):
    store = AnalyticsStore(
        local_path=tmp_path / "analytics_data" / "analytics.sqlite",
        key="dev/analytics/shards/t7410-w2/analytics.sqlite",
        writer_id="t7410-w2",
        env="dev",
    )
    assert store.confirm_baseline() is True
    store.record_visit("seo", "landing:soccer")
    assert store.flush_local() is True
    counts = store.local_visit_counts()
    assert any(k[2] == "landing:soccer" for k in counts)


# -- POST /api/t (T7410:C4 -- unauthenticated, always 204) --------------------

def test_visit_beacon_returns_204_for_full_payload():
    client = _client()
    resp = client.post("/api/t", json={
        "page_class": "landing",
        "ref": None,
        "utm_campaign": None,
        "click_id": "fbclid",
        "referrer_host": None,
    })
    assert resp.status_code == 204


def test_visit_beacon_returns_204_for_empty_required_fields_only():
    client = _client()
    resp = client.post("/api/t", json={"page_class": "app"})
    assert resp.status_code == 204


def test_visit_beacon_drops_invalid_page_class_without_erroring():
    client = _client()
    resp = client.post("/api/t", json={"page_class": "not-a-real-class"})
    assert resp.status_code == 204


def test_visit_beacon_accepts_sport_landing_page_class():
    client = _client()
    resp = client.post("/api/t", json={"page_class": "landing:soccer"})
    assert resp.status_code == 204
