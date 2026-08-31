"""
Game + annotation materialization for teammate sharing.

Copies game references and filtered annotations from a sharer's profile SQLite
into a recipient's profile SQLite. Handles overlap merging when the recipient
already has annotations on the same game.
"""


import logging
import sqlite3
from pathlib import Path

from app.database import USER_DATA_BASE, sync_db_to_r2_explicit
from app.services.auth_db import get_game_storage_ref, insert_game_storage_ref
from app.services.db_refresh import RefreshFailed, clear_stale_wal_sidecars, wal_sidecars_present
from app.services.pg import get_pg
from app.services.sharing_db import (
    get_share_claim,
    mark_game_share_materialized,
    record_share_claim,
)
from app.utils.encoding import decode_data, encode_data

logger = logging.getLogger(__name__)

# T5330: provenance sentinel written to games.shared_by / raw_clips.shared_by when a
# share has no resolvable sharer identity at all. The marker is NEVER NULL for a shared
# item (precedence: sharer_email -> sharer_user_id -> this sentinel) so onboarding-blind
# quest counts (quests._check_all_steps) can rely on `shared_by IS NOT NULL` == shared-in.
SHARED_PROVENANCE_LOST = "lost"


def _open_profile_db(user_id: str, profile_id: str) -> sqlite3.Connection | None:
    """Open a profile SQLite database directly (bypasses ContextVar).
    Only opens locally-cached DBs -- does NOT download from R2."""
    db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
    if not db_path.exists():
        return None
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


class ProfileDBRefreshFailed(RefreshFailed):
    """R2 was unreachable, so a profile DB could not be confirmed current.

    Only raised for WRITE callers (require_fresh=True). Serving a stale copy to a
    reader is fine; handing one to a writer is not, because the write-back
    force-pushes (skip_version_check=True) and would revert the profile in R2 to
    the stale snapshot plus the new row.
    """


def ensure_profile_db_local(
    user_id: str, profile_id: str, require_fresh: bool = False
) -> Path | None:
    """Guarantee a profile's SQLite DB is present in the local cache, downloading
    it from R2 if missing/stale, then return its path (or None if R2 has none).

    READ-ONLY w.r.t. the owner's data: it only populates the local cache and the
    local db_version bookkeeping; it never writes the owner's authoritative data
    and never uploads / bumps the R2 sync version. Used to resolve a public
    collection share against the SHARER's profile DB on a request that carries no
    (or a different) profile context.

    The R2 helpers (sync_database_from_r2_if_newer -> download_from_r2 / r2_key)
    derive the profile from the profile_context ContextVar, so we temporarily set
    it to the sharer's profile_id and restore it in a finally (same pattern the
    background workers use: auto_export, modal_queue, sweep_scheduler).
    """
    from app.database import (
        clear_sync_pending,
        get_local_db_version,
        read_pending_token,
        set_local_db_version,
    )
    from app.profile_context import reset_profile_id_token, set_current_profile_id
    from app.storage import sync_database_from_r2_if_newer

    db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
    token = set_current_profile_id(profile_id)
    try:
        local_version = get_local_db_version(user_id, profile_id)
        # T4315 round 3 (BLOCKING NEW-B): the WAL-in-use guard must gate the
        # DOWNLOAD, not the version check -- checking it up front refused
        # even the overwhelmingly common "local already current, nothing to
        # download" case (sidecars just mean SOME connection, unrelated to
        # this restore, has the file open right now for perfectly normal
        # reasons). before_download is only consulted once R2 is confirmed
        # newer, so a live connection blocks the actual swap, not every call.
        #
        # T5081 (INV-P reason b, site 4): capture this SCOPE's (the DB's
        # owner, from the explicit args -- NEVER the ContextVar, which this
        # function may have just pointed at a different sharer) pending
        # token before the download, same as the upload path's reason (a).
        # A restore-if-newer that actually replaces local content discharges
        # whatever committed-but-unconfirmed write earned that scope its
        # marker -- the peer fact to recording the new baseline below.
        pending_token = read_pending_token(user_id, profile_id)
        downloaded, new_version, was_error = sync_database_from_r2_if_newer(
            user_id, db_path, local_version,
            before_download=lambda: not wal_sidecars_present(db_path),
        )
        if downloaded:
            # WAL safety: the download already swapped db_path's content
            # atomically, but a stale -wal/-shm sidecar from the file it
            # replaced would still be sitting next to it -- see
            # db_refresh.clear_stale_wal_sidecars for why that corrupts the
            # next connection's reads instead of just serving old data. Only
            # reached when the pre-check above found no sidecars, so this is
            # defense-in-depth for the narrow window while the download ran.
            clear_stale_wal_sidecars(db_path)
        if downloaded and new_version is not None:
            # Cache bookkeeping only (db_version table); not owner data.
            set_local_db_version(user_id, profile_id, new_version)
            clear_sync_pending(user_id, profile_id, if_token=pending_token)
        if was_error and require_fresh:
            # A writer must never build on an unconfirmed copy: the sync back is a
            # force-push, so proceeding here silently REVERTS the profile in R2 to
            # whatever this machine happens to hold. This is how moved reels lost
            # their final_videos row while the mp4 survived.
            raise ProfileDBRefreshFailed(
                f"could not confirm profile {profile_id} is current (R2 error)"
            )
        if was_error and not db_path.exists():
            logger.warning(
                f"[collection-share] R2 error and no local DB for "
                f"user={user_id} profile={profile_id}"
            )
            return None
    finally:
        reset_profile_id_token(token)

    return db_path if db_path.exists() else None


