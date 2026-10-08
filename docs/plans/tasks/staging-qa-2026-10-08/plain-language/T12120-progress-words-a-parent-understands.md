# T12120: Progress words a parent understands

**Status:** WIP
**Impact:** 6
**Complexity:** 2
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 2: Confusing moments and jargon](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

Generation progress shows 'Enhancing video - 15/92' (counter appended by GlobalExportIndicator.jsx:25-29; displayNames.js:483-493) and 'Finding players for spotlight' at 92% (exportProgressPresentation.js:57,63) even though no spotlight was requested; the backend sends detecting_players at 92% of every framing export (backend routers/export/multi_clip.py:326,871). 'Starting generation...' comes from stores/exportStore.js:145 and the backend falls through to the raw message.

## Solution

Never render the counter (the bar already shows percent). Copy: preparing 'Getting your video ready', rendering 'Generating your highlight', enhancing 'Sharpening the picture' (matches DIVISION_OF_WORK), uploading and finding-players both 'Finishing up'; map 'starting' to preparing. No 'overlay' in render copy (use 'spotlight'). Adding your spotlight for the overlay job.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/config/displayNames.js (EXPORT_PROGRESS, EXPORT_JOBS.overlay)`
- `src/frontend/src/utils/exportProgressPresentation.js`
- `src/frontend/src/components/GlobalExportIndicator.jsx`
- `their tests`

### Related Tasks

- T12110.

### Test first (red before green)

Unit on exportProgressPresentation: detecting_players maps to 'Finishing up' and the detail counter is dropped (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12120:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] No counter rendered
- [ ] detecting_players reads 'Finishing up'
- [ ] 'Starting generation...' reads 'Getting your video ready'
- [ ] No 'overlay' in rendered copy
- [ ] Relevant tests pass and lint is clean
