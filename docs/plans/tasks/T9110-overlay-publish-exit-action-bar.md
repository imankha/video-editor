# T9110: Overlay gets a publish-exit action bar (Publish Now / Reapply Overlay / Reapply Focus / Publish Later)

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-08

> **Partially reversed by [T9590](T9590-post-focus-choice-hierarchy.md) (2026-09-10).**
> This task mirrored T8390's flat four-equal-weight layout into `OverlayPublishActionBar`.
> T9590 re-hierarchized both bars together (leaving one flat would recreate the exact
> inconsistency): on THIS screen the spotlight is already applied, so the dominant PRIMARY
> is Publish, then SECONDARY Reapply spotlight / TERTIARY Reapply AI Focus + a quiet
> Save-draft link (the old "Publish Later" card). Handlers/analytics unchanged; labels,
> copy, and visual weight moved. Product owner decision, recorded with the conflict at filing.

## Problem

[T8390](T8390-focus-publish-exit.md) gave Focus a preview-first completion screen with a flat,
4-equal-weight action bar (`FocusPublishActionBar`) once a user finishes framing and exporting a
clip. Overlay (where the user adds a spotlight highlight) has no equivalent: after a user finishes
in Overlay there's no matching on-screen choice screen offering to publish, redo the overlay, redo
the framing, or defer — a parallel dead end to the one T8390 closed for Focus.

## Solution

Filed at the user's request (2026-09-08, in the same conversation as T8390's round-2 visual
redesign): once Overlay export completes, show a preview of the result with a similarly flat,
4-equal-weight action bar:

- **Publish Now** — publish the reel as-is
- **Reapply Overlay** — go back into Overlay to redo the spotlight/highlight
- **Reapply Focus** — go back into Focus to redo the crop/framing (implies a fresh Overlay
  re-export afterward, same "uses credits" consideration Focus's Refocus button already carries —
  needs the same honest cost-warning caption pattern)
- **Publish Later** — defer, matching Focus's "Add Spotlight Later" semantics (toast + explainer
  copy per the existing `is_auto_created`-routed Clips-vs-Highlight-Reels split, see
  `FOCUS_PUBLISH_LATER_TOAST` in `displayNames.js` for the existing pattern to mirror or reuse)

**Every choice fires a confirmation toast when its action completes** (product owner, 2026-09-08,
same conversation): "the work has been done to accomplish the command, user should see a toast
confirming that it happened with a note on what they can do next" — e.g. Publish Later's toast
should say the clip is findable under In Progress Clips and its status was promoted to Overlay (the
equivalent detail to what Focus's `FOCUS_PUBLISH_LATER_TOAST` already says about Clips vs Highlight
Reels). Follow T8390's precedent for WHICH choices actually need one, don't blanket-apply: a choice
that already lands the user somewhere self-evidently confirming (e.g. Publish Now landing on the
published reel with its own "Published" toast per T8400) doesn't need a second redundant toast; a
choice that's a pure abort back to the same screen with nothing new to confirm (if this bar has an
equivalent) doesn't need one either. Reapply Overlay/Reapply Focus and Publish Later are the most
likely candidates to genuinely need one, mirroring Focus's `FOCUS_ADD_SPOTLIGHT_TOAST` (added to
`handleAddSpotlight` for the identical reason: it moves the user into another edit mode without any
other confirmation that their prior work was saved).

**Reuse T8390's shipped pattern, don't redesign from scratch.** The user explicitly asked for "the
same UI" — same preview-first shell (`CollectionPlayer`'s `actionBar` slot), same flat/no-hierarchy
principle (no single choice visually more important than the others — this was a deliberate,
hard-won product decision in T8390 round 2, not a default to reconsider), same 3-stage responsive
pattern (`grid-cols-1` stacked below `sm` / 2-up at `sm:` / the full single row only at `xl:`
1280px — NOT `sm:`, see the landmine below), and the same `minmax(min-content, 1fr)` grid-sizing
fix (title must never wrap, caption may wrap freely). Likely the cleanest implementation extracts a
shared underlying layout (e.g. a generic `<FlatChoiceActionBar>` taking a list of
`{icon, label, caption, onClick}` entries) rather than hand-duplicating `FocusPublishActionBar`'s
JSX a second time — but confirm this is a real 3rd-use-driven abstraction opportunity, not premature
(currently only 2 call sites); Focus's own bar predates this task and is NOT required to be
retrofitted onto the shared component in the same change unless it's a clean, low-risk mechanical
extraction.

