# T9110: Overlay gets a publish-exit action bar (Publish Now / Reapply Overlay / Reapply Focus / Publish Later)

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-08

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
