"""
Games endpoints for the Video Editor API.

This router handles game storage and management:
- /api/games - List all games
- /api/games - Create a game (POST with video)
- /api/games/{id} - Get game details (including annotations from file)
- /api/games/{id} - Update game name
- /api/games/{id} - Delete a game
- /api/games/{id}/video - Stream game video
- /api/games/{id}/annotations - Update annotations (saves to file)
"""

from fastapi import APIRouter, Form, HTTPException, Body
from typing import Optional, List
import os
import logging
import json

from app.database import get_db_connection, get_raw_clips_path, ensure_directories
from app.storage import generate_presigned_url_global

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/games", tags=["games"])

# Import rating constants from shared module (single source of truth)
from app.constants import (
    RATING_ADJECTIVES,
    TAG_SHORT_NAMES,
    get_rating_adjective,
    get_tag_short_name,
)


def generate_clip_name(rating: int, tags: list) -> str:
    """
    Generate a default clip name based on rating and tags.
    Must match frontend generateClipName() in soccerTags.js.
    """
    if not tags:
        return ''

    adjective = get_rating_adjective(rating)

    # Convert tag names to short names
    short_names = [get_tag_short_name(tag) for tag in tags]

    # Join with "and" for multiple tags
    if len(short_names) == 1:
        tag_part = short_names[0]
    else:
        tag_part = ', '.join(short_names[:-1]) + ' and ' + short_names[-1]

    return f"{adjective} {tag_part}"


def generate_game_display_name(
    opponent_name: Optional[str],
    game_date: Optional[str],
    game_type: Optional[str],
    tournament_name: Optional[str],
    fallback_name: str
) -> str:
    """
    Generate a display name for a game based on its details.

    Format:
    - Home: "Vs <Opponent> <Date>"
    - Away: "at <Opponent> <Date>"
    - Tournament: "<Tournament>: Vs <Opponent> <Date>"

    Falls back to the stored name if opponent_name is not set.
    """
    if not opponent_name:
        return fallback_name

    # Format date as "Mon D" (e.g., "Dec 6")
    date_str = ""
    if game_date:
        try:
            from datetime import datetime
            dt = datetime.strptime(game_date, "%Y-%m-%d")
            date_str = dt.strftime("%b %-d")  # "Dec 6"
        except (ValueError, Exception):
            # On Windows, %-d may not work, try %#d
            try:
                from datetime import datetime
                dt = datetime.strptime(game_date, "%Y-%m-%d")
                date_str = dt.strftime("%b %d").replace(" 0", " ")  # Remove leading zero
            except:
                date_str = game_date

    # Build the name based on game type
    if game_type == 'tournament' and tournament_name:
        prefix = f"{tournament_name}: Vs"
    elif game_type == 'away':
        prefix = "at"
    else:  # home or default
        prefix = "Vs"

    parts = [prefix, opponent_name]
    if date_str:
        parts.append(date_str)

    return " ".join(parts)


