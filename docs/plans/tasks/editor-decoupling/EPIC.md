# Editor State Decoupling Epic

**Status:** TODO
**Started:** -
**Completed:** -
**Source:** [Code quality audit 2026-07-03](../../audit-2026-07-03-code-quality.md) items D1-D7, G2, G4

## Goal

Remove the frontend's remaining single-source-of-truth violations and — the [DEP] directive — its **cross-screen timing contracts**: state written by screen A that screen B's effect must consume in the right order. These contracts are where the export→overlay handoff bugs (T1670 family) keep regrowing, and they make Overlay untestable without Framing having run first.

## The timing-contract inventory (what this epic eliminates)

| Signal | Producer | Consumer | Replacement |
|--------|----------|----------|-------------|
| `projectDataStore.clipMetadata` (doubles as "fresh export" flag) | FramingScreen.jsx:964, useProjectLoader.js:189 | OverlayScreen effect :432-497 (first act: set it to null) | Explicit navigation payload / function argument |
| `overlayStore.isLoadingWorkingVideo` | FramingScreen.jsx:954 (before navigating!) | OverlayScreen 65-line reconcile effect :328-392 + 4 guard refs | Working-video state machine owned by projectDataStore |
| `exportStore` toast flags dismissed by collection-identity-watching effects | AnnotateContainer:1107, OverlayScreen:749 | (same files) | Dismiss inside the actual gesture wrappers |
| React-batch workarounds ("segmentBoundaries won't have the new value yet") | FramingContainer 8 mirror sites | store/API | Compute next state once per gesture |

## Tasks (independent except T4530 last)

| ID | Task | Status |
|----|------|--------|
| T4470 | [FramingContainer: One Next-State Computation per Gesture](T4470-framing-single-nextstate.md) | TODO |
| T4480 | [Kill clipMetadata Event-Bus + Single Overlay-Data Loader](T4480-clipmetadata-bus-removal.md) | TODO |
| T4490 | [Working-Video Single Owner State Machine](T4490-working-video-state-machine.md) | TODO |
| T4500 | [selectedProject → id + Selector](T4500-selectedproject-selector.md) | TODO |
| T4510 | [Annotate API Data → gamesDataStore](T4510-annotate-data-to-store.md) | TODO |
| T4520 | [Reactive-Effect Cleanup Batch](T4520-reactive-effect-cleanups.md) | TODO |
| T4530 | [Editor-Mode Isolation Test Harness](T4530-mode-isolation-harness.md) | TODO |

T4530 (G4) runs LAST: after the timing contracts are gone, add per-mode fixture entry points proving each editor mode loads and is testable without sibling-mode state — and keeping it that way.

## Shared rules (from coding-standards.md, enforced here)

1. Every store write traces to a gesture or a fetch-result landing; no effect writes another store as a message.
2. Derived data is computed in selectors, never stored (kills `readyGames`/`pendingGameIds` caching, `gamesVersion` counter, stored snapshots).
3. Restore is read-only; loading a clip/project must not write anything.
4. One selector module per derived fact — `hasFramingEdits` currently has three implementations, one reading fields that don't exist (OverlayScreen.jsx:763-777).

## Completion Criteria

- [ ] The timing-contract table above is empty (grep-verifiable per signal)
- [ ] Overlay mode loads in a test with zero Framing involvement (T4530 proves it)
- [ ] FramingContainer has no hand-mirrored store writes with batching comments
- [ ] Rename no longer desyncs ProjectContext (T4500)
- [ ] All editor E2E flows green after each task, not just at epic end