def open_profile_db_readonly(user_id: str, profile_id: str) -> sqlite3.Connection | None:
    """Ensure the sharer's profile DB is local (R2 fallback) and open it read-only.
    Returns None if the DB cannot be obtained. Caller must close the connection."""
    path = ensure_profile_db_local(user_id, profile_id)
    if path is None:
        return None
    # mode=ro: a public resolve must never mutate the sharer's DB.
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def _collect_video_hashes(conn: sqlite3.Connection, game_id: int) -> list[str]:
    """Get all blake3 hashes for a game (single-video or multi-video)."""
    cur = conn.cursor()
    cur.execute("SELECT blake3_hash FROM games WHERE id = ?", (game_id,))
    game_row = cur.fetchone()
    if not game_row:
        return []

    if game_row["blake3_hash"]:
        return [game_row["blake3_hash"]]

    cur.execute(
        "SELECT blake3_hash FROM game_videos WHERE game_id = ? ORDER BY sequence",
        (game_id,),
    )
    return [r["blake3_hash"] for r in cur.fetchall()]


def _find_existing_game_by_hashes(
    conn: sqlite3.Connection, hashes: list[str]
) -> int | None:
    """Find a game in the recipient's DB that shares the same video hashes."""
    if not hashes:
        return None

    cur = conn.cursor()
    if len(hashes) == 1:
        cur.execute(
            "SELECT id FROM games WHERE blake3_hash = ?", (hashes[0],)
        )
        row = cur.fetchone()
        if row:
            return row["id"]

        cur.execute(
            "SELECT game_id FROM game_videos WHERE blake3_hash = ?", (hashes[0],)
        )
        row = cur.fetchone()
        if row:
            return row["game_id"]
        return None

    # Multi-video: find a game whose game_videos hashes match exactly
    placeholders = ",".join(["?"] * len(hashes))
    cur.execute(
        f"""SELECT game_id, COUNT(*) as cnt
            FROM game_videos
            WHERE blake3_hash IN ({placeholders})
            GROUP BY game_id
            HAVING cnt = ?""",
        (*hashes, len(hashes)),
    )
    row = cur.fetchone()
    return row["game_id"] if row else None


# The game_videos columns copied by BOTH cross-profile game copiers, in order.
_GAME_VIDEO_COLUMNS = (
    "blake3_hash", "sequence", "duration", "video_width", "video_height",
    "video_size", "fps",
)


class RecipientProfileBelowHead(RuntimeError):
    """T6780: the cross-profile game copy targets a recipient/target profile DB whose
    schema is BELOW head — a column the copy must write (`shared_by` v026,
    `source_profile_id`/`source_game_id` v030) does not exist yet on that DB, because
    it hasn't been migrated in the deploy->migrate window.

    Reachable: the recipient/target DB is opened raw (`_open_profile_db` /
    `ensure_profile_db_local`), NEITHER of which migrates to head, so a below-head DB
    can reach this write. The matching READS are already column_exists-guarded
    (games list, quests, move-reel source projection); this is the write-side sibling.

    We REFUSE rather than write a partial row: omitting these columns is NOT an option
    like `detections_data` (T6780 case A) — `shared_by` is the onboarding-blind quest
    provenance marker (T5330) and `source_profile_id`/`source_game_id` DEFINE a
    reference row (T5800); a row missing them is corrupt, not merely incomplete.
    Callers map this to the right shape: share paths DEFER via `create_pending_share`
    (retries post-migration through T3230 login materialization); the move-reel path
    returns HTTP 503 (retryable, no deferral channel). Never a lying `{success:true}`,
    never a raw 500 (this is a known, time-bounded state)."""


def _insert_game_with_videos(
    target_conn: sqlite3.Connection,
    game_columns: dict,
    game_videos,
) -> int:
    """Shared game-insert primitive used by BOTH cross-profile game copiers
    (`_copy_game` share-materialization AND `ensure_game_reference`, T5800) -- the
    2nd copier reuses this rather than duplicating the INSERT.

    Inserts ONE games row from an explicit column->value map, then inserts the given
    game_videos rows (each an indexable mapping/Row carrying `_GAME_VIDEO_COLUMNS`).
    Returns the new game id. Touches ONLY the two profile-local tables; never
    game_storage / Postgres game_storage_refs / game_ref_counts (EPIC decision 4).

    T6780: refuses (raises `RecipientProfileBelowHead`) when any column the copy must
    write is absent on the target `games` table — a below-head recipient in the
    deploy->migrate window — rather than 500 on an OperationalError or write a corrupt
    partial row. Guarding the SHARED primitive covers both copiers AND any future
    column added to a copy set, so a new call site cannot silently skip it. One PRAGMA
    per copy (not per row).
    """
    cols = list(game_columns.keys())
    rcur = target_conn.cursor()
    existing_cols = {
        row[1] for row in rcur.execute("PRAGMA table_info(games)").fetchall()
    }
    missing = [c for c in cols if c not in existing_cols]
    if missing:
        raise RecipientProfileBelowHead(
            "target profile DB is below head; games table missing column(s) "
            f"{sorted(missing)} required by the cross-profile game copy "
            "(pending migration)"
        )
    rcur.execute(
        f"INSERT INTO games ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
        [game_columns[c] for c in cols],
    )
    new_game_id = rcur.lastrowid

    video_cols = ", ".join(("game_id", *_GAME_VIDEO_COLUMNS))
    video_placeholders = ", ".join("?" for _ in range(len(_GAME_VIDEO_COLUMNS) + 1))
    for vrow in game_videos:
        rcur.execute(
            f"INSERT INTO game_videos ({video_cols}) VALUES ({video_placeholders})",
            [new_game_id, *[vrow[c] for c in _GAME_VIDEO_COLUMNS]],
        )

    return new_game_id


