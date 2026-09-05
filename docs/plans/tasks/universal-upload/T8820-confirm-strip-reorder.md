# T8820: Confirm strip + reorder editor

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-05
**Updated:** 2026-09-05

## Problem

After T8810 accepts multiple files, the user must SEE and TRUST the inferred order before
uploading, and fix it when we guessed wrong - without blocking, and in parent language.

## Solution

Two new presentational components inside `GameFootagePicker`'s multi-file `ready` state:
`FootageStrip` (horizontal chips + gap connectors + trust line) and `FootageReorderList`
(vertical drag list). Mockup + ALL microcopy: artifact section 03 screen C and the
edge-case table (link in [EPIC.md](EPIC.md), decisions 1-3).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/FootageStrip.jsx` - NEW
- `src/frontend/src/components/FootageReorderList.jsx` - NEW
- `src/frontend/src/components/GameFootagePicker.jsx` - mount strip/list, replace T8810's placeholder
- `src/frontend/src/components/GameFootagePicker.test.jsx` - extend

### Related Tasks
- Depends on: T8810 (picker shell), T8800 (`order`, `confidence`, `gaps`, `skipped`,
  `setManualOrder`, `removeItem`)
- Blocks: nothing (intake complete after this)

### Technical Notes
- Strip container reuses the existing selected-state green (`border-green-500
  bg-green-900/20`); `confidence === 'unknown'` swaps to yellow (`border-yellow-500
  bg-yellow-900/20`) and auto-opens the reorder list.
- Chips: `w-[88px]` cards in a `flex gap-2 overflow-x-auto snap-x` row; line 1 = number
  badge (green `bg-green-600`, yellow when unknown), line 2 = duration ("23 min"),
  line 3 = the EVIDENCE - recorded local clock time ("2:03 PM", mono) when confidence is
  `time`, truncated filename otherwise. Full filename in `title` + `aria-label`.
- Continuous neighbors joined by a small chevron; each `gaps` entry renders a dashed
  connector labeled "{n} min break". A gap > 3 hours renders the connector in yellow with
  label "{n} hr gap - two games?" plus sub-line "If some of these are a different game,
  remove them here and upload that game separately."
- Trust line (exact strings): time -> "Put in order by the time each was recorded"
  (green, clock icon); name -> "Put in order by their names" (gray, file icon); unknown ->
  "We couldn't tell what order these go in - please check" (yellow, warning icon);
  manual -> "Order set by you" (green check). Right-aligned "Adjust order" text button
  always visible (never hover-only), min 44px tap target on coarse pointers.
- Header: "Your game - {n} videos - {humanized total}" (e.g. "1 hr 8 min").
- Skipped junk: collapsed `<details>`: "Skipped {n} extra camera files" expanding to the
  filenames + sub-line "Photos and helper files the camera makes - not game video."
  Gray, never a warning color.
- "+ Add more" dashed chip at the row end calls the picker's file input; the strip
  container remains a drop target (drops merge via `addFiles`).
- Per-chip remove: X button revealed on hover (desktop) / long-press (mobile) -
  secondary path; the always-visible remove lives on the reorder rows.
- Reorder list: vertical rows (drag handle, number badge, filename, duration + evidence,
  X), Pointer Events + `setPointerCapture` + `touch-none` (same drag pattern as the
  timeline levers), rows >= 44px on coarse pointers. Dragging live-updates the strip;
  any manual change calls `setManualOrder` (trust line flips to "Order set by you").
  Header "Fix the order" + Done button, yellow edit tint (`bg-yellow-950/20
  border-yellow-800/40`), helper "Drag to match how the game was played".
- A `probeError` item renders as a red-tinted chip "Can't read this one" with remove as
  its only action, excluded from totals; submit allowed once removed.

## Implementation

### Steps
1. [ ] Build `FootageStrip` (header, chips, connectors, trust line, Adjust order, Add
   more, junk details) purely from `useFootageIntake` state + callbacks.
2. [ ] Build `FootageReorderList` with the vertical drag interaction; wire open/close
   (Adjust order opens; auto-open when confidence `unknown`; Done closes).
3. [ ] Mount both in `GameFootagePicker`'s multi-file state; delete T8810's placeholder.
4. [ ] Mobile pass at 360/390/428px: chips scroll naturally (~3.5 visible at 360),
   reorder rows thumb-draggable, no horizontal page scroll.
5. [ ] Tests: strip renders DJI fixture (4 chips, 1 gap connector "9 min break", green
   trust line); Legends fixture (name trust line, filename evidence on chips); unknown
   fixture (yellow + list auto-open); drag reorder updates sequence payload + trust line;
   remove; huge-gap yellow connector; probeError chip blocks nothing after removal.

### Progress Log

**2026-09-05**: Filed.

## Acceptance Criteria

- [ ] All three confidence states render with the exact approved strings
- [ ] Drag-to-reorder works with a mouse AND via touch emulation, updating sequences
- [ ] Submit is NEVER disabled by ordering ambiguity
- [ ] Single-file games never render any of this (T8810's C0 state untouched)
- [ ] Curated test set green
