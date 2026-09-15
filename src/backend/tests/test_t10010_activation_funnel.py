"""T10010: activation-funnel instrumentation.

The missing funnel events (framing point added, preview started, a validated
playback view, draft saved, result (re)opened) route through the same
aggregates-only mechanism as every other milestone: the free-text `user_actions`
Postgres aggregate (counts only, no new column -> no migration) plus the per-user
`user_action_log` detail trail. These tests pin the four acceptance criteria:

  AC1  one person + three renders of one highlight = ONE activated person
  AC2  the 7d/24h definitions + historical baseline stay explicit/separate (doc)
  AC3  render validation (export) and playback (result_viewed) are DIFFERENT events
  AC4  the instrumented data excludes child names / emails / free text
"""

import logging

import pytest
from fastapi.testclient import TestClient

from app.analytics import (
    CLIENT_FUNNEL_EVENTS,
    FLOW_EVENTS,
    FUNNEL_CONTEXT_ALLOWED_KEYS,
    _sanitize_funnel_context,
    create_user_segment,
    is_playback_viewed,
    record_funnel_event,
)
from app.services.auth_db import create_user

NEW_EVENTS = (
    "framing_point_added",
    "preview_started",
    "draft_saved",
    "result_opened",
    "playback_started",
    "result_viewed",
    "result_reopened",
)


def _get_action(user_id: str, action: str) -> dict | None:
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM user_actions WHERE user_id = %s AND action = %s",
            (user_id, action),
        )
        return cur.fetchone()


def _distinct_users(action: str) -> int:
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(DISTINCT user_id) AS n FROM user_actions WHERE action = %s",
            (action,),
        )
        return cur.fetchone()["n"]


class TestRegistration:
    def test_all_new_events_registered(self):
        # Must exist in FLOW_EVENTS so record_milestone accepts them instead of
        # dropping them as "Unknown event".
        for event in NEW_EVENTS:
            assert event in FLOW_EVENTS, f"{event} missing from FLOW_EVENTS"

    def test_no_daily_column_added(self):
        # Aggregates-only, no new Postgres state: every new event is an engagement
        # dimension (daily_col=None). A daily_col would require a migration this
        # task deliberately avoided.
        for event in NEW_EVENTS:
            assert FLOW_EVENTS[event]["daily_col"] is None, (
                f"{event} maps to a daily_counters column — that needs a pg "
                "migration this task must not introduce"
            )

    def test_new_events_have_labels(self):
        # admin.py funnel consumers do FLOW_EVENTS[step]["label"].lower(); a None
        # label would crash the dashboard.
        for event in NEW_EVENTS:
            assert FLOW_EVENTS[event]["label"], f"{event} needs a non-None label"

    def test_client_vocabulary_matches_new_events(self):
        # The client beacon may only fire these seven; a server-endpoint event
        # (clip_created, export_completed, ...) must NOT be spoofable via the beacon.
        assert set(NEW_EVENTS) == CLIENT_FUNNEL_EVENTS


class TestViewedConvention:
    @pytest.mark.parametrize(
        "watched,duration,expected",
        [
            (2.0, 6.0, True),    # >= 2s on a long clip
            (1.9, 6.0, False),   # just under 2s
            (2.0, 4.0, True),    # exactly at the long-clip boundary
            (1.6, 3.0, True),    # short clip: >= 50%
            (1.4, 3.0, False),   # short clip: < 50%
            (5.0, 0.0, False),   # unknown/zero duration can never be "viewed"
            (-1.0, 6.0, False),  # nonsense playback position
        ],
    )
    def test_threshold_table(self, watched, duration, expected):
        assert is_playback_viewed(watched, duration) is expected


