"""v033: Heal arshia's already-moved reels (restore game attribution) — T5830.

The reporter (arshia, prod) moved 14 single-clip reels into his two kids'
profiles BEFORE T5810 shipped. The pre-T5810 move flow nulled
`final_videos.game_ids`, and the move's phase-2 deleted the source reels, so the
attribution cannot be re-derived from live data. T5830 heals it directly, writing
EXACTLY the state T5810 would have produced: a metadata-only game REFERENCE
(`materialization.ensure_game_reference`, T5800) in the kid profile plus a
single-id `game_ids` list pointing at it.

The reel->game mapping below was produced by a dry-run matcher against DOWNLOADED
copies of his prod profile DBs and SIGNED OFF by the user on 2026-08-02. It is
applied verbatim: 14 matched reels, 0 ambiguous, 7 unmatched (left untouched
forever — 6 have no surviving source clip, 1 has a NULL clip_game_start_time).
The matching is NOT re-derived, widened, or "improved" here.

Gating is on DATA SHAPE, never a user id alone: a profile DB is only touched when
it actually holds a `final_videos` row matching one of the signed-off
(filename, clip_game_start_time) pairs with `clip_count = 1` and empty
`game_ids`. `filename` carries a per-reel random hex suffix and is globally
unique; combined with the exact REAL start_time (compared with a float tolerance),
no other user's DB can match, so the heal is a provable no-op everywhere else and
idempotent on a re-run (a healed reel's game_ids is no longer empty).

Landmines (all previously drew blood):
  - The runner hands ``up(conn)`` a TUPLE row factory, NOT sqlite3.Row (v017
    crashed on ``row["col"]`` for 4 prod users). Our own gating reads index
    positionally. ``ensure_game_reference`` REQUIRES a sqlite3.Row target_conn,
    so we flip conn.row_factory to Row only around the primitive calls and restore
    it in a finally.
  - Cross-profile read: ``up(conn)`` sees ONE profile DB (a kid profile). The
    source `games` + `game_videos` live in the DEFAULT profile. We open it via the
    materialization helper (``open_profile_db_readonly`` = ensure_profile_db_local
    + read-only open), which downloads it from R2 if this machine hasn't cached it
    yet — the default profile sorts AFTER the kids, so it may not be migrated
    (downloaded) locally at the time a kid profile is being healed. We only READ
    the default profile; it is never written or swapped by this migration.
  - Float equality: clip_game_start_time is a REAL column; compared with a
    tolerance (never `==`, never truncated — the values only collide at full
    precision).
  - Never touches game_storage / game_storage_refs / game_ref_counts (a reference
    has no storage participation — EPIC decision 4). ensure_game_reference /
    _insert_game_with_videos touch only `games` + `game_videos`.
"""

import logging
import sqlite3

from ..base import BaseMigration

logger = logging.getLogger(__name__)

# arshia's user id (owner). Belt-and-suspenders ONLY — the data-shape gate is the
# real guard. A full UUID here, not a profile id (profile ids are 8-hex).
_ARSHIA_USER_ID = "937e5e54-d49a-4ebb-8b54-fdd878e15df9"

# The default (owning) profile that holds the real `games` rows the references
# point back at.
_DEFAULT_PROFILE_ID = "b95eb93b"

