"""
T5810 perf guard (query_counter): the move flow and list_games gained queries; assert
the statement count stays FLAT (no N+1) as reels / references grow.

- Moving N reels that all attribute to ONE game resolves the source game exactly ONCE
  (per-DISTINCT-game, never per-reel).
- list_games resolves owning-profile display names with ONE user.sqlite read
  regardless of how many references are present (never per-reference).
"""

from unittest.mock import patch

import pytest

# Reuse the 3-profile harness from the sibling test module.
from tests.test_t5810_move_attribution import (  # noqa: E402
    A,
    B,
    _conn,
    _insert_real_game,
    _insert_reel,
    _move,
    _refs,
    env,  # noqa: F401  (pytest fixture)
)
from app.services.materialization import ensure_game_reference


def _count(query_counter, needle):
    return len([s for s in query_counter.statements if needle in s])


@pytest.mark.asyncio
async def test_move_many_reels_one_game_resolves_source_once(env, query_counter):
    _insert_real_game(env, A, 10)
    reels = [_insert_reel(env, A, game_ids=[10], game_id=10) for _ in range(6)]

    # set_trace_callback expands bound params, so the placeholder shows as a literal.
    before = _count(query_counter, "FROM games WHERE id =")
    await _move(reels, A, B)
    after = _count(query_counter, "FROM games WHERE id =")

    # 6 reels, ONE distinct source game -> exactly ONE source-game resolution.
    assert after - before == 1
    assert len(_refs(env, B)) == 1


@pytest.mark.asyncio
async def test_list_games_one_profile_read_regardless_of_reference_count(env, query_counter):
    from app.profile_context import set_current_profile_id
    from app.routers.games import list_games

    # Seed MANY references into B (each keyed to a distinct owning game).
    set_current_profile_id(B)
    conn = _conn(env, B)
    for gid in range(1, 9):
        ensure_game_reference(
            conn, B, A,
            {
                "id": gid, "name": f"G{gid}", "opponent_name": "Foe",
                "game_date": "2026-01-01", "game_type": "match",
                "tournament_name": None, "blake3_hash": f"h{gid}",
                "video_duration": 1.0, "video_width": 1, "video_height": 1,
                "video_size": 1, "video_fps": 30.0, "created_at": "2026-01-01",
                "source_profile_id": None, "source_game_id": None,
            },
            [],
        )
    conn.commit()
    conn.close()

    with patch("app.routers.games.get_grace_deletion_hashes", return_value=set()):
        before = _count(query_counter, "FROM profiles")
        resp = await list_games()
        after = _count(query_counter, "FROM profiles")

    # 8 references -> still exactly ONE user.sqlite profiles read (no per-reference N+1).
    assert after - before == 1
    assert len([g for g in resp["games"] if g["is_reference"]]) == 8