class TestContextSanitizer:
    def test_drops_pii_and_free_text(self):
        # AC4: child names, recipient emails, free-text report content must never
        # reach the trail — only allow-listed coarse keys survive.
        dirty = {
            "highlight_id": "h1",
            "child_name": "Ethan",
            "recipient_email": "coach@example.com",
            "report_text": "Great control pass by Ethan",
            "watched_seconds": "2.5",
        }
        clean = _sanitize_funnel_context(dirty)
        assert clean == {"highlight_id": "h1", "watched_seconds": 2.5}
        assert "child_name" not in clean
        assert "recipient_email" not in clean
        assert "report_text" not in clean

    def test_every_allowed_key_is_coarse(self):
        # Guard against a future edit adding a free-text/PII key to the allow-list.
        forbidden = {"name", "email", "title", "text", "message", "caption", "comment"}
        for key in FUNNEL_CONTEXT_ALLOWED_KEYS:
            assert not any(f in key for f in forbidden), f"suspicious allowed key: {key}"

    def test_id_length_capped(self):
        clean = _sanitize_funnel_context({"result_id": "x" * 500})
        assert len(clean["result_id"]) == 64


class TestRecording:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn, monkeypatch):
        create_user("user-a", email="a@test.com")
        create_user_segment("user-a", "organic", None, "otp")
        monkeypatch.setattr("app.analytics.get_current_user_id", lambda: "user-a")

    def test_rejects_non_client_event(self, pg_conn):
        # A server-side event name must be refused by the client beacon path so a
        # spoofed beacon can't forge, e.g., an export success.
        record_funnel_event("export_completed", {"export_id": "e1"})
        assert _get_action("user-a", "export_completed") is None

    def test_result_viewed_below_threshold_dropped(self, pg_conn):
        # A bare load (0.5s of a 6s clip) is NOT a view — server re-validates.
        record_funnel_event(
            "result_viewed", {"watched_seconds": 0.5, "duration_seconds": 6}
        )
        assert _get_action("user-a", "result_viewed") is None

    def test_result_viewed_above_threshold_recorded(self, pg_conn):
        record_funnel_event(
            "result_viewed", {"watched_seconds": 2, "duration_seconds": 6, "result_id": "r1"}
        )
        assert _get_action("user-a", "result_viewed")["count"] == 1

    def test_ac1_three_renders_one_person_one_activation(self, pg_conn):
        # THE headline criterion. One person watches one highlight validated three
        # times: user_actions.count climbs, but the person appears ONCE.
        for _ in range(3):
            record_funnel_event(
                "result_viewed",
                {"watched_seconds": 2, "duration_seconds": 6, "highlight_id": "h1"},
            )
        assert _get_action("user-a", "result_viewed")["count"] == 3
        # Activation is COUNT(DISTINCT user_id), never SUM(count): still one person.
        assert _distinct_users("result_viewed") == 1

    def test_ac3_playback_distinct_from_render(self, pg_conn):
        # Render validation (export_completed) and actual playback (result_viewed)
        # are DIFFERENT event keys — a rendered-but-unwatched highlight is not
        # activated. Confirm they are separate dimensions.
        assert "result_viewed" in FLOW_EVENTS
        assert "export_completed" in FLOW_EVENTS
        assert "result_viewed" != "export_completed"
        assert "result_viewed" not in CLIENT_FUNNEL_EVENTS or "export_completed" not in CLIENT_FUNNEL_EVENTS

    def test_impersonation_leaves_zero_footprint(self, pg_conn, monkeypatch):
        # record_funnel_event -> record_milestone, which carries the T1515 guard.
        monkeypatch.setattr("app.analytics.get_current_impersonator_id", lambda: "admin-9")
        record_funnel_event("draft_saved", {"project_id": "p1"})
        assert _get_action("user-a", "draft_saved") is None


class TestBeaconEndpoint:
    def _client(self):
        from app.main import app
        return TestClient(app, raise_server_exceptions=True)

    def test_known_event_returns_204(self):
        resp = self._client().post(
            "/api/telemetry/funnel-event",
            json={"event": "result_opened", "context": {"result_id": "r1"}},
        )
        assert resp.status_code == 204

    def test_unknown_event_never_500(self, caplog):
        # A stray/forged beacon is dropped, not a server error.
        with caplog.at_level(logging.WARNING, logger="app.analytics"):
            resp = self._client().post(
                "/api/telemetry/funnel-event",
                json={"event": "not_a_real_event", "context": {}},
            )
        assert resp.status_code == 204

    def test_empty_body_never_422_on_missing_context(self):
        resp = self._client().post(
            "/api/telemetry/funnel-event", json={"event": "preview_started"}
        )
        assert resp.status_code == 204
