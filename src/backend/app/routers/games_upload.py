"""
Game Upload endpoints for Video Editor API (T80).

This router handles deduplicated game uploads:
- POST /api/games/prepare-upload - Check if upload needed, get presigned URLs
- POST /api/games/finalize-upload - Complete multipart upload

Games are stored globally in R2 at games/{blake3_hash}.mp4 for deduplication.
The blake3_hash is stored in the games table for lookup.
"""

import logging
import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.constants import MAX_CLIP_UPLOAD_BYTES, GameStatus, UploadKind, UploadStatus
from app.database import column_exists, get_db_connection
from app.middleware.db_sync import durable_sync
from app.services.credit_ledger import get_credit_balance
from app.services.storage_credits import calculate_storage_cost, calculate_upload_cost
from app.storage import (
    R2_ENABLED,
    generate_multipart_urls,
    generate_presigned_url_global,
    r2_abort_multipart_upload,
    r2_abort_orphan_multipart_uploads,
    r2_complete_multipart_upload,
    r2_create_multipart_upload,
    r2_head_object_global,
    r2_is_multipart_upload_valid,
    r2_key,
    r2_multipart_parts_match_size,
    r2_set_object_metadata_global,
)
from app.user_context import get_current_user_id
from app.utils.encoding import decode_data, encode_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/games", tags=["games-upload"])

# BLAKE3 hash is 64 hex characters (256 bits)
BLAKE3_PATTERN = re.compile(r'^[a-f0-9]{64}$')

# Maximum file size: 10GB (R2 limit is 5TB, but practical limit for video)
MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024  # 10GB

# Part size for multipart uploads.
# T7480: 25MB -> 5MB (R2/S3 hard minimum for non-final parts). At 25MB a single
# 17.8MB phone video was ONE part needing >=0.79Mbps sustained to beat the client's
# 180s per-part budget; residential/cell uplinks sit at 0.3-0.7Mbps, so every attempt
# restarted from byte 0 and died the same way (prod outage since 2026-08-20). A 5MB
# part needs only 0.22Mbps to clear the same budget, and each completed part is durable
# resume progress. R2 requires all non-final parts of ONE upload to be the same size,
# so this is flat per upload (10GB max / 5MB = 2048 parts, well under the 10k cap).
PART_SIZE = 5 * 1024 * 1024  # 5MB

def upload_object_key(kind: str, blake3_hash: str, user_id: str | None = None) -> str:
    """Resolve the R2 key an upload session's bytes land at, by kind.

    GAME uploads share the global, blake3-deduped `games/{hash}.mp4` namespace
    (cross-user dedup, ref-counted, swept). CLIP uploads land in the per-profile
    `raw_clips/{hash}.mp4` prefix — exactly one owning `raw_clips` row, never
    entering `game_storage`/the sweep (INV-U1/INV-U2, T8370 design §2.1). Every
    R2 multipart helper already accepts a raw key, so this needs no storage.py
    change. Fails loud on an unrecognized kind rather than defaulting — a
    silently mis-namespaced upload would land bytes nobody can find.
    """
    if kind == UploadKind.GAME.value:
        return f"games/{blake3_hash}.mp4"
    if kind == UploadKind.CLIP.value:
        if not user_id:
            raise ValueError("upload_object_key(kind='clip') requires user_id")
        return r2_key(user_id, f"raw_clips/{blake3_hash}.mp4")
    raise ValueError(f"unknown upload kind: {kind!r}")


def _pending_kind(row) -> str:
    """Read pending_uploads.kind from a row, defaulting to GAME for a below-v050
    DB (guarded-write pattern, T5630/T6550) — the column's own DEFAULT is 'game'
    on any machine that HAS migrated, so this only matters mid rolling-deploy."""
    # sqlite3.Row: `in row` tests VALUES, not keys — `.keys()` required (SIM118).
    return row['kind'] if 'kind' in row.keys() else UploadKind.GAME.value  # noqa: SIM118


def validate_blake3_hash(hash_value: str) -> bool:
    """Validate that a string is a valid BLAKE3 hash (64 hex chars)."""
    return bool(BLAKE3_PATTERN.match(hash_value.lower()))


def validate_file_size(size: int) -> bool:
    """Validate file size is within acceptable range."""
    return 0 < size <= MAX_FILE_SIZE


