"""T6860 (round 2): the SAME reel showed DIFFERENT intro cards at the two egresses
- in-app playback rendered the CURRENT athlete name ("Mehdi Khabazian") while the
downloaded file's burned-in card showed a STALE name ("Jordan Vega") that no longer
exists in the profile.

Root cause (validated): the burn/download egress reads the card ROW restore-if-newer
(open_profile_db_readonly -> ensure_profile_db_local) but read the athlete FACTS
(full_name lives in user.sqlite) via the OWNER path get_user_db_connection ->
ensure_user_database = restore-if-ABSENT only. So a Fly machine holding a stale local
user.sqlite baked an old full_name into the (correctly hash-keyed) cached card render,
while playback -- resolved on a different, fresh machine -- showed the current name.
It is strictly cross-machine: a single machine renders identical titles for both modes.

Fix: intro_egress._load_field_values now calls ensure_user_database_fresh(user_id)
(restore-if-newer, WAL-safe, read-only) before reading facts, so ALL live egresses that
funnel through this one seam resolve facts from the same R2-current truth as the card row.

These tests simulate the two-machine case in one process: a stale local user.sqlite +
a newer R2 copy, where the restore-if-newer step (mocked) pulls the new name in.
"""

from unittest.mock import MagicMock, patch

import pytest

from app.services.db_refresh import RefreshFailed

MOD = "app.services.intro_egress"
USER = "user-123"
PROFILE = "9fa7378c"


def _facts_readers(state):
    """Build get_all_intro_facts / get_all_intro_full_names mocks that read `state`
    LIVE at call time, so a restore that mutates `state` first is reflected."""
    facts = MagicMock(side_effect=lambda uid=None: {PROFILE: dict(state["facts"])})
    names = MagicMock(side_effect=lambda uid=None: ({PROFILE: state["full_name"]} if state["full_name"] else {}))
    return facts, names


def test_load_field_values_confirms_user_db_fresh_before_reading_facts():
    """The freshen MUST run, exactly once, with the user_id, and BEFORE the fact reads
    (else a stale local user.sqlite is read)."""
    order = []
    state = {"facts": {"position": "CAM"}, "full_name": "Mehdi Khabazian"}
    facts, names = _facts_readers(state)
    facts.side_effect = lambda uid=None: (order.append("read_facts"), {PROFILE: {"position": "CAM"}})[1]
    names.side_effect = lambda uid=None: (order.append("read_names"), {PROFILE: state["full_name"]})[1]
    fresh = MagicMock(side_effect=lambda uid: order.append(f"fresh:{uid}"))

    from app.services.intro_egress import _load_field_values
    with patch(f"{MOD}.ensure_user_database_fresh", fresh), \
         patch(f"{MOD}.get_all_intro_facts", facts), \
         patch(f"{MOD}.get_all_intro_full_names", names):
        out = _load_field_values(USER, PROFILE)

    fresh.assert_called_once_with(USER)
    assert order[0] == f"fresh:{USER}", f"freshen must precede fact reads, got {order}"
    assert "read_facts" in order and "read_names" in order
    assert out["full_name"] == "Mehdi Khabazian"


def test_stale_local_plus_newer_r2_yields_the_new_name():
    """The bug reproduction: local user.sqlite has the OLD name; the restore-if-newer
    step pulls R2's newer copy (mutating `state`), so the egress resolves the NEW name.
    Without the freshen (see the control below) it would resolve the stale one."""
    state = {"facts": {"position": "CAM", "team": "West Coast ECNL"}, "full_name": "Jordan Vega"}
    facts, names = _facts_readers(state)

    def restore(uid):
        # Simulate ensure_user_database_fresh pulling R2's newer user.sqlite in.
        state["full_name"] = "Mehdi Khabazian"

    from app.services.intro_egress import _load_field_values
    with patch(f"{MOD}.ensure_user_database_fresh", side_effect=restore), \
         patch(f"{MOD}.get_all_intro_facts", facts), \
         patch(f"{MOD}.get_all_intro_full_names", names):
        out = _load_field_values(USER, PROFILE)

    assert out["full_name"] == "Mehdi Khabazian"  # NOT the stale "Jordan Vega"


def test_control_without_freshen_would_read_stale_name():
    """Proves the freshen is load-bearing: if the restore is a no-op (the OLD behavior),
    the stale local name is what gets returned."""
    state = {"facts": {}, "full_name": "Jordan Vega"}
    facts, names = _facts_readers(state)
    from app.services.intro_egress import _load_field_values
    with patch(f"{MOD}.ensure_user_database_fresh", MagicMock()), \
         patch(f"{MOD}.get_all_intro_facts", facts), \
         patch(f"{MOD}.get_all_intro_full_names", names):
        out = _load_field_values(USER, PROFILE)
    assert out["full_name"] == "Jordan Vega"  # no-op restore => stale, as before the fix


def test_refresh_failure_degrades_to_local_copy_never_raises():
    """R2 unreachable must NOT break the egress (epic decision 9): log + read local."""
    state = {"facts": {"position": "CAM"}, "full_name": "Jordan Vega"}
    facts, names = _facts_readers(state)
    from app.services.intro_egress import _load_field_values
    with patch(f"{MOD}.ensure_user_database_fresh", side_effect=RefreshFailed("R2 down")), \
         patch(f"{MOD}.get_all_intro_facts", facts), \
         patch(f"{MOD}.get_all_intro_full_names", names):
        out = _load_field_values(USER, PROFILE)  # must not raise
    assert out["full_name"] == "Jordan Vega"
    assert out["position"] == "CAM"


@pytest.mark.parametrize("mode", ["burn", "playback"])
def test_both_egress_modes_route_facts_through_the_freshened_seam(mode):
    """Both the download (burn) and playback egresses MUST resolve facts through the
    single freshened _load_field_values seam, so they can never diverge on the name."""
    card_row = {
        "id": 1, "name": "New card 1", "treatment": "gold", "duration": 4.0,
        "shown_fields": [], "text_elements": {}, "subtitle_text": None,
        "image_key": None, "image_cutout_key": None,
        "focal_x": None, "focal_y": None, "zoom": None,
    }
    spy = MagicMock(return_value={"full_name": "Mehdi Khabazian"})
    fake_conn = MagicMock()

    from app.services.intro_egress import resolve_intro_for_reel
    with patch(f"{MOD}.resolve_intro_card", return_value=dict(card_row)), \
         patch(f"{MOD}._load_field_values", spy), \
         patch(f"{MOD}._download_card_image", return_value=None), \
         patch(f"{MOD}._presign_card_image", return_value=None):
        result = resolve_intro_for_reel(
            USER, PROFILE, 1, 12.0, 38, mode=mode, profile_conn=fake_conn,
        )

    assert result is not None
    spy.assert_called_once_with(USER, PROFILE)
