"""Highlight carry-forward decision helper (T4350).

A Framing re-export used to SILENTLY DISCARD the user's overlay-edited
highlights and reseed freshly-detected regions (see docs/plans/tasks/T4350-design.md
section 0). This module holds the pure decision+transform that PRESERVES the
user's highlights across a re-export instead:

- framing unchanged           -> carry the old highlights VERBATIM (correct & cheap)
- single-clip framing change  -> transform each region OLD->raw->NEW, drop the ones
                                 that fall outside the new trim, and report the count
- multi-clip framing change   -> out of scope this task (T4355): loud fallback
- no old framing snapshot      -> can't transform; carry verbatim + a loud notice

`resolve_carried_highlights` is a PURE function (dicts in, dicts out) so it is
unit-testable without a DB. `upsert_working_video` calls it inside the export
finalize transaction (INSERT branch only) — see export_finalize.py.

Snapshots are the DECODED framing snapshot dict (the caller decodes the msgpack
`working_videos.framing_snapshot` blob before calling):

    {
      "clip_count": int,
      "video_dims": {"width": int, "height": int},
      "clips": [
        {
          "crop_keyframes": [ {frame, x, y, width, height}, ... ],  # FRAME-based (stored form)
          "segments_data": {"boundaries": [...], "segmentSpeeds": {...}, "trimRange": {...} | None},
          "fps": float,
          "raw_duration": float,
        },
        ...
      ],
    }
"""

from __future__ import annotations

from app.highlight_transform import (
    canonicalize_segments_data,
    transform_all_regions_to_raw,
    transform_all_regions_to_working,
)

# Carry notes surfaced to the user (mapped to copy on the frontend). Kept as
# greppable string literals next to their use (CLAUDE.md greppability rule).
# `dropped` carries a count: f"{NOTE_DROPPED_PREFIX}:{n}".
NOTE_DROPPED_PREFIX = "dropped"
NOTE_MULTICLIP_RESET = "multiclip_reset"
NOTE_LEGACY_UNCERTAIN = "legacy_uncertain"

# Framing snapshots and the highlight transforms interpret stored frame-based crop
# keyframes at a fixed 30fps — the SAME convention the overlay read path uses
# (overlay.py transform_all_regions_to_working framerate=30.0). Using it on BOTH
# the old and new sides of the carry transform keeps the round-trip self-consistent.
SNAPSHOT_FRAMERATE = 30.0


def resolve_carried_highlights(
    *,
    prior_highlights: list[dict] | None,
    prior_snapshot: dict | None,
    new_snapshot: dict,
    detected_regions: list[dict],
    clip_count: int,
) -> tuple[list[dict], str | None]:
    """Decide the new version's highlight regions on a Framing re-export.

    Returns ``(final_highlights, note)`` where ``note`` is one of ``None``,
    ``f"dropped:{n}"``, ``"multiclip_reset"``, or ``"legacy_uncertain"``.

    Detection output (``detected_regions``) is authoritative ONLY as the
    first-export seed and the multi-clip loud fallback — it never overwrites a
    carried/transformed user region (T4350 design Q5).
    """
    # Rule 1: no prior user highlights -> this is (effectively) a first export;
    # seed from fresh detection. Checked FIRST so an empty list never falls into
    # the legacy/transform branches.
    if not prior_highlights:
        return detected_regions, None

    # Rule 2: framing unchanged -> the old times/geometry are already correct in
    # the new working video. Carry VERBATIM (the only provably-correct fast path).
    # Compared by value on the decoded dicts (msgpack byte-equality upstream is an
    # optimization, not the contract).
    if prior_snapshot is not None and prior_snapshot == new_snapshot:
        return prior_highlights, None

    # Rule 4: multi-clip framing change is out of scope (Gap B / T4355). Fall back
    # LOUDLY to detection rather than silently mis-mapping across clip boundaries.
    if clip_count > 1:
        return detected_regions, NOTE_MULTICLIP_RESET

    # --- single-clip below ---

    # Rule 5: no OLD framing snapshot (pre-v046 legacy row). We cannot transform
    # without the framing the highlights were authored against; carry VERBATIM and
    # flag LOUDLY so the user verifies positions (never a silent best-guess).
    if prior_snapshot is None:
        return prior_highlights, NOTE_LEGACY_UNCERTAIN

    # Rule 3: single-clip framing change -> transform OLD-working -> raw -> NEW-working.
    transformed, dropped = _transform_single_clip(prior_highlights, prior_snapshot, new_snapshot)
    note = f"{NOTE_DROPPED_PREFIX}:{dropped}" if dropped > 0 else None
    return transformed, note


def _transform_single_clip(
    prior_highlights: list[dict],
    prior_snapshot: dict,
    new_snapshot: dict,
) -> tuple[list[dict], int]:
    """Compose the two existing single-clip transforms: OLD-working -> raw (using
    the OLD framing) -> NEW-working (using the NEW framing). Regions whose source
    time falls outside the NEW trim are dropped by the transform (returns None).

    ``dropped`` counts ENABLED prior regions that did not survive — a region the
    user had already disabled is not a "needs re-placement" loss, so it is not
    counted (Tester clarification 3).
    """
    old_clip = prior_snapshot["clips"][0]
    new_clip = new_snapshot["clips"][0]

    # T4340 gotcha: canonicalize before walking boundaries. Snapshots are captured
    # canonical at render time, so this is a defensive no-op — kept because every
    # reader canonicalizes until the follow-up reader-cleanup task lands.
    old_segments = canonicalize_segments_data(old_clip["segments_data"], old_clip.get("raw_duration"))
    new_segments = canonicalize_segments_data(new_clip["segments_data"], new_clip.get("raw_duration"))

    raw_regions = transform_all_regions_to_raw(
        regions=prior_highlights,
        crop_keyframes=old_clip["crop_keyframes"],
        segments_data=old_segments,
        working_video_dims=prior_snapshot["video_dims"],
        framerate=old_clip.get("fps", 30.0),
    )
    new_regions = transform_all_regions_to_working(
        raw_regions=raw_regions,
        crop_keyframes=new_clip["crop_keyframes"],
        segments_data=new_segments,
        working_video_dims=new_snapshot["video_dims"],
        framerate=new_clip.get("fps", 30.0),
    )

    # The geometry-only transform reconstructs each region with just
    # {id, start_time, end_time, enabled, keyframes} — merge the transformed geometry
    # back onto the original region so region-level metadata (label, per-region
    # shape/color overrides) survives the carry. `detections` is re-projected read-time
    # (/overlay-data), so a carried stale value is harmless.
    prior_by_id = {r.get("id"): r for r in prior_highlights}
    merged = []
    for region in new_regions:
        base = prior_by_id.get(region.get("id"))
        merged.append({**base, **region} if base else region)
    new_regions = merged

    enabled_prior = sum(1 for r in prior_highlights if r.get("enabled", True))
    dropped = max(0, enabled_prior - len(new_regions))
    return new_regions, dropped