def _copy_game(
    sharer_conn: sqlite3.Connection,
    recipient_conn: sqlite3.Connection,
    game_id: int,
    shared_by: str | None = None,
) -> int:
    """Copy game + game_videos rows from sharer to recipient. Returns new game_id.

    shared_by stamps the copied game row's provenance (T5330) so onboarding-blind
    quest counts can exclude it. Callers via materialize_game_share pass a non-null
    marker; the default None path is only for direct unit tests of the copy itself.
    """
    cur = sharer_conn.cursor()
    cur.execute(
        """SELECT name, blake3_hash, video_duration, video_width, video_height,
                  video_size, opponent_name, game_date, game_type, tournament_name,
                  video_fps
           FROM games WHERE id = ?""",
        (game_id,),
    )
    game = cur.fetchone()
    if not game:
        raise ValueError(f"Game {game_id} not found in sharer's database")

    game_columns = {
        "name": game["name"],
        "blake3_hash": game["blake3_hash"],
        "video_duration": game["video_duration"],
        "video_width": game["video_width"],
        "video_height": game["video_height"],
        "video_size": game["video_size"],
        "opponent_name": game["opponent_name"],
        "game_date": game["game_date"],
        "game_type": game["game_type"],
        "tournament_name": game["tournament_name"],
        "video_fps": game["video_fps"],
        "video_filename": None,
        "viewed_duration": 0,
        "status": "ready",
        "shared_by": shared_by,
    }
    cur.execute(
        f"""SELECT {', '.join(_GAME_VIDEO_COLUMNS)}
            FROM game_videos WHERE game_id = ? ORDER BY sequence""",
        (game_id,),
    )
    return _insert_game_with_videos(recipient_conn, game_columns, cur.fetchall())


def _hashes_from_game_row(game_row, game_videos) -> list[str]:
    """Video hashes for an already-loaded game row + its game_videos rows (the
    ensure_game_reference analogue of _collect_video_hashes, which queries by id).
    Single-video games carry the hash on the games row; multi-video games carry it
    per game_videos row."""
    if game_row["blake3_hash"]:
        return [game_row["blake3_hash"]]
    return [v["blake3_hash"] for v in game_videos if v["blake3_hash"]]


def ensure_game_reference(
    target_conn: sqlite3.Connection,
    target_profile_id: str,
    source_profile_id: str,
    source_game_row,
    source_game_videos,
) -> int:
    """Ensure a metadata-only game REFERENCE (T5800) for the owning-profile game
    exists in `target_conn`'s profile, returning the resolved target game id.

    A reference is a `games` row with `source_profile_id IS NOT NULL`: it lets the
    target profile resolve `final_videos.game_ids` for by-game grouping WITHOUT
    owning the media (no game_storage / storage_refs / refcounts -- EPIC decision 4).
    This is the 2nd cross-profile game copier; the shared insert is
    `_insert_game_with_videos`.

    `target_conn` MUST be a NORMAL (already-open) connection with a `sqlite3.Row`
    row factory. The caller owns cross-profile DB opening and R2 sync ordering.

    Resolution order (return an existing id when possible, else insert a reference):
      1. Existing row already keyed to (owner_profile, owner_game) -> reuse
         (idempotent across repeat moves; dedups two reels from the same game).
      2. Chain collapse: if the SOURCE row is itself a reference, resolve through ITS
         source pointer so the new reference points at the ORIGINAL owner, never at
         another reference (EPIC decision 6 -- references never chain). Moving a reel
         back to the owning profile therefore maps to the REAL game (step 3, via
         hash-dedup) and inserts no reference.
      3. A REAL local game (share-materialized earlier) with matching video hashes ->
         reuse it -- grouping attaches to the real copy, not a redundant reference.
      4. Else insert a fresh reference row.
    """
    # Step 2 first: a reference source resolves to its own owner so we never point
    # a reference at another reference.
    src_source_profile = source_game_row["source_profile_id"]
    if src_source_profile:
        owner_profile_id = src_source_profile
        owner_game_id = source_game_row["source_game_id"]
    else:
        owner_profile_id = source_profile_id
        owner_game_id = source_game_row["id"]

    cur = target_conn.cursor()

    # Step 1: dedup on the (owner_profile, owner_game) reference key.
    cur.execute(
        "SELECT id FROM games WHERE source_profile_id = ? AND source_game_id = ?",
        (owner_profile_id, owner_game_id),
    )
    row = cur.fetchone()
    if row:
        return row["id"]

    # Step 3: a real local game (share-materialized) with the same hashes wins over
    # a redundant reference.
    hashes = _hashes_from_game_row(source_game_row, source_game_videos)
    existing = _find_existing_game_by_hashes(target_conn, hashes)
    if existing is not None:
        return existing

    # Step 4: insert the reference. Metadata frozen at materialization (EPIC dec. 5).
    game_columns = {
        "name": source_game_row["name"],
        "opponent_name": source_game_row["opponent_name"],
        "game_date": source_game_row["game_date"],
        "game_type": source_game_row["game_type"],
        "tournament_name": source_game_row["tournament_name"],
        "blake3_hash": source_game_row["blake3_hash"],
        "video_duration": source_game_row["video_duration"],
        "video_width": source_game_row["video_width"],
        "video_height": source_game_row["video_height"],
        "video_size": source_game_row["video_size"],
        "video_fps": source_game_row["video_fps"],
        "created_at": source_game_row["created_at"],
        "video_filename": None,
        "status": "ready",
        "source_profile_id": owner_profile_id,
        "source_game_id": owner_game_id,
        "shared_by": None,
        "recap_video_url": None,
        "viewed_duration": 0,
        "last_playhead_position": None,
        "auto_export_status": None,
        "auto_export_attempts": 0,
    }
    return _insert_game_with_videos(target_conn, game_columns, source_game_videos)


