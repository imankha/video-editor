# T13400: Veo zip import into an existing game fails with a 422 and a generic retry message

**Status:** WIP
**Impact:** 7
**Complexity:** 3
**Tier:** M (frontend + backend, Veo import)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Outside AI new-user QA run on staging, 2026-10-25/26, with the prompt in `docs/plans/ux/2026-10-25-staging-new-user-test-prompt.md` (account imankh+stg-qa-20261025@gmail.com).

## Problem

Importing the smallest Veo zip (`Veo highlights WCFC  vs. Legends FC San Diego (1st Half).zip`, 32 clips, 27 moments offered) into an EXISTING short game failed twice: the request returned HTTP 422 and the app showed only a generic "try again" message. The other path, "Make a game from these highlights", worked (new game, opponent inferred from the file name), and a second zip also made a new game. So adding Veo footage to a game the user already has is broken or refused without saying why. The exact endpoint and 422 body were not captured by the tester.

## Solution

Reproduce on staging with the same zip into a short game (the tester's existing game was a 5-second or 90-second upload), capture the 422 response, then either fix the request or, if the refusal is intended (for example the clips do not belong to that game's time range), show a specific message that names the reason and the working alternative (make a new game).

## Context

### Relevant Files
- Veo zip reader and manifest (T13200 to T13246, PR 634 and 636); the add-to-existing-game path
- `.claude/knowledge/annotate.md` (add footage, multi-video games)

### Related Tasks
- T13246 (Veo game details step), T13040 (add footage)

## Acceptance Criteria

- [ ] Importing a Veo zip into an existing game either succeeds, or shows a specific reason and the next step; never a generic retry for a request that will fail again
- [ ] A regression test covers the request that returned 422
