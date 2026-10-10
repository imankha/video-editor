"""T12300: Guidance is on by default and a stored off value always wins.

Drives the real settings router (GET/PUT) over an in-memory stand-in for the
user_settings key/value rows (`get_all_preferences` / `set_preferences_bulk`),
so the merge-with-defaults logic is exercised exactly as served. The SQLite
INSERT OR REPLACE layer and R2 sync are covered elsewhere and are not proven here.
"""
import asyncio
from unittest.mock import patch

from app.routers import settings as settings_router
from app.routers.settings import SettingsUpdate


class _Rows:
    """Stands in for user_settings pref.* rows; counts writes."""

    def __init__(self, initial=None):
        self.rows = dict(initial or {})
        self.writes = []

    def get_all(self):
        return dict(self.rows)

    def set_bulk(self, prefs=None, user_id=None):
        self.writes.append(dict(prefs or {}))
        self.rows.update(prefs or {})


def _run(coro):
    return asyncio.run(coro)


def _routes(rows):
    return (
        patch.object(settings_router, "get_all_preferences", rows.get_all),
        patch.object(settings_router, "set_preferences_bulk", rows.set_bulk),
    )


def _get(rows):
    a, b = _routes(rows)
    with a, b:
        return _run(settings_router.get_settings())


def _put(rows, **sections):
    a, b = _routes(rows)
    with a, b:
        return _run(settings_router.update_settings(SettingsUpdate(**sections)))


def test_new_account_starts_with_guidance_on_and_get_writes_nothing():
    rows = _Rows()
    assert _get(rows)["guidance"]["coachEnabled"] is True
    assert rows.writes == []


def test_off_survives_every_later_load():
    rows = _Rows()
    assert _put(rows, guidance={"coachEnabled": False})["guidance"]["coachEnabled"] is False
    for _ in range(3):  # reload, new session, second browser: each is a fresh GET
        assert _get(rows)["guidance"]["coachEnabled"] is False
    assert rows.rows == {"coachEnabled": "false"}


def test_loading_settings_never_overwrites_a_stored_off():
    rows = _Rows({"coachEnabled": "false"})
    _get(rows)
    _get(rows)
    assert rows.writes == []
    assert rows.rows["coachEnabled"] == "false"


def test_unrelated_setting_updates_leave_guidance_alone():
    rows = _Rows({"coachEnabled": "false"})
    out = _put(rows, framing={"includeAudio": False}, ranking={"rankSoundEnabled": False})
    assert out["guidance"]["coachEnabled"] is False
    assert all("coachEnabled" not in w for w in rows.writes)


def test_toggle_writes_only_the_changed_field():
    rows = _Rows()
    _put(rows, guidance={"coachEnabled": False})
    _put(rows, guidance={"coachEnabled": True})
    assert rows.writes == [{"coachEnabled": "false"}, {"coachEnabled": "true"}]
    assert _get(rows)["guidance"]["coachEnabled"] is True
