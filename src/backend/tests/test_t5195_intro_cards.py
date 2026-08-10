"""T5195 -- intro card library CRUD + shared composition/validation rules.

Drives the router coroutines directly against a real per-profile profile.sqlite
(R2 disabled), the same pattern as test_t5410_poster_selection.py. Maps the QA
matrix onto named tests:

  create/read/update/delete .......... test_create_read / test_update_* / test_delete_*
  surgical update (one field) ........ test_surgical_update_touches_one_field
  set default twice (one survives) ... test_set_default_twice_leaves_one
  delete a card a reel points at ..... test_delete_nulls_referencing_reels
  invalid treatment -> 400 ........... test_create_invalid_treatment_400
  focal NULL stays NULL .............. test_create_focal_null_stays_null
  focal out of range -> 400 .......... test_create_focal_out_of_range_400
  below-head DB does not 500 ......... test_list_below_head_returns_empty

  T6680 -- the T6640 "exactly one default" invariant is RETIRED (there is no
  profile default to maintain; is_default is dead schema data, kept but
  unread). Superseded the section below this docstring used to point to:
  first card no longer auto-defaults . test_create_first_card_does_not_default
  no set-default endpoint remains .... test_no_set_default_symbol
"""

import sqlite3
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.services.intro_cards import (
    COMPOSITION_BROADCAST,
    COMPOSITION_HERO,
    COMPOSITION_RECRUITING,
    COMPOSITION_TITLE_ONLY,
    derive_composition,
)

USER_ID = "test-user-t5195"
PROFILE_ID = "t5195prof"


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
        from app.services.user_db import set_intro_consent
        ensure_database()
        # T5230: card creation is now gated on a parental-consent attestation.
        # These tests exercise card CRUD, not the consent gate, so record consent
        # up front (the gate itself is covered by test_t5230_intro_compliance.py).
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


# ---------------------------------------------------------------------------
# Composition derivation (the shared rule -- pure)
# ---------------------------------------------------------------------------

def test_derive_composition_matrix():
    assert derive_composition(False, []) == COMPOSITION_TITLE_ONLY
    assert derive_composition(False, ["position"]) == COMPOSITION_TITLE_ONLY  # no photo
    assert derive_composition(True, []) == COMPOSITION_TITLE_ONLY             # photo, 0 facts
    assert derive_composition(True, ["position"]) == COMPOSITION_HERO
    assert derive_composition(True, ["position", "class"]) == COMPOSITION_BROADCAST
    assert derive_composition(True, ["position", "class", "team"]) == COMPOSITION_RECRUITING


# ---------------------------------------------------------------------------
# Create / read
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_read(db):
    from app.routers.intro_cards import list_intro_cards

    created = await _create(
        name="My Card", shown_fields=["position", "class"], title_text="Big Game",
    )
    assert created["id"] > 0
    assert created["name"] == "My Card"
    assert created["shown_fields"] == ["position", "class"]
    # T6680: is_default is retired end-to-end -- not in the serialized response.
    assert "is_default" not in created
    # No photo -> title-only regardless of 2 facts.
    assert created["composition"] == COMPOSITION_TITLE_ONLY

    listed = await list_intro_cards()
    assert len(listed["cards"]) == 1
    assert listed["cards"][0]["id"] == created["id"]


@pytest.mark.asyncio
async def test_create_with_photo_derives_hero(db):
    c = await _create(image_key="dummy", shown_fields=["position"])
    assert c["composition"] == COMPOSITION_HERO


# ---------------------------------------------------------------------------
# Update (surgical + NULL discipline)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_surgical_update_touches_one_field(db):
    from app.routers.intro_cards import UpdateIntroCardRequest, update_intro_card

    c = await _create(name="Old", title_text="keep me", shown_fields=["team"])
    updated = await update_intro_card(c["id"], UpdateIntroCardRequest(name="New"))

    assert updated["name"] == "New"
    # Everything else untouched by a name-only PATCH.
    assert updated["title_text"] == "keep me"
    assert updated["shown_fields"] == ["team"]


@pytest.mark.asyncio
async def test_update_focal_explicit_null_vs_unset(db):
    from app.routers.intro_cards import UpdateIntroCardRequest, update_intro_card

    c = await _create(focal_x=0.5, focal_y=0.5, zoom=2.0)
    assert c["focal_x"] == 0.5

    # Explicit null clears focal_x to inherit; an unset focal_y is left untouched.
    updated = await update_intro_card(
        c["id"], UpdateIntroCardRequest(focal_x=None)
    )
    assert "focal_x" in UpdateIntroCardRequest(focal_x=None).model_fields_set
    assert updated["focal_x"] is None      # explicit null -> inherit
    assert updated["focal_y"] == 0.5       # untouched
    assert updated["zoom"] == 2.0          # untouched


@pytest.mark.asyncio
async def test_update_unknown_card_404(db):
    from app.routers.intro_cards import UpdateIntroCardRequest, update_intro_card

    with pytest.raises(HTTPException) as exc:
        await update_intro_card(9999, UpdateIntroCardRequest(name="x"))
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_update_no_fields_400(db):
    from app.routers.intro_cards import UpdateIntroCardRequest, update_intro_card

    c = await _create()
    with pytest.raises(HTTPException) as exc:
        await update_intro_card(c["id"], UpdateIntroCardRequest())
    assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# is_default retirement (T6680) -- supersedes the T6640 "exactly one default"
