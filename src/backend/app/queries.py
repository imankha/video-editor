"""
Reusable SQL query helpers and data transformation utilities.

These functions generate SQL subqueries for filtering to the latest version
of records, avoiding duplication of complex window function logic across
multiple files.
"""

from typing import List, Optional

from app.constants import RATING_ADJECTIVES, get_rating_adjective


def derive_clip_name(stored_name: Optional[str], rating: int, tags: List[str]) -> str:
    """
    Derive a clip name from rating and tags if no custom name is stored.

    This is the single source of truth for clip name derivation. The algorithm
    matches the frontend generateClipName() in soccerTags.js.

    Args:
        stored_name: The name stored in the database (None or empty = auto-generate)
        rating: Star rating 1-5
        tags: List of tag short names (e.g., ["Goal", "Dribble"])

    Returns:
        The stored name if present, otherwise a generated name like "Brilliant Goal and Dribble"
    """
    # If there's a stored custom name, use it
    if stored_name:
        return stored_name

    # No tags = no auto-generated name
    if not tags:
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

    The clip identity is determined by COALESCE(rc.end_time, wc.uploaded_filename),
    which groups clips that originated from the same raw clip or have the same
    uploaded filename.

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
                PARTITION BY COALESCE({rc_alias}.end_time, {inner_alias}.uploaded_filename)
                ORDER BY {inner_alias}.version DESC
            ) as rn
            FROM working_clips {inner_alias}
            LEFT JOIN raw_clips {rc_alias} ON {inner_alias}.raw_clip_id = {rc_alias}.id
            {project_clause}
        ) WHERE rn = 1
    """.strip()


def latest_final_videos_subquery() -> str:
    """
    Returns SQL subquery for filtering to latest version per project in final_videos.

    Partitions by project_id and orders by version DESC to get the latest
    final video for each project.

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
                PARTITION BY project_id
                ORDER BY version DESC
            ) as rn
            FROM final_videos
        ) WHERE rn = 1
    """.strip()
