# T3710: Framing Preview (Advance Organizer)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-06-16
**Updated:** 2026-06-16

## Problem

Non-technical parents enter Framing without a mental model of the goal. They see a crop box
and don't know what "done" looks like, which compounds the keyframe confusion that makes them
stall before exporting. Ausubel's *advance organizer* principle: show the finished outcome up
front so every subsequent action is interpreted against a known target.

This was specified alongside the T3700 quest split (Q2 "Frame Your Highlight") but is an app
behavior, not a quest step, so it was deferred from that work.

## Solution

On entering Framing, auto-play a short (5-8s) preview of a finished, well-framed, upscaled
result (a generic example reel, not necessarily the user's own clip) as an advance organizer.
Dismissible; should not block interaction. Pairs with the outcome-first copy already shipped in
the quest hints ("keep your player in the shot").

Open questions for Architecture:
- Canned example asset vs. a rendered preview of the user's own crop. Start with a canned asset.
- Placement: inline above the editor, or a one-time auto-playing overlay that collapses to a
  "Watch example" affordance (ties into T3700 P1.6 replayable hints).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/FramingScreen.jsx` — framing entry; mount point for the preview
- `src/frontend/src/modes/framing/FramingMode.jsx` / `FramingModeView.jsx`
- `src/frontend/src/App.jsx` — `editorMode === FRAMING` entry effect (where `opened_framing_editor` fires)
- `src/frontend/src/components/QuestPanel.jsx` — coordinate so the preview and the active quest hint don't fight for attention

### Related Tasks
- Parent: T3700 (Framing/Overlay Clarity) — outcome-first UX
- Related: T3700 P1.6 (replayable hints) — the "watch example again" affordance shares surface
- Related: T3740 (single-control step spotlight) — both are guided-attention layers

### Technical Notes
- Pure UI/presentation. No persistence, no quest trigger. Do not gate export on it.
- Asset must be lightweight and lazy-loaded so it never delays the editor becoming interactive.

## Implementation

### Steps
1. [ ] Source/produce a short canned "finished highlight" preview asset.
2. [ ] Render an auto-playing, dismissible preview on Framing entry.
3. [ ] Collapse to a replayable "Watch example" affordance after first view.
4. [ ] Ensure it never blocks the editor or the export button.

## Acceptance Criteria

- [ ] Entering Framing shows a 5-8s finished-result preview that auto-plays once.
- [ ] Preview is dismissible and replayable in context.
- [ ] Editor is fully interactive while/after the preview; export is never gated on it.
- [ ] No new quest trigger or persistence introduced.
