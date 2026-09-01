# Follow-up (from Tbug49p review) — highlight_transform conflates source-fps and working-fps

**Status:** TODO — not blocking Tbug49p's fix, filed as an explicit deferral per reviewer
requirement (do not silently drop a BLOCKING finding, just fix the smaller safe piece now).

**Context:** while fixing bug 49p (Modal export ignoring source fps, causing slow/fast-motion
output), a fix was attempted that threaded each clip's real source fps into
`_build_framing_snapshot`'s per-clip `"fps"` field (`src/backend/app/routers/export/multi_clip.py`),
so a future re-export's highlight-carry transform would remap old crop keyframes correctly for
non-30fps sources.

Reviewer caught that `transform_all_regions_to_working`
(`src/backend/app/highlight_transform.py`) uses that SAME snapshot `fps` value for two
DIFFERENT unit conversions:

1. `raw_frame_to_working_time(raw_frame, segments_data, framerate)` (~line 732) -- correct
   with the clip's real SOURCE fps, since `crop_keyframes` are authored in source-fps space
   (`src/frontend/src/modes/focus/hooks/useCrop.js:69`).
2. `working_frame = int(round(working_time * framerate))` (~line 761) -- must always use the
   WORKING VIDEO's fps, which is always `SNAPSHOT_FRAMERATE` (30.0) since the render always
   forces `-r <target_fps>` (this is exactly what bug 49p's Fix A guarantees).

Threading `clip.source_fps` through made both conversions use the source fps, so on a
non-30fps clip, `working_frame` (and therefore `highlights_data.frame`, persisted to
`working_videos`) would land in the wrong unit -- keyframes 1.667x (50fps) or 2x (60fps) later
than intended, outside their own region. This is the SAME class of bug 49p was fixing, just
relocated to the highlight-carry path.

It was also a broader blast radius than intended: EVERY project's snapshot would gain a
non-30.0 `fps` the moment a non-30.000 source (including 29.97fps NTSC, common) re-exports,
breaking the verbatim-carry fast path (`resolve_carried_highlights` Rule 2,
`highlight_carry.py:90`, which compares `prior_snapshot == new_snapshot`) for far more
projects than the 4 known-broken videos, potentially surfacing spurious "highlights dropped"
notes to unaffected users.

**Reverted for bug 49p's fix.** `_build_framing_snapshot`'s `"fps"` stays the fixed
`SNAPSHOT_FRAMERATE` (matches all pre-existing snapshots, no behavior change, no new risk).
`ClipExportData.source_fps` is still resolved and set on the multi-clip DB-resolve path
(parity with the single-clip path, `framing.py:673`) but not yet consumed by the snapshot.

**Recommended fix (not done here):** give `transform_all_regions_to_working` an explicit
second parameter for the working-side rate (e.g. `working_framerate: float = SNAPSHOT_FRAMERATE`),
so `framerate` unambiguously means "source fps" everywhere in the function and the working-frame
conversion at line ~761 uses the new param instead. Once that split exists, `_build_framing_snapshot`
can safely thread `clip.source_fps or SNAPSHOT_FRAMERATE` into `"fps"` again, fixing the
highlight-carry remap for non-30fps clips without the unit-confusion risk. Update
`SNAPSHOT_FRAMERATE`'s docstring (`highlight_carry.py:56-60`) and `.claude/knowledge/export-pipeline.md`
in the same change, since "snapshot fps is always 30" is a documented invariant this would
intentionally relax.

**Verification needed:** re-export a project with existing carried highlights on a genuinely
non-30fps source (50/60fps from the known-broken cohort, and separately a 29.97fps project) and
confirm no spurious `dropped:n` carry note and correct highlight positioning after the fix.
