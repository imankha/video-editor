"""T6650 -- shared-ownership of an intro image R2 object.

One R2 object can be referenced by the PROFILE (`user.sqlite` intro_photo_key)
AND by any number of intro CARDS (`profile.sqlite` intro_cards.image_key, seeded
from the profile key on create/duplicate). A delete triggered by ONE owner must
never destroy the object while another owner still points at it -- the bug this
task fixes (a card delete silently blanking the profile photo, and its mirror).

Drives the router coroutines directly against a real per-profile profile.sqlite
(R2 disabled), the same pattern as test_t5195_intro_cards.py. The R2 delete
primitive (`delete_intro_image`) is spied via a Mock so we assert precisely
whether the object WOULD be destroyed, independent of R2 being disabled.

  card delete, key shared with profile ...... test_card_delete_keeps_object_shared_with_profile
  card delete, exclusive key ................ test_card_delete_removes_exclusive_object
  duplicated cards share one key ............ test_duplicated_cards_survive_each_others_deletion
  profile remove, key referenced by a card .. test_profile_remove_keeps_object_referenced_by_card
  profile remove, exclusive key ............. test_profile_remove_deletes_exclusive_object
  profile replace, previous referenced ...... test_profile_replace_keeps_previous_object_referenced_by_card
  T5230 purge stays unconditional ........... test_purge_deletes_object_even_when_card_references_it
"""

import sqlite3
from unittest.mock import Mock, patch

import pytest

USER_ID = "test-user-t6650"
PROFILE_ID = "t6650prof"


@pytest.fixture()
def db(tmp_path):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.storage.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        from app.services.user_db import create_profile, set_intro_consent
        ensure_database()
        # Owned profile (intro endpoints 404 an unowned profile) + consent
        # (card creation is gated on a parental-consent attestation, T5230).
        create_profile(USER_ID, PROFILE_ID, "Test", "#fff", is_default=True)
        set_intro_consent(USER_ID, PROFILE_ID, "2026-08-08T00:00:00")
        yield get_database_path()


def _connect(path):
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


async def _create(**overrides):
    from app.routers.intro_cards import CreateIntroCardRequest, create_intro_card

    payload = {"name": "Card", "treatment": "gold"}
    payload.update(overrides)
    return await create_intro_card(CreateIntroCardRequest(**payload))


# A key shaped like a real per-profile intro object (unused by the Mock spy, but
# realistic and unambiguous across tests).
SHARED_KEY = f"dev/users/{USER_ID}/profiles/{PROFILE_ID}/intro/aaaaaaaa.png"
EXCLUSIVE_KEY = f"dev/users/{USER_ID}/profiles/{PROFILE_ID}/intro/bbbbbbbb.png"


# ---------------------------------------------------------------------------
# Card delete
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_card_delete_keeps_object_shared_with_profile(db):
    """Deleting a card whose image_key == the profile's intro_photo_key must NOT
    destroy the R2 object (the core bug)."""
    from app.routers.intro_cards import delete_intro_card
    from app.services.user_db import set_intro_photo_key

    set_intro_photo_key(USER_ID, PROFILE_ID, SHARED_KEY)
    card = await _create(image_key=SHARED_KEY)

    with patch("app.routers.intro_cards.delete_intro_image") as spy:
        await delete_intro_card(card["id"])

    spy.assert_not_called()


@pytest.mark.asyncio
async def test_card_delete_removes_exclusive_object(db):
    """Deleting a card whose image nothing else references still removes the
    object -- no orphan growth."""
    from app.routers.intro_cards import delete_intro_card

    card = await _create(image_key=EXCLUSIVE_KEY)

    with patch("app.routers.intro_cards.delete_intro_image") as spy:
        await delete_intro_card(card["id"])

    spy.assert_called_once_with(USER_ID, PROFILE_ID, EXCLUSIVE_KEY)


@pytest.mark.asyncio
async def test_duplicated_cards_survive_each_others_deletion(db):
    """Two cards sharing one image_key each survive the other's deletion; the
    object is only removed once the LAST referrer is gone."""
    from app.routers.intro_cards import delete_intro_card

    a = await _create(name="A", image_key=SHARED_KEY)
    b = await _create(name="B", image_key=SHARED_KEY)

    with patch("app.routers.intro_cards.delete_intro_image") as spy:
        await delete_intro_card(a["id"])
    spy.assert_not_called()  # b still references it

    with patch("app.routers.intro_cards.delete_intro_image") as spy:
        await delete_intro_card(b["id"])
    spy.assert_called_once_with(USER_ID, PROFILE_ID, SHARED_KEY)  # now exclusive


