# T5700: Team / My Athlete layer in Annotate

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-07-21
**Updated:** 2026-07-21

Task 1 of 5 in the [Share the Game epic](EPIC.md). Absorbs T4920.

## Problem

Team plays have no identity in Annotate. The only related control is the "My Athlete" on/off
toggle buried at the bottom of the desktop clip editor (default on, absent on mobile), and a
clip with `my_athlete = 0` never visibly surfaces anywhere again. Parents can't tag "great team
play" as a first-class thing, which blocks the team recap and the shareable game link
(downstream tasks).

## Solution

Promote the existing `raw_clips.my_athlete` boolean into a visible two-layer model. See
[EPIC.md](EPIC.md) for the locked decisions: strictly one layer per clip; layer IS the
`my_athlete` bit (**no schema change, no migration**); toggle sticky within session, reset to
My Athlete on game open, never persisted.

1. **Tagging-mode toggle** — a segmented "My Athlete / Team" control in the Annotate UI
   (placement per UI Designer; near the timeline or clip-list header). Sets which layer NEW
   clips land on (`addClipRegion` default in `useAnnotate.js` currently hardcodes
   `my_athlete: true`). Ephemeral React state owned by the Annotate screen/container.
2. **Per-clip layer switch** — replace the on/off toggle in `ClipDetailsEditor.jsx`
   (`handleMyAthleteChange`, L165-168, toggle UI L282-300) with a two-value segmented control
   (My Athlete / Team). Add the same control to the mobile add/edit overlay
   (`AnnotateFullscreenOverlay.jsx` — today my_athlete is desktop-only). Same DB write path:
   `onUpdate({ my_athlete })` → `useRawClipSave` → `PUT/POST /clips/raw` (gesture-based,
   unchanged backend).
3. **Layer visibility** — color-code the layer everywhere the clip appears: timeline region
   markers, `ClipsSidePanel` clip-list rows (chip: cyan MY ATHLETE / amber TEAM), and the
   layer of the currently-selected clip in the editor. Filter pills in the clip list:
   All / My Athlete / Team.
4. **Imported clips** (`shared_by` NOT NULL, already forced `my_athlete=0` by
   materialization) render on the Team layer with the existing "Shared by {name}" attribution.
5. **Consumption audit (regression, no behavior change):** reels/rankings/collections/clip
   selector already read only `my_athlete=1` via `exclude_teammate_reels_clause`
   (`queries.py:173`) and `GameClipSelectorModal`'s `myAthleteOnly` default — add/extend tests
   pinning that Team-layer clips stay out of those surfaces.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` — new-clip layer default
  (`addClipRegion` L385/422; load normalization L302/642/702)
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` — per-clip layer control
  (replaces on/off toggle L282-300)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — mobile add/edit
  layer control (L165/266/278)
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` — layer chips + filter pills
- `src/frontend/src/screens/AnnotateScreen.jsx` / `src/frontend/src/containers/AnnotateContainer.jsx`
  — mode-toggle state ownership + threading (my_athlete already threads at
  AnnotateContainer L797/815/894/926)
- Timeline marker component (region markers rendered from clipRegions) — layer color
- No backend changes expected (`clips.py` already persists `my_athlete`); tests only

### Related Tasks
- Absorbs: T4920 (superseded)
- Blocks: T5710 (per-layer recaps read the layer), T5720/T5730
- Related: T5330 (shared-in provenance), v003_fix_shared_clip_athletes (my_athlete=0 backfill
  for shared clips — prior art for the bit's semantics)

### Technical Notes
- Knowledge doc: [annotate.md](../../../.claude/knowledge/annotate.md) — load before exploring.
- `my_athlete` NULL is legacy = My Athlete (existing rule: `my_athlete ?? true` in
  useAnnotate). Keep that read-time normalization; do NOT migrate NULLs.
- Toggle state: ephemeral, screen-owned, resets to My Athlete per game open. Never persisted,
  never in a store that syncs.
- Layer colors: cyan = My Athlete (matches existing toggle's cyan-600), amber = Team. Run the
  UI Designer for placement + exact treatment (chips, marker tint, filter pills).
- L-tier by workflow (core-flow UI + UI Designer gate) but NO schema change and no new
  backend surface.

## Implementation

### Steps
1. [ ] UI Designer: toggle placement, chip/marker/filter visual language (approval gate)
2. [ ] Mode toggle state + new-clip layer default (useAnnotate/AnnotateScreen)
3. [ ] Per-clip segmented control (desktop ClipDetailsEditor + mobile AnnotateFullscreenOverlay)
4. [ ] Layer chips on clip list + timeline marker colors + filter pills
5. [ ] Regression tests: Team clips excluded from reels/rankings/selector; layer persists via
       existing gesture path; toggle never persisted
6. [ ] Real-browser verify (drive-app-as-user) — tagging flow on desktop + mobile viewport

### Progress Log

**2026-07-21**: Created from the epic consolidation (T4920 superseded). Design session locked
the one-layer model + sticky toggle.

## Acceptance Criteria

- [ ] New clips land on the layer selected by the mode toggle; toggle resets to My Athlete on
      game open and is never persisted
- [ ] Any clip's layer can be switched from the clip editor on desktop AND mobile
- [ ] Layer is visible at a glance: timeline markers, clip-list chips, filter pills
- [ ] Imported clips (`shared_by` NOT NULL) appear on the Team layer with attribution
- [ ] Reels, rankings, collections, clip selector: unchanged behavior (tests pin it)
- [ ] No schema change, no migration, no new persistence path
