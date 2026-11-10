# T15850: Pre-shrink spike

## In plain words

Today very large game files almost never land: of 246 successful uploads, 202 were under one gigabyte and two were over six, and the five parents who tried files over ten gigabytes were refused. A standalone tool that shrinks video in the browser before uploading exists but has never been measured on a real file over a real connection. One week: shrink three real files on two laptops over two connection speeds, compare total time against uploading the original, and judge the athlete's sharpness at 1080p. Go if shrink plus upload is at least 30% faster on a slow connection and you accept the quality; then the three integration tasks below proceed. No-go closes the milestone with the numbers.


**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Roadmap 4, Big-file upload (see PLAN.md)

## How we got here

Prod evidence ([funnel-evidence-2026-11-09.md](../bi/funnel-evidence-2026-11-09.md)): about 25 of
202 parents who picked a file failed on files over 2 GB, 23 of 199 probed users had sources above 4K,
and of 246 successful game uploads only 2 were over 6 GB. These are high-intent parents with real
cameras, and the product loses nearly all of them. A browser tool that shrinks video before upload
exists (`scripts/shrink-tool/`, T8840) but has never been measured on a real file over a real uplink.

## The problem

The thesis "shrink plus upload is faster than upload alone, and the player still looks right" has never
been measured on a real file over a real uplink.

## What we will do

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

## How we will know it worked

- [ ] The research note has the measurement table for 3 files x 2 machines x 2 uplinks with total wall-clock and size.
- [ ] A GO / NO-GO against the stated rule, signed by the owner.
- [ ] On GO, T8845's task file is updated to the plain 1080p scope and un-gated; on NO-GO, T8845 to T8860 are closed.

## For the implementer

### Related Tasks
T8840 (the tool), T8845, T8850, T8860 (integration, gated on GO), T8865 (de-gated 2026-11-09), T15780,
T15840, T15770 / T14800 (make the 40 silent abandons visible first).

### Relevant Files (REQUIRED)
- `scripts/shrink-tool/README.md` (steps 1 to 7 recipe)
- `scripts/shrink-tool/pipeline/` (decision.js, autoCrop.js stay unused)
- `src/frontend/src/services/uploadManager.js`
- `docs/plans/tasks/universal-upload/T8840-shrink-pipeline-core.md` and `T8840-design.md` (the tool, and the acceptance it never had)
