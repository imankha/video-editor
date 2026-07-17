# T5290: Recap player mobile redesign (portrait is a crushed desktop layout)

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-17
**Updated:** 2026-07-17

## Problem

`RecapPlayerModal` renders a **desktop two-pane layout** — a fixed `w-64` (256px) clips
sidebar beside the video — with **no mobile breakpoint**. On a phone in portrait this is
broken; the only responsive escape hatch is fullscreen.

### Evidence (driven live as imankh@gmail.com, game "at Sporting Mar 21", 2026-07-17)

Measured via Playwright at real device sizes (screenshots were in `src/frontend/qa/recap-ux-*.png`):

| State | Viewport | Video box | Sidebar | Verdict |
|-------|----------|-----------|---------|---------|
| **Portrait (default modal)** | 390×844 | **116×65 px**, jammed top-right | 256px (66% of width) | **Broken / unwatchable** |
| Landscape (default modal) | 844×390 | 263×148 px | 256px | OK (what it was designed for) |
| Fullscreen portrait | 390×844 | 390×844 (letterboxed) | hidden | Best current experience |

Portrait specifics:
- The 256px clips sidebar consumes ~66% of a 390px screen; the **landscape (16:9) recap
  video is crushed into a ~116×65px sliver** in the top-right corner with a large dead black
  void beneath it.
- The active-clip pill header mashes timestamp and name together (`8'56"Good Control`) in the
  narrow column.
- The bottom control bar is cramped into the ~116px-wide video column; the fullscreen button
  measured as spilling past the modal's right edge.

### Root cause

The annotations layout is a single horizontal flex row for all widths:
`RecapPlayerModal.jsx:308` `<div className="flex flex-1 min-h-0">` → sidebar (`w-64`,
`:316`) + video column (`flex-1`, `:364`). The modal shell (`:249-255`) is
`max-w-6xl mx-4 max-h-[90vh]` (desktop card) in the non-fullscreen branch. Nothing switches to
a stacked layout below `sm`. `useIsMobile()` is already imported and in scope
(`:33`, passed to `NotesOverlay`) but does not drive the layout.

## Solution — mobile-first redesign (full scope, user-approved 2026-07-17)

Mirror the T4880 / T4933 pattern (stack vertically + own scroll region on small screens).
Keep the desktop layout byte-identical at `>= sm`.

### 1. Full-bleed modal on phones
Non-fullscreen shell: on `< sm` use `w-full h-dvh` (no `mx-4`, no `max-h-[90vh]`,
no rounded card) so the player owns the viewport; keep
`rounded-xl border max-w-6xl mx-4 max-h-[90vh]` at `>= sm`. Use `h-dvh` (never `h-screen` /
`100vh`) per the T4880/T4931 viewport-unit rule + the `check-viewport-units.mjs` gate.

### 2. Vertical stack on phones (the core fix)
On `< sm`, the annotations layout becomes a column instead of a row:
- **Video on top**, full modal width, correct 16:9 (`w-full`, `object-contain`), controls
  directly beneath it (as today's video column, just full-width).
- **Clip list below** the video as its own `min-h-0 overflow-y-auto` region (reuse
  `RecapClipsSidebar`), OR a horizontal-scroll strip of clip chips — implementer's choice,
  but it must not steal vertical space from the video (cap it, e.g. `max-h-[38dvh]`, and scroll
  internally). The `13 clips` / `Create clip` header row stays above the list.
- At `>= sm` keep the current side-by-side (`w-64` sidebar + `flex-1` video).
Do this with Tailwind responsive classes (`flex-col sm:flex-row`, `w-full sm:w-64`,
`h-auto sm:h-full`, etc.) driven by the breakpoint — prefer classes over `isMobile` branching
where a class suffices; use `isMobile` only where structure (not just styling) must differ.

### 3. Auto-immersive on portrait phones
When opened on a portrait phone, default into the immersive/fullscreen video layout (fullscreen
is already the best experience) with the clip list reachable as a bottom sheet / pull-up rather
than a permanent pane. Gesture-scoped and ephemeral (view state only — never persisted, per the
no-persisted-view-state rule). Exiting immersive returns to the stacked layout from #2. Keep the
existing `toggleFullscreen` control working. (If a full bottom-sheet is too big for this task,
the acceptable floor is: portrait phone opens with the video maximized and the clip list
collapsed-but-reachable — do NOT ship the current crushed side-by-side.)

### 4. Polish
- Active-clip pill (`NotesOverlay`): stop it overlapping the top edge of the video on narrow
  widths; give the timestamp and clip name a gap so they don't run together (`8'56" Good
  Control`, not `8'56"Good Control`). `NotesOverlay` already receives `isMobile`.
- Highlights tab (`effectiveTab === 'highlights'`) gets the same stacked treatment (it shares
  the two-pane structure).

## Relevant files
- `src/frontend/src/components/RecapPlayerModal.jsx` — modal shell (`:249`), annotations layout
  (`:307-361` sidebar / `:363-445` video), highlights layout, tab bar. Primary change.
- `src/frontend/src/components/recap/RecapClipsSidebar.jsx` — clip list (reused in the stacked
  layout; may need a horizontal-strip variant)
- `src/frontend/src/components/shared/NotesOverlay.jsx` (or wherever `NotesOverlay` lives) —
  pill overlap + time/name spacing on mobile
- `src/frontend/src/components/RecapPlayerModal.test.jsx` — extend for the stacked layout
- `useIsMobile` hook — already in scope; reuse, don't reinvent

## Testing (must drive the real app, not just unit render)
Use the drive-app-as-user harness (`loginAsRealUser('imankh@gmail.com','9fa7378c')`, open a game
with annotations, click **Recap**) and assert with `getBoundingClientRect` at 390×844,
844×390, and desktop:
- Portrait: video width >= ~90% of modal width (NOT the 116px sliver); no element with
  `right > innerWidth` or `bottom > innerHeight`; no horizontal overflow.
- Landscape + desktop: unchanged from today (regression).
- `saveEvidence` screenshots per state. Run `check-viewport-units.mjs` (no new `100vh`/`h-screen`).

## Acceptance Criteria
- [ ] Portrait phone: recap video is full-width and watchable (video box >= ~90% modal width,
      not a corner thumbnail); clip list is below it in its own scroll region; no horizontal
      overflow; no controls off-screen.
- [ ] Portrait phone opens into the immersive/maximized-video layout (clip list reachable, not a
      permanent 256px pane).
- [ ] Landscape and desktop layouts are visually unchanged (regression).
- [ ] Active-clip pill no longer overlaps the video top edge; timestamp/name are spaced.
- [ ] Highlights tab gets the same mobile treatment.
- [ ] `check-viewport-units.mjs` green (no `100vh`/`h-screen`); view state stays ephemeral
      (no persistence).
- [ ] Tests pass (unit + live-drive evidence per criterion).

## Context
### Related Tasks
- Same class as: T4880 (editor mobile unreachable), T4933 (annotate landscape sidebar),
  T4931 (recap fullscreen `h-dvh`). This is the recap *non-fullscreen* portrait gap those
  didn't cover.
- Found by: manual drive during the T5090/T5260 staging derisk pass (2026-07-17).

### Classification hint
M-tier, frontend-only, ~2-4 files, no backend/schema change. Responsive layout work +
live-drive verification; no new abstractions. Reviewer: Yes (layout regression risk on the
shared desktop path).
