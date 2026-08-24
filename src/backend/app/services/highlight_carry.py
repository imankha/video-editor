"""Highlight carry-forward decision helper (T4350).

A Framing re-export used to SILENTLY DISCARD the user's overlay-edited
highlights and reseed freshly-detected regions (see docs/plans/tasks/T4350-design.md
section 0). This module holds the pure decision+transform that PRESERVES the
user's highlights across a re-export instead:

- framing unchanged           -> carry the old highlights VERBATIM (correct & cheap)
- single-clip framing change  -> transform each region OLD->raw->NEW, drop the ones
                                 that fall outside the new trim, and report the count
- multi-clip framing change   -> T4355: attribute each region to its OLD clip via
                                 OLD concat offsets, transform per-clip, re-emit at
                                 the NEW concat offset; genuinely-unmappable cases
                                 (e.g. legacy dissolve snapshot with no `transition`)
                                 still take the loud multiclip_reset fallback
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
    get_output_duration,
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

    # Rule 3: no OLD framing snapshot (pre-v046 legacy row) -- promoted above the
    # clip_count split (T4355 Decision 4 step 3). We cannot transform without the
    # framing the highlights were authored against, for EITHER single- or multi-clip;
    # carry VERBATIM and flag LOUDLY so the user verifies positions (never a silent
    # best-guess, and never a detection reset that discards real user data).
    if prior_snapshot is None:
        return prior_highlights, NOTE_LEGACY_UNCERTAIN

    # Rule 4: single-clip framing change -> transform OLD-working -> raw -> NEW-working.
    if clip_count == 1:
        transformed, dropped = _transform_single_clip(prior_highlights, prior_snapshot, new_snapshot)
        note = f"{NOTE_DROPPED_PREFIX}:{dropped}" if dropped > 0 else None
        return transformed, note

    # Rule 5: multi-clip framing change (T4355) -> attribute each region to its OLD
    # clip via OLD concat offsets, transform per-clip, re-emit at the NEW offset.
    # `_transform_multi_clip` itself never raises for the "can't derive OLD offsets"
    # case (dissolve gap) -- callers detect that up front (Rule 6) before ever
    # calling into it, so this path always has derivable offsets.
    if clip_count > 1:
        if _dissolve_offsets_unavailable(prior_snapshot, new_snapshot):
            # Rule 6: residual genuinely-unmappable case -- a LEGACY prior snapshot
            # (multi-clip, written before T4355) that has no `transition` key, on a
            # re-export whose NEW side is itself a dissolve. OLD concat offsets cannot
            # be derived without guessing the OLD overlap -- fall back LOUDLY rather
            # than silently mis-mapping regions across clip boundaries.
            return detected_regions, NOTE_MULTICLIP_RESET
        transformed, dropped = _transform_multi_clip(prior_highlights, prior_snapshot, new_snapshot)
        note = f"{NOTE_DROPPED_PREFIX}:{dropped}" if dropped > 0 else None
        return transformed, note

    # A snapshot always reports clip_count >= 1 for a real render (the caller derives
    # it as `int(snapshot.get("clip_count", 1) or 1)`); clip_count < 1 is an impossible
    # upstream state, so fail loudly rather than falling through to an implicit None.
    raise ValueError(f"resolve_carried_highlights: invalid clip_count {clip_count!r}")


def _dissolve_offsets_unavailable(prior_snapshot: dict, new_snapshot: dict) -> bool:
    """T4355 Decision 2 residual case: a prior (OLD) multi-clip snapshot with NO
    `transition` key at all (pre-T4355 legacy blob) cannot prove its true OLD
    overlap. Per Decision 2, absent-key is safe to treat as `cut` for the carry
    ARITHMETIC (`concat_offsets` already does this) -- a cut re-export needs no
    overlap, so a legacy OLD snapshot transforms fine against a cut NEW export.

    The only genuinely-unmappable case is when the CURRENT export's own NEW side
    is a `dissolve`: the transform then needs BOTH sides' overlap to keep the
    concatenated timeline a strict partition, and the OLD overlap is unknowable
    from a snapshot that predates the `transition` key. Gate on the NEW side's
    transition, not the OLD snapshot alone -- keying on OLD-absence alone would
    reset EVERY legacy multi-clip project (including plain cut re-exports) that
    Decision 2 says should transform fine.
    """
    if "transition" in prior_snapshot:
        return False
    new_transition = new_snapshot.get("transition")
    return bool(new_transition) and new_transition.get("type") == "dissolve"


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


def _attribute_clip_index(start_time: float, offsets: list[float], durations: list[float]) -> int | None:
    """T4355 Decision 1: attribute a region to a clip by its `start_time` alone,
    using the half-open span ``[off_i, off_i + dur_i)``. `start_time` is the
    anchor (a highlight's keyframes/geometry are authored against the moment it
    BEGINS). Exactly-on-boundary (`start_time == off_i`) attributes to clip `i`
    (the clip it STARTS), never `i - 1`. Returns ``None`` if unattributable
    (e.g. negative or past the last clip's span -- should not normally happen
    for a region that was ever placed on this concatenated timeline, but is
    handled as a loud drop rather than an out-of-range index).
    """
    for i, (off, dur) in enumerate(zip(offsets, durations)):
        if off <= start_time < off + dur:
            return i
    return None


def _transform_multi_clip(
    prior_highlights: list[dict],
    prior_snapshot: dict,
    new_snapshot: dict,
) -> tuple[list[dict], int]:
    """T4355: the multi-clip generalization of `_transform_single_clip`. Highlight
    regions live in CONCATENATED working-video seconds with no per-clip
    attribution stored on them, so each ENABLED region is first attributed to its
    OLD clip via OLD concat offsets (`concat_offsets`) + its `start_time`
    (Decision 1), shifted into that clip's LOCAL old timeline, run through the
    SAME old->raw->new transform `_transform_single_clip` composes (but against
    `clips[i]` instead of the hard-indexed `clips[0]`), then re-offset into the
    NEW clip's position in the NEW concatenated timeline.

    Failure sub-cases that DROP + count (Decision 3), never silently mis-place:
    - unattributable OLD start_time, or the attributed clip index no longer
      exists on the NEW side (clip removed / concat shrank / reorder mismatch)
    - a straddling region whose end-clamp collapses to `end <= start`
    - the per-clip transform returns nothing (region trimmed out on the NEW side)

    A DISABLED region is carried through UNTRANSFORMED by id-merge (same as
    `_transform_single_clip`) and never counts toward `dropped`.

    ``dropped`` counts ENABLED prior regions only -- same contract as
    `_transform_single_clip`.
    """
    from app.routers.export.multi_clip import concat_offsets

    old_clips = prior_snapshot["clips"]
    new_clips = new_snapshot["clips"]
    new_clip_count = new_snapshot["clip_count"]

    old_offsets = concat_offsets(prior_snapshot)
    new_offsets = concat_offsets(new_snapshot)
    old_durations = [
        get_output_duration(clip["segments_data"], clip.get("raw_duration")) for clip in old_clips
    ]

    dropped = 0
    transformed_regions: list[dict] = []

    for region in prior_highlights:
        if not region.get("enabled", True):
            # Carried untransformed by id-merge below; never counted.
            continue

        i = _attribute_clip_index(region["start_time"], old_offsets, old_durations)
        if i is None or i >= new_clip_count:
            # Unattributable OLD start_time, OR the attributed clip no longer
            # exists on the NEW side (removed / reorder mismatch past the new
            # clip count) -- DROP + count, loud.
            dropped += 1
            continue

        old_clip = old_clips[i]
        new_clip = new_clips[i]
        old_span_end = old_offsets[i] + old_durations[i]

        # A region/keyframe shorter than a single frame has nothing to render and
        # can't be distinguished from float noise -- use it as BOTH the collapse
        # threshold AND the nudge-off-the-boundary amount below. This also sidesteps
        # a pre-existing quirk in `working_time_to_source_time`/`working_time_to_raw_frame`
        # (unmodified, out of this task's scope): a working_time landing EXACTLY on an
        # untrimmed segment's cumulative duration falls through to `trim_end` (`inf`
        # when untrimmed), so a clamp that lands exactly on the clip's span end must
        # never be handed to those helpers unnudged.
        frame_duration = 1.0 / (old_clip.get("fps", 30.0) or 30.0)

        # Shift into clip i's LOCAL old timeline; clamp end_time to the
        # attributed clip's OLD output span end (straddle case, Decision 1(i)).
        local_start = region["start_time"] - old_offsets[i]
        local_end = min(region["end_time"], old_span_end) - old_offsets[i]
        if local_end >= old_durations[i]:
            local_end = old_durations[i] - frame_duration
        if local_end - local_start < frame_duration:
            # Clamp collapsed the region to sub-frame (or negative) length -- DROP + count.
            dropped += 1
            continue

        # Keyframe times live in the SAME (concatenated, then local-shifted) time
        # space as start_time/end_time (`transform_keyframe_to_raw` reads `kf['time']`
        # directly) -- shift and clamp them identically or the transform sees a
        # keyframe still anchored to the OLD global/concatenated timeline.
        local_keyframes = []
        for kf in region.get("keyframes", []):
            kf_time = min(kf.get("time", region["start_time"]), old_span_end) - old_offsets[i]
            kf_time = max(local_start, min(local_end, kf_time))
            local_keyframes.append({**kf, "time": kf_time})

        local_region = {
            **region,
            "start_time": local_start,
            "end_time": local_end,
            "keyframes": local_keyframes,
        }

        old_segments = canonicalize_segments_data(old_clip["segments_data"], old_clip.get("raw_duration"))
        new_segments = canonicalize_segments_data(new_clip["segments_data"], new_clip.get("raw_duration"))

        raw_regions = transform_all_regions_to_raw(
            regions=[local_region],
            crop_keyframes=old_clip["crop_keyframes"],
            segments_data=old_segments,
            working_video_dims=prior_snapshot["video_dims"],
            framerate=old_clip.get("fps", 30.0),
        )
        new_local_regions = transform_all_regions_to_working(
            raw_regions=raw_regions,
            crop_keyframes=new_clip["crop_keyframes"],
            segments_data=new_segments,
            working_video_dims=new_snapshot["video_dims"],
            framerate=new_clip.get("fps", 30.0),
        )
        if not new_local_regions:
            # Trimmed out of the NEW clip -- DROP + count (same as single-clip).
            dropped += 1
            continue

        # Re-emit in NEW concatenated seconds: add the NEW clip's offset back.
        new_region = new_local_regions[0]
        new_off = new_offsets[i]
        new_region = {
            **new_region,
            "start_time": new_region["start_time"] + new_off,
            "end_time": new_region["end_time"] + new_off,
        }
        transformed_regions.append(new_region)

    # Same id-merge pattern as `_transform_single_clip`: merge transformed geometry
    # back onto the original region so region-level metadata (label, per-region
    # overrides) survives, AND carry disabled regions through untransformed.
    prior_by_id = {r.get("id"): r for r in prior_highlights}
    merged = []
    for region in transformed_regions:
        base = prior_by_id.get(region.get("id"))
        merged.append({**base, **region} if base else region)
    for region in prior_highlights:
        if not region.get("enabled", True):
            merged.append(region)

    return merged, dropped
