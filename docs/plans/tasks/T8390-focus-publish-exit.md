# T8390: Focus gets a publish exit (guided-path R3)

**Status:** STAGING (merged to master 2026-09-04, PR #329)
**Impact:** 7
**Complexity:** 3
**Created:** 2026-09-02

App design change **R3 from the approved T7620 guided-Help design** (user accepted
2026-09-02; rationale + rule wiring in [T7620-design.md](T7620-design.md) sections 17
and 17.1). Filed as a standalone task per the design's argument: it is a product win on
its own, keeps T7630's reviewable units sane, and rebases safely around T8360/T8350.

## Problem

Focus is a genuine dead end at the framed-to-published transition: after a user finishes
framing and exporting a clip there is no on-screen path toward publishing the reel - they
must know to navigate elsewhere. The T7620 per-screen intent analysis rates this the
highest-value screen fix of the set: guided-path rule 30 (the L3-to-L4 advance) currently
has nothing real to anchor to, and without R3 the guide can only narrate navigation.

## Solution

Give Focus an explicit publish exit per the design: a clear post-export affordance that
takes the user toward publishing the reel this clip belongs to. Exact placement/copy get
a quick ui-designer pass consistent with T7580's Focus naming and the T8360 surface
outcome. Must carry `data-tutorial-target="focus-publish"` (literal - guided rule 30
anchors here).

## Context

### Relevant Files (anticipated)
- `src/frontend/src/screens/FocusScreen.jsx` (and its container/view split) - the
  post-export state
- `src/frontend/src/config/displayNames.js` - button copy
- e2e spec for the Focus flow

### Related Tasks
- From: [T7620-design.md](T7620-design.md) R3 (sections 17/17.1)
- Blocks: **T7630** (guided-path implementation anchors rule 30 to this)
- Sequencing (recorded in T7620-design.md 18.3): R3, R4 -> T8360 -> T8370 -> T8380 ->
  T7630 -> T7640
- Related: [T8400](T8400-publish-lands-on-reel.md) (R4, sibling)

## Scope expansion (2026-09-04, user direction — supersedes the pre-flight note's smaller recommendation)

User rejected choosing before previewing. New required sequence, replacing T8520's shipped
completion-card ordering (choose -> optionally preview) for the no-spotlight path:

1. Export completes -> user is shown the **current preview first**, no decision yet.
2. From the preview screen, three choices sit side by side: **Publish** (renamed from "Finish
   Now" — appropriate now because they've actually watched what they're publishing),
   **Add Spotlight Now**, **Add Spotlight Later**.
3. **Add Spotlight Later**: shows a toast confirming where the video went, PLUS a plain-language
   line explaining the Clips-vs-Highlight-Reels split (the user explicitly asked for this
   explainer, it doesn't exist today). Destination follows the already-approved T8360 split, not
   a new decision: **single-clip drafts land on the Clips tab; multi-clip drafts land on the
   Highlight Reels tab's Highlights section.**
4. The preview screen also offers **Refocus** (go back and reframe) — copy must make clear this
   re-triggers a paid export (credits charged again), not a free redo.

This reorders and relabels T8520's ALREADY-MERGED completion card (PR #325) — not just T8390's
originally-scoped narrow gap. ui-designer pass launched to work out the concrete screen(s),
grounded in the real shipped `ExportButtonView`/`FocusScreen`/`DraftReelPreview`/
`usePublishProject` code, before implementation.

## Design APPROVED (2026-09-04)

Decision artifact: https://claude.ai/code/artifact/851b5ae6-4e6d-4c35-962a-7790b781cd5a

**Layout — Option 1**: export completion mounts the existing preview-player shell (same one
`DraftReelPreview` already uses — scrubber, header, Escape, no backdrop-close, portrait/landscape
aspect box) over the working video immediately, full-screen. One new optional slot on
`CollectionPlayer`: `actionBar`, rendered after the video area. The three choices could not fit
in the header cluster (same width math that already dropped Download from the draft toolbar), so
they render in the new action-bar footer: **Publish** full-width primary
(`data-tutorial-target="focus-publish"`, caption "Puts it in Highlight Reels so you can share
it."), then **Add Spotlight** / **Add Spotlight Later** as an equal-weight pair beneath it
(caption "A spotlight is a glowing highlight that follows your athlete."), then a divider and a
quiet ghost **Refocus** row ("Refocus (reframe and export again, uses credits)"). Desktop: one
right-aligned row, Refocus pushed left, primary rightmost.

**Publish semantics — one tap, true publish (APPROVED).** Tapping Publish fires the render, then
automatically completes the publish gesture the instant it finishes — no second tap, no landing
on another decision screen. Needs a small new mechanism: an ephemeral flag (e.g.
`publishAfterRenderRef` in `FocusScreen`) consumed by the existing completion handler
(`App.jsx:597-604`) to auto-publish instead of waiting for another tap. This is a deliberate
departure from T8530's original two-tap design — that design predates a preview existing at this
point; now that the user has already watched and decided, a "Publish" button that doesn't publish
would read as dishonest per the app's own copy-honesty rule (T8520).

**"Add Spotlight Later" toast**, routed by `is_auto_created` (T8360's already-approved split, not
a new decision):
- Single-clip: **"Saved to Clips"** — "Clips are single plays. Highlight Reels join several clips
  into one video. Yours is still a draft, so add a spotlight or publish it from here whenever you
  want."
- Multi-clip: **"Saved to Highlight Reels, under Highlights"** — "Highlight Reels join several
  clips into one video. Single plays stay in Clips. Yours is still a draft, so add a spotlight or
  publish it from here whenever you want."
- `toast.success(title, { message, duration: 10000 })`, no action button.

**Minor findings to fix in passing (no decision needed):** two shipped comments
(`ConfirmationDialog.jsx:92-95`, `FocusScreen.jsx:1296-1298`) claim `flex-col-reverse` puts the
primary action lowest on mobile — it actually renders it highest (first DOM child = bottom in
`column-reverse`). Correct the comments; the new action bar uses explicit order and avoids the
pattern entirely. Existing `overlay_offered`/`overlay_deferred`/`overlay_declined` events still
sum correctly under this design (declined = Publish); Refocus has no event of its own — optional
future addition, not required here.

## Pre-flight note (2026-09-04)

Filed 2026-09-02, before T8520 (overlay-optional-skip + draft preview player), T8530
(one-tap publish, shared `usePublishProject` hook), and T8540 (Share as the primary player
action) shipped (all merged 2026-09-04). Those may have already substantially or fully
closed this gap — the export-completion card (T8520) already offers "Finish Now" leading
into a completion surface with Publish (T8530). **Before any design/implementation work:
re-read the current `FocusScreen.jsx` + `ExportButtonContainer.jsx` + the T8520/T8530
completion flow and confirm whether a real gap still exists.** If it's already closed,
close this task with the evidence recorded here rather than building anything.

## Acceptance Criteria

- [ ] A user finishing in Focus has a visible, one-tap path toward publishing
- [ ] `data-tutorial-target="focus-publish"` present (literal, greppable)
- [ ] ui-designer-consistent placement/copy; responsive at 375px
- [ ] Tests pass (unit + the Focus e2e updated)
