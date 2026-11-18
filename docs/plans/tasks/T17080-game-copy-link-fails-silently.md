# T17080: Game Copy link fails silently

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

In the "Share" window for a game (Home, game tile menu, "Share game"), the parent sees "Anyone with the link", "Copy link" and "Turn off link". On a game whose plays are all marked "My athlete", pressing "Copy link" does nothing visible: nothing is copied and no message appears. The server refuses with "Tag some team plays first", but the parent never sees that. The parent should either get a working link or be told plainly what to do.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as e2e@test.local, at desktop 1440x900, on a game made during the pass ("Vs QA Adv United", 2 plays, both "My athlete").

## Repro steps

1. Sign in, upload a game, mark two plays (leave "Who is this play about?" on "My athlete").
2. Home, Games, tap the game's ⋮ menu, "Share game".
3. Press "Copy link".

**Expected:** a link is copied ("Link copied"), or a clear message says why not and what to do.
**Actual:** nothing copied, no message; POST /api/games/{id}/share-link answers 409 `{"error":"empty_team_layer","message":"Tag some team plays first"}`.
**Repeats:** always (3 of 3)
**Also checked at:** phone and iPad not checked.

## Evidence

- Screenshot: `qa/qa-pass-2026-11-17/bugs/r2-B09-share-link-409.png` (local, not in git)
- Logs: `qa/qa-pass-2026-11-17/bugs/r2-B09-logs.txt`
- Network: POST https://api-staging.reelballers.com/api/games/19/share-link -> 409, request ids 3912b28b, 4e44df52, body `{"detail":{"error":"empty_team_layer","message":"Tag some team plays first"}}`
- Console: `[userError] 409 .../api/games/19/share-link {detail: Object}`
- Server log: `POST /api/games/19/share-link -> 409` after `[R2_CALL] op=HeadObject status=404`, twice (01:43:22 and 01:43:55 UTC).

## Solution

"Copy link" on a game either copies a working link or shows a plain message saying what the parent needs to do.

## Relevant Files

Not investigated.

## Acceptance Criteria

- [ ] C1: At 1440x900, on a game with only "My athlete" plays, "Copy link" either copies a link that opens signed out or shows a visible message; never silent.
- [ ] C2: The same at 390x844.
