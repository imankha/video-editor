"""
Reusable SQL query helpers and data transformation utilities.

These functions generate SQL subqueries for filtering to the latest version
of records, avoiding duplication of complex window function logic across
multiple files.
"""


import logging

from app.constants import get_rating_adjective

logger = logging.getLogger(__name__)

# T4280: NULL-rating semantics, decided ONCE and used at every read site, replacing the
# three divergent invented defaults (games.py `or 3`, clips.py `or 5`, clips.py `or 3`)
# -- three fallbacks for one field was the smoking gun of the silent-fallback audit.
# raw_clips.rating is NOT NULL, so a missing rating at read time is anomalous (an
# unmatched join or an un-migrated row): surface it (log ERROR) rather than hide it, and
# fall back to a single documented value. UNRATED_RATING is the neutral middle ("interesting").
UNRATED_RATING = 3


def normalize_rating(rating, *, context: str = "") -> int:
    """Return a usable clip rating, logging when the stored value was missing (a bug).

    Trusts any real stored value (including an unexpected 0); only a NULL is substituted,
    and only with a log so the anomaly stays visible. See T4280.
    """
    if rating is None:
        logger.error(
            f"[rating] NULL rating encountered{f' ({context})' if context else ''}; "
            f"raw_clips.rating is NOT NULL so this is a data bug -- using the unrated "
            f"default {UNRATED_RATING}. Investigate the source."
        )
        return UNRATED_RATING
    return rating


def derive_clip_name(stored_name: str | None, rating: int, tags: list[str], notes: str = '', generated_title: str = '') -> str:
    """
    Derive a clip name from rating and tags if no custom name is stored.

    This is the single source of truth for clip name derivation. The algorithm
    matches the frontend generateClipName() in soccerTags.js for tag-based names.
    When notes exist but no tags, uses TF-IDF generated title if provided,
    otherwise falls back to truncated notes.

    Args:
        stored_name: The name stored in the database (None or empty = auto-generate)
        rating: Star rating 1-5
        tags: List of tag short names (e.g., ["Goal", "Dribble"])
        notes: Optional notes text to use as fallback when no tags
        generated_title: Optional TF-IDF generated title from notes (pre-computed)

    Returns:
        The stored name if present, otherwise a generated name like "Brilliant Goal and Dribble"
    """
    # If there's a stored custom name, use it
    if stored_name:
        return stored_name

    # No tags: use TF-IDF generated title if available, else truncate notes
    if not tags:
        if generated_title:
            return generated_title
        if notes and notes.strip():
            words = notes.strip().split()
            result = words[0]
            for word in words[1:]:
                next_result = result + ' ' + word
                if len(next_result) > 30:
                    break
                result = next_result
            return result
        return ''

    adjective = get_rating_adjective(rating)

    # Tags are already short names (Goal, Assist, Dribble, etc.)
    if len(tags) == 1:
        tag_part = tags[0]
    else:
        tag_part = ', '.join(tags[:-1]) + ' and ' + tags[-1]

    return f"{adjective} {tag_part}"


def latest_working_clips_subquery(alias: str = "wc", project_filter: bool = True) -> str:
    """
    Returns SQL subquery for filtering to latest version per working clip identity.

    The clip identity is determined by (project_id, COALESCE(rc.end_time,
    wc.uploaded_filename)) — project_id MUST be in the partition because
    manual multi-clip projects insert working_clips that reuse raw_clip_ids
    from auto-projects (same rc.end_time). Omitting project_id would let
    cross-project ROW_NUMBER tiebreaks delete one project's rows in favour
    of another's (T1532 release-blocker).

    Args:
        alias: Table alias for working_clips (will use alias2 and rc2 internally)
        project_filter: Whether to include project_id = ? filter (adds one ? placeholder)

    Returns:
        SQL string for use in WHERE ... id IN (...)

    Example:
        cursor.execute(f'''
            SELECT * FROM working_clips wc
            WHERE wc.project_id = ? AND wc.id IN ({latest_working_clips_subquery()})
        ''', (project_id, project_id))
    """
    inner_alias = f"{alias}2"
    rc_alias = "rc2"
    project_clause = f"WHERE {inner_alias}.project_id = ?" if project_filter else ""

    return f"""
        SELECT id FROM (
            SELECT {inner_alias}.id, ROW_NUMBER() OVER (
                PARTITION BY {inner_alias}.project_id, COALESCE({rc_alias}.end_time, {inner_alias}.uploaded_filename)
                ORDER BY {inner_alias}.version DESC
            ) as rn
            FROM working_clips {inner_alias}
            LEFT JOIN raw_clips {rc_alias} ON {inner_alias}.raw_clip_id = {rc_alias}.id
            {project_clause}
        ) WHERE rn = 1
    """.strip()


def latest_final_videos_subquery() -> str:
    """
    Returns SQL subquery for filtering to latest version per source in final_videos.

    Partitions by:
    - project_id for project-based exports (brilliant_clip, custom_project)
    - game_id for annotated game exports (where project_id IS NULL)

    Uses (COALESCE(project_id, 0), COALESCE(game_id, 0)) as composite key to avoid collisions.

    T4850 (transferred reels): a reel MOVED to another profile keeps no source
    lineage in its new profile — both project_id AND game_id are NULL (the
    editing lineage stays behind in the source profile). Without a discriminator
    those rows would all collapse into the single (0, 0) partition and only ONE
    moved reel would survive the MAX(version) filter. The per-row `id` tiebreaker
    (added ONLY when both keys are NULL) gives each moved reel its own partition.
    It is a strict no-op for every pre-T4850 row: an exported reel always carries
    a project_id (brilliant_clip / custom_project) or a game_id (annotated_game),
    so the CASE yields 0 and version dedup within a source is unchanged.

    Returns:
        SQL string for use in WHERE ... id IN (...)

    Example:
        cursor.execute(f'''
            SELECT * FROM final_videos fv
            WHERE fv.id IN ({latest_final_videos_subquery()})
        ''')
    """
    return """
        SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY COALESCE(project_id, 0), COALESCE(game_id, 0),
                             CASE WHEN project_id IS NULL AND game_id IS NULL
                                  THEN id ELSE 0 END
                ORDER BY version DESC
            ) as rn
            FROM final_videos
        ) WHERE rn = 1
    """.strip()


def exclude_teammate_reels_clause(fv_alias: str = "fv") -> str:
    """AND-prefixed SQL fragment that drops teammate-only single-clip reels from
    the user's OWN collections + rankings (bug 22).

    A single-clip reel's "My Athlete" status IS its source clip's, derived (not
    denormalized) via final_videos.source_clip_id -> raw_clips.my_athlete. A reel
    built from a teammate clip (my_athlete = 0) is excluded everywhere the user's
    own highlights are surfaced (Rankings, Collections gallery/summary, share
    resolution). The reel still exists and stays viewable/shareable directly.

    Kept (status can't be denied): multi-clip reels (source_clip_id NULL ->
    Mixes), orphans / deleted source clips (no raw_clips row), and pre-migration
    clips (my_athlete NULL). The correlated NOT EXISTS avoids alias collisions
    with the outer query and latest_final_videos_subquery().
    """
    return f"""
        AND NOT EXISTS (
            SELECT 1 FROM raw_clips rc
            WHERE rc.id = {fv_alias}.source_clip_id AND rc.my_athlete = 0
        )
    """.strip()
