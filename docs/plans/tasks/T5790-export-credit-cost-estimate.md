# T5790: Show estimated credit cost on the Framing Export button

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-24
**Updated:** 2026-07-24

## Problem

User report 2026-07-24 (our biggest user, via text), same message as T5780:

> Wondering if there is a way to put a total clip length option or a ticker that shows
> the estimated credit amount for the clip. Even if you add it right on the Export button
> to show the clip cost, it may alleviate some uncertainty which could avoid
> annoyance/confusion.

Today the credit cost is computed only AFTER the user clicks Export
(`handleExport` in `ExportButtonContainer.jsx:534-565`: fetch balance ->
`calculateEffectiveDuration` -> `getRequiredCredits` -> maybe insufficient-credits
modal). The user never sees the price before committing. Since slow-mo inflates the
cost past the visible clip length (6s clip + 3s slow-mo = 9 credits), the price feels
arbitrary — uncertainty around billing is trust-damaging with exactly our most engaged
payers.

## Solution

Show the estimated credit cost directly on/next to the Framing-mode Export button,
updating live as the user edits (speed, trim, splits, clip add/remove).

- Cost model (already the backend rule): **1 credit per second of OUTPUT video,
  rounded up** — `getRequiredCredits = Math.ceil(videoSeconds)`
  (`creditStore.js:58`); backend remains authoritative at export time.
- Button label suggestion: `Export (9 credits)` — exact copy/placement is a View-layer
  decision against the ui-style-guide; a small line under the button
  (`~9 credits · balance 42`) is an acceptable alternative. Keep it lightweight; no
  new modal.
- **Insufficient-balance preview**: when estimate > current balance, style the
  estimate as a warning (amber) so the user learns BEFORE clicking; clicking still
  runs the existing authoritative flow (refresh balance -> 402/insufficient modal ->
  buy credits). Do not block the click on the estimate — the estimate is optimistic,
  backend decides.
- Scope: **Framing mode only.** Overlay-mode export does not run the per-second
  credit check (see `handleExport` — the credit branch is inside
  `editorMode === FRAMING`); leave the Overlay button untouched.

### Dependency on T5780

Consumes T5780's extracted `utils/effectiveDuration.js` and its live per-clip /
project-total effective-duration derivation (live `useSegments` state for the selected
clip + saved `segments` for others). If T5780 hasn't landed yet, do its mechanical
extraction commit first (see T5780 "Prerequisite extraction") — do NOT duplicate the
calc.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/containers/ExportButtonContainer.jsx` — expose `estimatedCredits` (derived, no state) alongside existing return values; existing credit-check logic at :534-565 is the reference implementation
- `src/frontend/src/components/ExportButtonView.jsx` — render the estimate on/under the button; warning styling when estimate > balance
- `src/frontend/src/utils/effectiveDuration.js` — from T5780 (extracted `calculateEffectiveDuration`)
- `src/frontend/src/stores/creditStore.js` — `balance`, `getRequiredCredits` (`Math.ceil`), `fetchCredits`
- `src/frontend/src/containers/FramingContainer.jsx` — thread live segment state if not already available to the export button (T5780 wiring)

### Related Tasks
- Depends on: T5780 (extracted util + live effective-duration derivation)
- Related: T530 (credit check + insufficient-credits modal), T525/T526 (buy-credits flow)

### Technical Notes
- Balance freshness: `creditStore.balance` is already in the container
  (`useCreditStore((s) => s.balance)`); do NOT poll or reactively `fetchCredits` on
  every edit — the estimate recomputes from local data; balance refresh stays on the
  existing gestures (mount/export/purchase).
- The estimate must match what the click-time check computes for the same data
  (same util, same `Math.ceil`) so users never see the number change between the
  button and the insufficient-credits modal.
- Fail-soft: if effective duration comes back NaN/0 (missing metadata), hide the
  estimate rather than showing a wrong number — mirror the existing fail-closed
  fallback logging (`ExportButtonContainer.jsx:543-548`); don't invent a value.
- No new store state; `estimatedCredits` is derived at render (no-redundant-state rule).
- Mobile: the Framing export button already has mobile placements — verify the label
  fits at 360px without wrapping/overflow (or use the under-button line there).

## Implementation

### Steps
1. [ ] (If T5780 not landed) do the mechanical `effectiveDuration.js` extraction first
2. [ ] Derive `estimatedCredits` + `insufficientForEstimate` in `ExportButtonContainer` from live total effective duration + `creditStore`
3. [ ] Render on the Framing export button in `ExportButtonView` (normal + warning states); Overlay mode untouched
4. [ ] Unit tests: 6s clip + 3s@0.5x -> 9 credits shown; trim reduces it; warning state when balance < estimate; hidden when duration unknown; Overlay button unchanged
5. [ ] Real-browser verify (desktop + 390px): watch the number tick while dragging speed/trim; confirm click-time modal shows the SAME required number

### Progress Log

**2026-07-24**: Task created from user feedback.

## Acceptance Criteria

- [ ] Framing export button (or adjacent line) shows estimated credit cost, live-updating with speed/trim/split/clip-count edits
- [ ] 6s clip + 3s at 0.5x -> shows 9 credits, matching the insufficient-credits modal's "required" for the same edit state
- [ ] Estimate > balance renders a visible warning state; click still goes through the existing authoritative backend check
- [ ] Unknown/NaN duration -> estimate hidden (no fabricated number), warning logged
- [ ] Overlay-mode export button byte-identical
- [ ] No new persisted/store state; unit tests + real-browser evidence (desktop + mobile)
