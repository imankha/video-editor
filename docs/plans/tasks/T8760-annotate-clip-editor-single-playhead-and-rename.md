# T8760: Annotate clip editor — single play control, clip-scoped looping playhead, remove duplicate name field, rename Create Reel

**Status:** STAGING (merged to master 2026-09-04, PR #336)
**Impact:** 7
**Complexity:** 6
**Created:** 2026-09-04

User feedback (2026-09-04), live-testing on staging-bound branches, three screenshots with
annotations. Bundled into one task because all changes land in the same clip-editing surface
(`AnnotateFullscreenOverlay.jsx` + the timeline/scrub/transport components it composes) and
several are structurally related (removing the small play button and consolidating playback
control is the same change as the clip-scoped looping behavior).

## Problem / Solution, itemized from the user's annotated screenshots

### 1. Rename "Create Reel" → "Clip Out Play"
Button currently reads "+ Create Reel" in the clip-edit panel
(`AnnotateFullscreenOverlay.jsx`, near the star rating). Rename to **"Clip Out Play"**
everywhere it appears (button label, any empty-state/help copy, tests, docs).

### 2. Toast on ready
When the user taps the renamed button and the clip is ready, show a toast naming the clip
and confirming its new home: e.g. **"[clip name] is now in In Progress Clips"** (exact
copy TBD by whoever picks this up — match the existing toast style used elsewhere, e.g.
T8390's "Add Spotlight Later" toasts). "In Progress Clips" is the tab name from T8555
(already shipped) — confirm that task has landed before wiring the copy, so the name is
current.

### 3. Remove the duplicate name field
Screenshot 3: the clip-edit panel shows the clip name TWICE — once in the header
("✏️ Editing: Brilliant Interception, Pass and Dribble") and again in a separate text
field next to the "Create Reel"/"Clip Out Play" button ("Brilliant Interception, Pas...").
**Remove the second occurrence** (the standalone field in the button row) — the header is
the only place the name should show.

### 4. Drop "Editing:" from the header, pencil icon becomes the edit affordance
Header currently reads "✏️ Editing: [name]". Remove the word "Editing:" — header becomes
just "✏️ [name]". **Clicking the pencil icon enables inline editing of the name** (this
is the replacement for the field removed in item 3 — one edit affordance, not two).

### 5. Single play control — remove the small in-panel play button
Screenshot 3 (X'd out) and screenshot 2: the clip-edit panel has its own small play button
next to the duration readout ("7.3s ▶"). **Remove it.** Screenshot 1 (red circle): the
MAIN video player's transport bar (skip-back / prev-frame / play-pause / restart /
next-frame, above the clip-edit panel) already has its own play button — **this becomes
the single source of playback control** while a clip is being edited, not a second
separate mini-player.

### 6. Playback scoped + looped to the clip while editing
While editing a clip, the main transport's play button must play **only within the
clip's own start/end bounds** (the green region), and **loop back to the start** when it
reaches the end — never continuing into the rest of the game video. This is a real
behavior change to the shared video-playback hook/controller, gated on "a clip is
currently being edited," not a permanent mode change to the player.

### 7. Playhead always visible, defaults to clip start
The playhead marker must always be visible while editing a clip (ties into
[T8720](T8720-annotate-playhead-visibility-inconsistent.md)'s already-shipped fix — this
extends that invariant into the new clip-scoped-loop behavior, don't regress it). On
opening a clip for editing, the playhead defaults to the clip's **start** time, not
wherever the main game video happened to be positioned.

### 8. Only the green area is shown
The clip-edit timeline should display **only the clip's own bounded region** (the green
area) as the scrub/playable range — not the full game timeline surrounding it. Confirm
with Code Expert exactly what "only show the green area" means in the current
`ClipScrubRegion.jsx` rendering (e.g. does the timeline zoom/crop to just the clip span,
or does everything outside the green region simply become non-interactive/dimmed further
than today) before implementing — the screenshots show context ticks outside the green
region today; the user wants those gone or at minimum non-functional.

### 9. Spacebar still starts/pauses
Reinforces T8720: spacebar must start/pause the (now clip-scoped, looping) playhead the
same as the transport button. Both trigger paths must stay converged per T8720's existing
fix — do not reintroduce a divergence while adding the clip-scoping/loop behavior.

### 10. Replace the time display with clip-relative time while editing
User: "add the clip time somewhere that makes sense... like where the current
'00:39:00.475 / 01:28:01.809' is, since that's not relevant to the clip it shouldn't be
there." Screenshot 1's red underline points at the main transport's absolute time readout
(current position / full game duration). **While editing a clip, REPLACE that readout**
with clip-relative time (e.g. elapsed-within-clip / clip-duration, like `3.2s / 7.3s`) —
not a supplement alongside it. The absolute game-time readout is correct and unchanged
outside clip-edit mode.

## Context

### Relevant Files (anticipated — confirm via Code Expert, this surface was just touched by
T8720/T8730, re-verify current line numbers)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — header,
  name field, "Create Reel" button, toast trigger
- `src/frontend/src/modes/annotate/components/ClipScrubRegion.jsx` — green-region
  rendering, playhead (T8720's recent fix lives here — build on it, don't replace it)
- `src/frontend/src/modes/annotate/components/PlaybackControls.jsx` — the main transport
  bar (play/pause, skip, restart, time readout) — likely where the clip-scoped-loop gate
  and the new clip-time display both need to land
- Whatever hook owns actual video playback/seeking (find via Code Expert) — the
  clip-scoped-loop behavior belongs there, gated on "currently editing a clip," not
  hardcoded into the transport UI component

### Related Tasks
- Builds directly on [T8720](T8720-annotate-playhead-visibility-inconsistent.md)
  (STAGING, merged) — the persistent playhead this task extends into clip-scoped looping.
  Do not regress T8720's button/spacebar convergence fix.
- Overlaps physically with [T8730](T8730-annotate-clip-editor-focus-button-and-dialog.md)
  (STAGING, merged) — same `AnnotateFullscreenOverlay.jsx` file (header/naming area);
  re-read the current file state before editing, it has moved since T8730 filed.
- "In Progress Clips" naming depends on [T8555](first-reel-funnel/T8555-published-tab-and-highlights-multiclip-only.md)
  (pushed, held for user review, not yet merged) — confirm it has landed before wiring
  the toast copy in item 2, or use a placeholder and finalize the string once it has.

### Technical Notes
- Clip-scoped-loop is a real interaction-model change (video playback constrained to a
  sub-range + auto-loop) — needs a Code Expert pass to find the right layer to gate it at
  (the shared video hook, not per-component), so it doesn't leak into other playback
  contexts (e.g. normal game scrubbing outside clip-edit mode must be unaffected).
- No schema/backend change anticipated — this is entirely frontend playback/UI behavior.

## Acceptance Criteria

- [ ] "Create Reel" renamed to "Clip Out Play" everywhere (button, copy, tests, docs)
- [ ] Toast on ready names the clip and says it's now in "In Progress Clips"
- [ ] Duplicate name field removed; header drops "Editing:", pencil icon opens inline name
      editing
- [ ] Small in-panel play button removed; the main transport's play button is the single
      control while editing a clip
- [ ] Playback while editing a clip is scoped to the clip's start/end and loops at the end
      (never plays into the rest of the game)
- [ ] Playhead always visible while editing; defaults to clip start on open
- [ ] Only the clip's own (green) region is shown/playable in the edit timeline
- [ ] Spacebar and the transport button stay converged (no T8720 regression)
- [ ] Absolute game-time readout is replaced by clip-relative time while editing a clip
      (not shown alongside it); unaffected outside clip-edit mode
- [ ] Tests pass (unit + e2e covering the loop-at-end behavior, the single-play-control
      consolidation, and the button/spacebar convergence)
