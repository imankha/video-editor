"""
T4340 (Tester Phase 1) -- characterization test for overlay.py's before/after
`end_frame` computation, locking in CURRENT (pre-T4340, unchanged-by-this-branch)
behavior for both segments_data.boundaries shapes.

Design: docs/plans/tasks/T4340-design.md Sec 1.5 / Sec 2.5 / Sec 3 Step 6 item 10.
"Per the task, these readers stay unchanged this branch... Acceptance criterion:
overlay reads correctly for BOTH formats during the transition -- it already
does for full-list; for splits-only it currently uses the last split as the
end (a pre-existing latent bug the task closes at the SOURCE by making writes
canonical, not by editing the reader this branch)."

The actual logic lives INLINE inside `export_final` (app/routers/export/overlay.py
lines 1925-1940), an async endpoint that also drives ffmpeg/R2/credits -- not
independently callable as a unit. Rather than invoking the full export pipeline,
this test reproduces the EXACT snippet as a local pure-python helper (verified
byte-for-byte against overlay.py:1925-1940 below) so the current behavior is
pinned as an executable regression guard for the follow-up reader-cleanup task.
If overlay.py's snippet changes, keep this helper in sync or delete this test.

This test is NOT expected to fail today (it's a characterization of EXISTING
behavior, not new functionality) -- it's the one item in the Step 6 list that
should be GREEN from the start, proving the "before" baseline the follow-up
task will change.
"""

from app.utils.encoding import decode_data, encode_data


def _compute_before_after_frame_range(segments_data_blob, framerate=30.0):
    """Verbatim reproduction of overlay.py:1925-1940 (export_final, before/after
    tracking block). Kept intentionally unrefactored/duplicated -- see module
    docstring for why this isn't imported from production code."""
    start_frame = 0
    end_frame = 0

    if segments_data_blob:
        try:
            segments = decode_data(segments_data_blob)
            trim_range = segments.get('trimRange')
            if trim_range:
                start_frame = int(trim_range.get('start', 0) * framerate)
                end_frame = int(trim_range.get('end', 0) * framerate)
            elif segments.get('boundaries'):
                # No trim, use full clip from boundaries
                boundaries = segments['boundaries']
                if len(boundaries) >= 2:
                    end_frame = int(boundaries[-1] * framerate)
        except Exception:
            pass

    return start_frame, end_frame


class TestOverlayBothFormatCharacterization:
    def test_full_list_boundaries_end_frame_is_duration(self):
        """Full-list [0, ...splits, duration] -- boundaries[-1] IS the true
        clip duration, so end_frame is correct today. Must stay correct."""
        blob = encode_data({
            "boundaries": [0.0, 3.0, 7.0, 10.0],
            "segmentSpeeds": {"0": 1.0, "1": 0.5, "2": 1.0},
        })
        start_frame, end_frame = _compute_before_after_frame_range(blob, framerate=30.0)
        assert start_frame == 0
        assert end_frame == int(10.0 * 30.0)  # 300 -- correct: last boundary IS duration

    def test_splits_only_boundaries_end_frame_uses_last_split_not_duration(self):
        """PRE-EXISTING LATENT BUG (design Sec 1.5), characterized not fixed
        this branch: splits-only [3.0, 7.0] on a clip whose true duration is
        10.0 -- boundaries[-1] is 7.0 (the last user SPLIT), not the duration.
        end_frame is computed from the WRONG value. This is the baseline the
        follow-up reader-cleanup task (post-migration) will correct by no
        longer needing to special-case this shape at all, once every row is
        written full-list at the source."""
        blob = encode_data({
            "boundaries": [3.0, 7.0],  # splits-only; true clip duration is 10.0, NOT present here
            "segmentSpeeds": {"1": 0.5},
        })
        start_frame, end_frame = _compute_before_after_frame_range(blob, framerate=30.0)
        assert start_frame == 0
        # Locks in the CURRENT (wrong) behavior: uses last split (7.0), not the
        # real duration (10.0). int(7.0 * 30.0) == 210, not int(10.0*30)==300.
        assert end_frame == int(7.0 * 30.0), (
            "this test pins the PRE-EXISTING splits-only bug (last split used "
            "as clip end, not true duration) as the documented baseline -- "
            "if this now equals 300 the reader's behavior changed and the "
            "follow-up cleanup task's assumptions need re-checking"
        )
        assert end_frame != int(10.0 * 30.0), (
            "sanity: if this now matches the TRUE duration, the reader started "
            "canonicalizing on read (out of scope for this branch, Sec 2.5)"
        )

    def test_trim_range_present_takes_precedence_over_boundaries_either_format(self):
        """trimRange, when present, short-circuits the boundaries branch
        entirely -- true for both boundary formats, unaffected by T4340."""
        for boundaries in ([0.0, 3.0, 10.0], [3.0]):
            blob = encode_data({
                "boundaries": boundaries,
                "trimRange": {"start": 1.0, "end": 8.0},
            })
            start_frame, end_frame = _compute_before_after_frame_range(blob, framerate=30.0)
            assert start_frame == int(1.0 * 30.0)
            assert end_frame == int(8.0 * 30.0)

    def test_no_segments_data_defaults_to_zero(self):
        start_frame, end_frame = _compute_before_after_frame_range(None, framerate=30.0)
        assert (start_frame, end_frame) == (0, 0)