def _record_upload_failure(user_id: str | None, reason: str, kind: str = UploadKind.GAME.value) -> None:
    """
    T7970: record a `game_upload_failed`/`clip_upload_failed` milestone at a REAL
    in-flight failure site (T8370: routed by `kind` — a clip upload's failures
    must not inflate the GAME tried/succeeded pair, mirroring the finalize-time
    D4 fix).

    Before T7970 the ONLY emitter of `game_upload_failed` was the stale-pending
    reaper (`list_pending_uploads`, reason=user_abandoned), so the admin "Upload
    Success" denominator was success-only by construction (100% by construction).
    This records the actual failure branches (R2 error, validation rejection, size
    mismatch, explicit cancel, client-side network abort) using the existing
    `analytics.MILESTONE_REASONS` taxonomy.

    Best-effort: analytics must NEVER break the upload's own error path, so a failed
    milestone write is swallowed (and an absent user_id — anon beacon — is skipped).
    Each caller traces to a named terminal failure event, not a reactive sweep.
    """
    if not user_id:
        return
    event = "clip_upload_failed" if kind == UploadKind.CLIP.value else "game_upload_failed"
    try:
        from app.analytics import record_milestone
        record_milestone(user_id, event, reason=reason)
    except Exception:
        logger.exception(f"[T7970] failed to record {event} milestone")


# T8170: an HTTP status embedded in an uploadPart rejection message (see
# uploadManager.js's uploadPart -- "Part N upload failed: <status>"). A part
# PUT that itself got a non-2xx from R2 is NOT a dropped transport; the T8160
# outage's entire signature was exactly this (404 NoSuchUpload from a
# self-aborted multipart) mislabeled as "network" for 2 days, pointing
# diagnosis at users' connections instead of our own bug.
_PART_HTTP_STATUS_RE = re.compile(r"upload failed: (\d{3})")


def _classify_uploading_phase_failure(reason_text: str | None) -> str:
    """Map the client's free-text uploadPart failure message (T7480's
    reject reasons: 'Part N upload failed: <status>', 'stalled', 'timed out',
    'network error', 'aborted') to a MILESTONE_REASONS entry. Prefers the
    embedded HTTP status when present — that is server-observed fact, not a
    client guess about why the transport failed."""
    text = reason_text or ""
    if _PART_HTTP_STATUS_RE.search(text):
        return "r2_rejected"
    lowered = text.lower()
    if "stalled" in lowered or "timed out" in lowered:
        return "timeout"
    if "network error" in lowered:
        return "network"
    return "unknown"


# ==============================================================================
# Request/Response Models
# ==============================================================================

class PrepareUploadRequest(BaseModel):
    blake3_hash: str = Field(..., description="BLAKE3 hash of the file (64 hex chars)")
    file_size: int = Field(..., description="File size in bytes")
    original_filename: str = Field(..., description="Original filename")
    label: str | None = Field(None, description="Display label (e.g. 'First Half')")
    # T8370: default keeps every existing (pre-T8370) caller byte-identical.
    kind: str = Field(UploadKind.GAME.value, description="'game' (default) or 'clip'")


class PartInfo(BaseModel):
    part_number: int
    etag: str


class FinalizeUploadRequest(BaseModel):
    upload_session_id: str = Field(..., description="Session ID from prepare-upload")
    parts: list[PartInfo] = Field(..., description="List of uploaded parts with ETags")
    # Video metadata stored on R2 object for future reference
    video_duration: float | None = Field(None, description="Video duration in seconds")
    video_width: int | None = Field(None, description="Video width in pixels")
    video_height: int | None = Field(None, description="Video height in pixels")


class SavePartsRequest(BaseModel):
    """Request to save completed parts for resume support."""
    parts: list[PartInfo] = Field(..., description="List of completed parts with ETags")


# ==============================================================================
# Endpoints
# ==============================================================================

