"""Serve-time metadata + cover-art stamping for downloaded reels (T6360).

Every video leaving ReelBallers is stamped with rich container metadata (title,
author, album, game date, description, attribution, genre) and -- when a
publish-time poster exists -- an embedded cover-art frame, so the file lands in
Finder / QuickTime / VLC / Plex / the camera roll as a named, dated, illustrated
play instead of an anonymous `*_final.mp4` with a film-strip icon.

This is the THIRD serve-time pass on the download path, after the branded outro
(T3950) and the player intro (T5220) -- both folded into the single
`compose_serve_time` concat. Ordering: `[intro?][reel][outro?]` is composed
FIRST (that pass owns the pixels), THEN this metadata pass runs over the composed
file. Kept as its own INDEPENDENT ffmpeg invocation (design recommendation in the
task file), so it is independently testable, independently failing, and unchanged
when the outro/intro are disabled.

Everything here is written with `-c copy` -- NO re-encode, NO pixel/audio change.
The cover art is added as an `attached_pic` stream; the real video stream is
copied byte-for-byte.

Same failure contract as the outro (T3950): this NEVER raises and NEVER fails a
download. `stamp_download_metadata` returns False and the caller ships the
unstamped (but playable) file. `build_*` return a best-effort field map; an
absent field is OMITTED, never guessed (no silent fallback -- a visibly missing
date beats a wrong date in a camera-roll timeline).

Deliberately NEVER written (task file, permanently out of scope): location / GPS,
chapters / subtitle tracks, any loudness or pixel/audio change.

NOTE ON CACHING: the stamping pass is applied PER REQUEST at the router, on top
of (and never baked into) the T4947 collection-download cache. `artist` is the
current profile name, which a rename can change without touching any cached
input; keeping the stamp out of the cache means a rename is reflected on the very
next download with no stale-artist cache poisoning.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

# Machine-readable attribution to pair with the burned-in branded outro. ASCII
# only (the hyphen is a plain '-', never an em-dash) -- some players/panels mangle
# non-ASCII metadata, and it keeps the value greppable.
BRAND_ATTRIBUTION = "Made with ReelBallers - reelballers.com"
BRAND_PUBLISHER = "ReelBallers"
DEFAULT_GENRE = "Sports"


def _base_tags() -> dict[str, str]:
    """The constant attribution block written on EVERY download, regardless of
    what per-reel facts resolve. Process-constant, so always cache-safe."""
    return {
        "copyright": BRAND_ATTRIBUTION,
        "publisher": BRAND_PUBLISHER,
        "encoder": BRAND_PUBLISHER,
        "genre": DEFAULT_GENRE,
    }


def _athlete_name(user_id: str | None, profile_id: str | None) -> str | None:
    """The profile's full name (the athlete), the `artist`/`album_artist` source
    -- the SAME value the player intro burns as its title (T6570). None (field
    omitted) when unset or unreadable; never raises."""
    if not user_id or not profile_id:
        return None
    try:
        from app.services.user_db import get_all_intro_full_names
        name = get_all_intro_full_names(user_id).get(profile_id)
        return name or None
    except Exception as e:
        logger.info(f"[DownloadMetadata] could not resolve athlete name: {e}")
        return None


def _game_attribution(conn, game_id: int | None) -> tuple[str | None, str | None]:
    """(display_name, game_date) for a single-game reel, or (None, None).

    Reuses `downloads._generate_game_display_name` (the SAME "Vs <Opp> <Date>"
    the gallery shows) -- lazily imported to avoid a router<->service import
    cycle. `game_date` is returned VERBATIM ('YYYY-MM-DD') only when present; a
    missing date yields None so the caller omits `date`/`creation_time` rather
    than guessing (task file: a visibly absent date beats a wrong one)."""
    if game_id is None:
        return (None, None)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT name, game_date, opponent_name, game_type, tournament_name "
            "FROM games WHERE id = ?",
            (game_id,),
        )
        row = cur.fetchone()
        if row is None:
            return (None, None)
        from app.routers.downloads import _generate_game_display_name
        display = _generate_game_display_name(
            row["opponent_name"], row["game_date"], row["game_type"],
            row["tournament_name"], row["name"] or f"Game {game_id}",
        )
        game_date = row["game_date"] or None
        return (display, game_date)
    except Exception as e:
        logger.info(f"[DownloadMetadata] game attribution failed for game {game_id}: {e}")
        return (None, None)


def _comment(name: str | None, album: str | None, tags: list[str] | None) -> str | None:
    """Short human line for the 'Get Info'/Properties panel: reel name, game,
    tags. None when there's nothing meaningful to say."""
    parts: list[str] = []
    if name:
        parts.append(name)
    if album and album != name:
        parts.append(album)
    if tags:
        parts.append(", ".join(tags))
    return " - ".join(parts) if parts else None


