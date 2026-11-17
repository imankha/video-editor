# T16780: Posters requested for failed uploads

**Status:** WIP
**Impact:** 2
**Complexity:** 1
**Created:** 2026-11-16
**Updated:** 2026-11-16

## In plain words

**Today.** On Home, a game whose upload did not finish shows an "Upload incomplete" card with Retry and Discard, and the words "No poster". The app still asks the server for that game's poster picture every time Home loads.

**The problem.** Found in the staging QA pass on 2026-11-16. The test account has 8 unfinished uploads, and every Home load logged 8 "404 Not Found" errors for their posters, one per game. Nothing breaks for the parent, but the errors bury real problems in the console and in error reports, and they cost a request each.

**What we will do.** Do not request a poster for a game whose upload is incomplete; the card already says "No poster".

**Why this and not something else.** The server is right to answer 404; there is no poster to send.

**How we will know it worked.** Home on an account with unfinished uploads loads with no poster 404s in the console.

## Evidence (staging, build 94928afa1, account e2e@test.local)

- `GET /api/games/{7,8,9,11,12,13,14,15}/poster.jpg?profile_id=4345b661&v=0` returned 404 on every Home load; all eight have `upload_status: upload_failed`.

## Implementer notes

- Home game cards (`src/frontend/src/components/ProjectManager.jsx` and the game card component it renders) build the poster URL regardless of upload status.

## Acceptance Criteria

- [ ] No `poster.jpg` request for a game with `upload_status` other than ready (browser check on network requests).