**Two landmines T8390 already paid for — read its Progress Log, don't rediscover these the hard
way:**
1. `minmax(max-content, 1fr)` looks equivalent to `minmax(min-content, 1fr)` but silently sizes grid
   columns off the WRAPPABLE caption's full unwrapped width instead of the (non-wrappable) title,
   causing a real horizontal scrollbar at realistic desktop widths. Use `min-content`.
2. The single-row stage must be gated at a wide-enough breakpoint (T8390 uses `xl:`, 1280px) —
   gating it at `sm:` (640px) fits the row's actual measured content need (~800-950px, verify your
   own copy's exact number) only past roughly 1030px, so `sm:` would overflow on every real width
   from 640px to ~1030px, iPad portrait included. Verify live at 768/1024/1280, not just one large
   viewport. Do NOT add an `overflow-x-auto` "safety net" on the grid as a substitute for getting the
   breakpoint right — Reviewer flagged that it makes this exact class of bug undetectable by any
   test checking only document/viewport-level overflow (fails OPEN); if the row doesn't fit, that
   should show up as a real, visible failure, not be silently absorbed into a scroll container.

## Context

### Relevant Files (anticipated)
- `src/frontend/src/components/FocusPublishActionBar.jsx` — the pattern to follow/reuse (T8390,
  round 2 redesign)
- `src/frontend/src/screens/OverlayScreen.jsx` (or its container/view split) — Overlay's
  post-export state; need to find/build the equivalent of Focus's `handleAddSpotlight` /
  `handlePublish` / `handleRefocus` handlers for Overlay's four choices
- `src/frontend/src/config/displayNames.js` — new copy constants, likely `OVERLAY_PUBLISH` mirroring
  the existing `FOCUS_PUBLISH` shape
- `src/frontend/src/components/collections/CollectionPlayer.jsx` — same `actionBar` slot T8390 added
- e2e spec for the Overlay completion flow

### Related Tasks
- Pattern source: [T8390](T8390-focus-publish-exit.md) (Focus's publish exit + round-2 flat
  redesign — read its Progress Log before starting, especially the `min-content` vs `max-content`
  grid landmine)
- Sibling: [T8400](T8400-publish-lands-on-reel.md) (publish-landing behavior — already shipped and
  closed-as-satisfied; whatever "Publish Now" does here should land the user the same way)

## Acceptance Criteria

- [ ] A user finishing in Overlay has a visible, one-tap path toward publishing, with the same
      redo-Overlay / redo-Focus / defer choices available
- [ ] All 4 choices render with equal visual weight (no hierarchy) — same product decision T8390
      round 2 established for Focus, not a fresh design question
- [ ] No button title ever wraps at `sm:` and up; captions may wrap freely — verified via live DOM
      measurement (scrollWidth/clientWidth, resolved `grid-template-columns`), not just eyeballing
- [ ] Responsive at 375px through common desktop widths (verify at a simulated ~1280px-equivalent
      width, not just one large viewport)
- [ ] "Reapply Focus" copy is honest about triggering a fresh paid re-export afterward, mirroring
      Focus's existing Refocus cost-warning caption
- [ ] Each choice whose action isn't already self-evidently confirmed elsewhere fires a toast
      stating what happened + what the user can do next (see the toast requirement above)
- [ ] The single-row desktop stage is gated at a breakpoint verified (via live DOM measurement at
      768/1024/1280, not just one viewport) to actually fit the row's real content width — no
      `overflow-x-auto` fallback masking a wrong breakpoint choice
- [ ] Tests pass (unit + an Overlay completion e2e spec)

## Progress Log

### 2026-09-09 — Implemented (M-tier: implement -> unit -> QA -> reviewer)

Faithful mirror of T8390's shipped Focus pattern, as the task directed. Files:

- **`src/frontend/src/components/OverlayPublishActionBar.jsx`** (new) — the Overlay
  sibling of `FocusPublishActionBar`. Four equal-weight choices (Publish Now /
  Reapply Overlay / Reapply Focus / Publish Later), same flat/no-hierarchy grid,
  same three-stage responsive layout (`grid-cols-1` / `sm:` 2-up /
  `xl:` 4-across), same `minmax(min-content, 1fr)` column floor + `whitespace-nowrap`
  title span, no `overflow-x-auto`. Both T8390 landmines reproduced verbatim, not
  re-derived (doc comment points at `FocusPublishActionBar` as the authoritative
  rationale). Icons reuse app conventions: `FolderInput` (publish), `Sparkles`
  (spotlight/overlay), `Crop` (Focus/framing), `Clock` (later).
