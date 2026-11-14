"""T8520: overlay-is-an-offer completion-choice funnel events.

When a Focus export completes, the app now shows a completion-choice card instead
of silently auto-navigating into Overlay. Three engagement events measure the
outcome:

  overlay_offered  — the card renders (the DENOMINATOR)
  overlay_deferred — "Add Spotlight Later" / X (no render started)
  overlay_declined — "Finish Now" (final render, no spotlight)

They are client funnel beacons (T11175): the browser sends them through
recordFunnelEvent -> POST /api/telemetry/funnel-event -> record_funnel_event into
the user_actions aggregate under the same milestone names the retired quest
achievements bridge used, with no daily_counters column and no migration.

Guards the frontend emit chain end-to-end:
  CLIENT_FUNNEL_EVENTS -> record_funnel_event -> FLOW_EVENTS milestone -> user_actions.
"""

import uuid
from unittest.mock import patch

from app.analytics import CLIENT_FUNNEL_EVENTS, FLOW_EVENTS, record_funnel_event
from app.services import pg as pg_service
from app.services.auth_db import create_user
from tests.conftest import register_test_user_ids

# key == milestone name for all three (identity bridge).
OFFER_EVENTS = ("overlay_offered", "overlay_deferred", "overlay_declined")

EXPECTED_LABELS = {
    "overlay_offered": "Overlay Offered",
    "overlay_deferred": "Overlay Deferred",
    "overlay_declined": "Overlay Declined",
}


class TestOverlayOfferEventRegistration:
    def test_events_registered_in_flow_events_with_exact_labels(self):
        # Must exist so record_milestone accepts them instead of dropping them
        # as "Unknown event", and the labels are what the admin engagement
        # dimensions render.
        for event in OFFER_EVENTS:
            assert event in FLOW_EVENTS, f"{event} missing from FLOW_EVENTS"
            assert FLOW_EVENTS[event]["label"] == EXPECTED_LABELS[event]

    def test_no_daily_column_added(self):
        # Engagement dimensions: read side is the user_actions aggregate, no
        # day-grain, so NO daily_counters column and NO pg migration.
        for event in OFFER_EVENTS:
            assert FLOW_EVENTS[event]["daily_col"] is None, (
                f"{event} unexpectedly maps to a daily_counters column — that "
                "requires a pg migration this task deliberately avoided"
            )

    def test_client_beaconable(self):
        # The frontend->milestone transport is the funnel beacon: a name outside
        # CLIENT_FUNNEL_EVENTS is rejected server-side and never recorded.
        for event in OFFER_EVENTS:
            assert event in CLIENT_FUNNEL_EVENTS, (
                f"{event} not in CLIENT_FUNNEL_EVENTS -- the beacon would be dropped"
            )


class TestOverlayOfferEventTransport:
    def test_each_beacon_lands_in_user_actions(self, pg_conn):
        user_id = f"t11175-offer-{uuid.uuid4().hex[:8]}"
        register_test_user_ids(user_id)
        create_user(user_id, email=f"{user_id}@test.local")
        for event in OFFER_EVENTS:
            with patch("app.analytics.get_current_user_id", return_value=user_id):
                record_funnel_event(event)
            with pg_service.get_pg() as conn:
                cur = conn.cursor()
                cur.execute(
                    "SELECT COALESCE(SUM(count), 0) AS n FROM user_actions "
                    "WHERE user_id = %s AND action = %s",
                    (user_id, event),
                )
                assert cur.fetchone()["n"] == 1, event
