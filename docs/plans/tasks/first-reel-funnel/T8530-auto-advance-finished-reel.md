# T8530: Done means done: auto-advance finished reels

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03

## Problem

After the overlay export completes, the finished video sits in a "Ready" phase on the
Your Clips board until the user manually clicks "Move to Highlight Reels". The system's
definition of done lags the user's by one undisclosed click; this is also why the
Highlight Reels drawer said "No reels yet" for a user who considered themselves finished
(walkthrough 2026-09-02, cliff 4).

## Solution

- A completed export auto-advances into the Highlight Reels surface; the manual "Move"
  gesture disappears as a REQUIRED step (the board may keep an optional review detour).
- The completion toast tells the user where it went and offers the next action:
  "Export complete. Brilliant Goal is in your Highlight Reels, ready to share."
- Coordinate with T8400 (publish lands the user ON the reel, tutorial-redesign R4):
  T8400 owns the landing; this task owns removing the manual move + the state advance.
  Whichever lands second rebases on the first; do not build two competing landings.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` - Ready phase board + Move action
- `src/frontend/src/components/DownloadsPanel.jsx` - Highlight Reels destination
- `src/frontend/src/utils/draftStage.js` - stage transitions (T8470 dependency)
- Backend move/advance endpoint (locate: the handler behind "Move to Highlight Reels")

### Related Tasks
- Depends on: T8470 (status model) conceptually; T8400 (landing surface) for the destination
- The advance is triggered by export COMPLETION (a server-side outcome of the user's
  export gesture), not by a reactive frontend effect: implement server-side or in the
  completion event handler, consistent with gesture-based persistence

## Implementation

### Steps
1. [ ] Trace what "Move to Highlight Reels" actually writes; move that write into the export-completion path
2. [ ] Remove the mandatory Move CTA; keep Preview as optional
3. [ ] Completion toast with destination + share affordance
4. [ ] e2e: overlay export completes -> reel visible in Highlight Reels with no extra gesture
5. [ ] 390x844 pass

## Acceptance Criteria

- [ ] Zero manual gestures between export completion and the reel being visible in Highlight Reels
- [ ] No surface can say "No reels yet" while a finished reel exists
- [ ] Coordinated with T8400 (single landing story)
