"""T7890: pre-upload funnel beacons (add_game_opened -> upload_file_selected).

The signup->first-upload cliff was dark before game_created (the "Upload Attempted"
pending insert). These two frontend gestures now bridge through the
impersonation-guarded record_milestone into the existing user_actions aggregate,
making a bail-before-picker distinguishable from a bail-before-prepare.
"""

import pytest

from app.analytics import (
    FLOW_EVENTS,
    FUNNEL_STEPS,
    create_user_segment,
    record_milestone,
)
from app.routers.quests import (
    _STEP_ACHIEVEMENT_KEYS,
    ACHIEVEMENT_TO_MILESTONE,
    KNOWN_ACHIEVEMENT_KEYS,
)
from app.services.auth_db import create_user

BEACONS = ("add_game_opened", "upload_file_selected")


def _get_action(user_id: str, action: str) -> dict | None:
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM user_actions WHERE user_id = %s AND action = %s",
            (user_id, action),
        )
        return cur.fetchone()


class TestPreUploadBeaconRegistration:
    def test_events_registered_in_flow_events(self, pg_conn):
        # Must exist so record_milestone accepts them instead of dropping them
        # as "Unknown event".
        for event in BEACONS:
            assert event in FLOW_EVENTS, f"{event} missing from FLOW_EVENTS"

    def test_no_daily_column_added(self, pg_conn):
        # Decision (task Technical Notes): read side uses the user_actions
        # aggregate (per-user first_at + count) — no day-grain, so NO
        # daily_counters column and NO migration. Guard that decision.
        for event in BEACONS:
            assert FLOW_EVENTS[event]["daily_col"] is None, (
                f"{event} unexpectedly maps to a daily_counters column — that "
                "requires a pg migration this task deliberately avoided"
            )

    def test_registered_in_funnel_between_session_and_attempt(self, pg_conn):
        # Localizes the pre-upload cliff: session -> add_game_opened ->
        # upload_file_selected -> game_created.
        for event in BEACONS:
            assert event in FUNNEL_STEPS
        assert (
            FUNNEL_STEPS.index("session_started")
            < FUNNEL_STEPS.index("add_game_opened")
            < FUNNEL_STEPS.index("upload_file_selected")
            < FUNNEL_STEPS.index("game_created")
        )

    def test_funnel_steps_have_nonnull_labels(self, pg_conn):
        # admin.py funnel consumers do FLOW_EVENTS[step]["label"].lower(); a
        # None label would crash the funnel dashboard for every step.
        for event in BEACONS:
            assert FLOW_EVENTS[event]["label"], f"{event} needs a non-None label"

    def test_bridged_from_frontend_achievement(self, pg_conn):
        # The only frontend->milestone transport is the achievement POST bridge.
        for event in BEACONS:
            assert event in KNOWN_ACHIEVEMENT_KEYS
            assert ACHIEVEMENT_TO_MILESTONE[event] == event

    def test_not_quest_steps(self, pg_conn):
        # Analytics-only: they must NOT ride the quest-step batched query.
        for event in BEACONS:
            assert event not in _STEP_ACHIEVEMENT_KEYS


class TestPreUploadBeaconRecording:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_segment("user-a", "organic", None, "otp")

    def test_add_game_opened_recorded(self, pg_conn):
        record_milestone("user-a", "add_game_opened")
        assert _get_action("user-a", "add_game_opened")["count"] == 1

    def test_upload_file_selected_recorded(self, pg_conn):
        record_milestone("user-a", "upload_file_selected")
        assert _get_action("user-a", "upload_file_selected")["count"] == 1

    def test_beacons_are_independent_dimensions(self, pg_conn):
        # A user who opened Add Game but never picked a file leaves ONLY the
        # first row — that is the whole point (distinguishable in prod data).
        record_milestone("user-a", "add_game_opened")
        assert _get_action("user-a", "add_game_opened") is not None
        assert _get_action("user-a", "upload_file_selected") is None

    def test_impersonation_leaves_zero_footprint(self, pg_conn, monkeypatch):
        # Route is record_milestone, which carries the T1515 impersonation guard;
        # an admin driving the user's screen must record nothing.
        monkeypatch.setattr(
            "app.analytics.get_current_impersonator_id", lambda: "admin-9"
        )
        for event in BEACONS:
            record_milestone("user-a", event)
        for event in BEACONS:
            assert _get_action("user-a", event) is None
