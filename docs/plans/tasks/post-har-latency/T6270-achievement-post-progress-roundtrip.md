# T6270: Every achievement POST is chased by a `quests/progress` GET

**Status:** STAGING
**Impact:** 4
**Complexity:** 2
**Created:** 2026-07-31
**Updated:** 2026-07-31

Epic task 4/6. See [EPIC.md](EPIC.md).

## Problem

`/api/quests/progress` is fetched 4 times in the 2026-07-31 session:

| start | duration | what preceded it |
|-------|----------|------------------|
| 1 | 22148ms | app boot (part of the boot storm, see T6240) |
| 23602 | 573ms | after `POST /api/quests/achievements/returned_home` (t=22202) |
| 37619 | 25ms | after `POST /api/quests/achievements/opened_framing_editor` (t=37514) |
| 44391 | 136ms | after `POST /api/quests/achievements/opened_overlay_editor` (t=44311) |

The pattern is exact: **every achievement POST is immediately followed by a progress GET.** The
POST already mutates progress server-side, so it can return the updated progress in its own
response body and the follow-up GET disappears.

Note the third one lands 105ms after its POST on the project-open critical path — precisely the
window T6190 was clearing.

## Solution

Return the updated quest progress in the `POST /api/quests/achievements/{id}` response, and have
the client use it instead of issuing a follow-up GET.

Keep the standalone `GET /api/quests/progress` — boot still needs it, and any caller that
genuinely needs a fresh read should keep working.

This is a gesture-driven write followed by a read of the same data, so folding the read into the
write response does not violate the project's persistence rules — it removes a round trip, not a
gesture.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/quests.py` — the achievements POST handler and the progress GET
- `src/frontend/src/stores/` — the quest store (grep `quests/progress` and
  `quests/achievements`) — find the caller that chases the POST with a GET

### Related Tasks
- **T6240** — the boot occurrence of this GET is part of the boot storm; do not attribute that
  one to this task.

### Technical Notes
- Verify the POST's current response shape before changing it — other callers may depend on it.
  Additive is safest.
- Some achievement POSTs are fire-and-forget. If the client does not await them, folding the
  response in only helps where the result is actually consumed — check before assuming a win,
  and if a caller ignores the response, the right fix may be to drop its follow-up GET entirely.

## Implementation

### Steps
1. [ ] Confirm the POST -> GET pairing in the client (which caller issues the follow-up)
2. [ ] Return updated progress from the achievements POST (additively)
3. [ ] Consume it client-side; remove the follow-up GET
4. [ ] Verify quest UI still updates correctly after each achievement

### Progress Log

**2026-07-31**: Filed from the post-T6190/T6200 verification HAR.

**2026-08-28**: Implemented via dotask container, merged [PR #297](https://github.com/imankha/video-editor/pull/297).
Extracted `_assemble_quests()` shared by GET /progress and the achievements POST; the POST now
returns `progress.quests` additively. Frontend `recordAchievement` consumes it via a new
`_deriveQuestState()` helper (also now shared by `fetchProgress`/`setFromBootstrap`, removing
triplicated derivation logic), falling back to the standalone GET on deploy-skew. Live-driven:
achievement path is now 1 request instead of POST+GET. Reviewer approved.

## Acceptance Criteria

- [x] An achievement POST is not followed by a `quests/progress` GET
- [x] Quest progress UI still updates immediately after each achievement
- [x] Boot still loads progress correctly (standalone GET unchanged)
- [x] Frontend unit tests pass
