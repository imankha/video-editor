# T9285: Focus's export-recovery path never shows the publish-exit preview after a mobile tab discard

**Status:** WIP
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-09

## Problem

Follow-up from [T9280](T9280-mobile-focus-export-skips-publish-preview.md) (PR #378, merged
2026-09-09), which fixed a real but SECONDARY defect (a null-selection guard conflation) and
left this — the likely DOMINANT cause of the original report — unfixed and unconfirmed on a
real device.

**Mechanism, per the T9280 worker's Opus expert consult (code-trace confidence, not yet
device-confirmed):**

On mobile, a backgrounded tab can be discarded by the OS during a slow Modal export and
reloaded when the user returns to it. The reload re-initializes `editorMode=FRAMING` (from the
`/focus` URL) with `selectedProjectId=null`. No plain-reload path re-selects the project, so
`App.jsx:546-552` bounces the user to the Clips home and **`FocusScreen` never mounts**. The
export completes via the recovery path (`useExportRecovery.js` / `GlobalExportIndicator`),
which calls only `completeExport(...)` — **never `onProceedToOverlay`/`handleExportComplete`**
for a FRAMING export — so the T8390 preview-first completion screen (`FocusPublishActionBar`)
is never shown. T9280's guard fix is inert for this path since `FocusScreen`'s own guard code
never runs when `FocusScreen` itself never mounts.

## Solution (per the expert consult, needs live confirmation + design judgment before landing)

Route the recovery-path FRAMING completion into an App-level completion handler, carrying a
completion-preview intent across the unmount/reload — e.g. an ephemeral store mirroring the
existing `publishIntentStore` pattern (check whether that store itself can be reused/extended
rather than adding a parallel one — this task's Code Expert step should confirm). On the next
mount (post-reload), if that intent says "a FRAMING export for project X just completed", route
to the same preview-first screen desktop/foreground gets, instead of silently landing on Clips.

## Context

### Relevant Files
- `src/frontend/src/hooks/useExportRecovery.js` — the recovery path that currently only calls
  `completeExport(...)`, with no FRAMING-specific preview branch
- `src/frontend/src/components/GlobalExportIndicator.jsx` — surfaces recovery-completed exports
- `src/frontend/src/App.jsx` (~L546-552, ~L582-633) — the reload-time redirect-to-Clips-home
  logic and `handleExportComplete` (OVERLAY-only today)
- `src/frontend/src/screens/FocusScreen.jsx` — `handleProceedToOverlayInternal` /
  `setShowExportCompletePreview`, the guard T9280 already hardened (verify it composes cleanly
  with whatever cross-reload intent this task adds — don't duplicate the guard logic)
- `src/frontend/src/stores/publishIntentStore.js` — likely reuse/extension target for carrying
  the completion-preview intent across the unmount

### Related Tasks
- Follows: [T9280](T9280-mobile-focus-export-skips-publish-preview.md) (PR #378, merged
  2026-09-09) — fixed the secondary null-conflation guard defect; this task is the dominant
  mechanism T9280 left open
- Same funnel investment this closes the loop on: T8390 (Focus preview-first completion),
  T8520/T8530/T9110 (the rest of the First Reel Funnel publish-exit work)

### Technical Notes
- **Live mobile confirmation is still owed** before implementing — the mechanism above is a
  code-trace hypothesis from an Opus expert pass, not yet reproduced on a real device or a
  faithful simulation. A real OS-level "tab discard" is not cleanly reproducible via Playwright;
  reproduce via an approximation (reload mid-export, or dispatch `visibilitychange` +
  `document.hidden=true` then reload) and confirm the recovery path's actual behavior before
  committing to the fix design above — the mechanism could differ in a real device's detail.
- No schema/persistence change expected — this is in-memory navigation/intent state, ephemeral
  per the no-persisted-view-state rule (this is NOT a case for surgical/full-state DB
  persistence; it only needs to survive a reload within the existing SW/recovery machinery,
  which already handles export continuity — check whether IT already carries enough state to
  derive this rather than adding a new store).

## Acceptance Criteria
- [ ] Mechanism confirmed via live reproduction (real device or a faithful reload-mid-export
      simulation), not just code-reading
- [ ] A Focus export completing via the recovery path (post-reload/tab-discard) lands the user
      on the `FocusPublishActionBar` preview screen for that project, matching the
      still-mounted case T9280 already fixed
- [ ] No regression to the still-mounted (non-discarded) completion path T9280 covers
- [ ] Regression test reproducing the recovery-path gap
- [ ] Tests pass
