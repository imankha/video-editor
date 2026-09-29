# T11430: Published play still says Highlight Not Started; support N highlights per play by aspect

**Status:** TODO
**Impact:** 7
**Complexity:** 7
**Created:** 2026-09-29
**Reported environment:** Production, `imankh@gmail.com`, game `at Oceanside Breakers Aug 30`

## Problem

A play that has already produced and published a highlight can still render the primary CTA as
**Make Highlight** and the badge as **Highlight Not Started**. The production report is the
`Great Goal` play near 24:01 in `at Oceanside Breakers Aug 30`.

This is both a misleading status bug and a missing product model. A user must be able to make more
than one highlight from the same play, including multiple vertical and horizontal versions. The UI
currently reasons from the play's single `raw_clips.auto_project_id`, so one linked project is
treated as the entire history and current state of that play. That cannot express a published
vertical version plus a not-started/in-progress horizontal version, or N versions of either aspect.

## Required behavior

After any highlight for a play has been published:

- The create CTA says **Make Another Highlight**.
- Every existing/current highlight status is qualified by video type: **Vertical** for `9:16` and
  **Horizontal** for `16:9`.
- The published artifact remains visible as **Vertical Video Published** or
  **Horizontal Video Published**.
- The next counterpart opportunity is visible as **Horizontal Video Not Started** after a vertical
  publish, or **Vertical Video Not Started** after a horizontal publish.
- As another highlight advances, its badge keeps the same type prefix through the existing state
  vocabulary, for example **Horizontal Video Framing**, **Horizontal Video Framed**,
  **Horizontal Video Overlaid**, and **Horizontal Video Published**.
- Multiple outputs of the same type are supported. Use a one-based ordinal when needed to
  disambiguate the active/history entries, derived independently per type: for example
  **Vertical Video 2 Framing** after one vertical video is already published. Do not hard-code a
  two-video ceiling or assume exactly one vertical plus one horizontal.

Spelling is **Vertical**, not “Veridical” (the latter was a typo in the report).

## Current mechanism and likely root cause

- `src/frontend/src/modes/annotate/clipStage.js` derives one status/CTA from a region's
  `autoProjectId` and one `linkedProject`.
- `src/frontend/src/modes/AnnotateModeView.jsx` finds only that one project and passes it to
  `getClipStage`.
- `src/backend/app/routers/clips.py::_create_auto_project_for_clip` writes a single
  `raw_clips.auto_project_id`; update/create paths skip creation while that pointer exists.
- Project aspect lives on `projects.aspect_ratio`; published artifacts also retain aspect ratio.

The implementation must first verify the production record and determine why the published project
is not the play's current `auto_project_id` (stale/cleared pointer, archive behavior, or a distinct
project created from the same raw clip). Do not patch the display by looking only for any published
video: the durable association and N-version semantics must be correct.

## Design requirements

1. Introduce or reuse a durable one-to-many association from a raw play (`raw_clip_id`) to every
   highlight project/version created from it. Do not encode a list into `auto_project_id`.
2. Preserve historical published outputs when creating another highlight. Creating a new vertical
   or horizontal highlight must never mutate, detach, archive, or overwrite an older published one.
3. Define the active-work rule when several unfinished projects exist. At minimum, the UI must open
   the specifically selected status entry rather than guessing from the most recent project.
4. Derive orientation from the project's canonical `aspect_ratio` (`9:16` vertical, `16:9`
   horizontal), not source-video dimensions.
5. Derive per-orientation ordinals deterministically from durable creation order/ID and keep them
   stable after publish, reload, archive, and deletion of an unrelated version.
6. Keep `clipStage.js` as the single source for stage labels/actions, but extend its input/output to
   represent a collection of highlight instances rather than collapsing them into one status.
7. Specify migration/backfill behavior for existing plays with one linked project and for published
   projects whose `raw_clip_id` association exists only through `working_clips`.
8. Preserve current staleness semantics per highlight project; editing play boundaries must not
   retroactively relabel a published artifact as not started.
9. Cover desktop, portrait mobile, landscape phone, and any details/sidebar surface that displays
   the same status.

This is an L-tier cross-layer/data-model change. Complete an architecture/design pass before
implementation and explicitly document compatibility with the planned single-clip editor work
(T11220-T11280).

## Acceptance criteria

- [ ] The reported production play no longer shows only **Highlight Not Started** after a published
      highlight exists.
- [ ] Its published artifact is shown with the correct orientation-qualified **Video Published**
      badge.
- [ ] The primary CTA is **Make Another Highlight** once at least one output has been published.
- [ ] Creating another highlight from the same play preserves and can still open every prior
      published output.
- [ ] A play can have arbitrary N vertical and N horizontal highlight projects; no two-output cap.
- [ ] Status and CTA navigation target the correct project at every stage: Not Started, Clipped,
      Framing, Framed, Overlaid, Published.
- [ ] Same-orientation instances receive stable one-based ordinals when more than one exists.
- [ ] Orientation comes from `projects.aspect_ratio`, including after reload and publish/archive.
- [ ] Migration/backfill tests cover a legacy single `auto_project_id`, a published orphaned/stale
      pointer, and mixed vertical/horizontal history.
- [ ] Regression tests cover one published vertical + horizontal not started, one published
      horizontal + vertical not started, two vertical versions, mixed in-progress states, and
      correct CTA navigation.
- [ ] Live verification is performed on staging with a production-shaped copy of the reported play
      before production deployment.

## Evidence

Production screenshot supplied 2026-09-29: the `Great Goal` play shows **Make Highlight** despite
the user having already published a highlight from it. The screenshot is conversation evidence;
the production database/API record must be inspected read-only during implementation to capture the
exact broken linkage before any repair.