@router.post("/prepare-upload")
async def prepare_upload(request: PrepareUploadRequest):
    """
    Prepare a game upload. Returns one of:
    - already_owned: User already has this game
    - linked: Game exists globally, linked to user's account
    - upload_required: Game doesn't exist, presigned URLs provided

    This endpoint enables deduplication: if the same game exists globally,
    the user gets linked to it without re-uploading.
    """
    if not R2_ENABLED:
        # R2 is always enabled in prod (this branch is dev/test only), so it is not
        # instrumented as a real upload failure — it cannot contribute to the prod rate.
        raise HTTPException(
            status_code=503,
            detail="R2 storage not enabled. Multipart upload requires R2."
        )

    user_id = get_current_user_id()

    # T8370: fail loud on an unrecognized kind rather than defaulting — a
    # mis-namespaced upload would land bytes nobody can find.
    kind = request.kind
    if kind not in (UploadKind.GAME.value, UploadKind.CLIP.value):
        _record_upload_failure(user_id, "refused")
        raise HTTPException(status_code=400, detail=f"Invalid upload kind: {kind!r}")
    is_clip = kind == UploadKind.CLIP.value

    # Validate inputs. A malformed hash/size is a real rejected upload attempt (T7970).
    blake3_hash = request.blake3_hash.lower()
    if not validate_blake3_hash(blake3_hash):
        _record_upload_failure(user_id, "refused", kind=kind)
        raise HTTPException(
            status_code=400,
            detail="Invalid BLAKE3 hash format. Expected 64 hex characters."
        )

    if not validate_file_size(request.file_size):
        _record_upload_failure(user_id, "refused", kind=kind)
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file size. Must be between 1 byte and {MAX_FILE_SIZE // (1024**3)}GB."
        )

    # T8370 §4.3: clip sources are permanent (never expire), so cap the size
    # up front — never a silent truncation, steer to Add Game instead.
    if is_clip and request.file_size > MAX_CLIP_UPLOAD_BYTES:
        _record_upload_failure(user_id, "refused", kind=kind)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Clip uploads are limited to {MAX_CLIP_UPLOAD_BYTES // (1024*1024)}MB. "
                "For longer footage, use Add Game instead."
            ),
        )

    # T8370 guarded write (T5630/T6550 pattern): a kind='clip' prepare on a
    # below-v050 profile DB has nowhere honest to record intent — refuse
    # rather than write a row that finalize could route into the wrong
    # namespace / emit the wrong milestone for.
    with get_db_connection() as _guard_conn:
        has_kind_column = column_exists(_guard_conn.cursor(), "pending_uploads", "kind")
    if is_clip and not has_kind_column:
        raise HTTPException(
            status_code=503,
            detail={"detail": "Your data is being upgraded, please retry", "code": "pending_migration"},
        )

    r2_key = upload_object_key(kind, blake3_hash, user_id)

    # Check if the object already exists in R2 (global dedup for games; a
    # per-profile clip source is never pre-existing under a fresh hash, but
    # the same HEAD call is harmless and keeps the two kinds on one path).
    head_result = r2_head_object_global(r2_key)

    # T1580: compute upload cost for all response paths. A clip's REAL charge
    # is one debit per BATCH on summed bytes (POST /api/clips/upload, §4.2) —
    # this per-file preview uses the same no-surcharge storage cost so the
    # number shown here is in the right ballpark before the batch is posted.
    upload_cost = (
        calculate_storage_cost(request.file_size) if is_clip
        else calculate_upload_cost(request.file_size)
    )
    balance = get_credit_balance(user_id)["balance"]

    if head_result:
        # Video already exists in R2 - no upload needed
        # Game creation is handled separately by POST /api/games
        return {
            "status": UploadStatus.EXISTS,
            "blake3_hash": blake3_hash,
            "file_size": head_result.get('ContentLength', request.file_size),
            "upload_cost": upload_cost,
            "balance": balance,
            "can_afford": balance >= upload_cost,
        }

    # Check for existing pending upload with same hash (resume support).
    # T8370: scope the resume lookup to the SAME kind — the identical hash can
    # legitimately be mid-upload as a game AND (separately) as a clip, and
    # resuming across kinds would hand back an upload_id in the wrong
    # namespace. A below-v050 DB has no kind column at all (every row is
    # implicitly 'game' pre-T8370), so the plain lookup is still correct there.
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if has_kind_column:
            cursor.execute(
                "SELECT id, r2_upload_id, parts_json FROM pending_uploads "
                "WHERE blake3_hash = ? AND kind = ?",
                (blake3_hash, kind)
            )
        else:
            cursor.execute(
                "SELECT id, r2_upload_id, parts_json FROM pending_uploads WHERE blake3_hash = ?",
                (blake3_hash,)
            )
        existing_pending = cursor.fetchone()

        if existing_pending:
            session_id = existing_pending['id']
            upload_id = existing_pending['r2_upload_id']

            # Validate that the R2 multipart upload session is still valid AND was
            # chunked at the CURRENT PART_SIZE. T7480: after PART_SIZE changed
            # 25MB -> 5MB, an old session's already-uploaded parts no longer tile
            # the file at the new size; splicing them with new 5MB parts would
            # finalize a corrupt object. On a size mismatch, abort + restart fresh.
            if r2_is_multipart_upload_valid(r2_key, upload_id) and r2_multipart_parts_match_size(
                r2_key, upload_id, request.file_size, PART_SIZE
            ):
                # Resume existing upload - return remaining parts
                completed_parts = decode_data(existing_pending['parts_json']) or []

                # Generate presigned URLs for ALL parts (4 hour expiry)
                all_parts = generate_multipart_urls(
                    key=r2_key,
                    upload_id=upload_id,
                    file_size=request.file_size,
                    part_size=PART_SIZE,
                    expires_in=14400  # 4 hours
                )

                # Filter to only remaining parts
                completed_part_numbers = {p['part_number'] for p in completed_parts}
                remaining_parts = [p for p in all_parts if p['part_number'] not in completed_part_numbers]

                logger.info(
                    f"[UPLOAD_LIFECYCLE] resume user={user_id} session={session_id} "
                    f"hash={blake3_hash} upload_id={upload_id} "
                    f"completed={len(completed_parts)} remaining={len(remaining_parts)}"
                )

                return {
                    "status": UploadStatus.UPLOAD_REQUIRED,
                    "upload_session_id": session_id,
                    "parts": remaining_parts,
                    "completed_parts": completed_parts,
                    "is_resume": True,
                    "upload_cost": upload_cost,
                    "balance": balance,
                    "can_afford": balance >= upload_cost,
                }
            else:
                # R2 session expired/invalid - delete stale pending upload
                logger.warning(
                    f"Stale upload session detected: {session_id}, upload_id: {upload_id}. "
                    f"Cleaning up and starting fresh."
                )
                # T8160: abort the stale multipart NOW, while its id is still
                # recorded. The age-scoped reclaim below spares anything younger
                # than the threshold, so without this abort a fresh-but-invalid
                # session (e.g. part-size mismatch) would strand its multipart
                # with no DB record left to find it by.
                r2_abort_multipart_upload(r2_key, upload_id)
                cursor.execute(
                    "DELETE FROM pending_uploads WHERE id = ?",
                    (session_id,)
                )
                conn.commit()
                # Fall through to create new upload below

    # Game doesn't exist and no valid resumable pending upload.
    # T7950 (B2): create the new multipart FIRST, then reclaim orphans while SPARING
    # the id we are about to store (keep_upload_id). The old order (abort-all THEN
    # create, with no keep) let a concurrent prepare's unscoped abort strand the id
    # this request stores. Creating first means we always have the id to protect;
    # T7480's orphan reclaim still fires (this path is only reached after a valid
    # resume was declined, so every OTHER open multipart here is a genuine orphan —
    # e.g. an executed-but-unacked create from a prior attempt).
    upload_id = r2_create_multipart_upload(r2_key)
    if not upload_id:
        _record_upload_failure(user_id, "sync_failed", kind=kind)
        raise HTTPException(
            status_code=500,
            detail="Failed to initiate multipart upload"
        )

    orphans_aborted = r2_abort_orphan_multipart_uploads(r2_key, keep_upload_id=upload_id)

    # T8160 keeper post-check: if the reclaim aborted anything, prove the keeper
    # survived before handing out presigned URLs. R2's ListMultipartUploads
    # returns per-call UploadId aliases, so the reclaim's keep_upload_id equality
    # can never be trusted on its own — the pre-T8160 version silently aborted
    # its own fresh multipart here and every part PUT 404'd (bug 47p outage).
    # Direct use of the created id in list_parts is safe (only cross-response
    # comparison is broken). Gated on orphans_aborted so the extra R2 round-trip
    # is paid only when an abort actually happened.
    if orphans_aborted and not r2_is_multipart_upload_valid(r2_key, upload_id):
        logger.critical(
            f"[T8160] Orphan reclaim killed the keeper multipart: key={r2_key} "
            f"upload_id={upload_id} (aborted={orphans_aborted}) — refusing to "
            f"return presigned URLs for a dead upload"
        )
        # Best-effort abort so the failed prepare leaves no record-less orphan
        # (if the keeper is truly dead this is a no-op; direct use of the
        # created id is safe — only cross-response comparison is broken).
        r2_abort_multipart_upload(r2_key, upload_id)
        _record_upload_failure(user_id, "sync_failed", kind=kind)
        raise HTTPException(
            status_code=500,
            detail="Failed to initiate multipart upload"
        )

    # Generate session ID
    session_id = f"upload_{uuid.uuid4().hex}"

    # Store pending upload in user's database. kind is written only when the
    # column exists (guarded above: a below-v050 DB already refused kind='clip',
    # so reaching here with the column absent means kind is 'game' — the
    # column's own DEFAULT is correct without us writing it).
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if has_kind_column:
            cursor.execute("""
                INSERT INTO pending_uploads (
                    id, blake3_hash, file_size, original_filename, r2_upload_id, label, kind
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                session_id,
                blake3_hash,
                request.file_size,
                request.original_filename,
                upload_id,
                request.label,
                kind,
            ))
        else:
            cursor.execute("""
                INSERT INTO pending_uploads (
                    id, blake3_hash, file_size, original_filename, r2_upload_id, label
                )
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                session_id,
                blake3_hash,
                request.file_size,
                request.original_filename,
                upload_id,
                request.label,
            ))
        conn.commit()

    # Generate presigned URLs for all parts (4 hour expiry)
    parts = generate_multipart_urls(
        key=r2_key,
        upload_id=upload_id,
        file_size=request.file_size,
        part_size=PART_SIZE,
        expires_in=14400  # 4 hours
    )

    logger.info(
        f"[UPLOAD_LIFECYCLE] prepare user={user_id} session={session_id} "
        f"hash={blake3_hash} upload_id={upload_id} parts={len(parts)} "
        f"file_size={request.file_size} part_size={PART_SIZE}"
    )

    return {
        "status": UploadStatus.UPLOAD_REQUIRED,
        "upload_session_id": session_id,
        "parts": parts,
        "is_resume": False,
        "upload_cost": upload_cost,
        "balance": balance,
        "can_afford": balance >= upload_cost,
    }