# invariant tests that used to live here (set-default, delete-promotes-newest,
# delete-non-default-untouched, the full create/delete walkthrough). None of
# that machinery exists anymore: there is no profile default to maintain, so
# there is nothing left to promote, switch, or count. See also
# test_t5215_intro_attachment.py::TestIsDefaultRetirementT6680 for the
# cross-cutting (create/load_profile_cards) assertions; these two are the
# T5195-local regression coverage for this file's own CRUD surface.
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_first_card_does_not_default(db):
    """T6680 inversion of the retired test_create_first_card_auto_defaults:
    a profile's first card no longer becomes a default -- there is no default
    concept left for it to become."""
    a = await _create(name="A")
    b = await _create(name="B")
    assert "is_default" not in a
    assert "is_default" not in b

    from app.routers.intro_cards import list_intro_cards
    cards = {c["id"]: c for c in (await list_intro_cards())["cards"]}
    assert "is_default" not in cards[a["id"]]
    assert "is_default" not in cards[b["id"]]


def test_no_set_default_symbol():
    """T6680 Decision 4: the set-default gesture is removed, not merely
    unreachable -- the symbol itself must be gone from the router module."""
    import app.routers.intro_cards as intro_cards_router
    assert not hasattr(intro_cards_router, "set_default_intro_card"), (
        "set_default_intro_card must be fully removed -- there is no "
        "default to set"
    )


@pytest.mark.asyncio
async def test_delete_does_not_report_promotion(db):
    """T6680: the delete response no longer carries promoted_default_id --
    there is nothing to promote."""
    from app.routers.intro_cards import delete_intro_card

    a = await _create(name="A")
    b = await _create(name="B")

    result = await delete_intro_card(a["id"])
    assert result == {"success": True}

    from app.routers.intro_cards import list_intro_cards
    cards = (await list_intro_cards())["cards"]
    assert len(cards) == 1
    assert cards[0]["id"] == b["id"]


# ---------------------------------------------------------------------------
# Delete + referencing reels
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_nulls_referencing_reels(db):
    from app.routers.intro_cards import delete_intro_card

    c = await _create(name="Referenced")
    # Point two reels at the card; a third opts out (0) and must NOT be touched.
    conn = _connect(db)
    conn.execute(
        "INSERT INTO final_videos (filename, version, intro_card_id) VALUES ('r1.mp4', 1, ?)",
        (c["id"],),
    )
    conn.execute(
        "INSERT INTO final_videos (filename, version, intro_card_id) VALUES ('r2.mp4', 1, ?)",
        (c["id"],),
    )
    conn.execute(
        "INSERT INTO final_videos (filename, version, intro_card_id) VALUES ('optout.mp4', 1, 0)"
    )
    conn.commit()
    conn.close()

    await delete_intro_card(c["id"])

    conn = _connect(db)
    rows = {
        r["filename"]: r["intro_card_id"]
        for r in conn.execute("SELECT filename, intro_card_id FROM final_videos").fetchall()
    }
    conn.close()
    assert rows["r1.mp4"] is None   # detached -> no intro (T6680: no default to inherit)
    assert rows["r2.mp4"] is None
    assert rows["optout.mp4"] == 0  # opt-out reel left alone (0 != referencing id)


@pytest.mark.asyncio
async def test_delete_unknown_card_404(db):
    from app.routers.intro_cards import delete_intro_card

    with pytest.raises(HTTPException) as exc:
        await delete_intro_card(4242)
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# Validation -> 400
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_invalid_treatment_400(db):
    with pytest.raises(HTTPException) as exc:
        await _create(treatment="neon")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_create_invalid_shown_field_400(db):
    with pytest.raises(HTTPException) as exc:
        await _create(shown_fields=["height"])  # not a known fact
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_create_focal_out_of_range_400(db):
    with pytest.raises(HTTPException) as exc:
        await _create(focal_x=1.5)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_create_zoom_out_of_range_400(db):
    with pytest.raises(HTTPException) as exc:
        await _create(zoom=99.0)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_create_negative_duration_400(db):
    # A negative/zero duration is invalid internal data -> fail loudly, not stored.
    with pytest.raises(HTTPException) as exc:
        await _create(duration=-1.0)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_update_absurd_duration_400(db):
    from app.routers.intro_cards import UpdateIntroCardRequest, update_intro_card

    c = await _create()
    with pytest.raises(HTTPException) as exc:
        await update_intro_card(c["id"], UpdateIntroCardRequest(duration=9999.0))
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_create_focal_null_stays_null(db):
    # NULL focal is valid = inherit; it must persist as NULL, not a default value.
    c = await _create(focal_x=None, focal_y=None, zoom=None)
    assert c["focal_x"] is None
    assert c["focal_y"] is None
    assert c["zoom"] is None

    conn = _connect(db)
    row = conn.execute(
        "SELECT focal_x, focal_y, zoom FROM intro_cards WHERE id = ?", (c["id"],)
    ).fetchone()
    conn.close()
    assert row["focal_x"] is None and row["focal_y"] is None and row["zoom"] is None


# ---------------------------------------------------------------------------
# Migration window: below-head DB must not 500
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_below_head_returns_empty(db):
    from app.routers.intro_cards import list_intro_cards

    # Simulate a below-head profile DB where v034 has not run: drop the table.
    conn = _connect(db)
    conn.execute("DROP TABLE intro_cards")
    conn.commit()
    conn.close()

    result = await list_intro_cards()  # must not raise OperationalError / 500
    assert result == {"cards": []}