def _filter_clips_for_tag(
    conn: sqlite3.Connection, game_id: int, tag_name: str
) -> list[dict]:
    """Get raw_clips for a game filtered by tag_name via clip_teammates join."""
    cur = conn.cursor()
    cur.execute(
        """SELECT rc.id, rc.rating, rc.tags, rc.name, rc.notes,
                  rc.start_time, rc.end_time, rc.video_sequence,
                  rc.tagged_teammates
           FROM raw_clips rc
           JOIN clip_teammates ct ON ct.clip_id = rc.id
           WHERE rc.game_id = ? AND ct.tag_name = ?""",
        (game_id, tag_name),
    )
    return [
        {
            "id": row["id"],
            "rating": row["rating"],
            "tags": row["tags"],
            "name": row["name"],
            "notes": row["notes"],
            "start_time": row["start_time"],
            "end_time": row["end_time"],
            "video_sequence": row["video_sequence"],
            "tagged_teammates": decode_data(row["tagged_teammates"]),
        }
        for row in cur.fetchall()
    ]


def team_layer_clips_for_game(conn: sqlite3.Connection, game_id: int) -> list[dict]:
    """Get a game's TEAM-layer raw_clips (my_athlete = 0) from the sharer's DB (T5730).

    The public game link is team-recap-only, so a claim that imports annotations
    imports exactly the Team layer -- the same clips the shared recap plays. Mirrors
    the shape _filter_clips_for_tag returns (tags kept as the raw blob, tagged_teammates
    decoded) so it drops straight into _materialize_clips via materialize_game_share's
    clip_data path. my_athlete is compared to 0 exactly: NULL/1 are the My-Athlete layer
    and never cross into a recipient's account through this path (EPIC decision 1/3)."""
    cur = conn.cursor()
    cur.execute(
        """SELECT rc.id, rc.rating, rc.tags, rc.name, rc.notes,
                  rc.start_time, rc.end_time, rc.video_sequence,
                  rc.tagged_teammates
           FROM raw_clips rc
           WHERE rc.game_id = ? AND rc.my_athlete = 0""",
        (game_id,),
    )
    return [
        {
            "id": row["id"],
            "rating": row["rating"],
            "tags": row["tags"],
            "name": row["name"],
            "notes": row["notes"],
            "start_time": row["start_time"],
            "end_time": row["end_time"],
            "video_sequence": row["video_sequence"],
            "tagged_teammates": decode_data(row["tagged_teammates"]),
        }
        for row in cur.fetchall()
    ]


def _tag_names_for_email(conn: sqlite3.Connection, email: str) -> list[str]:
    """Resolve a recipient email to its teammate tag_name(s) (T5740).

    teammate_emails holds tag_name <-> email mappings (clips.py). An email may map
    to more than one tag; all are returned so tagged-only sharing unions every clip
    that recipient is tagged in. Case-insensitive to match UserPicker's normalized
    (lower-cased) emails against however the mapping was entered. Empty list means
    'no tag mapping' -> tagged-only yields zero clips (the untagged state)."""
    cur = conn.cursor()
    cur.execute(
        "SELECT DISTINCT tag_name FROM teammate_emails WHERE lower(email) = lower(?)",
        (email,),
    )
    return [row["tag_name"] for row in cur.fetchall()]


def resolve_scoped_clips(
    conn: sqlite3.Connection, game_id: int, email: str, scope: str
) -> list[dict]:
    """Return the EXACT clip dicts a recipient receives for the given share scope.

    SINGLE SOURCE OF TRUTH (T5740): the share-preview READ and the share SEND path
    both call this, so the preview list can never diverge from what is materialized.
    Reuses the existing selection machinery -- no new clip-selection query:
      ALL_TEAM    -> team_layer_clips_for_game (my_athlete = 0)
      TAGGED_ONLY -> _filter_clips_for_tag per resolved tag, unioned by clip id
      GAME_ONLY   -> [] (game/recap only)
    My-Athlete clips (my_athlete != 0) never appear via any branch (EPIC 1/3)."""
    from app.constants import ShareClipScope

    if scope == ShareClipScope.ALL_TEAM.value:
        return team_layer_clips_for_game(conn, game_id)
    if scope == ShareClipScope.TAGGED_ONLY.value:
        # INTERSECT tagged clips with the Team layer: _filter_clips_for_tag alone
        # would return a My-Athlete clip that happens to carry the tag, which must
        # NEVER cross (EPIC decision 1/3). Restricting to my_athlete = 0 ids keeps
        # the invariant even when a tag spans both layers.
        team_ids = {c["id"] for c in team_layer_clips_for_game(conn, game_id)}
        seen: set = set()
        unioned: list[dict] = []
        for tag in _tag_names_for_email(conn, email):
            for clip in _filter_clips_for_tag(conn, game_id, tag):
                if clip["id"] in team_ids and clip["id"] not in seen:
                    seen.add(clip["id"])
                    unioned.append(clip)
        return unioned
    if scope == ShareClipScope.GAME_ONLY.value:
        return []
    raise ValueError(f"Unknown share clip scope: {scope!r}")


