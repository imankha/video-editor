# T6330: Video failures must log where the code looked, so "missing" vs "denied" is one glance

**Status:** STAGING — merged to master 2026-08-01 (auto-deploys staging)
**Impact:** 6
**Complexity:** 2
**Created:** 2026-08-01
**Updated:** 2026-08-01

## Problem

User direction (2026-08-01, imankh): *"in general, video failures should put more relevant data in
the logs so we can easily check if the video exists where the code was looking for it."*

Triggered by a real incident: a game video would not load in Annotate on a cloned account. The
frontend told us a lot —

```
[VIDEO_DIAG] format_error id=0 status=401 content_type=application/json
  url=http://localhost:5173/api/games/2/video
  body={"detail":"Authentication required. Please refresh the page to initialize a session."}
```

— and that was enough to identify a **session** failure, not a missing file. But answering the
follow-up question ("is the video actually where we think it is?") took THREE manual steps outside
the app: read `games.blake3_hash` out of the profile DB, probe R2 for `games/{hash}.mp4` across
candidate prefixes, then re-request the endpoint with a fresh session to see the 302.

None of that is in any log. **The backend never records the key it resolved**, so a video failure
cannot be triaged from logs alone — every incident restarts the same manual archaeology.

## Solution

On any video-serving failure path, log the resolved location and the reason, in one line, at
WARNING/ERROR. The three states must be distinguishable **without touching R2 by hand**:

| State | What the log must say |
|-------|----------------------|
| Object missing | the exact bucket + key that was probed, and that HEAD returned 404 |
| Access/session denied | 401/403 and *which* check rejected it (no key probe needed) |
| Expired / swept | the expiry state that caused refusal, not a bare 404 |

Fields to include on the failure line: `game_id` (or reel id), `user_id`, `profile_id`,
`blake3_hash`, the **fully-qualified R2 key**, the bucket, whether a HEAD found the object, and the
resolved outcome (`redirect_302` / `missing` / `denied` / `expired`).

Cover the video-serving endpoints uniformly — game video, final/reel video, working video, and the
poster proxies (a missing poster is the same triage problem in miniature).

### Explicitly NOT this task

- **No new fallback behavior.** This is diagnostics only. A missing object must still fail loudly
  (no silent placeholder video) — see CLAUDE.md § no silent fallbacks.
- **No secrets in logs.** Log the KEY, never the presigned URL (it embeds credentials and is
  short-lived, so it is worthless in a log anyway).
- Do not log the key on the SUCCESS path at INFO — that is per-request noise on a hot path. Success
  stays at DEBUG or is omitted.

## Context

### Relevant Files
- `src/backend/app/routers/games.py` — game video endpoint (the 302-to-presigned path)
- `src/backend/app/routers/downloads.py` — final/reel video serving
- `src/backend/app/storage.py` — R2 key derivation + presign helpers (where the key is actually
  resolved; the natural place for a shared `log_video_resolution(...)` helper)
- `src/frontend/src/...` — `[VIDEO_DIAG]` already logs status/content-type/url/body on the client.
  That half is GOOD and needs no change; this task is the server half.

### Technical Notes
- Game videos use the **env-prefix-free** key scheme `games/{blake3}.mp4` (memory:
  `project_t4010_lost_final_video_refs`), while per-user media is env-prefixed
  (`dev/users/...`, `production/users/...`). That asymmetry is exactly why "where did the code
  look?" is non-obvious to a reader — the log line removes the guesswork.
- One HEAD per FAILURE is acceptable; never add a HEAD to the success path (T2880/T3380 kept
  presign off the hot path deliberately).

## Implementation

### Steps
1. [ ] Shared helper that formats the resolution line (bucket, key, hash, ids, outcome)
2. [ ] Wire into game video, reel video, working video, poster proxies
3. [ ] Failure-path HEAD to distinguish missing-object from denied
4. [ ] Tests: missing object logs the probed key; denied logs no key probe; success logs nothing at INFO

## Acceptance Criteria

- [ ] A missing game video logs bucket + exact key + `missing`, sufficient to check R2 by hand
- [ ] A 401/403 logs `denied` and does NOT claim the object is missing
- [ ] An expired/swept video is reported as expired, not as a bare 404
- [ ] No presigned URL and no credentials appear in any log line
- [ ] Success path adds no new INFO-level per-request logging
