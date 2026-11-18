# T17510: Record each game video's format

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

We do not know how many games are iPhone HEVC, how many are HDR, or how many parents open them in a browser that cannot show them. Those numbers decide whether converting video is worth building and what it would cost. Record the video format of every game at upload so the numbers exist.

## How we got here

Owner ruling 2026-11-18 on the T17390 design: foundational work now, the conversion feature later after prototypes. The server already probes every uploaded game (`video_probe.probe_video` reads the codec and stream, but `probe_r2_video` returns only width, height, fps and duration). The client already sends `shrink_decode_*` census beacons that say whether the uploading browser can decode HEVC.

## Solution

Make `probe_r2_video` also return codec, pixel format and color transfer (HDR or not), and record them for each activated game as one in-house analytics event or log line (no new table; follow the in-house aggregates rule). Add one admin or script read that answers: of the last N game uploads, how many are HEVC, how many HDR, by resolution, and how many uploading browsers could not decode them (from the existing beacons). No behavior change for parents.

## Relevant Files

`src/backend/app/services/video_probe.py`, `src/backend/app/routers/games.py` (`_probe_video_metadata`, `activate_game`), `src/frontend/src/utils/shrinkCapability.js` (beacons). Knowledge docs: `.claude/knowledge/backend-services.md`, `.claude/knowledge/modal-gpu.md`.

## Acceptance Criteria

- [ ] C1: `probe_r2_video` returns codec, pixel format and color transfer, with a unit test on an HEVC 10-bit HLG fixture and an H.264 fixture.
- [ ] C2: Activating a game records its format once; an H.264 game and an HEVC game each produce the expected record.
- [ ] C3: A documented query or admin read reports the format mix and the cannot-decode share; its first run on staging is written in the task notes.
- [ ] C4: No change to upload, playback or export behavior (existing activate tests pass unchanged).

## Format census read (C3)

Each activated game video records one `capability_impression:game_format_{family}_{transfer}_{res}` row in the in-house `user_actions` aggregate (`games.py` `_record_game_video_formats`, only on the pending->ready flip), plus a `[activate] game_format ...` log line with the raw ffprobe codec, pix_fmt and color_transfer. family/res use the client census vocabulary (`avc|hevc8|hevc10|av1|vp9|other`, `le1080|le4k|gt4k` by height); transfer is `sdr|hlg|pq`.

Read it as an admin: `GET /api/admin/analytics/game-formats` (`exclude_test=true` by default). It returns `games`, `hevc_games`, `hdr_games`, `by_res`, `formats[]` and, from the existing `shrink_decode_*` beacons, `hevc_decode {yes, no, unavailable}` and `hevc_cannot_decode_share` = no / (yes + no); `unavailable` (no WebCodecs) is reported apart. Counts are all-time; the aggregate keeps no per-event timestamps, so "last N uploads" is not answerable from it.

Equivalent SQL (Postgres):

```sql
SELECT action, SUM(count) FROM user_actions
WHERE action LIKE 'capability_impression:game_format_%'
   OR action LIKE 'capability_impression:shrink_decode_%'
GROUP BY action ORDER BY 2 DESC;
```

### First staging run

Not run yet: games activated before this code deployed recorded no format, and the container has no staging admin session. After merge, open the read on staging as an admin and paste the JSON here.
