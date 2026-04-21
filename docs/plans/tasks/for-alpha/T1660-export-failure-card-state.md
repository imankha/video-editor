# T1660: Export Failure Card State

## Problem

When an export fails (network error, R2 unreachable, server crash), the project card on the home screen reverts to "Editing" with a blue progress bar -- indistinguishable from a card that was never exported. The user gets no persistent indication that an export was attempted and failed.

### What happens today

1. User starts export -> card shows amber "Framing..." bar, "Exporting..." status
2. Export fails (any reason) -> card reverts to blue "in_progress" bar, "Editing" status
3. "Sync failed -- click to retry" button appears (R2 sync failure, separate system)
4. User sees no trace that an export was attempted

### What should happen

1. After export failure, the card should show a distinct state (e.g., red/orange bar segment, "Export failed" label)
2. The "Sync failed" button at bottom-right is about R2 database sync, not the export -- this is confusing when it appears alongside an export failure
3. Clicking a failed-export card should offer to retry, not just open the editor

## Observed during T1520 testing

- Local test: turned off internet during export -> backend couldn't reach R2 -> server sent genuine error via WS -> card reverted to blue "Editing" with no failure indication
- The blue `bg-blue-500` color for `in_progress` is used for both "actively editing" and "export failed, back to editing" -- no visual distinction

## Scope

- Add an `export_failed` status to `SegmentedProgressStrip` color mapping (e.g., `bg-red-500` or `bg-orange-500`)
- Track last export failure per project in the export store
- Show failure state on the card until user re-exports or dismisses
- Consider whether "Sync failed" button needs disambiguation from export failures

## Files likely affected

- `src/frontend/src/components/ProjectManager.jsx` -- `SegmentedProgressStrip` color mapping + card state
- `src/frontend/src/stores/exportStore.js` -- track failure per project
- `src/frontend/src/containers/ExportButtonContainer.jsx` -- surface failure state

## Priority

Low -- cosmetic UX issue, does not cause data loss. The export failure IS communicated via toast; this is about persistent card-level indication.
