"""T11175: engagement events move off the quest achievements POST.

Each event family that used to ride POST /api/quests/achievements/{key} ->
ACHIEVEMENT_TO_MILESTONE now arrives through POST /api/telemetry/funnel-event
(record_funnel_event) and lands in ``user_actions`` under the SAME milestone name,
so the admin Journey history stays continuous.
"""

import uuid
from unittest.mock import patch

import pytest

from app.analytics import CLIENT_FUNNEL_EVENTS, FLOW_EVENTS, record_funnel_event
from app.services import pg as pg_service
from app.services.auth_db import create_user
from tests.conftest import register_test_user_ids

# family -> milestone names exactly as ACHIEVEMENT_TO_MILESTONE stored them.
REROUTED = {
    "pre_upload": ("add_game_opened", "upload_file_selected", "add_clip_opened"),
    "editor_opened": ("framing_opened", "overlay_opened"),
    "gallery": ("gallery_viewed", "custom_project_viewed", "gallery_watched_1s"),
    "annotate": ("annotations_played",),
    "framing_step": ("crop_adjusted", "speed_segment_created"),
    "overlay_step": ("overlay_players_assigned", "overlay_color_set", "overlay_shape_set"),
    "overlay_offer": ("overlay_offered", "overlay_deferred", "overlay_declined"),
    "draft_preview": ("previewed_draft_reel_1s",),
    "tutorial": (
        "watched_annotate_tutorial",
        "watched_framing_tutorial",
        "watched_overlay_tutorial",
        "watched_publish_tutorial",
    ),
}


def _action_count(user_id, action):
    with pg_service.get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COALESCE(SUM(count), 0) AS n FROM user_actions "
            "WHERE user_id = %s AND action = %s",
            (user_id, action),
        )
        return cur.fetchone()["n"]


@pytest.mark.parametrize("family", sorted(REROUTED))
def test_family_lands_in_user_actions_with_same_milestone_name(pg_conn, family):
    user_id = f"t11175-{family}-{uuid.uuid4().hex[:8]}"
    register_test_user_ids(user_id)
    create_user(user_id, email=f"{user_id}@test.local")
    for event in REROUTED[family]:
        assert event in FLOW_EVENTS, f"{event} is not a known milestone"
        assert event in CLIENT_FUNNEL_EVENTS, f"{event} is not client-beaconable"
        with patch("app.analytics.get_current_user_id", return_value=user_id):
            record_funnel_event(event)
        assert _action_count(user_id, event) == 1, event
