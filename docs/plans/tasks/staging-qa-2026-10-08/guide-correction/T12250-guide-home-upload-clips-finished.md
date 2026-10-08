# T12250: Guide on Home, Upload modal, Clips and Finished

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 4: Guide correction](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

Home guide is a hardcoded 'Press on a game...' string shown for any game count (EmptyTabGuide.jsx:93-97); the upload modal state is local to ProjectManager (:1073) so the coach never learns it is open; TabGuideHeader mounts the coach only for games (EmptyTabGuide.jsx:93) so Clips and Finished have none (qa-04, 05, 34, 36).

## Solution

Rules and copy (tone in brackets): home.games.empty 'Start with your game video. Tap Upload game.' -> Upload button; upload.choose 'Pick your game video. Name and details are optional.' -> dropzone; upload.submit 'Tap Upload game. You can start marking plays while it uploads.'; upload.failed [error] 'That upload didn't finish. Tap Retry to try again.'; home.games.uploading 'Your game is uploading. Open it now to start marking plays.'; home.games.no-plays 'Open your game to find the plays worth keeping.' (never above Upload); home.games.plays 'Open your game and turn your best play into a highlight.'; home.games.finished 'Your highlight is ready to share. Open Finished.'; home.clips.empty 'Highlights you're still working on wait here. Open a game in Games to start one.'; home.clips.unfinished 'Pick up where you left off. Tap a clip to finish its highlight.'; home.clips.all-done 'Every clip is finished. Open a game to mark more plays.'; home.finished.first 'Your highlight is ready. Tap it to share it or download it.'; home.finished.empty 'Finished highlights show here. Open a game to make your first one.' ProjectManager passes modal and counts to the facts; the upload modal renders its own <Guide> inside the modal layer so no portal coach exists while it is open. TabGuideHeader mounts <Guide> for all three tabs.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/shared/EmptyTabGuide.jsx`
- `src/frontend/src/components/ProjectManager.jsx`
- `src/frontend/src/components/GameDetailsModal.jsx`
- `src/frontend/src/components/instructions/resolveGuide.js`
- `src/frontend/src/config/displayNames.js`

### Related Tasks

- T12230, T12240.

### Test first (red before green)

Enumeration test rows for home.* and upload.* (fail until added).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12250:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Enumeration covers the 13 home/upload states
- [ ] With the upload modal open no portal coach exists and the in-modal guide anchors to the dropzone (Playwright)
- [ ] No 'Press on a game' with zero games
- [ ] Relevant tests pass and lint is clean
