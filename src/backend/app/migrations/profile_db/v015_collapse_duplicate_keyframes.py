"""
v015: Collapse near-duplicate crop/highlight keyframes (data heal).

Background: the Framing and Overlay editors snap an edit to a nearby keyframe in
the display layer (within FRAME_TOLERANCE=10 frames for crop, 5 frames for
highlight regions), but the surgical persistence paths used to send the RAW
clicked frame/time. The crop backend matches keyframes exactly and the overlay
backend matches within 0.02s, so both appended a near-duplicate the display
layer had merged. Repeated edits on close frames accumulated overlapping
keyframes that, on delete, could strip a permanent boundary keyframe.

The write paths now persist the resolved (snapped) identity, so new duplicates
cannot form. This migration heals rows saved before that fix: it collapses any
cluster of keyframes closer than the minimum spacing down to a single keyframe,
always preserving the first and last (permanent boundary) keyframes. When a
cluster collapses, the earliest keyframe of the cluster is kept (its data);
the user re-verifies framing visually, and the corrupt mapping is unrecoverable
either way -- the goal is to remove the duplicate, not reconstruct intent.

Idempotent: after collapsing, no cluster violates the spacing, so a re-run
matches nothing.
"""

import logging

from ..base import BaseMigration
from app.utils.encoding import encode_data, decode_data

logger = logging.getLogger(__name__)

# Mirror of the frontend snap windows
# (keyframeUtils.FRAME_TOLERANCE, useHighlightRegions.MIN_KEYFRAME_DISTANCE_FRAMES).
# Keyframes closer than this were never supposed to coexist.
CROP_MIN_FRAME_GAP = 10
HIGHLIGHT_MIN_FRAME_GAP = 5
HIGHLIGHT_FPS = 30  # overlay keyframes are stored in 30fps frame-space
HIGHLIGHT_MIN_TIME_GAP = HIGHLIGHT_MIN_FRAME_GAP / HIGHLIGHT_FPS


def _collapse(keyframes, pos, min_gap):
    """Collapse keyframes closer than ``min_gap``, preserving first/last boundaries.

    Args:
        keyframes: list of keyframe dicts for a single track / region.
        pos: callable returning a keyframe's numeric position (frame or time).
        min_gap: keyframes closer than this (in the same units as ``pos``) are
            collapsed into the earlier one.

    Returns:
        (deduped_list, changed) tuple.
    """
    if not isinstance(keyframes, list) or len(keyframes) <= 2:
        return keyframes, False

    ordered = sorted(keyframes, key=pos)
    last = ordered[-1]

    kept = [ordered[0]]
    for kf in ordered[1:-1]:  # interior keyframes only
        if pos(kf) - pos(kept[-1]) >= min_gap:
            kept.append(kf)
        # else: too close to the last kept keyframe -- drop it

    # The last boundary must survive. If a kept interior keyframe sits too close
    # to it, the boundary wins (drop the interior).
    while len(kept) > 1 and pos(last) - pos(kept[-1]) < min_gap:
        kept.pop()
    kept.append(last)

    return kept, len(kept) != len(ordered)


class V015CollapseDuplicateKeyframes(BaseMigration):
    version = 15
    description = "Collapse near-duplicate crop/highlight keyframes"

    def up(self, conn) -> None:
        cur = conn.cursor()

        # --- Crop keyframes: working_clips.crop_data (list keyed by 'frame') ---
        if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='working_clips'"
        ).fetchone():
            fixed = 0
            rows = cur.execute(
                "SELECT id, crop_data FROM working_clips WHERE crop_data IS NOT NULL"
            ).fetchall()
            for clip_id, blob in rows:
                kfs = decode_data(blob)
                if not isinstance(kfs, list):
                    continue
                deduped, changed = _collapse(
                    kfs, lambda k: k.get('frame', 0), CROP_MIN_FRAME_GAP
                )
                if changed:
                    cur.execute(
                        "UPDATE working_clips SET crop_data = ? WHERE id = ?",
                        (encode_data(deduped), clip_id),
                    )
                    fixed += 1
            if fixed:
                logger.info(f"[v015] collapsed crop keyframe duplicates in {fixed} clips")

        # --- Highlight keyframes: working_videos.highlights_data ---
        # (list of regions; each region has a 'keyframes' list keyed by 'time') ---
        if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='working_videos'"
        ).fetchone():
            fixed = 0
            rows = cur.execute(
                "SELECT id, highlights_data FROM working_videos WHERE highlights_data IS NOT NULL"
            ).fetchall()
            for video_id, blob in rows:
                regions = decode_data(blob)
                if not isinstance(regions, list):
                    continue
                changed_any = False
                for region in regions:
                    if not isinstance(region, dict):
                        continue
                    kfs = region.get('keyframes')
                    if not isinstance(kfs, list):
                        continue
                    deduped, changed = _collapse(
                        kfs, lambda k: k.get('time', 0), HIGHLIGHT_MIN_TIME_GAP
                    )
                    if changed:
                        region['keyframes'] = deduped
                        changed_any = True
                if changed_any:
                    cur.execute(
                        "UPDATE working_videos SET highlights_data = ? WHERE id = ?",
                        (encode_data(regions), video_id),
                    )
                    fixed += 1
            if fixed:
                logger.info(
                    f"[v015] collapsed highlight keyframe duplicates in {fixed} working videos"
                )
