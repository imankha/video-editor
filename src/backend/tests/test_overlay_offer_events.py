"""T8520: overlay-is-an-offer completion-choice funnel events.

When a Focus export completes, the app now shows a completion-choice card instead
of silently auto-navigating into Overlay. Three engagement events measure the
outcome:

  overlay_offered  — the card renders (the DENOMINATOR)
  overlay_deferred — "Add Spotlight Later" / X (no render started)
  overlay_declined — "Finish Now" (final render, no spotlight)

They are analytics-only achievements (NOT quest steps): they ride the existing
recordAchievement -> POST /api/quests/achievements/{key} bridge into the
user_actions aggregate via ACHIEVEMENT_TO_MILESTONE, with no daily_counters
column and no migration.

Guards the frontend emit chain end-to-end:
  achievement key -> ACHIEVEMENT_TO_MILESTONE -> FLOW_EVENTS milestone.
"""

from app.analytics import FLOW_EVENTS
from app.routers.quests import (
    _STEP_ACHIEVEMENT_KEYS,
    ACHIEVEMENT_TO_MILESTONE,
    KNOWN_ACHIEVEMENT_KEYS,
)

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

    def test_bridged_from_frontend_achievement(self):
        # The only frontend->milestone transport is the achievement POST bridge:
        # key must be known AND map to a milestone (here, the same string).
        for event in OFFER_EVENTS:
            assert event in KNOWN_ACHIEVEMENT_KEYS, (
                f"{event} not in KNOWN_ACHIEVEMENT_KEYS — the POST would 400"
            )
            assert event in ACHIEVEMENT_TO_MILESTONE, (
                f"{event} not in ACHIEVEMENT_TO_MILESTONE — the milestone bridge "
                "would silently no-op"
            )
            assert ACHIEVEMENT_TO_MILESTONE[event] == event

    def test_achievement_targets_are_valid_flow_events(self):
        # The load-bearing chain guard: every one of these achievement keys must
        # bridge to a milestone that exists in FLOW_EVENTS, or record_milestone
        # drops it as "Unknown event" and the funnel never sees it.
        for event in OFFER_EVENTS:
            milestone = ACHIEVEMENT_TO_MILESTONE[event]
            assert milestone in FLOW_EVENTS, (
                f"{event} bridges to milestone '{milestone}' which is absent "
                "from FLOW_EVENTS"
            )

    def test_not_quest_steps(self):
        # Analytics-only: they must NOT ride the quest-step batched query, so a
        # non-quest achievement never affects quest progress.
        for event in OFFER_EVENTS:
            assert event not in _STEP_ACHIEVEMENT_KEYS
