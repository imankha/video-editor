# T11770: Shared cost row that never scrambles

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Tier:** M (frontend only, 1 new component + 4 call sites + tests, ~90 LOC)
**Created:** 2026-10-04
**Decision gate:** none (recommendation only) **Ruled 2026-10-04: recommended option taken.**

## Epic Context

Task 4 of 4 in [Epic B: Fits on phones and tablets](EPIC.md). T11880 (upload modal copy) builds on
this component. Milestone rules: [README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [iphone/03](../../../ux/2026-10-04-parent-usability-audit/iphone/03-upload-modal-credit-wrap-and-jargon.png).
At 390px the upload modal reads "2 credits - keeps your video for 30 Balance: days 54". The row is
`flex items-center justify-between`; both sides wrap and their lines interleave. This is the moment
the parent decides whether uploading is affordable and safe.

The same row is copied four times, so per the refactoring rules (abstract on the third duplication)
it becomes one component.

## Solution

New `components/shared/CreditCostRow.jsx`:

```
Cost: 2 credits                 Balance: 54 credits
Your game video is kept for 30 days.
```

```jsx
<div className="flex flex-col gap-0.5 text-sm">
  <div className="flex flex-wrap justify-between gap-x-3">
    <span className="whitespace-nowrap">Cost: {cost} credits</span>
    <span className="whitespace-nowrap">Balance: {balance} credits</span>
  </div>
  {note && <p className="text-xs text-gray-400">{note}</p>}
</div>
```

- Props: `cost` (number), `balance` (number), `note` (string, supplied by the caller because
  StorageExtensionModal's wording differs). Keep the existing Coins icon before "Cost" if the
  call sites show it today.
- When `balance < cost`: balance text `text-red-400`. The caller keeps rendering its own buy-credits action.
- Same layout at every width (not a mobile-only fork).

## Relevant Files (under `src/frontend/src/`)

- `components/GameDetailsModal.jsx:257-263` (upload game)
- `components/AttachVideoModal.jsx:142-148`
- `modes/annotate/AddFootageButton.jsx:259-268`
- `components/StorageExtensionModal.jsx` (~`:181`)
- `config/displayNames.js` - add `CREDIT_COST_ROW.COST`, `.BALANCE`, and
  `UPLOAD.GAME_RETENTION_NOTE: 'Your game video is kept for 30 days.'`. Read the retention days from
  the same constant the current string uses; do not hardcode 30 if a constant exists.

## Implementation Steps

1. Create `CreditCostRow.jsx` and its test.
2. Replace each of the four copies with `<CreditCostRow cost={...} balance={...} note={...} />`.
   Keep each modal's own wording in its `note`.
3. Remove the now-dead per-modal markup.

## Acceptance Criteria

1. At 320 and 390 the cost, balance and retention facts never interleave; each is readable on its own line or unit.
2. All four modals show the same layout.
3. Insufficient balance shows the balance in red and the existing buy-credits path still works.

## Tests (red first)

- New `components/shared/CreditCostRow.test.jsx`: renders cost/balance/note; red balance when short.
- Update `GameDetailsModal.videoFirst.test.jsx:77-78` (pins `/2 credits - keeps your video for 30 days/`
  and `/Balance:\s*88/`), `AttachVideoModal.test.jsx:62`, `StorageExtensionModal.test.jsx:137`
  (exact `'Balance: 10'`).

## Landmines

- The modal intro paragraph above this row is rewritten by T11880, not here.
- Do not change credit costs or balance fetching; layout only.