def build_download_metadata(
    conn, download_id: int, user_id: str | None = None, profile_id: str | None = None,
) -> dict:
    """Assemble the ffmpeg `-metadata` field map + poster reference for a single
    reel download from the DB, over the ALREADY-OPEN profile connection `conn`.

    Returns `{"tags": {ffmpeg_key: value}, "cover_path": None,
    "poster_basename": str|None}`. `cover_path` is filled in by the router AFTER
    it downloads the poster object to a temp dir (R2 access differs by egress).
    Absent fields are OMITTED, never guessed. Best-effort: on any read failure it
    still returns at least the constant attribution block (never raises)."""
    tags = _base_tags()
    poster_basename: str | None = None
    try:
        from app.database import column_exists
        cur = conn.cursor()
        has_poster = column_exists(cur, "final_videos", "poster_filename")
        poster_col = "poster_filename" if has_poster else "NULL AS poster_filename"
        cur.execute(
            f"SELECT name, filename, game_id, tags, {poster_col} "
            f"FROM final_videos WHERE id = ?",
            (download_id,),
        )
        row = cur.fetchone()
        if row is not None:
            name = row["name"]
            if name:
                tags["title"] = name

            athlete = _athlete_name(user_id, profile_id)
            if athlete:
                tags["artist"] = athlete
                tags["album_artist"] = athlete

            album, game_date = _game_attribution(conn, row["game_id"])
            if album:
                tags["album"] = album
            if game_date:
                # ffmpeg `date` takes YYYY-MM-DD; `creation_time` wants ISO 8601.
                # Noon UTC avoids a timezone rollover shifting the calendar day.
                tags["date"] = game_date
                tags["creation_time"] = f"{game_date}T12:00:00Z"

            from app.utils.encoding import decode_data
            reel_tags = decode_data(row["tags"]) if row["tags"] else None
            comment = _comment(name, album, reel_tags)
            if comment:
                tags["comment"] = comment
                tags["description"] = comment

            if row["poster_filename"]:
                poster_basename = row["poster_filename"]
    except Exception as e:
        logger.info(f"[DownloadMetadata] build failed for download {download_id}: {e}")

    return {"tags": tags, "cover_path": None, "poster_basename": poster_basename}


def _collection_title(scope_type: str, tags: list[str] | None) -> str:
    """A human title for a collection download (no PII -- scope-derived only)."""
    if scope_type == "game":
        return "Game Highlights"
    if scope_type == "mixes":
        return "Mixes"
    if tags:
        return f"{' '.join(tags)} Highlights"
    return "Highlights"


def build_collection_metadata(
    scope_type: str, tags: list[str] | None, user_id: str | None, profile_id: str | None,
) -> dict:
    """The `-metadata` field map for a stitched COLLECTION download (T4945/T4946).

    A collection spans many reels/games, so there is no single game date and no
    single publish-time poster -- title/album come from the collection's scope and
    `artist` from the profile name. No `cover_path` (no per-collection poster
    object). Same omit-absent-fields contract; never raises."""
    field_map = _base_tags()
    title = _collection_title(scope_type, tags)
    field_map["title"] = title
    field_map["album"] = title
    athlete = _athlete_name(user_id, profile_id)
    if athlete:
        field_map["artist"] = athlete
        field_map["album_artist"] = athlete
    field_map["comment"] = f"{title} - {BRAND_ATTRIBUTION}"
    field_map["description"] = field_map["comment"]
    return {"tags": field_map, "cover_path": None, "poster_basename": None}


