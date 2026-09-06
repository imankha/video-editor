# T8822: Consolidate footage strip + reorder list into one draggable list, add overlap badge

**Status:** WIP
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-06
**Updated:** 2026-09-06

## Problem

Live-testing feedback on T8820's shipped confirm strip: every selected video is shown in
TWO places (`FootageStrip`'s horizontal chip row, and `FootageReorderList`'s vertical drag
list, opened via a separate "Adjust order" tap) - confusing duplication for one underlying
list. Separately, the user wants the picker to keep an open mind about overlapping footage
(a half-by-half upload plus an iPhone clip that spans both halves) rather than only ever
assuming one strictly serial order.

## Solution

Collapse both components into one always-visible, always-draggable vertical list
(`FootageList`, replacing `FootageStrip`; `FootageReorderList` is deleted). Add a
light-touch overlap badge: using the SAME `creationTime`/`duration` evidence
`useFootageIntake` already exposes, flag when two items' recorded time ranges intersect
(only when `confidence === 'time'` - no reliable evidence otherwise). This is NOT the full
lane/angle system (T8880/T8890 own that, in Annotate, against real `offset_seconds`) - it's
a cheap, purely informational heads-up at upload time. See EPIC.md decision 3 (confirm
strip) and decision 8 (angle vocabulary/color - reuse violet here for consistency, since
this is the same underlying concept surfacing one screen earlier).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/FootageStrip.jsx` - renamed/rewritten to `FootageList.jsx`
- `src/frontend/src/components/FootageReorderList.jsx` - DELETED, behavior merged in
- `src/frontend/src/utils/footageDisplay.js` - add `overlapGroups(order, confidence)` pure
  helper
- `src/frontend/src/components/GameFootagePicker.jsx` - remove `reorderOpen` state/effect,
  render one `FootageList` unconditionally
- `src/frontend/src/components/FootageStrip.test.jsx` +
  `src/frontend/src/components/FootageReorderList.test.jsx` - DELETED, replaced by
  `FootageList.test.jsx` covering the union of both plus new overlap tests
- `src/frontend/e2e/T8820-confirm-strip-reorder.qa.spec.js` - update the drag test (no more
  "Adjust order" tap / "Done" close - the list is always there)

### Related Tasks
- Follows: T8820 (shipped STAGING) - this supersedes its two-component UI, same epic
- Read `.claude/knowledge/annotate.md` before starting for upload/footage context

### Technical Notes
- Item shape (from `useFootageIntake`, unchanged by this task): `{ name, size, duration,
  creationTime: Date|null, file }` (+ `probeError: true` variant with null duration/time).
- Overlap definition: two items A, B (both with non-null `creationTime` and `duration`,
  and `confidence === 'time'`) overlap when
  `A.creationTime < B.creationTime + B.duration*1000 && B.creationTime < A.creationTime + A.duration*1000`.
  `overlapGroups` returns a `Map<name, string[]>` (overlapping item names) so the component
  stays presentational.
- Badge copy (plain language, matches EPIC microcopy tone, never "lane"/"layer"/"overlay"):
  "Looks like this overlaps with {other item's short label} - that's fine, we'll treat it
  as a second angle." Violet accent (border/badge), per EPIC decision 8's angle color.
- Merged list, per row: drag handle (always active, no separate mode) + order bubble +
  evidence text/duration (reuse `footageEvidence`/`humanizeMinutes`) + remove button
  (always visible, matches `FootageReorderList`'s existing behavior) + overlap badge when
  applicable. Gap connectors (existing `gapDisplay`) render as thin inline dividers between
  rows instead of between horizontal chips. Trust line, header, skipped-junk disclosure,
  and "+ Add more" keep their existing copy/logic, now living in the one list instead of
  split across two components.
- Preserve every existing behavioral guarantee from both old test files (DJI time-chain,
  Legends name-fallback, unknown/yellow state, manual trust line, huge->"two games?" gap,
  skipped disclosure, probeError row exclusion, pointer-drag reorder incl. second-pointerId
  ignore, touch-none handles, 44px coarse-pointer targets) - this is a consolidation, not a
  behavior cut.
- No backend/API changes. `order` reporting to the parent (`onFootageChange`) is unchanged.

## Implementation

### Steps
1. [x] Add `overlapGroups(order, confidence)` to `footageDisplay.js` + unit tests
   (synthetic descriptors: two overlapping, none overlapping, only meaningful at
   `confidence === 'time'`).
2. [x] Write `FootageList.jsx`: merge `FootageStrip` + `FootageReorderList` into one
   always-draggable vertical list per the Technical Notes row shape; add the overlap badge.
3. [x] Update `GameFootagePicker.jsx`: drop `reorderOpen` state/effect + the
   `FootageReorderList` import/usage; render the single `FootageList`.
4. [x] Delete `FootageReorderList.jsx` + `FootageReorderList.test.jsx`; delete
   `FootageStrip.jsx`/`.test.jsx` (superseded).
5. [x] Write `FootageList.test.jsx` covering the union of prior coverage + overlap badge
   cases.
6. [x] Update `T8820-confirm-strip-reorder.qa.spec.js`: drag test drives the list directly
   (no adjust-order tap, no reorder-done close); responsive-overflow test no longer needs
   to open anything first.

### Progress Log

**2026-09-06**: Filed from live-testing feedback on T8820's shipped UI; user approved the
light-touch overlap-badge approach over a full lane-preview alternative in conversation
(pulling T8880's real lane algorithm into the picker was rejected as unnecessary
complexity/consistency risk - reserved for Annotate). Implemented inline in the shared
supervisor session (M-tier, single-area frontend). Fresh-context Reviewer caught a real
bug in the first draft: the merged row rendered `item.name` on the title line AND again
via `footageEvidence`'s non-mono fallback (which IS the filename) for every
non-`time`-confidence state - fixed by gating the evidence line on `evidence.mono`
(clock-time evidence only), with the offending test corrected to assert no duplication
rather than codify it. Also fixed on review: a stale last-row gap-connector guard, the
overlap badge silently dropping partners beyond the first (now says "and N more"), and a
magic-number cleanup in `shortLabel`. 42 unit tests green, 3/3 e2e green (real browser,
live stack), eslint clean.

## Acceptance Criteria

- [x] Every video appears in exactly ONE place in the confirm UI, always draggable (no
      separate "Adjust order" mode/button)
- [x] `overlapGroups` correctly flags intersecting time ranges only at `confidence ===
      'time'`; no false positives for name/unknown/manual confidence
- [x] All prior `FootageStrip`/`FootageReorderList` behavioral guarantees still pass
      (consolidated into `FootageList.test.jsx`)
- [x] E2E confirm-strip spec passes against the new single-list interaction
- [x] Curated frontend unit + the one e2e spec green
