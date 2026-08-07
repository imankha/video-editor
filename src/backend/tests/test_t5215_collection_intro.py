"""
T5215 round 2 -- a collection's OWN attached intro (distinct from a collection
SHARE's frozen-at-creation choice, covered by test_t5215_intro_attachment.py).

Resolution order (stated explicitly, see services/intro_cards.py's module
docstring above collection_intro_settings_key for the full rationale):
  - The collection's OWN resolved intro governs collection playback; per-
    member reel attachments are not consulted in that context.
  - The duration gate on the inherit-the-default path uses the collection's
    LIVE TOTAL duration (sum of current members), against the SAME per-
    profile intro_min_duration_seconds a reel already uses.
  - Storage reuses the pre-existing (v009) collection_settings sparse KV
    table -- NO migration needed for this feature (verified: v038 is T6640's,
    v039 was free, but this task doesn't need either).
"""

import sqlite3
from unittest.mock import patch

import pytest

from app.services.intro_cards import (
    collection_intro_settings_key,
    get_collection_intro_card_id,
    set_collection_intro_card_id,
)

USER_ID = "t5215-collection-user"
PROFILE_ID = "t5215collprof"


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
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _connect(path):
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_card(db_path, name="Card", is_default=0):
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO intro_cards (name, shown_fields, treatment, is_default) "
        "VALUES (?, '[]', 'gold', ?)",
        (name, is_default),
    )
    card_id = cur.lastrowid
    conn.commit()
    conn.close()
    return card_id


def _seed_published_final(db_path, *, game_ids=None, duration=30.0, aspect_ratio="9:16",
                           clip_count=1, tags=None):
    from app.utils.encoding import encode_data
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', ?)", (aspect_ratio,))
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, "
        "duration, aspect_ratio, published_at, clip_count, game_ids, tags) "
        "VALUES (?, ?, 1, 'custom_project', 'Reel', ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)",
        (project_id, f"f{project_id}.mp4", duration, aspect_ratio, clip_count,
         encode_data(game_ids) if game_ids is not None else None,
         encode_data(tags) if tags else None),
    )
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, project_id))
    conn.commit()
    conn.close()
    return fv_id


# ===========================================================================
# 1. Canonical key builder
# ===========================================================================

class TestCollectionIntroSettingsKey:
    def test_game_scope(self):
        assert collection_intro_settings_key("game", game_id=12, aspect_ratio="9:16") == "intro:game:12:9:16"

    def test_game_scope_requires_game_id(self):
        with pytest.raises(ValueError):
            collection_intro_settings_key("game", game_id=None, aspect_ratio="9:16")

    def test_mixes_scope(self):
        assert collection_intro_settings_key("mixes", aspect_ratio="16:9") == "intro:mixes:16:9"

    def test_all_scope_no_tags(self):
        assert collection_intro_settings_key("all", aspect_ratio="9:16") == "intro:all:9:16"

    def test_all_scope_with_tags_sorted(self):
        # Tag order in the request must not fragment identity.
        key_a = collection_intro_settings_key("all", tags=["Goal", "Assist"], aspect_ratio="9:16")
        key_b = collection_intro_settings_key("all", tags=["Assist", "Goal"], aspect_ratio="9:16")
        assert key_a == key_b == "intro:tags:Assist,Goal:9:16"

    def test_unknown_scope_raises(self):
        with pytest.raises(ValueError):
            collection_intro_settings_key("bogus", aspect_ratio="9:16")

    def test_ratio_is_part_of_identity(self):
        # A game's 9:16 and 16:9 buckets are different member sets/collections.
        a = collection_intro_settings_key("game", game_id=1, aspect_ratio="9:16")
        b = collection_intro_settings_key("game", game_id=1, aspect_ratio="16:9")
        assert a != b


# ===========================================================================
# 2. Storage round-trip (reuses collection_settings, no migration)
# ===========================================================================