# The signed-off mapping (14 reels). Each row:
#   (target_profile_id, filename, clip_game_start_time, source_game_id)
# `filename` is the stable per-reel key (final_videos.id is per-profile and could
# differ if a row was re-inserted). `source_game_id` is the games.id in the
# DEFAULT profile (b95eb93b). Applied verbatim — do NOT edit without a fresh
# dry-run + user sign-off.
_MAPPING = [
    # target profile b0a81fe1 (Maddie U13)
    ("b0a81fe1", "final_4_707d183a.mp4", 405.96058099211723, 1),
    ("b0a81fe1", "final_6_53dca1f6.mp4", 816.0070391315425, 1),
    ("b0a81fe1", "final_1_adc050ba.mp4", 2673.5513595066045, 1),
    ("b0a81fe1", "final_3_11009f27.mp4", 3529.6165475009175, 1),
    ("b0a81fe1", "final_23_4347db65.mp4", 1507.1031153626207, 7),
    ("b0a81fe1", "final_28_37d914e1.mp4", 2159.607841594342, 8),
    # target profile 6ff007e6 (Ella U13)
    ("6ff007e6", "final_11_08ff1991.mp4", 2515.934628310104, 1),
    ("6ff007e6", "final_41_c80c7709.mp4", 398.4112035921107, 6),
    ("6ff007e6", "final_42_b44f531e.mp4", 490.3391471624593, 6),
    ("6ff007e6", "final_38_202ad592.mp4", 287.63720379327475, 5),
    ("6ff007e6", "final_34_d0b6f046.mp4", 1870.804440648296, 5),
    ("6ff007e6", "final_39_bbc07817.mp4", 866.9105974096519, 5),
    ("6ff007e6", "final_44_0a3e39e0.mp4", 1070.9785031104643, 6),
    ("6ff007e6", "final_37_ac12f5f0.mp4", 195.3517237696267, 5),
]

# REAL column comparison tolerance (full-precision; the frozen publish-time value
# equals raw_clips.start_time to ~15 significant digits).
_START_TIME_TOL = 1e-6


