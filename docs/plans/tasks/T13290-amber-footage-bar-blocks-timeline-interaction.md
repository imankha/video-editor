# T13290: After adding footage the timeline stops responding to clicks

**Status:** STAGING
**Impact:** 7
**Complexity:** 2
**Tier:** S/M (frontend; reproduce first)
**Created:** 2026-10-21
**Updated:** 2026-10-21
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

User tested T13040 on 2026-10-21: "currently adding footage disables my ability to interact with the timeline."

## Problem

Probable cause, found by reading the code, **not yet reproduced live**: the amber footage bar in `AnnotateTimeline.jsx` (~L299-316) is a `<button>` with `absolute top-0 bottom-0`, `zIndex: 6`, and `left`/`width` from the added video's virtual range. When the added video is long relative to the game (the user's screenshot: the bar covers nearly the whole timeline), the bar sits on top of the main track, the play regions and the playhead scrub area, so clicks land on the button instead of the timeline. Its only handler is `onFixAmberFootage`, and the code comment says Fix timing "engages only when the footage is a genuine angle", so for appended footage the click does nothing at all. Net effect: seeking, selecting a play and dragging region levers are dead while the bar exists.

The bar stays until a reload (`amberFootage` is local state set in `handleFootageAttached`), so the user sees it right after adding.

## Solution

1. Reproduce: add a footage with no recorded time to a game, then click the main track, a play region and the ruler. Confirm what receives the click.
2. Fix so the bar never intercepts timeline gestures it has no use for: make the bar non-blocking (`pointer-events-none` on the body with a small interactive affordance, or render it in its own strip above the clip lanes) so seek, select and lever drag work everywhere. Keep Fix timing reachable.
3. If the bar's click does nothing for non-angle footage, either make it open something useful or remove the click handler (no dead tap, see T13040).

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx` (amber bar ~L299-316, z-index 6 vs clip layers)
- `src/frontend/src/containers/AnnotateContainer.jsx` (`onFixAmberFootage`, `handleFootageAttached`)
- `src/frontend/src/modes/annotate/AnnotateTimeline.trackClickSeek.test.jsx` (existing click-seek test to extend)
- `.claude/knowledge/annotate.md`

### Related Tasks
- Found while testing T13040. Siblings: T13270 (amber bar is unexplained), T13280 (see and flip between sources)
- Original spec: T8910

## Acceptance Criteria

- [ ] With an amber footage bar present, clicking the main track seeks, clicking a play region selects it, and region levers drag (real-pointer test, not a mocked handler)
- [ ] The bar's own click does something useful or does not exist
- [ ] Geometry test: the bar does not cover the interactive timeline area it has no handler for