def clips_overlap(a: dict, b: dict) -> bool:
    """Two clips overlap if video_sequence matches and time ranges intersect."""
    if a.get("video_sequence") != b.get("video_sequence"):
        return False
    a_start = a.get("start_time", 0) or 0
    a_end = a.get("end_time", 0) or 0
    b_start = b.get("start_time", 0) or 0
    b_end = b.get("end_time", 0) or 0
    return a_start < b_end and b_start < a_end


def _is_team_layer(clip: dict) -> bool:
    """True if the clip is on the Team layer (my_athlete == 0).

    Layer semantics: my_athlete NULL or 1 = My Athlete; 0 = Team. NULL must be
    read as My Athlete, never as Team or "unknown" -- so this is an explicit
    ``== 0`` test, not a truthiness check on a possibly-NULL value.
    """
    return clip.get("my_athlete") == 0


def merge_clips(existing: dict, incoming: dict) -> dict:
    """Merge two overlapping clips: earliest start, latest end, combined notes.

    T4315 round 5 (note only, not restructured): a post-commit refusal
    (WAL-checkpoint busy, or a recipient refresh failure) leaves the local
    recipient DB already holding this materialization's clips/games -- a
    retry re-runs this against that same local state, so an overlapping
    clip's notes get "\n".join()-ed a second time (doubled notes). Game and
    clip rows dedupe correctly by hash/overlap and no duplicate reels are
    created, so this is cosmetic, not a correctness bug worth a bigger fix.
    """
    e_start = existing.get("start_time", 0) or 0
    e_end = existing.get("end_time", 0) or 0
    i_start = incoming.get("start_time", 0) or 0
    i_end = incoming.get("end_time", 0) or 0

    merged_notes_parts = []
    if existing.get("notes"):
        merged_notes_parts.append(existing["notes"])
    if incoming.get("notes"):
        merged_notes_parts.append(incoming["notes"])

    return {
        "start_time": min(e_start, i_start),
        "end_time": max(e_end, i_end),
        "name": existing.get("name") or incoming.get("name"),
        "notes": "\n".join(merged_notes_parts) if merged_notes_parts else None,
        "rating": existing.get("rating", incoming.get("rating")),
        "video_sequence": existing.get("video_sequence"),
    }


def _get_existing_clips(conn: sqlite3.Connection, game_id: int) -> list[dict]:
    """Get existing raw_clips for a game in recipient's DB."""
    cur = conn.cursor()
    cur.execute(
        """SELECT id, rating, name, notes, start_time, end_time, video_sequence,
                  tagged_teammates, my_athlete
           FROM raw_clips WHERE game_id = ?""",
        (game_id,),
    )
    return [dict(r) for r in cur.fetchall()]


def _insert_clip(
    conn: sqlite3.Connection, game_id: int, clip: dict,
    shared_by: str | None = None,
    tagged_teammates_blob: bytes | None = None,
) -> int:
    """Insert a raw_clip into recipient's DB. Returns new clip id."""
    tags = clip.get("tags")
    if isinstance(tags, list):
        tags = encode_data(tags) if tags else None
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO raw_clips
           (filename, rating, tags, name, notes, start_time, end_time,
            game_id, video_sequence, tagged_teammates, my_athlete, shared_by)
           VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
        (
            clip.get("rating", 3),
            tags,
            clip.get("name"),
            clip.get("notes"),
            clip.get("start_time"),
            clip.get("end_time"),
            game_id,
            clip.get("video_sequence"),
            tagged_teammates_blob,
            shared_by,
        ),
    )
    return cur.lastrowid


def _build_athlete_set(clip: dict, sharer_profile_name: str | None = None) -> set[str]:
    """Build the set of athlete names for a clip."""
    athletes = set()
    if sharer_profile_name:
        athletes.add(sharer_profile_name)
    clip_teammates = clip.get("tagged_teammates")
    if clip_teammates:
        if isinstance(clip_teammates, list):
            athletes.update(clip_teammates)
        else:
            decoded = decode_data(clip_teammates)
            if decoded:
                athletes.update(decoded)
    return athletes