@router.post("/finalize-upload")
async def finalize_upload(
    request: FinalizeUploadRequest,
    _durable: None = Depends(durable_sync),  # T4320: sync the pending_uploads cleanup to R2 before 200
):
    """
    Complete a multipart upload after all parts have been uploaded.

    Verifies the upload, sets metadata, and links the game to the user.
    """
    if not R2_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="R2 storage not enabled"
        )

    session_id = request.upload_session_id
    user_id = get_current_user_id()

    # Get pending upload from database
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM pending_uploads WHERE id = ?",
            (session_id,)
        )
        pending = cursor.fetchone()

        if not pending:
            logger.warning(
                f"[UPLOAD_LIFECYCLE] finalize FAILED user={user_id} session={session_id} "
                f"reason=session_not_found"
            )
            raise HTTPException(
                status_code=404,
                detail="Upload session not found"
            )

        blake3_hash = pending['blake3_hash']
        kind = _pending_kind(pending)
        r2_key = upload_object_key(kind, blake3_hash, user_id)
        r2_upload_id = pending['r2_upload_id']

        # Convert parts to R2 format
        r2_parts = [
            {'PartNumber': p.part_number, 'ETag': p.etag}
            for p in request.parts
        ]

        # Complete multipart upload
        if not r2_complete_multipart_upload(r2_key, r2_upload_id, r2_parts):
            # Attempt to abort the upload to clean up
            r2_abort_multipart_upload(r2_key, r2_upload_id)
            logger.error(
                f"[UPLOAD_LIFECYCLE] finalize FAILED user={user_id} session={session_id} "
                f"hash={blake3_hash} upload_id={r2_upload_id} parts={len(r2_parts)} "
                f"reason=complete_multipart_failed"
            )
            # T7970: R2 refused/failed to assemble the multipart — a durable-sync failure.
            _record_upload_failure(user_id, "sync_failed", kind=kind)
            raise HTTPException(
                status_code=500,
                detail="Failed to complete multipart upload"
            )

        # Verify file size matches
        head_result = r2_head_object_global(r2_key)
        if not head_result:
            logger.error(
                f"[UPLOAD_LIFECYCLE] finalize FAILED user={user_id} session={session_id} "
                f"hash={blake3_hash} reason=object_not_found_after_complete"
            )
            # T7970: R2 completed but the object is not durably readable — sync failure.
            _record_upload_failure(user_id, "sync_failed", kind=kind)
            raise HTTPException(
                status_code=500,
                detail="Upload completed but object not found"
            )

        actual_size = head_result.get('ContentLength', 0)
        expected_size = pending['file_size']

        if actual_size != expected_size:
            logger.error(
                f"[UPLOAD_LIFECYCLE] finalize FAILED user={user_id} session={session_id} "
                f"hash={blake3_hash} reason=size_mismatch expected={expected_size} got={actual_size}"
            )
            # T7970: bytes on R2 don't match the declared size — the transfer dropped/
            # duplicated data in flight (transport-level corruption) -> network.
            _record_upload_failure(user_id, "network", kind=kind)
            # Don't delete - let admin investigate
            raise HTTPException(
                status_code=400,
                detail=f"File size mismatch: expected {expected_size}, got {actual_size}"
            )

        # Set metadata on the R2 object
        initial_metadata = {
            'original_filename': pending['original_filename'],
            'created_at': datetime.utcnow().isoformat() + 'Z'
        }
        # Add video metadata if provided
        if request.video_duration:
            initial_metadata['duration'] = str(request.video_duration)
        if request.video_width:
            initial_metadata['width'] = str(request.video_width)
        if request.video_height:
            initial_metadata['height'] = str(request.video_height)

        r2_set_object_metadata_global(r2_key, initial_metadata)

        # Delete pending upload record
        cursor.execute(
            "DELETE FROM pending_uploads WHERE id = ?",
            (session_id,)
        )
        conn.commit()

        logger.info(
            f"[UPLOAD_LIFECYCLE] finalize success user={user_id} session={session_id} "
            f"hash={blake3_hash} size_mb={actual_size / (1024*1024):.1f}"
        )

    # T7510: the DURABLE upload-success point. R2 has confirmed the object (HEAD +
    # size match above) and the pending row is committed-deleted, so this is the
    # first place a game upload provably persisted — the honest counterpart to the
    # intent-side game_created. Emitted synchronously so the impersonation guard
    # (record_milestone) resolves against this request's context. Never fires from
    # create_game (which only inserts the pending row).
    # T8370 (D4 fix): a CLIP upload's bytes landing here is not yet a durable
    # clip — that only happens once POST /api/clips/upload lands the raw_clips
    # row (its own `clip_uploaded` milestone). Emitting game_upload_succeeded
    # for a clip would count it as a game upload in T8220's tried/succeeded pair.
    if kind == UploadKind.GAME.value:
        from app.analytics import record_milestone
        record_milestone(user_id, "game_upload_succeeded", context={"blake3_hash": blake3_hash})

    # Game creation is handled separately by POST /api/games
    return {
        "status": UploadStatus.SUCCESS,
        "blake3_hash": blake3_hash,
        "file_size": actual_size,
        "kind": kind,
    }


