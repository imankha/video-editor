"""T8700: harden POST /api/games/{game_id}/videos (add_game_videos) — the
attach-video-to-existing-game endpoint.

Closes 3 safety gaps that exist today (see docs/plans/tasks/T8700-design.md §1.3):
  1. Attach charges NO credits (activate_game does).
  2. Attach inserts NO storage ref (so the expiry sweep can reclaim the attached
     source early).
  3. Attach has no explicit append-only sequence discipline.
Plus: attach onto a non-ready (pending) game must 409.

These tests are RED-first (Tester Phase 1): add_game_videos does not yet call
deduct_credits, _ensure_game_storage_refs, or assign server-side sequences, so
every credit/ref/append-only assertion here is expected to fail against
today's implementation. Mocking pattern follows tests/test_game_activate_consistency.py
(real profile DB via ensure_database, externalities patched on the games router module).
"""

import sqlite3
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

USER_ID = "test-user-t8700"
PROFILE_ID = "testdefault"
HASH_1 = "a" * 64
HASH_2 = "b" * 64
HASH_3 = "c" * 64


@pytest.fixture()
def profile_db(tmp_path):
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


def _connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_game(db_path, status="ready", blake3_hash=HASH_1, sequences=(1,)):
    """Seed a game row plus one game_videos row per sequence in `sequences`,
    all referencing blake3_hash (fine for these tests -- the hash isn't the
    point, the sequence numbering is)."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO games (name, status, blake3_hash) VALUES ('G', ?, ?)",
        (status, blake3_hash),
    )
    game_id = cur.lastrowid
    for seq in sequences:
        cur.execute(
            """INSERT INTO game_videos
               (game_id, blake3_hash, sequence, duration, video_width, video_height, video_size, fps)
               VALUES (?, ?, ?, 10.0, 1920, 1080, 1000000, 30.0)""",
            (game_id, blake3_hash, seq),
        )
    conn.commit()
    conn.close()
    return game_id


def _sequences(db_path, game_id):
    conn = _connect(db_path)
    rows = conn.execute(
        "SELECT sequence FROM game_videos WHERE game_id = ? ORDER BY sequence", (game_id,)
    ).fetchall()
    conn.close()
    return [r["sequence"] for r in rows]


def _ref_count(db_path, h):
    conn = _connect(db_path)
    n = conn.execute(
        "SELECT COUNT(*) c FROM game_storage WHERE blake3_hash = ?", (h,)
    ).fetchone()["c"]
    conn.close()
    return n


def _aggregate(db_path, game_id):
    conn = _connect(db_path)
    row = conn.execute(
        "SELECT video_duration, video_size FROM games WHERE id = ?", (game_id,)
    ).fetchone()
    conn.close()
    return dict(row)


def _video_ref(blake3_hash, sequence=1, duration=10.0, width=1920, height=1080, file_size=1_000_000):
    from app.routers.games import VideoReference
    return VideoReference(
        blake3_hash=blake3_hash, sequence=sequence, duration=duration,
        width=width, height=height, file_size=file_size,
    )


def _add_videos_request(*videos):
    from app.routers.games import AddVideosRequest
    return AddVideosRequest(videos=list(videos))


def _patched_externalities(**overrides):
    """Common patch set: R2 validation always passes, storage ref insert +
    credit deduction are mocked so tests can assert call args without a real
    Postgres/R2. Individual tests override via `overrides`."""
    from app.routers import games as games_router

    defaults = dict(
        target=games_router,
        _validate_video_in_r2=MagicMock(return_value=None),
        get_r2_client=MagicMock(return_value=None),  # R2 not configured -> ref-check skipped (mirrors profile_db fixture's R2_ENABLED=False)
        deduct_credits=MagicMock(return_value={"success": True, "balance": 100, "required": 0}),
    )
    defaults.update(overrides)
    target = defaults.pop("target")
    return patch.multiple(target, **defaults)


# ---------------------------------------------------------------------------
# 1. Charges credits (GAP 1)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_attach_charges_credits(profile_db):
    from app.routers import games as games_router
    from app.services.storage_credits import calculate_upload_cost

    game_id = _seed_game(profile_db, status="ready", sequences=(1,))
    new_size = 2_000_000

    with _patched_externalities():
        result = await games_router.add_game_videos(
            game_id, _add_videos_request(_video_ref(HASH_2, sequence=99, file_size=new_size))
        )
        expected_cost = calculate_upload_cost(new_size)
        games_router.deduct_credits.assert_called_once()
        call_kwargs = games_router.deduct_credits.call_args
        # amount arg (positional or kwarg) must equal the calculated cost
        amount = call_kwargs.kwargs.get("amount", call_kwargs.args[1] if len(call_kwargs.args) > 1 else None)
        assert amount == expected_cost

    assert result.get("upload_cost_charged") == expected_cost


# ---------------------------------------------------------------------------
# 2. Distinct reference_id is NOT a no-op vs activate_game's charge
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_attach_reference_id_distinct_from_activate_charge(profile_db):
    """activate_game charges source='game_upload', reference_id=str(game_id).
    Attach MUST use a distinct (source, reference_id) or deduct_credits would
    be a silent no-op (idempotent on that pair) -- proving the debit actually
    applies to the game_video_add charge."""
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="ready", sequences=(1,))

    # Simulate that this game's id was already used as a reference_id for the
    # unrelated 'game_upload' charge activate_game makes.
    with patch.object(games_router, "deduct_credits") as mock_deduct:
        mock_deduct.return_value = {"success": True, "balance": 100, "required": 0}
        with _patched_externalities(deduct_credits=mock_deduct):
            await games_router.add_game_videos(
                game_id, _add_videos_request(_video_ref(HASH_2, sequence=99))
            )

        mock_deduct.assert_called_once()
        _, kwargs = mock_deduct.call_args
        source = kwargs.get("source")
        reference_id = kwargs.get("reference_id")
        assert source == "game_video_add", f"expected distinct source, got {source!r}"
        assert reference_id != str(game_id), (
            "reference_id must NOT equal activate_game's f'{game_id}' reference_id "
            "or the debit is a silent no-op"
        )
        assert str(game_id) in str(reference_id)
        assert HASH_2 in str(reference_id)


# ---------------------------------------------------------------------------
# 3. Idempotent per video (retry-safe)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_attach_same_hash_twice_charges_once(profile_db):
    """Idempotency is a property of deduct_credits keyed on (source, reference_id);
    here we assert attach computes the SAME reference_id for the same hash on a
    retry, so the real (non-mocked) idempotency guarantee applies."""
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="ready", sequences=(1,))

    with patch.object(games_router, "deduct_credits") as mock_deduct:
        mock_deduct.return_value = {"success": True, "balance": 100, "required": 0}
        with _patched_externalities(deduct_credits=mock_deduct):
            await games_router.add_game_videos(
                game_id, _add_videos_request(_video_ref(HASH_2, sequence=99))
            )
            assert mock_deduct.call_args is not None, "deduct_credits was never called by attach"
            first_reference_id = mock_deduct.call_args.kwargs.get("reference_id")

            # Retry: attaching the identical hash again (e.g. client retry after
            # a dropped response). Sequence collision with UNIQUE(game_id,sequence)
            # is a separate concern -- what matters here is the reference_id must
            # match so the ledger's own idempotency dedupes the charge.
            await games_router.add_game_videos(
                game_id, _add_videos_request(_video_ref(HASH_2, sequence=99))
            )
            second_reference_id = mock_deduct.call_args.kwargs.get("reference_id")

    assert first_reference_id == second_reference_id


# ---------------------------------------------------------------------------
# 4. Insufficient credits -> 402
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_attach_insufficient_credits_returns_402(profile_db):
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="ready", sequences=(1,))

    with _patched_externalities(
        deduct_credits=MagicMock(return_value={"success": False, "balance": 0, "required": 5}),
    ):
        with pytest.raises(HTTPException) as exc:
            await games_router.add_game_videos(
                game_id, _add_videos_request(_video_ref(HASH_2, sequence=99))
            )

    assert exc.value.status_code == 402
    detail = exc.value.detail
    assert "required" in detail
    assert "balance" in detail


# ---------------------------------------------------------------------------
# 5. Storage ref inserted (GAP 2)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_attach_inserts_storage_ref(profile_db):
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="ready", sequences=(1,))

    with _patched_externalities(
        get_r2_client=MagicMock(return_value=MagicMock()),
        r2_head_object_global=MagicMock(return_value={"ContentLength": 2_000_000}),
    ):
        await games_router.add_game_videos(
            game_id, _add_videos_request(_video_ref(HASH_2, sequence=99, file_size=2_000_000))
        )

    assert _ref_count(profile_db, HASH_2) == 1


# ---------------------------------------------------------------------------
# 6. Ref refused for absent R2 source (bug 27p parity)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_attach_does_not_ref_absent_r2_source(profile_db):
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="ready", sequences=(1,))

    with _patched_externalities(
        get_r2_client=MagicMock(return_value=MagicMock()),
        r2_head_object_global=MagicMock(return_value=None),  # source absent
    ):
        await games_router.add_game_videos(
            game_id, _add_videos_request(_video_ref(HASH_2, sequence=99))
        )

    assert _ref_count(profile_db, HASH_2) == 0


# ---------------------------------------------------------------------------
# 7. Append-only sequence (GAP 3)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_attach_single_video_appends_next_sequence(profile_db):
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="ready", sequences=(1,))

    with _patched_externalities():
        await games_router.add_game_videos(
            game_id, _add_videos_request(_video_ref(HASH_2, sequence=1))  # client sends bogus/duplicate seq
        )

    assert _sequences(profile_db, game_id) == [1, 2]


@pytest.mark.asyncio
async def test_attach_two_videos_at_once_appends_sequentially(profile_db):
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="ready", sequences=(1,))

    with _patched_externalities():
        await games_router.add_game_videos(
            game_id,
            _add_videos_request(
                _video_ref(HASH_2, sequence=1),
                _video_ref(HASH_3, sequence=1),  # both claim seq 1 -- server must override
            ),
        )

    assert _sequences(profile_db, game_id) == [1, 2, 3]


@pytest.mark.asyncio
async def test_attach_never_shifts_existing_sequences(profile_db):
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="ready", sequences=(1, 2))

    with _patched_externalities():
        await games_router.add_game_videos(
            game_id, _add_videos_request(_video_ref(HASH_3, sequence=0))  # client tries to prepend
        )

    # existing 1, 2 untouched; new one appended at 3, never inserted before them
    assert _sequences(profile_db, game_id) == [1, 2, 3]


@pytest.mark.asyncio
async def test_attach_overrides_out_of_order_client_sequence(profile_db):
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="ready", sequences=(1,))

    with _patched_externalities():
        await games_router.add_game_videos(
            game_id, _add_videos_request(_video_ref(HASH_2, sequence=500))  # wildly out of order
        )

    assert _sequences(profile_db, game_id) == [1, 2]


# ---------------------------------------------------------------------------
# 8. Existing guards hold: 404 unknown game, 400 empty videos
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_attach_unknown_game_404(profile_db):
    from app.routers import games as games_router

    with _patched_externalities():
        with pytest.raises(HTTPException) as exc:
            await games_router.add_game_videos(999999, _add_videos_request(_video_ref(HASH_2)))

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_attach_empty_videos_400(profile_db):
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="ready", sequences=(1,))

    with pytest.raises(HTTPException) as exc:
        await games_router.add_game_videos(game_id, _add_videos_request())

    assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# 9. Single->multi aggregate re-sums duration/size
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_attach_reaggregates_duration_and_size(profile_db):
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="ready", sequences=(1,))  # duration=10.0, size=1_000_000

    with _patched_externalities():
        await games_router.add_game_videos(
            game_id,
            _add_videos_request(_video_ref(HASH_2, sequence=1, duration=15.0, file_size=3_000_000)),
        )

    agg = _aggregate(profile_db, game_id)
    assert agg["video_duration"] == pytest.approx(25.0)
    assert agg["video_size"] == 4_000_000


# ---------------------------------------------------------------------------
# Q3: attach onto a non-ready (pending) game -> 409
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_attach_onto_pending_game_returns_409(profile_db):
    from app.routers import games as games_router

    game_id = _seed_game(profile_db, status="pending", sequences=(1,))

    with _patched_externalities():
        with pytest.raises(HTTPException) as exc:
            await games_router.add_game_videos(
                game_id, _add_videos_request(_video_ref(HASH_2, sequence=99))
            )

    assert exc.value.status_code == 409