def _materialize_clips(
    recipient_conn: sqlite3.Connection,
    recipient_game_id: int,
    incoming_clips: list[dict],
    shared_by: str | None = None,
    sharer_profile_name: str | None = None,
) -> dict:
    """Insert clips into recipient's DB, merging overlaps with existing clips."""
    existing = _get_existing_clips(recipient_conn, recipient_game_id)
    inserted = 0
    merged = 0
    inserted_clips: list[dict] = []

    for clip in incoming_clips:
        incoming_athletes = _build_athlete_set(clip, sharer_profile_name)
        overlap_found = False
        for ex in existing:
            # Incoming share clips are always Team layer (my_athlete=0). Merge
            # only with an existing clip on the SAME (Team) layer -- a cross-
            # layer intersection (the recipient's own My Athlete clip on the
            # same play) must NOT be merged, or the recipient loses their own
            # curation. A cross-layer overlap falls through to a plain insert
            # so both clips coexist (T5745).
            if _is_team_layer(ex) and clips_overlap(ex, clip):
                merged_data = merge_clips(ex, clip)
                existing_athletes = set(decode_data(ex.get("tagged_teammates")) or [])
                all_athletes = existing_athletes | incoming_athletes
                merged_teammates = encode_data(sorted(all_athletes)) if all_athletes else None
                cur = recipient_conn.cursor()
                # Never rewrite the row's my_athlete -- both clips are already
                # Team layer, and a merge must never change a row's layer.
                cur.execute(
                    """UPDATE raw_clips
                       SET start_time = ?, end_time = ?, name = ?, notes = ?,
                           tagged_teammates = ?
                       WHERE id = ?""",
                    (
                        merged_data["start_time"],
                        merged_data["end_time"],
                        merged_data["name"],
                        merged_data["notes"],
                        merged_teammates,
                        ex["id"],
                    ),
                )
                ex["start_time"] = merged_data["start_time"]
                ex["end_time"] = merged_data["end_time"]
                ex["name"] = merged_data["name"]
                ex["notes"] = merged_data["notes"]
                ex["tagged_teammates"] = merged_teammates
                overlap_found = True
                merged += 1
                break

        if not overlap_found:
            teammates_blob = encode_data(sorted(incoming_athletes)) if incoming_athletes else None
            new_id = _insert_clip(
                recipient_conn, recipient_game_id, clip,
                shared_by=shared_by, tagged_teammates_blob=teammates_blob,
            )
            new_clip = {
                "id": new_id,
                "start_time": clip.get("start_time"),
                "end_time": clip.get("end_time"),
                "video_sequence": clip.get("video_sequence"),
                "name": clip.get("name"),
                "notes": clip.get("notes"),
                "rating": clip.get("rating"),
                "tagged_teammates": teammates_blob,
            }
            existing.append(new_clip)
            inserted_clips.append(new_clip)
            inserted += 1

    return {"inserted": inserted, "merged": merged, "inserted_clips": inserted_clips}


def _create_storage_refs(
    sharer_user_id: str,
    sharer_profile_id: str,
    recipient_user_id: str,
    recipient_profile_id: str,
    hashes: list[str],
) -> None:
    """Create game_storage_refs in Postgres for the recipient."""
    for h in hashes:
        sharer_ref = get_game_storage_ref(sharer_user_id, sharer_profile_id, h)
        if sharer_ref:
            insert_game_storage_ref(
                user_id=recipient_user_id,
                profile_id=recipient_profile_id,
                blake3_hash=h,
                game_size_bytes=sharer_ref["game_size_bytes"],
                storage_expires_at=str(sharer_ref["storage_expires_at"]),
            )


