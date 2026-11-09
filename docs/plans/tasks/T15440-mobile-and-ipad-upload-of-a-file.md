# T15440: Mobile and iPad upload of a file already on the server leaves the modal stuck on Upload game

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Possible bug (unconfirmed), found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPhone 14 and iPad gen 7 (WebKit).

**Steps:** On a phone or iPad, pick a game file whose hash is already on the server (prepare-upload answers 'exists').

**Expected:** The game is added (or the parent is told it already exists) and Annotate opens.

**Actual:** The modal stayed on the 'Upload game' screen with no progress and no message. May be caused by the tester's files having landed in earlier killed runs; a first pick of a unique file was not observed on these viewports.

## Acceptance Criteria

- [ ] Picking an already-uploaded file on iPhone and iPad shows a clear outcome within 5 s (game opens or an 'already uploaded' message).

## Context

### Evidence (local screenshots, gitignored)
- none

### Related Tasks
T15020, T15040

### Relevant Files (REQUIRED)
- To be found.