- **`displayNames.js`** — `OVERLAY_PUBLISH` copy + `OVERLAY_REAPPLY_FOCUS_TOAST`.
  `REAPPLY_FOCUS_CAPTION` mirrors Focus's `REFOCUS_CAPTION` ("Reframe and export
  again, uses credits.") verbatim for the honest paid-re-export warning.
- **`OverlayScreen.jsx`** — `showExportCompletePreview` boolean state (NO API data
  in state); `handleExportComplete` now `await refreshProject()` first, then raises
  the preview ONLY for a plain overlay export (gated on
  `usePublishIntentStore.getState().projectId !== projectId`); four gesture
  handlers; a `CollectionPlayer` preview overlay streaming the FINAL video
  (URL derived at render from the refreshed `project.final_video_id`).
- **`App.jsx handleExportComplete`** — `goToProjectManager` + `openFinishedReel` moved
  INSIDE the publish-intent (Focus one-tap Publish) branch only. A plain overlay
  export no longer auto-navigates home; OverlayScreen owns the completion UI now.

**Abstraction call (task asked me to decide + record):** did NOT extract a shared
`<FlatChoiceActionBar>`. Only two call sites exist (Focus + Overlay); extracting on
the 2nd use is premature per the project's rule-of-three (abstract on the 3rd
duplication — premature indirection hides code paths from grep). When a 3rd flat
action bar appears, extract then and fold both onto it. Recorded in the component
doc comment.

**Per-choice toast decisions (task's "don't blanket-apply" test):**
- Publish Now — NO toast. Lands on the published reel with its own "Published"
  toast (T8400), self-evidently confirming. Mirrors Focus's Publish.
- Reapply Overlay — NO toast. Pure return to the still-mounted Overlay editor
  (the spotlight work is right there). Mirrors Focus's Refocus; also the preview's
  onClose (X/Escape), so an incidental dismiss has no side effects.
- Reapply Focus — TOAST (`OVERLAY_REAPPLY_FOCUS_TOAST`). Moves the user into another
  edit mode with no other confirmation their work was saved; mirrors Focus's Add
  Spotlight Now. Honest that the spotlight carries over the Focus re-export
  (highlight carry-forward, T4350/T4355) and a fresh export follows.
- Publish Later — TOAST. Defers to the drafts surface; reuses `FOCUS_PUBLISH_LATER_TOAST`
  (routed by `is_auto_created`, T8360's Clips-vs-Highlight-Reels split — where the
  draft actually landed). Mirrors Focus's Add Spotlight Later.

**Publish Now semantics:** unlike Focus (whose Publish triggers a fresh overlay
render), the overlay final video ALREADY exists at this point, so Publish Now just
runs the existing `usePublishProject().publish()` gesture then lands on the reel
via `openFinishedReel(..., {alreadyPublished})` — no re-export. The project row is
snapshotted BEFORE publishing (publish archives it + the next fetchProjects drops
it, per `finishedReelNav`'s note).

**Tests / evidence:**
- Unit: `OverlayPublishActionBar.test.jsx` (9) + `screens/__tests__/overlayPublishExit.test.jsx`
  (10) green; the min-content and xl:-breakpoint landmines each have a tripwire.
  Regression `appPublishAfterRender` / `publishIntentStore` / `DraftReelPreview` /
  `FocusPublishActionBar` / `focusPublishExit` (32) still green — the App.jsx
  refactor preserved the Focus one-tap Publish path.
- E2E: `e2e/T9110-overlay-publish-exit.spec.js` via `t9110diag.html` (dev-only
  harness, mirror of t8520diag), 4/4 passed under `dev-verify.sh`. LIVE DOM
  measurement confirmed resolved `grid-template-columns` = 1/2/2/4 tracks at
  375/768/1024/1280 (single row gated at `xl:`, not `sm:`) with the grid's
  `scrollWidth <= clientWidth` and no clipped title at every width. Evidence:
  `qa/T9110-criterion-*.png`.