@router.get("")
async def list_games():
    """List all saved games. Videos stored globally at games/{blake3_hash}.mp4."""
    ensure_directories()

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, name, blake3_hash, created_at,
                   clip_count, brilliant_count, good_count, interesting_count,
                   mistake_count, blunder_count, aggregate_score,
                   opponent_name, game_date, game_type, tournament_name
            FROM games
            ORDER BY created_at DESC
        """)
        rows = cursor.fetchall()

        games = []
        for row in rows:
            display_name = generate_game_display_name(
                row['opponent_name'],
                row['game_date'],
                row['game_type'],
                row['tournament_name'],
                row['name']
            )

            video_url = generate_presigned_url_global(
                f"games/{row['blake3_hash']}.mp4",
                expires_in=14400
            )

            games.append({
                'id': row['id'],
                'name': display_name,
                'raw_name': row['name'],
                'blake3_hash': row['blake3_hash'],
                'video_url': video_url,
                'clip_count': row['clip_count'] or 0,
                'brilliant_count': row['brilliant_count'] or 0,
                'good_count': row['good_count'] or 0,
                'interesting_count': row['interesting_count'] or 0,
                'mistake_count': row['mistake_count'] or 0,
                'blunder_count': row['blunder_count'] or 0,
                'aggregate_score': row['aggregate_score'] or 0,
                'created_at': row['created_at'],
            })

        return {'games': games}


@router.get("/tournaments")
async def list_tournaments():
    """
    List all unique tournament names that have been used.
    Returns tournaments sorted alphabetically for dropdown selection.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT tournament_name
            FROM games
            WHERE tournament_name IS NOT NULL
              AND tournament_name != ''
            ORDER BY tournament_name ASC
        """)
        rows = cursor.fetchall()
        tournaments = [row['tournament_name'] for row in rows]

    return {'tournaments': tournaments}


@router.get("/{game_id}")
async def get_game(game_id: int):
    """Get game details including annotations. Updates last_accessed_at."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            SELECT id, name, blake3_hash, created_at,
                   video_duration, video_width, video_height, video_size,
                   opponent_name, game_date, game_type, tournament_name
            FROM games
            WHERE id = ?
        """, (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        # Update last_accessed_at
        cursor.execute(
            "UPDATE games SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (game_id,)
        )
        conn.commit()

        annotations = load_annotations_from_db(game_id)

        display_name = generate_game_display_name(
            row['opponent_name'],
            row['game_date'],
            row['game_type'],
            row['tournament_name'],
            row['name']
        )

        video_url = generate_presigned_url_global(
            f"games/{row['blake3_hash']}.mp4",
            expires_in=14400
        )

        return {
            'id': row['id'],
            'name': display_name,
            'raw_name': row['name'],
            'blake3_hash': row['blake3_hash'],
            'video_url': video_url,
            'annotations': annotations,
            'clip_count': len(annotations),
            'created_at': row['created_at'],
            'video_duration': row['video_duration'],
            'video_width': row['video_width'],
            'video_height': row['video_height'],
            'video_size': row['video_size'],
        }


@router.put("/{game_id}")
async def update_game(
    game_id: int,
    name: Optional[str] = Form(None)
):
    """Update game name."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Check game exists
        cursor.execute("SELECT id FROM games WHERE id = ?", (game_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Game not found")

        if name is None:
            raise HTTPException(status_code=400, detail="No updates provided")

        cursor.execute("UPDATE games SET name = ? WHERE id = ?", (name, game_id))
        conn.commit()

        logger.info(f"Updated game {game_id} name to: {name}")
        return {'success': True}


@router.put("/{game_id}/annotations")
async def update_annotations(
    game_id: int,
    annotations: List = Body(...)
):
    """
    Update game annotations.

    Saves annotations to the database.
    Call this whenever annotations change in the frontend.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM games WHERE id = ?", (game_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Game not found")

    # Save annotations to database
    save_annotations_to_db(game_id, annotations)

    logger.info(f"Updated annotations for game {game_id}: {len(annotations)} clips")
    return {
        'success': True,
        'clip_count': len(annotations)
    }


@router.delete("/{game_id}")
async def delete_game(game_id: int):
    """Delete a game from user's database. Global video is NOT deleted (may be shared)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM games WHERE id = ?", (game_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Game not found")

        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()

        logger.info(f"Deleted game {game_id}")
        return {'success': True}


@router.get("/{game_id}/video")
async def get_game_video(game_id: int):
    """Redirect to presigned R2 URL for game video. Updates last_accessed_at."""
    from fastapi.responses import RedirectResponse

    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT blake3_hash FROM games WHERE id = ?", (game_id,))
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Game not found")

        # Update last_accessed_at
        cursor.execute(
            "UPDATE games SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?",
            (game_id,)
        )
        conn.commit()

        presigned_url = generate_presigned_url_global(
            f"games/{row['blake3_hash']}.mp4",
            expires_in=14400
        )
        if presigned_url:
            return RedirectResponse(url=presigned_url, status_code=302)
        raise HTTPException(status_code=404, detail="Failed to generate R2 URL")


# ============================================================================
# Database-backed annotation functions (for Phase 3+ of the refactor)
# ============================================================================

def calculate_aggregates(annotations: list) -> dict:
    """
    Calculate aggregate counts from a list of annotations.

    Returns dict with:
    - clip_count: total number of annotations
    - brilliant_count: rating 5
    - good_count: rating 4
    - interesting_count: rating 3
    - mistake_count: rating 2
    - blunder_count: rating 1
    - aggregate_score: weighted sum
    """
    counts = {
        'clip_count': len(annotations),
        'brilliant_count': 0,
        'good_count': 0,
        'interesting_count': 0,
        'mistake_count': 0,
        'blunder_count': 0,
    }

    for ann in annotations:
        rating = ann.get('rating', 3)
        if rating == 5:
            counts['brilliant_count'] += 1
        elif rating == 4:
            counts['good_count'] += 1
        elif rating == 3:
            counts['interesting_count'] += 1
        elif rating == 2:
            counts['mistake_count'] += 1
        elif rating == 1:
            counts['blunder_count'] += 1

    # Calculate aggregate score
    # Weighted score that rewards good clips and penalizes bad ones
    counts['aggregate_score'] = (
        counts['brilliant_count'] * 10 +
        counts['good_count'] * 5 +
        counts['interesting_count'] * 2 +
        counts['mistake_count'] * -2 +
        counts['blunder_count'] * -5
    )

    return counts


def update_game_aggregates(cursor, game_id: int, annotations: list) -> None:
    """Update the aggregate columns on a game based on its annotations."""
    agg = calculate_aggregates(annotations)
    cursor.execute("""
        UPDATE games SET
            clip_count = ?,
            brilliant_count = ?,
            good_count = ?,
            interesting_count = ?,
            mistake_count = ?,
            blunder_count = ?,
            aggregate_score = ?
        WHERE id = ?
    """, (
        agg['clip_count'],
        agg['brilliant_count'],
        agg['good_count'],
        agg['interesting_count'],
        agg['mistake_count'],
        agg['blunder_count'],
        agg['aggregate_score'],
        game_id
    ))


def load_annotations_from_db(game_id: int) -> list:
    """Load annotations from raw_clips table for a game."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Query raw_clips as the single source of truth for clip annotations
        cursor.execute("""
            SELECT id, start_time, end_time, name, rating, tags, notes
            FROM raw_clips
            WHERE game_id = ?
            ORDER BY end_time
        """, (game_id,))
        rows = cursor.fetchall()

        annotations = []
        for row in rows:
            # Parse tags from JSON string
            tags = json.loads(row['tags']) if row['tags'] else []

            # Generate default name if empty
            name = row['name']
            if not name:
                name = generate_clip_name(row['rating'], tags)

            annotations.append({
                'id': row['id'],  # raw_clip id for frontend sync
                'raw_clip_id': row['id'],  # Also send as raw_clip_id for importAnnotations
                'start_time': row['start_time'],
                'end_time': row['end_time'],
                'name': name,
                'rating': row['rating'],
                'tags': tags,
                'notes': row['notes'] or ''
            })

        return annotations


def save_annotations_to_db(game_id: int, annotations: list) -> None:
    """
    Save annotations to raw_clips table, syncing with existing records.

    Uses natural key (game_id, end_time) to match annotations with raw_clips.
    - Updates existing clips' metadata (name, rating, tags, notes, start_time)
    - Deletes clips that are no longer in the annotations list
    - New clips are expected to be created via real-time save (with FFmpeg extraction)
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Get existing raw_clips for this game (using end_time as natural key)
        cursor.execute("""
            SELECT id, end_time, filename, auto_project_id
            FROM raw_clips
            WHERE game_id = ?
        """, (game_id,))
        existing_clips = {row['end_time']: dict(row) for row in cursor.fetchall()}

        # Track which end_times are still present in annotations
        annotation_end_times = set()

        for ann in annotations:
            end_time = ann.get('end_time', ann.get('start_time', 0))
            annotation_end_times.add(end_time)

            tags = ann.get('tags', [])
            tags_json = json.dumps(tags)
            rating = ann.get('rating', 3)
            name = ann.get('name', '')

            # Don't store default names - they should be computed on read
            default_name = generate_clip_name(rating, tags)
            if name == default_name:
                name = ''

            if end_time in existing_clips:
                # Update existing raw_clip metadata
                cursor.execute("""
                    UPDATE raw_clips
                    SET start_time = ?, name = ?, rating = ?, tags = ?, notes = ?
                    WHERE id = ?
                """, (
                    ann.get('start_time', 0),
                    name,
                    rating,
                    tags_json,
                    ann.get('notes', ''),
                    existing_clips[end_time]['id']
                ))
            else:
                # Create new raw_clip with empty filename (pending extraction)
                # This is a fallback if real-time save failed
                cursor.execute("""
                    INSERT INTO raw_clips (filename, rating, tags, name, notes, start_time, end_time, game_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    '',  # empty filename = pending extraction
                    rating,
                    tags_json,
                    name,
                    ann.get('notes', ''),
                    ann.get('start_time', 0),
                    end_time,
                    game_id
                ))
                logger.info(f"Created pending raw_clip for game {game_id} at end_time {end_time}")

        # Delete raw_clips that are no longer in annotations
        for end_time, clip_data in existing_clips.items():
            if end_time not in annotation_end_times:
                clip_id = clip_data['id']
                filename = clip_data['filename']
                auto_project_id = clip_data['auto_project_id']

                # Delete auto-project if exists and unmodified
                if auto_project_id:
                    _delete_auto_project_if_unmodified(cursor, auto_project_id)

                # Delete working clips that reference this raw clip
                cursor.execute("DELETE FROM working_clips WHERE raw_clip_id = ?", (clip_id,))

                # Delete the raw clip record
                cursor.execute("DELETE FROM raw_clips WHERE id = ?", (clip_id,))

                # Delete the file from disk
                if filename:
                    file_path = get_raw_clips_path() / filename
                    if file_path.exists():
                        os.unlink(file_path)
                        logger.info(f"Deleted clip file: {file_path}")

        # Update aggregates
        update_game_aggregates(cursor, game_id, annotations)

        conn.commit()


def _delete_auto_project_if_unmodified(cursor, project_id: int) -> bool:
    """Delete an auto-created project if it hasn't been modified."""
    # Check if project has been modified (has working video, final video, or multiple clips)
    cursor.execute("""
        SELECT p.working_video_id, p.final_video_id,
               (SELECT COUNT(*) FROM working_clips WHERE project_id = p.id) as clip_count
        FROM projects p WHERE p.id = ?
    """, (project_id,))
    project = cursor.fetchone()

    if not project:
        return False

    # Don't delete if project has been worked on
    if project['working_video_id'] or project['final_video_id'] or project['clip_count'] > 1:
        logger.info(f"Keeping modified auto-project {project_id}")
        return False

    # Delete the working clip first (foreign key constraint)
    cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))

    # Delete the project
    cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))

    logger.info(f"Deleted unmodified auto-project {project_id}")
    return True


@router.post("/{game_id}/finish-annotation")
async def finish_annotation(game_id: int):
    """
    Called when user leaves annotation mode for a game.

    This endpoint is a no-op - extraction is NOT triggered here.

    Extraction only happens when:
    1. A clip is added to a project (auto-project for 5-star, or manual add)
    2. User chooses "Use Latest" on outdated clips prompt

    This gives the user full control over when extraction (and GPU costs) occur.
    """
    logger.info(f"[FinishAnnotation] User left annotation mode for game {game_id} (no extraction triggered)")
    return {
        "success": True,
        "tasks_created": 0,
        "message": "Annotation session ended"
    }