@router.patch("/upload/{session_id}/parts")
async def save_upload_parts(session_id: str, request: SavePartsRequest):
    """
    Save completed parts for resume support.

    Call this after each part upload succeeds. If the browser crashes/closes,
    the upload can be resumed from where it left off.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT parts_json FROM pending_uploads WHERE id = ?",
            (session_id,)
        )
        pending = cursor.fetchone()

        if not pending:
            raise HTTPException(
                status_code=404,
                detail="Upload session not found"
            )

        # Merge new parts with existing
        existing_parts = decode_data(pending['parts_json']) or []

        # Create a map of existing parts by part_number
        parts_map = {p['part_number']: p for p in existing_parts}

        # Add/update with new parts
        for part in request.parts:
            parts_map[part.part_number] = {
                'part_number': part.part_number,
                'etag': part.etag
            }

        # Convert back to list sorted by part_number
        merged_parts = sorted(parts_map.values(), key=lambda p: p['part_number'])

        # Save to database
        cursor.execute(
            "UPDATE pending_uploads SET parts_json = ? WHERE id = ?",
            (encode_data(merged_parts), session_id)
        )
        conn.commit()

        logger.debug(f"Saved {len(request.parts)} parts for session {session_id}, total: {len(merged_parts)}")

        return {
            "status": "saved",
            "parts_count": len(merged_parts)
        }


@router.post("/upload-failure-beacon", status_code=204)
async def upload_failure_beacon(request: Request):
    """
    T7480: client failure beacon. The browser POSTs here when it exhausts retries
    (or hits a terminal prepare/finalize failure) so the browser-side reason lands
    in server logs — the ONLY server-visible evidence channel, because prod builds
    strip console.log (vite.config.js marks it pure) and the whole failed transfer
    otherwise produces ZERO server traffic.

    Fire-and-forget contract: this MUST NEVER throw on bad input and MUST NOT block
    or break the client's failure path. It writes to LOGS ONLY — no profile/user DB
    write (so gesture-persistence rules don't apply, per the task's Technical Notes),
    and no durable_sync. Always returns 204, even for a malformed body.
    """
    try:
        payload = await request.json()
        if not isinstance(payload, dict):
            payload = {"raw": payload}
    except Exception:
        payload = {}

    try:
        user_id = get_current_user_id()
    except Exception:
        user_id = None

    # Pull a few known fields for a readable log line; keep the rest as-is.
    reason = payload.get("reason")
    phase = payload.get("phase")
    session_id = payload.get("session_id")
    blake3_hash = payload.get("blake3_hash")
    attempts = payload.get("attempts")
    elapsed_ms = payload.get("elapsed_ms")
    # T8370: client-declared, best-effort only — this beacon writes no DB row,
    # so there is nothing to guard against a forged value; worst case a
    # mislabeled beacon under/over-counts one of two purely informational
    # failure-reason breakdowns.
    beacon_kind = payload.get("kind") or UploadKind.GAME.value

    logger.error(
        f"[UPLOAD_BEACON] client upload failure user={user_id} "
        f"phase={phase} session={session_id} hash={blake3_hash} "
        f"attempts={attempts} elapsed_ms={elapsed_ms} reason={reason!r} detail={payload!r}"
    )

    # T7970: a terminal client-side failure in the PART-UPLOAD phase is the one real
    # failure the server never otherwise sees — the client exhausted its part retries
    # and gave up WITHOUT ever calling finalize (no server-side branch fired).
    # T8170: classify from the client's own failure message instead of hardcoding
    # "network" — that mislabel hid the entire T8160 outage (a part PUT 404 from R2
    # is not a dropped transport) behind a reason that pointed diagnosis at users'
    # connections. The 'preparing' and 'finalizing' phases are DELIBERATELY skipped
    # here: those failures already reached the server and are recorded by
    # prepare-upload's validation/create branches and finalize's complete/size
    # branches respectively, so emitting again would double-count the SAME failure
    # and inflate the denominator. `_record_upload_failure` guards a None user_id
    # (anon beacon) and never throws, so the fire-and-forget/always-204 contract holds.
    if phase == "uploading":
        _record_upload_failure(user_id, _classify_uploading_phase_failure(reason), kind=beacon_kind)

    # 204 No Content — nothing to return.
    return None


@router.get("/pending-uploads")
async def list_pending_uploads():
    """
    List pending uploads for the current user.

    Used by frontend to detect and resume interrupted uploads.
    Validates each R2 session and auto-cleans stale ones.
    """
    user_id = get_current_user_id()
    reaped_failures = 0  # T7510: count of orphaned GAME uploads reaped as failures
    reaped_clip_failures = 0  # T8370: same, for CLIP uploads (routed to clip_upload_failed)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # T8370 (reviewer-caught bug): SELECT * (not an explicit column list) so
        # `kind` is present when the column exists — an explicit list that
        # omitted it made every `_pending_kind(row)` below resolve to GAME
        # unconditionally (the column was never selected), even on an
        # already-migrated DB. That mis-routed a legitimately in-progress CLIP
        # upload's validity check onto the WRONG R2 key (games/ instead of
        # raw_clips/), reaping-and-DELETING its still-valid resume record.
        cursor.execute("SELECT * FROM pending_uploads ORDER BY created_at DESC")
        rows = cursor.fetchall()

        uploads = []
        stale_rows = []  # T7490: rows whose R2 multipart is gone — reap honestly

        for row in rows:
            # Validate R2 session is still valid
            r2_key = upload_object_key(_pending_kind(row), row['blake3_hash'], user_id)
            if not r2_is_multipart_upload_valid(r2_key, row['r2_upload_id']):
                # Mark for the honest reap below (abort R2 + surface orphaned game)
                stale_rows.append(row)
                logger.info(f"Stale pending upload detected: {row['id']}, reaping")
                continue

            completed_parts = decode_data(row['parts_json']) or []

            # Calculate total parts based on file size
            total_parts = (row['file_size'] + PART_SIZE - 1) // PART_SIZE

            uploads.append({
                'session_id': row['id'],
                'blake3_hash': row['blake3_hash'],
                'file_size': row['file_size'],
                'original_filename': row['original_filename'],
                # sqlite3.Row: `in row` tests VALUES (Row is a sequence), so
                # `.keys()` is required here — SIM118 is a false positive.
                'label': row['label'] if 'label' in row.keys() else None,  # noqa: SIM118
                'kind': _pending_kind(row),
                'completed_parts': len(completed_parts),
                'total_parts': total_parts,
                'progress_percent': round(len(completed_parts) / total_parts * 100) if total_parts > 0 else 0,
                'created_at': row['created_at']
            })

        # T7490: honest reap. A stale record means the R2 multipart session is gone
        # and the resume really is dead. The old code silently DELETEd the record,
        # which left any orphaned games row (still 'pending' after T1540's
        # annotate-during-upload anchor) invisible on the Games tab forever. Now, for
        # each stale row:
        #   1. Abort the orphaned R2 multipart (best-effort — never blocks the response),
        #   2. Flip a matching still-'pending' game to 'upload_failed' so it renders a
        #      visible, user-actionable card (Retry / Discard) — GAME kind only; a
        #      CLIP upload never created a games row (T8370 INV-U3), so this UPDATE
        #      is structurally a no-op for it. Never skip step 3 either way.
        #   3. Delete the dead pending_uploads row.
        # Idempotent: a second call finds no stale row (already deleted) and the UPDATE
        # is a no-op once the game has left 'pending'. Scoped to this profile's DB
        # (per-profile SQLite), so the hash match can only touch this user's games.
        if stale_rows:
            for row in stale_rows:
                row_kind = _pending_kind(row)
                r2_key = upload_object_key(row_kind, row['blake3_hash'], user_id)
                # 1. r2_abort_multipart_upload swallows + logs its own errors and never
                #    raises, so a failed abort cannot block the reap or the response.
                #    Log loudly here too when it reports failure.
                if not r2_abort_multipart_upload(r2_key, row['r2_upload_id']):
                    logger.error(
                        f"[T7490] Failed to abort stale R2 multipart for pending upload "
                        f"{row['id']} (hash={row['blake3_hash']}); continuing reap anyway"
                    )
                if row_kind == UploadKind.CLIP.value:
                    # T8370: no games row exists to surface — a dead clip upload
                    # has no visible surface (design §7 Q5, session-only client
                    # state). Count it for its own reason-carrying failure event.
                    reaped_clip_failures += 1
                else:
                    # 2. Surface any orphaned pending game instead of leaving it invisible.
                    cursor.execute(
                        "UPDATE games SET status = ? WHERE blake3_hash = ? AND status = ?",
                        (GameStatus.UPLOAD_FAILED.value, row['blake3_hash'], GameStatus.PENDING.value),
                    )
                    if cursor.rowcount > 0:
                        logger.warning(
                            f"[T7490] Marked {cursor.rowcount} orphaned pending game(s) "
                            f"upload_failed for hash={row['blake3_hash']} (dead resume "
                            f"session {row['id']})"
                        )
                        # T7510: a reaped pending upload is a durable FAILURE — the
                        # user started an upload that never finalized. Record it with a
                        # coarse reason so the dashboard shows the attempt AND its cause
                        # (user_abandoned = navigated away / dead resume session).
                        reaped_failures += 1
                # 3. Drop the dead resume record.
                cursor.execute("DELETE FROM pending_uploads WHERE id = ?", (row['id'],))
            conn.commit()
            logger.info(f"[T7490] Reaped {len(stale_rows)} stale pending upload(s)")

    # Emit failure milestones AFTER the SQLite txn commits (outside the connection
    # block), so the analytics PG write never rides the profile-DB transaction.
    if reaped_failures:
        from app.analytics import record_milestone
        for _ in range(reaped_failures):
            record_milestone(user_id, "game_upload_failed", reason="user_abandoned")
    if reaped_clip_failures:
        from app.analytics import record_milestone
        for _ in range(reaped_clip_failures):
            record_milestone(user_id, "clip_upload_failed", reason="user_abandoned")

    return {'pending_uploads': uploads}


@router.delete("/upload/{session_id}")
async def cancel_upload(session_id: str):
    """
    Cancel an in-progress upload and clean up R2 multipart upload.
    """
    if not R2_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="R2 storage not enabled"
        )

    user_id = get_current_user_id()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT blake3_hash, r2_upload_id, kind FROM pending_uploads WHERE id = ?"
            if column_exists(cursor, "pending_uploads", "kind")
            else "SELECT blake3_hash, r2_upload_id FROM pending_uploads WHERE id = ?",
            (session_id,)
        )
        pending = cursor.fetchone()

        if not pending:
            # Idempotent no-op cancel (row already gone) — not a distinct failure event.
            raise HTTPException(
                status_code=404,
                detail="Upload session not found"
            )

        cancel_kind = _pending_kind(pending)
        r2_key = upload_object_key(cancel_kind, pending['blake3_hash'], user_id)

        # Abort multipart upload in R2
        r2_abort_multipart_upload(r2_key, pending['r2_upload_id'])

        # Delete from database
        cursor.execute(
            "DELETE FROM pending_uploads WHERE id = ?",
            (session_id,)
        )
        conn.commit()

        logger.info(f"Cancelled upload: {session_id}")

    # T7970: an explicit user cancel is a real terminated-without-success upload —
    # same category as the reaper's silent abandonment (user_abandoned), but this is
    # the EXPLICIT gesture. It deletes the pending row above, so the reaper can never
    # re-count it (no double-count). Emitted outside the SQLite txn (reaper convention).
    _record_upload_failure(user_id, "user_abandoned", kind=cancel_kind)

    return {"status": "cancelled"}


@router.get("/dedupe/{game_id}/url")
async def get_dedupe_game_url(game_id: int):
    """
    Get a presigned URL for a deduplicated game video.
    """
    if not R2_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="R2 storage not enabled"
        )

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT blake3_hash FROM games WHERE id = ?",
            (game_id,)
        )
        game = cursor.fetchone()

        if not game:
            raise HTTPException(
                status_code=404,
                detail="Game not found"
            )

        if not game['blake3_hash']:
            raise HTTPException(
                status_code=400,
                detail="Game does not use global storage"
            )

        r2_key = f"games/{game['blake3_hash']}.mp4"
        url = generate_presigned_url_global(r2_key, expires_in=14400)

        if not url:
            raise HTTPException(
                status_code=500,
                detail="Failed to generate presigned URL"
            )

        return {"url": url}


@router.delete("/dedupe/{game_id}")
async def delete_dedupe_game(game_id: int):
    """
    Delete a game from user's database (dedup-upload flow).

    Global video is NOT deleted - it may be shared by other users. T4270: this route
    used to run a bare `DELETE FROM games` with no storage-ref or orphan-project
    cleanup, permanently leaking game_storage refs (R2 objects never became
    deletable). It now goes through the SAME _delete_game_cascade helper the main
    DELETE route uses, so ref-counts and orphan projects stay correct on every path.
    """
    from app.profile_context import get_current_profile_id
    from app.services.auth_db import delete_ref

    from .games import _delete_game_cascade

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM games WHERE id = ?", (game_id,))

        if not cursor.fetchone():
            raise HTTPException(
                status_code=404,
                detail="Game not found"
            )

        video_hashes, orphaned = _delete_game_cascade(cursor, game_id)
        conn.commit()

    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    for h in video_hashes:
        delete_ref(user_id, profile_id, h)

    logger.info(
        f"Removed game from user's library (dedupe route): game_id={game_id} "
        f"({orphaned} orphaned projects cleaned up, {len(video_hashes)} storage refs removed)"
    )
    return {"status": "deleted", "game_id": game_id}


@router.get("/dedupe")
async def list_dedupe_games():
    """
    List games that use global dedup storage (have blake3_hash).

    Note: This is mostly for debugging. Use /api/games for the main list.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, blake3_hash, name, video_size, video_duration,
                   video_width, video_height, created_at
            FROM games
            WHERE blake3_hash IS NOT NULL
            ORDER BY created_at DESC
        """)
        rows = cursor.fetchall()

        games = []
        for row in rows:
            # Generate presigned URL if R2 is enabled
            video_url = None
            if R2_ENABLED:
                r2_key = f"games/{row['blake3_hash']}.mp4"
                video_url = generate_presigned_url_global(r2_key, expires_in=14400)

            games.append({
                'id': row['id'],
                'blake3_hash': row['blake3_hash'],
                'name': row['name'],
                'file_size': row['video_size'],
                'duration': row['video_duration'],
                'width': row['video_width'],
                'height': row['video_height'],
                'video_url': video_url,
                'created_at': row['created_at']
            })

        return {'games': games}
