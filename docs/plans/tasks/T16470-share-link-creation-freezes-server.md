# T16470: Share link creation freezes the server

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

The first time a parent asks for a share link to a game, the server builds that game's recap video, the reel of its marked plays, before it answers. It runs that encode on the one thread that answers every request, so every other parent's request waits until the encode ends; found by reading the code on 2026-11-13, not yet timed. Run the encode off that thread now; moving it off the server altogether is T2650. Worked when other requests keep answering in under a second while a first share link is being made.

## Implementer details

- `create_game_link` is `async def` (`src/backend/app/routers/games.py`, the `POST /{game_id}/share-link` handler) and calls the synchronous `ensure_recap(...)` directly. `ensure_recap` (`src/backend/app/services/auto_export.py`) runs the native-resolution libx264 recap encode and the R2 upload.
- Short fix: `await asyncio.to_thread(ensure_recap, ...)`. Check the handler's other calls for the same shape, and check that the per-user database connection it uses is safe to use from the worker thread.
- Time it before and after on a test stack: start a first share link for a game with several plays, and in parallel poll a cheap endpoint.
- Worth checking in the same pass: whether a sweep or a share-link encode was running during the 2026-11-13 slow load (T16400 records load timings).
- Knowledge docs: `.claude/knowledge/backend-services.md`, `.claude/knowledge/annotate.md` (recap).

## Acceptance Criteria

- [ ] While a first share link for a game is being created, a second request to a cheap endpoint answers in under 1 second.
- [ ] The share link still returns only after the recap exists, and a game with no team plays is still refused with the same message.