class V033HealMovedReelAttribution(BaseMigration):
    version = 33
    description = (
        "T5830: heal arshia's pre-T5810 moved reels — restore game attribution "
        "via ensure_game_reference (data-shape gated, no-op elsewhere)"
    )

    def up(self, conn) -> None:
        # --- Table + column guards (a fresh/empty profile DB, or one pre-v030,
        # cannot be a healable target). All reads below use the runner's TUPLE row
        # factory, so index positionally.
        for table in ("final_videos", "games"):
            if not conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone():
                return

        fv_cols = {r[1] for r in conn.execute("PRAGMA table_info(final_videos)").fetchall()}
        if not {"id", "filename", "game_ids", "clip_count", "clip_game_start_time"} <= fv_cols:
            return
        game_cols = {r[1] for r in conn.execute("PRAGMA table_info(games)").fetchall()}
        # v030 reference columns must exist — a pre-v030 DB has no references and
        # cannot be arshia's already-materialized structure.
        if not {"source_profile_id", "source_game_id"} <= game_cols:
            return

        # --- Data-shape gate: which mapped reels actually live in THIS profile DB?
        # filename is globally unique per reel, so this both selects the reel and
        # confirms the profile — no cross-user filename can collide.
        from ...utils.encoding import decode_data

        matched = []  # (final_video_id, target_profile_id, source_game_id)
        for target_profile, filename, cgst, source_game_id in _MAPPING:
            for fv_id, row_cgst, game_ids_blob, clip_count in conn.execute(
                "SELECT id, clip_game_start_time, game_ids, clip_count "
                "FROM final_videos WHERE filename = ?",
                (filename,),
            ).fetchall():
                if clip_count != 1:
                    continue
                if row_cgst is None:
                    continue
                if abs(row_cgst - cgst) > _START_TIME_TOL:
                    continue
                # Empty game_ids only (NULL / b'' / []). A non-empty list means the
                # reel is already attributed -> idempotent skip.
                if decode_data(game_ids_blob):
                    continue
                matched.append((fv_id, target_profile, source_game_id))

        if not matched:
            return  # provable no-op for every other user AND for a re-run

        # --- We are on arshia's data. Resolve the owning user + confirm the default
        # profile is part of this account before opening it cross-profile.
        from ...services.user_db import get_profiles
        from ...user_context import get_current_user_id

        user_id = get_current_user_id()
        if not user_id:
            logger.warning(
                "[v033] matched %d heal reel(s) but no user context is set; skipping "
                "(cannot open the default profile safely)", len(matched)
            )
            return
        # Belt-and-suspenders: the data-shape gate already proves this is arshia's
        # DB; refuse loudly in the impossible cross-user case rather than proceed.
        if user_id != _ARSHIA_USER_ID:
            logger.warning(
                "[v033] signed-off reels matched under unexpected user=%s (expected %s); "
                "skipping", user_id, _ARSHIA_USER_ID
            )
            return

        try:
            profiles = {p["id"] for p in get_profiles(user_id)}
        except Exception as e:
            logger.warning("[v033] could not read profile registry for %s: %s", user_id, e)
            return
        if _DEFAULT_PROFILE_ID not in profiles:
            logger.warning(
                "[v033] matched heal reels but default profile %s not in registry for "
                "user %s; skipping", _DEFAULT_PROFILE_ID, user_id
            )
            return

        # --- Open the DEFAULT profile read-only (R2 download if not cached) and read
        # each needed source game + its game_videos. Never written or swapped here.
        from ...migrations import MigrationBlocked
        from ...services.materialization import ensure_game_reference, open_profile_db_readonly

        # T5085: open_profile_db_readonly now migrates-before-touch (calls
        # migrations.run_profile_seam) and can raise MigrationBlocked. This
        # migration's OWN caller already holds the migration lock for the
        # profile currently being migrated (this DB, the kid profile) --
        # opening a SECOND profile (the default profile) here through the
        # same seam machinery would acquire a second, different lock while
        # still holding the first, a non-reentrant nested-lock shape. Route
        # any MigrationBlocked into the exact same "leave reels unattributed
        # rather than guessing" degradation already used for source_conn is
        # None below, rather than let it propagate and permanently block
        # THIS profile's own migration over a problem in a DIFFERENT one.
        try:
            source_conn = open_profile_db_readonly(user_id, _DEFAULT_PROFILE_ID)
        except MigrationBlocked as e:
            logger.warning(
                "[v033] default profile %s blocked at migration seam (%s) for user "
                "%s; leaving reels unattributed rather than guessing",
                _DEFAULT_PROFILE_ID, e.reason, user_id
            )
            return
        if source_conn is None:
            logger.warning(
                "[v033] could not open default profile %s for user %s (R2 error / "
                "missing); leaving reels unattributed rather than guessing",
                _DEFAULT_PROFILE_ID, user_id
            )
            return

        healed = 0
        original_factory = conn.row_factory
        try:
            source_games: dict[int, sqlite3.Row] = {}
            source_videos: dict[int, list] = {}
            needed_game_ids = {sgid for _, _, sgid in matched}
            for sgid in needed_game_ids:
                grow = source_conn.execute(
                    "SELECT * FROM games WHERE id = ?", (sgid,)
                ).fetchone()
                if grow is None:
                    continue
                source_games[sgid] = grow
                source_videos[sgid] = source_conn.execute(
                    "SELECT * FROM game_videos WHERE game_id = ? ORDER BY sequence",
                    (sgid,),
                ).fetchall()

            # ensure_game_reference reads the TARGET conn by column NAME (dedup +
            # hash lookup), so it needs a sqlite3.Row factory. Flip it only for the
            # primitive; our positional reads are already done. The UPDATE below uses
            # positional params, so the factory is irrelevant to it.
            conn.row_factory = sqlite3.Row

            from ...utils.encoding import encode_data
            for fv_id, target_profile, source_game_id in matched:
                grow = source_games.get(source_game_id)
                if grow is None:
                    # Signed-off source game absent from the default DB — do NOT
                    # guess an attribution. Leave the reel NULL and log loudly.
                    logger.warning(
                        "[v033] source game %s missing in default profile %s; leaving "
                        "reel final_video=%s unattributed", source_game_id,
                        _DEFAULT_PROFILE_ID, fv_id
                    )
                    continue
                ref_id = ensure_game_reference(
                    conn, target_profile, _DEFAULT_PROFILE_ID,
                    grow, source_videos.get(source_game_id, []),
                )
                # T5810-shaped state: game_ids = msgpack single-id list; game_id
                # stays NULL (the moved rows have it NULL and T5810 only remaps a
                # scalar that was already set).
                conn.execute(
                    "UPDATE final_videos SET game_ids = ? WHERE id = ?",
                    (encode_data([ref_id]), fv_id),
                )
                healed += 1
        finally:
            conn.row_factory = original_factory
            source_conn.close()

        logger.info(
            "[v033] healed %d moved reel(s) for user=%s across kid profiles "
            "(references reused from default profile %s)",
            healed, user_id, _DEFAULT_PROFILE_ID
        )