def stamp_download_metadata(in_path: str, out_path: str, meta: dict) -> bool:
    """Stream-copy `in_path` to `out_path`, writing `meta["tags"]` as container
    metadata and (when `meta["cover_path"]` is a readable JPEG) embedding it as an
    `attached_pic` cover-art stream. `+faststart` is preserved.

    `-c copy` => the real video/audio streams are byte-identical; only the moov
    metadata atom and the appended still image change. Returns True on success,
    False on skip (nothing to write) or ANY failure -- the caller then ships the
    unstamped `in_path`. NEVER raises (T3950 outro contract)."""
    import subprocess

    tags: dict[str, str] = (meta or {}).get("tags") or {}
    cover_path = (meta or {}).get("cover_path")
    has_cover = bool(cover_path) and os.path.exists(cover_path)
    if not tags and not has_cover:
        return False

    cmd = ["ffmpeg", "-y", "-i", in_path]
    if has_cover:
        cmd += ["-i", cover_path]
    cmd += ["-map", "0"]
    if has_cover:
        cmd += ["-map", "1"]
    cmd += ["-c", "copy"]
    if has_cover:
        # Encode input 1 as an mjpeg attached_pic (the `covr` cover-art stream).
        # It is a still, not a real video track -- attached_pic disposition keeps
        # players from listing it as a selectable video stream.
        cmd += ["-c:v:1", "mjpeg", "-disposition:v:1", "attached_pic"]
    for key, value in tags.items():
        if value is None:
            continue
        cmd += ["-metadata", f"{key}={value}"]
    cmd += ["-movflags", "+faststart", out_path]

    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=120)
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "")[-600:]
        logger.error(f"[DownloadMetadata] ffmpeg stamp failed; shipping unstamped. stderr:\n{stderr}")
        return False
    except Exception as e:
        logger.error(f"[DownloadMetadata] stamp error; shipping unstamped: {e}", exc_info=True)
        return False

    if not (os.path.exists(out_path) and os.path.getsize(out_path) > 0):
        logger.error("[DownloadMetadata] stamp produced no output; shipping unstamped")
        return False
    logger.info(
        f"[DownloadMetadata] stamped {len(tags)} tag(s), cover={'yes' if has_cover else 'no'}"
    )
    return True


def apply_download_metadata(serve_path: str, tmp_dir: str, meta: dict | None) -> str:
    """Router convenience: run the stamping pass over `serve_path` (the composed
    file), returning the path to STREAM. On success that's a new stamped file in
    `tmp_dir`; on skip/failure it's `serve_path` unchanged. Never raises."""
    if not meta:
        return serve_path
    stamped = os.path.join(tmp_dir, "stamped.mp4")
    try:
        if stamp_download_metadata(serve_path, stamped, meta):
            return stamped
    except Exception as e:  # defense in depth -- stamp already swallows, but a
        logger.error(f"[DownloadMetadata] apply failed; serving unstamped: {e}")  # download must never break
    return serve_path


def fetch_owner_cover(
    user_id: str, profile_id: str, poster_basename: str, dest_path: str,
) -> bool:
    """Download an OWNER reel's publish-time poster (`final_videos/posters/
    {filename}.jpg`) to `dest_path` for use as cover art. `poster_basename` is
    the `final_videos.poster_filename` value, already the `{filename}.jpg`
    basename (`poster.py::poster_basename`). Explicit `profile_id` (never the
    ambient ContextVar) since this runs inside the deferred streaming generator.
    False (skip cover) on any miss/failure -- never raises."""
    try:
        from app.services.poster import poster_rel_path
        from app.storage import download_from_r2
        rel = poster_rel_path(poster_basename)
        return bool(download_from_r2(user_id, rel, Path(dest_path), profile_id=profile_id))
    except Exception as e:
        logger.info(f"[DownloadMetadata] owner cover fetch failed for {poster_basename}: {e}")
        return False