def materialize_game_share(
    sharer_user_id: str,
    sharer_profile_id: str,
    recipient_user_id: str,
    recipient_profile_id: str,
    game_id: int,
    tag_name: str,
    share_id: int,
    clip_data: list[dict] | None = None,
    sharer_email: str | None = None,
) -> dict:
    """Materialize a game share into the recipient's profile.

    If clip_data is provided (from a pending share), uses that instead of
    re-querying the sharer's SQLite.

    Returns dict with keys: game_id, inserted, merged, skipped.
    """
    # T4315 round 2 (MINOR): confirm the recipient is current BEFORE opening
    # sharer_conn -- this can do a real R2 HEAD and, for a cold recipient, a
    # full profile.sqlite download; doing it first means that network round
    # trip never holds the sharer's connection open for no reason. (Also:
    # _open_profile_db is a raw, R2-oblivious local read ("only opens
    # locally-cached DBs -- does NOT download from R2") reused below for a
    # WRITE (inserts games/clips into recipient_conn, commits) -- require_fresh
    # is the same guard move_reels uses, so an R2 error aborts loudly instead
    # of materializing the share on top of a stale/unconfirmed snapshot.)
    ensure_profile_db_local(recipient_user_id, recipient_profile_id, require_fresh=True)

    sharer_conn = _open_profile_db(sharer_user_id, sharer_profile_id)

    # T5330: provenance marker for every shared-in row — NEVER NULL for a share, so
    # onboarding-blind quest counts can exclude it. Precedence: sharer_email ->
    # sharer_user_id -> "lost". (Distinct from sharer_profile_name below, which is the
    # athlete-attribution display name.)
    shared_by = sharer_email or sharer_user_id or SHARED_PROVENANCE_LOST

    # Query sharer's profile name for athlete attribution (fall back to email)
    sharer_profile_name = sharer_email
    try:
        from app.services.user_db import get_profiles
        sharer_profiles = get_profiles(sharer_user_id)
        for p in sharer_profiles:
            if p["id"] == sharer_profile_id and p["name"]:
                sharer_profile_name = p["name"]
                break
    except Exception:
        pass

    if clip_data is None:
        if sharer_conn is None:
            raise ValueError(
                f"Sharer profile DB not found: {sharer_user_id}/{sharer_profile_id}"
            )
        clip_data = _filter_clips_for_tag(sharer_conn, game_id, tag_name)

    game_only = not clip_data
    if game_only:
        logger.info(
            f"[Materialize] Game-only share for game {game_id} (no clips)"
        )

    # Collect video hashes from sharer's game
    if sharer_conn:
        hashes = _collect_video_hashes(sharer_conn, game_id)
    else:
        hashes = []

    recipient_conn = _open_profile_db(recipient_user_id, recipient_profile_id)
    if recipient_conn is None:
        if sharer_conn:
            sharer_conn.close()
        raise ValueError(
            f"Recipient profile DB not found: {recipient_user_id}/{recipient_profile_id}"
        )

    try:
        # Check if the recipient already has this game (dedup by video hash)
        existing_game_id = _find_existing_game_by_hashes(recipient_conn, hashes)

        if existing_game_id:
            recipient_game_id = existing_game_id
            logger.info(
                f"[Materialize] Recipient already has game (id={existing_game_id}), "
                f"{'game-only' if game_only else 'merging clips'}"
            )
        elif sharer_conn:
            recipient_game_id = _copy_game(
                sharer_conn, recipient_conn, game_id, shared_by=shared_by)
            logger.info(
                f"[Materialize] Created game {recipient_game_id} in recipient's DB"
            )
        else:
            # T4315 round 3 (MINOR): no need to close here -- the `finally`
            # below always closes recipient_conn exactly once regardless of
            # how this block exits (sqlite3 close() is idempotent, but the
            # double-call was pure redundancy).
            raise ValueError(
                "Cannot create game without sharer's DB (pending share with no sharer DB)"
            )

        if game_only:
            result = {"inserted": 0, "merged": 0, "inserted_clips": []}
        else:
            result = _materialize_clips(
                recipient_conn, recipient_game_id, clip_data,
                shared_by=shared_by, sharer_profile_name=sharer_profile_name,
            )

        # Auto-create a draft reel for each shared 5-star clip, using the exact
        # same path as the "mark 5-star / create reel" gesture in the editor.
        # Runs on the recipient's connection before commit, so the draft projects
        # sync to R2 in the same transaction as the materialized clips.
        from app.routers.clips import _create_auto_project_for_clip
        reel_cursor = recipient_conn.cursor()
        for clip in result["inserted_clips"]:
            if clip["rating"] == 5:
                _create_auto_project_for_clip(
                    reel_cursor, clip["id"], clip["name"] or "")

        recipient_conn.commit()

        # BLOCKING NEW-A (T4315 round 3): _open_profile_db sets
        # journal_mode=WAL, so the commit above lands in profile.sqlite-wal,
        # not the main file. sync_db_to_r2_explicit uploads ONLY the main
        # file (storage.py: client.upload_file on local_db_path) -- with no
        # checkpoint first, R2 would receive stale (pre-share) bytes stamped
        # at a NEWER version than reality. That is worse than not syncing at
        # all: the next machine's restore-if-newer sees "local >= r2" and
        # never re-pulls the real data, so the share is permanently invisible
        # even though Postgres (below) reports it materialized. Checkpoint
        # BEFORE upload, not after -- recipient_conn stays open (closed once,
        # normally, in the `finally` below) so this is just a flush.
        #
        # BLOCKING-1 (T4315 round 4): PRAGMA wal_checkpoint does NOT raise on
        # contention -- it returns (busy, log, checkpointed) with busy=1 and
        # leaves the just-committed frames sitting in profile.sqlite-wal.
        # Round 3 logged that tuple and discarded it, so a contended
        # checkpoint (session_init's own later steps -- recover_orphaned_
        # reservations, backfill_*, archive_completed_projects -- CAN hold
        # this exact file open concurrently, per the NEW-B writeup, though
        # those hold their own connections only for short transactions, so
        # the window is narrow rather than routine) silently fell through to
        # uploading the STALE main file anyway, stamped at the new version.
        # A short busy_timeout here (not the connection's 30s default from
        # _open_profile_db) turns "wait 30s then give up" into "fail fast,"
        # and checking `busy` turns a silent
        # stale upload into a loud, retryable refusal via the SAME
        # ProfileDBRefreshFailed path already used for a failed sync below.
        recipient_conn.execute("PRAGMA busy_timeout=2000")
        busy, _log, _ckpt = recipient_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        if busy:
            logger.error(
                f"[Materialize] WAL checkpoint busy for recipient {recipient_user_id}/"
                f"{recipient_profile_id} before upload (share_id={share_id}) -- "
                f"refusing to upload a possibly-stale main file"
            )
            raise ProfileDBRefreshFailed(
                f"could not checkpoint recipient profile {recipient_profile_id} before upload "
                f"(WAL in use) -- share_id={share_id} stays retryable"
            )

        # BLOCKING-1 (T4315 round 2): recipient_conn is a raw sqlite3.Connection
        # from _open_profile_db, NOT a TrackedConnection -- the middleware's
        # foreign-DB sync (db_sync.py get_request_written_*_dbs) only sees
        # TrackedConnection owners, so this write is invisible to it and was
        # NEVER synced by anything, for ANY recipient (pre-existing, not new
        # to require_fresh -- the download just made the write reachable even
        # when the recipient wasn't already cached locally). Sync explicitly
        # and refuse to mark the share materialized in Postgres on failure --
        # a share that never left local disk must stay retryable, never a
        # permanent "success" that Postgres will never re-attempt.
        target_synced = sync_db_to_r2_explicit(recipient_user_id, recipient_profile_id)
        if not target_synced:
            logger.error(
                f"[Materialize] R2 sync FAILED for recipient {recipient_user_id}/"
                f"{recipient_profile_id} after materializing share_id={share_id} -- "
                f"NOT marking materialized so it retries instead of being lost"
            )
            raise ProfileDBRefreshFailed(
                f"could not sync recipient profile {recipient_profile_id} to R2 "
                f"after materializing share_id={share_id}"
            )

        # Create storage refs in Postgres
        if hashes:
            _create_storage_refs(
                sharer_user_id, sharer_profile_id,
                recipient_user_id, recipient_profile_id,
                hashes,
            )

        mark_game_share_materialized(share_id, recipient_profile_id)

        try:
            from app.services.sharing_db import SHARE_TYPE_TO_CHANNEL, record_referral
            with get_pg() as pg_conn:
                pg_cur = pg_conn.cursor()
                pg_cur.execute(
                    "SELECT share_type, sharer_default_sport FROM shares WHERE id = %s",
                    (share_id,))
                share_row = pg_cur.fetchone()
            inherited_sport = share_row["sharer_default_sport"] if share_row else None
            if tag_name:
                channel = "teammate_share"
            else:
                channel = SHARE_TYPE_TO_CHANNEL.get(share_row["share_type"]) if share_row else None
            if channel:
                record_referral(sharer_user_id, recipient_user_id, channel, str(share_id),
                                inherited_sport=inherited_sport)
        except Exception:
            logger.warning(
                f"[Materialize] Referral attribution failed for share_id={share_id}",
                exc_info=True,
            )

        logger.info(
            f"[Materialize] Done: game_id={recipient_game_id}, "
            f"inserted={result['inserted']}, merged={result['merged']}"
        )
        return {
            "game_id": recipient_game_id,
            "inserted": result["inserted"],
            "merged": result["merged"],
            "skipped": False,
        }

    finally:
        recipient_conn.close()
        if sharer_conn:
            sharer_conn.close()


