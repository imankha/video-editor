# T13245: A Veo zip with no game becomes one game made of the picked clips

**Status:** STAGING
**Epic:** [Veo Highlights Import](EPIC.md). Amends EPIC decision "never create a game from a zip"
(user decision 2026-10-24, made while testing PR 634). Depends on T13200, T13210, T13220, T13230, T13240.
**Tier:** L (new create-time fields on two endpoints, upload-manager change, 2 layers)

## Problem

A parent who only has the Veo highlights zip (no full game) gets loose draft clips with no game. They
expect one game, named after the zip, holding the highlights they picked, which they can annotate
right away like a game file.

## Decisions (user, 2026-10-24/25)

| # | Decision |
|---|---|
| G1 | The game's videos ARE the picked Veo clips: one game video per picked moment, each placed at its real Veo time (`offset_seconds`). No stitching, no re-encode. |
| G2 | Only the picked moments are extracted and uploaded (same pick list as Path B). |
| G3 | The game opens in Annotate immediately and plays from the in-memory clips while they upload (T1540 annotate-during-upload). |
| G4 | Playback is back to back (existing `buildFullVideoTimeline`), not real empty gaps. Real Veo time is shown in labels. Real gaps = a later task if wanted. |
| G5 | Name = the zip title: `Veo highlights WCFC vs. Legends FC San Diego (1st Half).zip` -> `WCFC vs. Legends FC San Diego (1st Half)`. Opponent = `Legends FC San Diego`. |
| G6 | The moments arrive as open suggested plays (T13210/T13220), one per video, so the parent rates to keep. |
| G7 | Cost: the Veo game is created with ALL video refs in one create and activated once, so it is charged once on the summed bytes (2 credits for ~500 MB), not 2 credits per attached video. Folder uploads keep today's attach path (changing their charge is a separate user call). |

## Design (from the expert analysis, 2026-10-25)

**Backend (no schema change, no new endpoint)**
1. `VideoReference.offset_seconds: float | None` (`routers/games.py` ~331). On `POST /api/games`: when
   any video sends it, ALL must (else 422), and the given offsets replace `compute_video_offsets`.
   `POST /api/games/{id}/videos` (attach) refuses it (422). Part of the create gesture, like `recorded_at`.
2. `CreateGameRequest.name: str | None`: when given (non-blank), it is the display name (made unique like
   other names); otherwise today's naming.
3. Suggestions import (`routers/suggestions.py`): each moment may carry its own `video_sequence`
   (body-level OR per-moment, exactly one form, else 422). Every referenced video must exist and be long
   enough for that moment's end. Idempotency key adds `video_sequence` (today `(start_time, labels)`
   would drop the second "Shot on goal" when every clip starts at 0).

**Frontend**
4. Router (`VeoZipRouter.jsx`): add **"Make a game from these highlights"**. With no candidate game it is
   the first option (above "Upload as clips"); with candidates it comes after the suggested-plays options.
5. Pick list game mode (`VeoZipPickList.jsx`): same list, button "Create game from N highlights". On tap:
   extract the picked moments' UPLOADED entries one at a time (`moment.entries.find(e => e.upload)`),
   placing each by THAT entry's own stamp and duration (not the merged group's `stamp_s`), sequence by
   stamp order, then hand `{ name, opponentName, files: [{file, offset_seconds, durationS}], veoSuggestions }`
   to the existing game intake (`onAnnotateWithFile`, whitelist in `ProjectsScreen.jsx`).
6. `AnnotateContainer.handleGameVideoSelect`: blob `gameVideos` carry `offset_seconds` and
   `original_filename`. In `onGameCreated`, POST the suggestions (one per video: `video_sequence=i`,
   `start=0`, `end=duration`, the moment's labels) and await it BEFORE `setAnnotateGameId`, so the first
   suggestions GET sees them. One continuation of the same gesture, not an effect.
7. `uploadMultiVideoGame` (`services/uploadManager.js`): when the files carry offsets, hash all, create the
   pending game with all refs (+ offsets, name), `onGameCreated`, upload each, activate once. Retry reuses
   `entry.gameId` (`existingGameId`), never a second create.
8. Re-entering Annotate mid-upload restores ALL blob `gameVideos` (today only video 1's `blobUrl`).
9. `SuggestedPlaysList`: the row stamp is `offset_seconds(video) + start_time` (Path A video 1 has offset 0,
   unchanged; a Path A 2nd-half import now shows game-axis time).

## Acceptance

1. Backend: create with explicit offsets stores them; partial offsets -> 422; attach with offsets -> 422;
   `name` sets the title; one activate on N videos charges once on summed bytes.
2. Backend: suggestions with per-moment `video_sequence`; same labels at start 0 on two videos -> 2 rows;
   re-import -> no new rows; a missing/short video -> 422.
3. Frontend unit: pick list game mode builds placement from the uploaded entry; upload manager makes ONE
   create carrying all refs and ONE activate, no `/videos` attach; retry reuses the game id; re-entry
   restores all `gameVideos`; suggestion stamp includes the offset.
4. Real browser (dev, fixture account): a Veo zip with no matching game -> "Make a game" -> pick 3 ->
   Annotate opens at once and plays from local clips while uploading -> 3 open suggestions with real
   Veo times -> rate one -> play saved on the right video -> after upload completes, reload: game titled
   from the zip, 3 videos, suggestions and the kept play persist, 2 credits charged.

## Risks

- `activate_game` ffprobes every video serially inside one durable_sync request; time it with ~35 videos.
- Overlapping picks (4 of 6 surveyed zips keep 1-3 small overlaps) switch the game to the multi-angle
  timeline (`hasOverlappingAngles`). Accepted: plays still map correctly.
- Phone memory: picked blobs stay alive while annotating.
