# T5010: Harden T4850 bulk-select e2e (fragile card locator) + cover 4d/4g in UI

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-07-12
**Updated:** 2026-07-12

## Problem

In the 2026-07-12 derisk sweep, `e2e/T4850-move-reels.spec.js` failed its
bulk-select test (`c2+c3`) in a fresh container while the FEATURE works: a
manual probe on the same stack showed card clicks toggling selection
(0 → 1 → 2 selected) and the Move button enabling.

The spec selects cards with:

```js
const cards = page.locator('div.cursor-pointer').filter({ hasText: 'Bulk' });
```

`div.cursor-pointer` + `hasText` matches ANCESTOR wrappers too (group
containers also carry cursor-pointer and contain the card text), so the
clicks can land on a wrapper with no onClick → "0 selected" → the test waits
forever on the disabled "Move to profile" button (300s timeout). Because the
file runs `mode: 'serial'`, the two tests after it (4d delete-in-target, 4g
round-trip) never run — so a REAL future regression in bulk-move would be
indistinguishable from this locator flake, and 4d/4g have no UI coverage.

(4d/4g were verified by API probe during the sweep: move A→B → stream/download
200 in B, move back → stream 200 in A, delete removes the row.)

## Solution

1. Add a stable hook on the selectable reel card in `DownloadsPanel.jsx`:
   `data-testid="reel-card"` (and `data-selected={isSelected}` for free
   assertions). The card root is the div whose
   `onClick={selectMode ? () => toggleSelected(download.id) : undefined}`.
2. Update the spec to `page.getByTestId('reel-card').filter({ hasText: 'Bulk' })`
   and assert the `N selected` counter increments after each click (fail fast
   on the first non-registering click instead of timing out on the Move
   button).
3. Consider `test.describe.configure({ mode: 'serial' })` fallout: keep serial
   (state builds up), but the fail-fast assert keeps 4d/4g reachable in the
   common case.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/DownloadsPanel.jsx` — reel card root (selection
  onClick + isSelected ring class); add data-testid only, no behavior change
- `src/frontend/e2e/T4850-move-reels.spec.js` — c2+c3 test locators

### Related Tasks
- T4850 (STAGING) — the feature; this is its test-debt follow-up

### Technical Notes
- Run in a /dotask container (`bash scripts/task.sh test <id>
  e2e/T4850-move-reels.spec.js`) — the spec needs the `/api/test/*` seams and
  R2, which staging does not mount (seams are dev/local-only by design).
- Evidence from the sweep run lives at
  `C:\work\tasks\derisk-sweep\qa\criterion-2-bulk-selected.png` (select mode
  on, checkboxes unchecked, "0 selected").

## Implementation

### Steps
1. [ ] Add `data-testid="reel-card"` + `data-selected` to the card root.
2. [ ] Rewrite the c2+c3 selection block: click card → expect counter text
       `1 selected`, click second → `2 selected`, then Move.
3. [ ] Full spec run in a fresh container: 8/8 must pass; paste the tail.

### Progress Log

**2026-07-12**: Root-caused during the derisk sweep (probe proved the feature
works; the locator is the flake). 5/8 spec tests passed; 4d/4g covered by API
probe in the interim.

## Acceptance Criteria

- [ ] `e2e/T4850-move-reels.spec.js` passes 8/8 in a fresh container
- [ ] Selection asserts on the `N selected` counter (fail-fast), not on the
      Move button's enabled state
- [ ] No product behavior change (testid/data attributes only)
