"""T5195 -- intro card library CRUD + shared composition/validation rules.

Drives the router coroutines directly against a real per-profile profile.sqlite
(R2 disabled), the same pattern as test_t5410_poster_selection.py. Maps the QA
matrix onto named tests:

  create/read/update/delete .......... test_create_read / test_update_* / test_delete_*
  surgical update (one field) ........ test_surgical_update_touches_one_field
  set default twice (one survives) ... test_set_default_twice_leaves_one
  delete a card a reel points at ..... test_delete_nulls_referencing_reels
  invalid TextSpec -> 400 ............ test_create_invalid_textspec_400
  invalid treatment -> 400 ........... test_create_invalid_treatment_400
  focal NULL stays NULL .............. test_create_focal_null_stays_null
  focal out of range -> 400 .......... test_create_focal_out_of_range_400
  below-head DB does not 500 ......... test_list_below_head_returns_empty

  T6640 round 2 -- "a profile with any cards always has exactly one default":
  first card auto-defaults ........... test_create_first_card_auto_defaults
  delete default -> promote newest ... test_delete_default_auto_promotes_newest_remaining
  delete non-default -> no change .... test_delete_non_default_card_does_not_touch_default
  delete the last card -> no default . test_delete_last_card_leaves_no_default
  invariant over a create/delete run . test_exactly_one_default_invariant_across_create_and_delete_sequence
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
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _connect(path):
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def _valid_textspec(text="Hero"):
    return {
        "text": text,
        "font": "anton",
        "size": 0.12,
        "color": "#ffffff",
        "position": {"x": 0.5, "y": 0.4},
        "maxWidth": 0.8,
    }


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
        text_elements={"title": _valid_textspec()},
    )
    assert created["id"] > 0
    assert created["name"] == "My Card"
    assert created["shown_fields"] == ["position", "class"]
    # T6640 round 2: the FIRST card for a profile auto-defaults.
    assert created["is_default"] is True
    # No photo -> title-only regardless of 2 facts.
    assert created["composition"] == COMPOSITION_TITLE_ONLY
    assert created["text_elements"]["title"]["text"] == "Hero"

    listed = await list_intro_cards()
    assert len(listed["cards"]) == 1
    assert listed["cards"][0]["id"] == created["id"]


@pytest.mark.asyncio
async def test_create_first_card_auto_defaults(db):
    # T6640 round 2 (user decision): a profile's FIRST card becomes the
    # default automatically -- no user action needed. Every card after that
    # starts non-default; the user promotes one explicitly.
    a = await _create(name="A")
    assert a["is_default"] is True

    b = await _create(name="B")
    assert b["is_default"] is False
    # The first card's default status is untouched by creating a second.
    from app.routers.intro_cards import list_intro_cards
    cards = {c["id"]: c for c in (await list_intro_cards())["cards"]}
    assert cards[a["id"]]["is_default"] is True
    assert sum(1 for c in cards.values() if c["is_default"]) == 1


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
# Default enforcement
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_set_default_twice_leaves_one(db):
    from app.routers.intro_cards import list_intro_cards, set_default_intro_card

    a = await _create(name="A")
    b = await _create(name="B")

    await set_default_intro_card(a["id"])
    await set_default_intro_card(b["id"])  # switching default

    cards = {c["id"]: c for c in (await list_intro_cards())["cards"]}
    assert cards[a["id"]]["is_default"] is False
    assert cards[b["id"]]["is_default"] is True
    # Exactly one default across the profile.
    assert sum(1 for c in cards.values() if c["is_default"]) == 1


@pytest.mark.asyncio
async def test_delete_default_auto_promotes_newest_remaining(db):
    # T6640 round 2 amendment 2 (user decision): a profile with any cards
    # ALWAYS has exactly one default. Deleting the default while others remain
    # auto-promotes the NEWEST remaining card, in the SAME transaction as the
    # delete -- never a window with cards but no default.
    from app.routers.intro_cards import delete_intro_card, list_intro_cards

    a = await _create(name="A")  # auto-default (first card)
    b = await _create(name="B")  # newest so far
    c = await _create(name="C")  # newest overall
    assert a["is_default"] is True

    result = await delete_intro_card(a["id"])
    assert result["promoted_default_id"] == c["id"]  # newest remaining, not b

    cards = {row["id"]: row for row in (await list_intro_cards())["cards"]}
    assert cards[c["id"]]["is_default"] is True
    assert cards[b["id"]]["is_default"] is False
    assert sum(1 for row in cards.values() if row["is_default"]) == 1
    assert set(cards) == {b["id"], c["id"]}


@pytest.mark.asyncio
async def test_delete_non_default_card_does_not_touch_default(db):
    from app.routers.intro_cards import delete_intro_card, list_intro_cards

    a = await _create(name="A")  # auto-default
    b = await _create(name="B")

    result = await delete_intro_card(b["id"])
    assert result["promoted_default_id"] is None  # nothing to promote

    cards = (await list_intro_cards())["cards"]
    assert len(cards) == 1
    assert cards[0]["id"] == a["id"]
    assert cards[0]["is_default"] is True


@pytest.mark.asyncio
async def test_delete_last_card_leaves_no_default(db):
    # The ONLY state where a profile with cards can have zero defaults is
    # having ZERO cards -- deleting the very last (also the default) card.
    from app.routers.intro_cards import delete_intro_card, list_intro_cards

    a = await _create(name="A")  # auto-default, the only card
    result = await delete_intro_card(a["id"])
    assert result["promoted_default_id"] is None  # nothing left to promote

    cards = (await list_intro_cards())["cards"]
    assert cards == []


@pytest.mark.asyncio
async def test_exactly_one_default_invariant_across_create_and_delete_sequence(db):
    # The invariant, exercised directly: whenever a profile has >=1 card,
    # EXACTLY one is_default=1. Never zero (while cards exist), never two.
    from app.routers.intro_cards import delete_intro_card, list_intro_cards

    def default_count(cards):
        return sum(1 for c in cards if c["is_default"])

    a = await _create(name="A")
    assert default_count((await list_intro_cards())["cards"]) == 1  # first card

    b = await _create(name="B")
    c = await _create(name="C")
    assert default_count((await list_intro_cards())["cards"]) == 1  # still one

    await delete_intro_card(b["id"])  # delete a NON-default card
    assert default_count((await list_intro_cards())["cards"]) == 1

    await delete_intro_card(a["id"])  # delete the DEFAULT, one card (c) remains
    cards = (await list_intro_cards())["cards"]
    assert default_count(cards) == 1
    assert cards[0]["id"] == c["id"] and cards[0]["is_default"] is True

    await delete_intro_card(c["id"])  # delete the LAST card
    cards = (await list_intro_cards())["cards"]
    assert cards == []  # zero cards -> zero defaults is the only valid empty state


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
    assert rows["r1.mp4"] is None   # detached -> inherit default
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
async def test_create_invalid_textspec_400(db):
    bad = _valid_textspec()
    bad["font"] = "comic-sans"  # unknown FontKey
    with pytest.raises(HTTPException) as exc:
        await _create(text_elements={"title": bad})
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


@pytest.mark.asyncio
async def test_update_invalid_textspec_400(db):
    from app.routers.intro_cards import UpdateIntroCardRequest, update_intro_card

    c = await _create()
    bad = _valid_textspec()
    bad["size"] = 5.0  # out of range (> 0.5)
    with pytest.raises(HTTPException) as exc:
        await update_intro_card(c["id"], UpdateIntroCardRequest(text_elements={"t": bad}))
    assert exc.value.status_code == 400


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
