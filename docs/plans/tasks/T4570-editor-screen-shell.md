# T4570: Same arrow keys in Frame and Spotlight

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-07-03
**Updated:** 2026-11-13

## In plain words

On a computer, the arrow keys jump four seconds in Frame and step a single frame in Spotlight, so the same key does two different things in two neighbouring steps. The owner picks one behaviour (ruling needed before a worker starts; recommendation: one frame, with Shift for four seconds). Then both editors use the one shared keyboard handler and its unused branches are deleted, about 100 lines. Runs after T11260 and T11270.

## Implementer details

- Frame uses `src/frontend/src/hooks/useKeyboardShortcuts.js` (arrows jump 4 seconds on the playhead layer). Spotlight has an inline keydown handler in `src/frontend/src/screens/OverlayScreen.jsx` where arrows step one frame.
- The shared hook has one caller, `FocusScreen.jsx`; its Annotate and highlight branches can never run and `FocusScreen` passes ten dummy arguments for them. Annotate has its own handlers.
- Also pull the identical fullscreen toggle and Escape pair from both screens into one small hook. No wider 'screen shell' hook: the screens are otherwise different.
- Record the owner's choice under `## Ruling` before starting.

## Acceptance Criteria

- [ ] The arrow keys do the same thing in Frame and Spotlight, as ruled.
- [ ] Spotlight has no keydown handler of its own; the shared hook has no branch that cannot run.