class TestCollectionIntroStorage:
    def test_collection_settings_table_exists_unguarded(self, db):
        """Predates the v023 floor (v009) -- reads/writes never need a
        column_exists-style guard, unlike every v024+ addition in this task."""
        conn = _connect(db)
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='collection_settings'"
        ).fetchone()
        conn.close()
        assert row is not None

    def test_absent_row_is_none_inherit(self, db):
        conn = _connect(db)
        key = collection_intro_settings_key("mixes", aspect_ratio="9:16")
        assert get_collection_intro_card_id(conn.cursor(), key) is None
        conn.close()

    def test_set_explicit_then_read_back(self, db):
        card_id = _seed_card(db, "Hero")
        conn = _connect(db)
        cur = conn.cursor()
        key = collection_intro_settings_key("game", game_id=7, aspect_ratio="9:16")
        set_collection_intro_card_id(cur, key, card_id)
        conn.commit()
        assert get_collection_intro_card_id(conn.cursor(), key) == card_id
        conn.close()

    def test_set_zero_then_read_back(self, db):
        conn = _connect(db)
        cur = conn.cursor()
        key = collection_intro_settings_key("mixes", aspect_ratio="16:9")
        set_collection_intro_card_id(cur, key, 0)
        conn.commit()
        assert get_collection_intro_card_id(conn.cursor(), key) == 0
        conn.close()

    def test_set_none_deletes_row_restores_inherit(self, db):
        card_id = _seed_card(db, "Hero")
        conn = _connect(db)
        cur = conn.cursor()
        key = collection_intro_settings_key("mixes", aspect_ratio="9:16")
        set_collection_intro_card_id(cur, key, card_id)
        conn.commit()
        assert get_collection_intro_card_id(conn.cursor(), key) == card_id

        cur2 = conn.cursor()
        set_collection_intro_card_id(cur2, key, None)
        conn.commit()
        assert get_collection_intro_card_id(conn.cursor(), key) is None
        row = conn.execute("SELECT 1 FROM collection_settings WHERE key = ?", (key,)).fetchone()
        assert row is None, "restoring inherit must DELETE the row, not store a sentinel"
        conn.close()

    def test_upsert_overwrites_existing_value(self, db):
        card_a = _seed_card(db, "A")
        card_b = _seed_card(db, "B")
        conn = _connect(db)
        key = collection_intro_settings_key("mixes", aspect_ratio="9:16")
        cur = conn.cursor()
        set_collection_intro_card_id(cur, key, card_a)
        conn.commit()
        cur2 = conn.cursor()
        set_collection_intro_card_id(cur2, key, card_b)
        conn.commit()
        assert get_collection_intro_card_id(conn.cursor(), key) == card_b
        conn.close()

    def test_two_ratios_of_the_same_game_are_independent(self, db):
        card_a = _seed_card(db, "Portrait card")
        conn = _connect(db)
        key_916 = collection_intro_settings_key("game", game_id=3, aspect_ratio="9:16")
        key_169 = collection_intro_settings_key("game", game_id=3, aspect_ratio="16:9")
        cur = conn.cursor()
        set_collection_intro_card_id(cur, key_916, card_a)
        conn.commit()
        assert get_collection_intro_card_id(conn.cursor(), key_916) == card_a
        assert get_collection_intro_card_id(conn.cursor(), key_169) is None
        conn.close()


# ===========================================================================
# 3. API endpoints: reuse resolve_intro_card_id, consent gate, dangling id
# ===========================================================================