# ---------------------------------------------------------------------------
# Profile photo remove / replace (the mirror case)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_profile_remove_keeps_object_referenced_by_card(db):
    """Removing the PROFILE photo must not destroy an object a card references;
    the profile key is still cleared."""
    from app.routers.profiles import DeleteIntroImageRequest, remove_intro_image
    from app.services.user_db import get_intro_photo_key, set_intro_photo_key

    set_intro_photo_key(USER_ID, PROFILE_ID, SHARED_KEY)
    await _create(image_key=SHARED_KEY)

    with patch("app.routers.profiles.delete_intro_image") as spy:
        result = await remove_intro_image(PROFILE_ID, DeleteIntroImageRequest(key=SHARED_KEY))

    assert result == {"success": True}
    spy.assert_not_called()
    assert get_intro_photo_key(USER_ID, PROFILE_ID) is None  # profile reference cleared


@pytest.mark.asyncio
async def test_profile_remove_deletes_exclusive_object(db):
    """Removing the profile photo when no card references it still destroys the
    object (mirror of the exclusive card-delete case)."""
    from app.routers.profiles import DeleteIntroImageRequest, remove_intro_image
    from app.services.user_db import get_intro_photo_key, set_intro_photo_key

    set_intro_photo_key(USER_ID, PROFILE_ID, EXCLUSIVE_KEY)

    with patch("app.routers.profiles.delete_intro_image", return_value=True) as spy:
        result = await remove_intro_image(PROFILE_ID, DeleteIntroImageRequest(key=EXCLUSIVE_KEY))

    assert result == {"success": True}
    spy.assert_called_once_with(USER_ID, PROFILE_ID, EXCLUSIVE_KEY)
    assert get_intro_photo_key(USER_ID, PROFILE_ID) is None


@pytest.mark.asyncio
async def test_profile_replace_keeps_previous_object_referenced_by_card(db):
    """Replacing the profile photo must not destroy the PREVIOUS object while a
    card still references it (the staleness half's mirror)."""
    from app.routers.profiles import upload_intro_image
    from app.services.user_db import get_intro_photo_key, set_intro_photo_key

    new_key = f"dev/users/{USER_ID}/profiles/{PROFILE_ID}/intro/cccccccc.png"
    set_intro_photo_key(USER_ID, PROFILE_ID, SHARED_KEY)
    await _create(image_key=SHARED_KEY)

    fake_upload = Mock()

    async def _read():
        return b"rawbytes"
    fake_upload.read = _read

    with patch(
        "app.routers.profiles.store_intro_image",
        return_value={"key": new_key, "previewUrl": "http://x", "ext": "png"},
    ), patch("app.routers.profiles.delete_intro_image") as spy:
        result = await upload_intro_image(PROFILE_ID, fake_upload)

    assert result["key"] == new_key
    spy.assert_not_called()  # previous SHARED_KEY kept alive for the card
    assert get_intro_photo_key(USER_ID, PROFILE_ID) == new_key


# ---------------------------------------------------------------------------
# T5230 compliance purge stays unconditional (regression guard)
# ---------------------------------------------------------------------------

def test_purge_deletes_object_even_when_card_references_it(db):
    """The account-delete purge (`delete_user_r2_data`, whole-prefix) removes the
    intro object regardless of any card reference -- the reference check must NOT
    weaken the compliance purge (it is a separate code path)."""
    from app import storage

    intro_key = f"{storage.APP_ENV}/users/{USER_ID}/profiles/{PROFILE_ID}/intro/deadbeef.jpg"
    deleted_keys = []

    class _Paginator:
        def paginate(self, **kwargs):
            return iter([{"Contents": [{"Key": intro_key}]}])

    class _FakeClient:
        def get_paginator(self, name):
            return _Paginator()

        def delete_objects(self, **kwargs):
            deleted_keys.extend(o["Key"] for o in kwargs["Delete"]["Objects"])
            return {}

    with patch("app.storage.R2_ENABLED", True), \
         patch("app.storage.get_r2_client", lambda: _FakeClient()):
        storage.delete_user_r2_data(USER_ID)

    assert intro_key in deleted_keys
