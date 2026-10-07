"""Guidance must survive the real settings serialization boundary."""
from app.routers.settings import SettingsUpdate, _flatten_updates, _to_nested


def test_guidance_defaults_on():
    assert _to_nested({})["guidance"]["coachEnabled"] is True


def test_guidance_false_survives_request_and_storage_round_trip():
    update = SettingsUpdate(guidance={"coachEnabled": False})
    stored = _flatten_updates(update.model_dump(exclude_none=True))
    assert stored == {"coachEnabled": "false"}
    assert _to_nested(stored)["guidance"]["coachEnabled"] is False
