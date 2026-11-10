# T15850: Pre-shrink spike: one week, one number, go or no-go

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Roadmap 4, Big-file upload (see PLAN.md)

## Source

The Video Pre-Shrink milestone (research T9000 to T9080, integration T8845 to T8865) was re-judged on
2026-11-09 against prod evidence ([funnel-evidence-2026-11-09.md](../bi/funnel-evidence-2026-11-09.md)):
about 25 users out of 202 file-pickers failed on files over 2 GB, 23 of 199 probed users had sources
above 4K, and big files almost never succeed. The loss is real and these are high-intent parents with
real cameras, but it is a tenth of pickers, so the programme shrinks to a bounded spike. T9000 is
answered by the evidence doc; T9010 (the owner's real-folder run) and T9040 (the benchmark) fold in
here; the auto-crop research (T9020, T9030, T9060) is removed.

## Problem

The thesis "shrink plus upload is faster than upload alone, and the player still looks right" has never
been measured on a real file over a real uplink.

## Solution

One week, using the merged standalone tool (`scripts/shrink-tool/`, T8840, PR #368).

1. Inputs: the owner's real DJI folder (17 to 24 GB games, the two files refused at the 10 GB cap are
   the exact case), one 4K phone game of 3 to 6 GB, one Veo export of 2 to 3 GB.
2. For each, on two machines (the owner's laptop and a mid-range Windows laptop) and two uplinks
   (home fibre and a throttled 10 to 20 Mbps profile): measure shrink time to 1080p at the tool's
   default bitrate, the shrunk size, upload time of original and shrunk, and total wall-clock.
3. Quality: side-by-side crops of the athlete at the far side at 1080p shrunk vs source, judged by the
   owner; jersey number legibility as the hard check.
4. Write the numbers into `docs/plans/research/pre-shrink-spike-2026-11.md` with GO / NO-GO.

GO: total time (shrink + upload) is lower than upload alone for every file at the throttled uplink, by
at least 30%, and the owner accepts the 1080p athlete quality. Then T8845, T8850, T8860 proceed as the
plain 1080p path (no auto-crop, no tweening). NO-GO: close the milestone with the numbers; keep T15780
(pre-flight), T15840 (resume) and T8865 (highlights before the upload finishes) as the big-file answer.

## Acceptance Criteria

- [ ] The research note has the measurement table for 3 files x 2 machines x 2 uplinks with total wall-clock and size.
- [ ] A GO / NO-GO against the stated rule, signed by the owner.
- [ ] On GO, T8845's task file is updated to the plain 1080p scope and un-gated; on NO-GO, T8845 to T8860 are moved to the removed list.

## Context

### Related Tasks
T8840 (the tool), T8845, T8850, T8860 (integration, gated on GO), T8865 (de-gated 2026-11-09), T15780,
T15840, T15770 / T14800 (make the 40 silent abandons visible first). Removed 2026-11-09: T9000, T9010,
T9020, T9030, T9040, T9060, T9070, T9080.

### Relevant Files (REQUIRED)
- `scripts/shrink-tool/README.md` (steps 1 to 7 recipe)
- `scripts/shrink-tool/pipeline/` (decision.js, autoCrop.js stay unused)
- `src/frontend/src/services/uploadManager.js`
- `docs/plans/tasks/universal-upload/T8840-shrink-pipeline-core.md` and `T8840-design.md` (the tool, and the acceptance it never had)