def serialize_clip_data(clips: list[dict]) -> bytes:
    """Serialize filtered clip data to msgpack for pending_teammate_shares.clip_data."""
    clean = []
    for c in clips:
        clean.append({
            "rating": c.get("rating"),
            "tags": c.get("tags"),
            "name": c.get("name"),
            "notes": c.get("notes"),
            "start_time": c.get("start_time"),
            "end_time": c.get("end_time"),
            "video_sequence": c.get("video_sequence"),
            "tagged_teammates": c.get("tagged_teammates"),
        })
    return encode_data(clean)


def claim_game_link(
    share: dict,
    claimer_user_id: str,
    claimer_profile_id: str,
    include_annotations: bool,
    sharer_email: str | None = None,
) -> dict:
    """Materialize a public game-link claim into the claimer's chosen profile (T5730).

    `share` is a get_game_share_by_token(...) row (must be a live `game_link`; the
    caller enforces share_type/revoked). Routes through materialize_game_share so the
    copied game + clips inherit a NON-NULL `shared_by` (T5330 invariant -- onboarding
    stays blind to imported content). Game always; team annotations opt-in.

    Idempotency (EPIC decision 5):
      - A repeat claim resolves to the SAME local game via the share_claims row AND
        video-hash dedup, never a second copy.
      - A re-claim with include_annotations=True after a game-only claim materializes
        the Team-layer clips into that same game (materialize's merge path handles
        overlap), and upgrades the claim row.

    Returns {game_id, already_claimed, imported_annotations}.
    """
    share_id = share["id"]
    sharer_user_id = share["sharer_user_id"]
    sharer_profile_id = share["sharer_profile_id"]
    game_id = share["game_id"]

    existing = get_share_claim(share_id, claimer_user_id)
    if existing:
        # Idempotent: already imported annotations, OR this call adds nothing new
        # (game-only re-claim). Return the SAME local game -- no re-materialize.
        if existing["include_annotations"] or not include_annotations:
            return {
                "game_id": existing["local_game_id"],
                "profile_id": existing["claimer_profile_id"],
                "already_claimed": True,
                "imported_annotations": bool(existing["include_annotations"]),
            }
        # Upgrade path: game-only -> with-annotations. Land the clips in the SAME
        # profile the game was first claimed into so hash-dedup finds that game.
        claimer_profile_id = existing["claimer_profile_id"] or claimer_profile_id
        include_annotations = True

    # The claimer is (almost always) a different user than the sharer, so the
    # sharer's profile DB may not be cached on this machine. Pull it read-only
    # from R2 before materialize_game_share's local-only _open_profile_db needs it
    # (same move the collection-share resolve uses). No require_fresh: this is a
    # read of the SOURCE, never written back.
    ensure_profile_db_local(sharer_user_id, sharer_profile_id)

    clip_data: list[dict] = []
    if include_annotations:
        source_conn = open_profile_db_readonly(sharer_user_id, sharer_profile_id)
        if source_conn is None:
            raise ValueError(
                f"Sharer profile DB unavailable for claim: "
                f"{sharer_user_id}/{sharer_profile_id}"
            )
        try:
            clip_data = team_layer_clips_for_game(source_conn, game_id)
        finally:
            source_conn.close()

    # tag_name="" (falsy) -> materialize attributes the referral via the share's
    # own type (game_link -> "game_link_share"), NOT the teammate_share channel.
    result = materialize_game_share(
        sharer_user_id=sharer_user_id,
        sharer_profile_id=sharer_profile_id,
        recipient_user_id=claimer_user_id,
        recipient_profile_id=claimer_profile_id,
        game_id=game_id,
        tag_name="",
        share_id=share_id,
        clip_data=clip_data,
        sharer_email=sharer_email,
    )
    local_game_id = result["game_id"]

    record_share_claim(
        share_id=share_id,
        claimer_user_id=claimer_user_id,
        claimer_profile_id=claimer_profile_id,
        include_annotations=include_annotations,
        local_game_id=local_game_id,
    )

    return {
        "game_id": local_game_id,
        # The profile the game ACTUALLY landed in -- may differ from the caller's
        # pick on an annotations-upgrade re-claim (forced to the original claim's
        # profile so hash-dedup lands the clips in the SAME game). The endpoint
        # echoes THIS so the frontend lands on the right profile's recap.
        "profile_id": claimer_profile_id,
        "already_claimed": False,
        "imported_annotations": include_annotations,
    }