class TestCollectionIntroEndpoints:
    @pytest.mark.asyncio
    async def test_get_resolves_explicit_id_at_any_duration(self, db):
        from app.routers.collections import get_collection_intro
        card_id = _seed_card(db, "Hero")
        # Short total duration -- an EXPLICIT collection pick is never gated.
        _seed_published_final(db, game_ids=[9], duration=2.0, clip_count=1)

        conn = _connect(db)
        key = collection_intro_settings_key("game", game_id=9, aspect_ratio="9:16")
        cur = conn.cursor()
        set_collection_intro_card_id(cur, key, card_id)
        conn.commit()
        conn.close()

        resp = await get_collection_intro(scope_type="game", aspect_ratio="9:16", game_id=9)
        assert resp["intro_card_id"] == card_id
        assert resp["intro_card_name"] == "Hero"

    @pytest.mark.asyncio
    async def test_get_zero_never_resolves(self, db):
        from app.routers.collections import get_collection_intro
        _seed_card(db, "Hero", is_default=1)
        _seed_published_final(db, game_ids=[9], duration=999.0, clip_count=1)

        conn = _connect(db)
        key = collection_intro_settings_key("game", game_id=9, aspect_ratio="9:16")
        cur = conn.cursor()
        set_collection_intro_card_id(cur, key, 0)
        conn.commit()
        conn.close()

        resp = await get_collection_intro(scope_type="game", aspect_ratio="9:16", game_id=9)
        assert resp["intro_card_id"] == 0
        assert resp["intro_card_name"] is None

    @pytest.mark.asyncio
    async def test_get_inherit_gated_by_live_total_duration(self, db):
        """No explicit collection pick (absent row = inherit); the default
        resolves ONLY when the collection's LIVE TOTAL duration (summed
        across its current members) clears the threshold -- reusing
        resolve_intro_card_id, not a second resolution path."""
        from app.routers.collections import get_collection_intro
        _seed_card(db, "Default Card", is_default=1)
        # Two short members summing ABOVE the 20s default threshold.
        _seed_published_final(db, game_ids=[9], duration=12.0, clip_count=1)
        _seed_published_final(db, game_ids=[9], duration=12.0, clip_count=1)

        resp = await get_collection_intro(scope_type="game", aspect_ratio="9:16", game_id=9)
        assert resp["intro_card_id"] is None  # raw stored value: absent row
        assert resp["intro_card_name"] == "Default Card"  # but it resolves (24s >= 20s)

    @pytest.mark.asyncio
    async def test_get_inherit_below_threshold_resolves_to_none(self, db):
        from app.routers.collections import get_collection_intro
        _seed_card(db, "Default Card", is_default=1)
        # One short member well under the 20s default threshold.
        _seed_published_final(db, game_ids=[9], duration=5.0, clip_count=1)

        resp = await get_collection_intro(scope_type="game", aspect_ratio="9:16", game_id=9)
        assert resp["intro_card_id"] is None
        assert resp["intro_card_name"] is None

    @pytest.mark.asyncio
    async def test_patch_requires_consent_for_explicit_id(self, db):
        from fastapi import HTTPException

        from app.routers.collections import UpdateCollectionIntroRequest, set_collection_intro
        card_id = _seed_card(db, "Hero")

        with pytest.raises(HTTPException) as exc:
            await set_collection_intro(
                UpdateCollectionIntroRequest(intro_card_id=card_id),
                scope_type="mixes", aspect_ratio="9:16",
            )
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_patch_detach_never_requires_consent(self, db):
        from app.routers.collections import UpdateCollectionIntroRequest, set_collection_intro
        resp = await set_collection_intro(
            UpdateCollectionIntroRequest(intro_card_id=0),
            scope_type="mixes", aspect_ratio="9:16",
        )
        assert resp["success"] is True

    @pytest.mark.asyncio
    async def test_patch_dangling_id_rejected_404(self, db):
        from fastapi import HTTPException

        from app.routers.collections import UpdateCollectionIntroRequest, set_collection_intro
        from app.services.user_db import set_intro_consent
        set_intro_consent(USER_ID, PROFILE_ID, "2026-08-06T00:00:00Z")

        with pytest.raises(HTTPException) as exc:
            await set_collection_intro(
                UpdateCollectionIntroRequest(intro_card_id=99999),
                scope_type="mixes", aspect_ratio="9:16",
            )
        assert exc.value.status_code == 404

        conn = _connect(db)
        key = collection_intro_settings_key("mixes", aspect_ratio="9:16")
        assert get_collection_intro_card_id(conn.cursor(), key) is None, \
            "the dangling id must never reach storage"
        conn.close()

    @pytest.mark.asyncio
    async def test_patch_then_get_round_trips(self, db):
        from app.routers.collections import (
            UpdateCollectionIntroRequest,
            get_collection_intro,
            set_collection_intro,
        )
        from app.services.user_db import set_intro_consent
        set_intro_consent(USER_ID, PROFILE_ID, "2026-08-06T00:00:00Z")
        card_id = _seed_card(db, "Hero")

        patch_resp = await set_collection_intro(
            UpdateCollectionIntroRequest(intro_card_id=card_id),
            scope_type="all", aspect_ratio="9:16", tags="Goal,Assist",
        )
        assert patch_resp["intro_card_id"] == card_id

        get_resp = await get_collection_intro(
            scope_type="all", aspect_ratio="9:16", tags="Assist,Goal",  # different order
        )
        assert get_resp["intro_card_id"] == card_id, \
            "tag order must not fragment the collection's identity"

    @pytest.mark.asyncio
    async def test_game_scope_without_game_id_400s(self, db):
        from fastapi import HTTPException

        from app.routers.collections import get_collection_intro
        with pytest.raises(HTTPException) as exc:
            await get_collection_intro(scope_type="game", aspect_ratio="9:16", game_id=None)
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_deleted_card_degrades_to_no_intro(self, db):
        from app.routers.collections import get_collection_intro
        card_id = _seed_card(db, "Gone")
        conn = _connect(db)
        cur = conn.cursor()
        key = collection_intro_settings_key("mixes", aspect_ratio="9:16")
        set_collection_intro_card_id(cur, key, card_id)
        conn.commit()
        conn.execute("DELETE FROM intro_cards WHERE id = ?", (card_id,))
        conn.commit()
        conn.close()

        resp = await get_collection_intro(scope_type="mixes", aspect_ratio="9:16")
        assert resp["intro_card_id"] == card_id  # raw value still stored
        assert resp["intro_card_name"] is None    # but resolves to nothing
