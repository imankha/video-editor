# T17390 Design: play iPhone (HEVC) game videos in browsers that cannot decode them

**Status:** DRAFT, waiting for owner approval (Stage 2 gate). The architect cannot approve this.
**Task:** [T17390-play-iphone-hevc-video.md](T17390-play-iphone-hevc-video.md)
**Background:** [T17280-iphone-game-video-sound-no-picture.md](T17280-iphone-game-video-sound-no-picture.md) (bug 62p, PR #819)
**Knowledge docs used:** modal-gpu.md, export-pipeline.md, annotate.md, persistence-sync.md, keyframes-framing.md

---

## Summary for the owner (plain words)

**The problem today.** An iPhone records video in a format called HEVC ("High Efficiency").
We store the parent's file exactly as uploaded. Chrome and Edge on many Windows laptops, and
Firefox, cannot draw HEVC pictures. They play the sound and show a blank screen. Since T17280 we
tell the parent plainly and refuse the upload in that browser, but the game is still unusable there.

**What we will do.** After an iPhone game finishes uploading, our cloud video service (Modal, the
same service that already builds recaps and highlight reels) makes a second copy of the video in
the common format every browser can play (H.264). The copy has the same size, timing and sound as
the original. Once it is ready, the editor plays the copy. Exports keep reading the original file,
so finished highlights keep the full original detail. For iPhone games uploaded before this ships,
the parent gets a button: "Make a copy this browser can play".

**What it costs (estimates, to be measured on staging before we trust them).** Per hour of video:

| Video | Time to make the copy | Compute cost | Storage cost (30 days + 14 day grace) | Total |
|---|---|---|---|---|
| 1080p, 30 fps (iPhone default) | about 12 minutes | about $0.09 | about $0.08 | about $0.17 |
| 1080p, 60 fps | about 24 minutes | about $0.18 | about $0.08 | about $0.26 |
| 4K, 30 fps | about 45 minutes | about $0.33 | about $0.33 | about $0.66 |
| 4K, 60 fps | about 90 minutes | about $0.66 | about $0.50 | about $1.16 |

H.264 games (most cameras, Veo, iPhones set to "Most Compatible") are not touched: no copy, no cost,
no change.

**What the parent sees.** In Safari, or in a browser that can play HEVC: nothing changes, including
marking plays while the video uploads. In a browser that cannot: the upload is no longer refused.
The parent is told the picture will be ready a set time after the upload finishes. Until then they
hear sound only and cannot mark plays in that browser (they can in Safari).

**Why not the other two ways.** Converting in the parent's browser before upload does not work in
exactly the browsers that have the problem: a browser that cannot decode HEVC to show it also
cannot decode it to convert it. Converting only when someone opens the game makes the parent wait
at the moment they sat down to work. We still use that path for old games, through the same
machinery.

**Decisions I need from you** (each has my recommended answer, see the "Owner decisions" section):
Q1 convert every iPhone upload automatically; Q2 serve the copy to every browser once ready;
Q3 exports keep reading the original; Q4 we absorb the copy's storage cost; Q5 the parent waits
with a "Check again" button, no live update in v1; Q6 4K copies stay 4K; Q7 old games get a button,
no bulk backfill; Q8 the copy's status lives in Postgres; Q9 the new wording.

---

## 1. Current behavior (evidence)

### 1.1 Storage and identity
- A game upload is a client multipart upload to the GLOBAL, env-prefix-free key
  `games/{blake3}.mp4`, where `blake3` is computed client-side on the original bytes and is the
  dedupe key (`games_upload.py` `prepare_upload` / `finalize_upload`, `upload_object_key`). The
  object is stored exactly as uploaded: no transcode, no remux. A `.MOV` lands under `.mp4`.
- `finalize_upload` (`games_upload.py:683`) only completes the multipart, HEADs it and checks size.
- `activate_game` (`games.py:1133`) validates the object exists, then ffprobes it via
  `_probe_video_metadata` (`games.py:374`) -> `video_probe.probe_r2_video` (`video_probe.py:110`),
  which today returns only `{width, height, fps, duration}`. `probe_video` already reads `codec`
  and the raw `video_stream` (pix_fmt, color_transfer are in there) but `probe_r2_video` drops them.
- `_insert_game_videos` (`games.py:391`) also probes when a video is attached to an existing game
  (`skip_fps_probe=False`).
- Storage lifetime is a derived ref-set in Postgres, `game_storage_refs(user_id, profile_id,
  blake3_hash)` (`auth_db.py:573-860`). When the last ref goes, `r2_grace_deletions` holds the hash
  14 days (`GRACE_PERIOD_DAYS`, `sweep_scheduler.py:66`); then Phase 2 deletes
  `games/{blake3}.mp4` (`sweep_scheduler.py:376`), production only. `r2_delete_object_global`
  hard-blocks any `games/` delete outside production (`storage.py:2486-2497`).
- `STORAGE_DURATION_DAYS = 30` (`storage_credits.py:22`).

### 1.2 Who reads the game file
Browser playback (the decode problem lives here):
- `get_game_video_url(blake3_hash, video_filename)` (`games.py:181`) presigns
  `games/{blake3}.mp4`. Callers: `GET /api/games/{id}/video` 302 (`games.py:2625`, Annotate's
  early src from `annotateVideoLoad.buildEarlyGameVideoSrc`), `list_games` (`games.py:1721`),
  `/load` `playback_url` and multi-video `videos[]` (`games.py:1829, 1987, 2396, 3412, 3499,
  3540`), the clips list `game_video_url` used by Framing (`clips.py:2207`, consumed by
  `FocusScreen.jsx:499-610`), and `clips.py:2713, 2863`.
- Two sites presign the key directly, bypassing that helper: the presign-cache warm in
  `list_games` (`games.py:1701`) and the share unfurl warm URL (`shares.py:762`).

Server-side decoding with ffmpeg/OpenCV (decodes HEVC fine; not the problem):
- Exports: `export_helpers.resolve_clip_source` (`export_helpers.py:557-608`) -> Modal
  `process_clips_ai` range-extracts with `-c copy` then decodes with OpenCV.
- Auto-export: `auto_export._export_brilliant_clip` stream-copies a clip range into
  `raw_clips/auto_*.mp4` (`auto_export.py:480-491`, `c="copy"`), and recap encode.
- Posters (`poster.py:1200`).

### 1.3 Frontend
- `utils/videoMetadata.extractVideoMetadata` rejects a file with sound and a 0x0 picture with
  `VideoPictureUnsupportedError` (`videoMetadata.js:257, 525`); `GameDetailsModal.jsx:183` and
  `AnnotateScreen.jsx:681` show `UPLOAD.VIDEO_PICTURE_UNSUPPORTED` and refuse the upload.
- `useVideo.handleLoadedMetadata` (`useVideo.js:1012-1018`) sets
  `ERROR_COPY.VIDEO_PICTURE_UNSUPPORTED` when an opened game loads sound-only. `useVideo` is shared
  by Annotate, Framing and Overlay screens.
- Copy: `displayNames.js:1483` and `:1882` ("This browser can't show this video's picture, only its
  sound. ... play in Safari, or set iPhone Settings > Camera > Formats to Most Compatible ...").
- `utils/shrinkCapability.js` (T8838) reads the real codec string with mp4box, maps it with
  `deriveCodecFamily` (`hevc8`/`hevc10`/...) and runs `VideoDecoder.isConfigSupported`. Its census
  beacons `shrink_decode_{yes|no|unavailable}_{family}_{res}` already measure how many uploads are
  HEVC and how many uploading browsers cannot decode them (evidence for Q1; not queried here).
- The T8840 shrink tool (`scripts/shrink-tool/`) is standalone and unintegrated; integration is
  gated on the T15850 go/no-go spike.

### 1.4 Facts this design depends on (verify, do not assume)
| # | Claim | Status |
|---|---|---|
| F1 | Chrome/Edge on Windows decode HEVC only with a platform hardware decoder; WebCodecs `VideoDecoder` HEVC support depends on the same platform decoder. | Industry knowledge, consistent with 62p evidence. Not re-tested here. |
| F2 | Crop keyframes are stored in the source video's displayed pixel space, so a playback copy with different dimensions would misplace every crop at export. | Supported by `export_cost_guard` (crop px), `DEFAULT_CROP_SIZES` in pixels, Framing reading `video.videoWidth`. Treated as a hard invariant. |
| F3 | Modal's `image` ffmpeg (Debian apt) decodes HEVC Main10, has libx264, zscale and tonemap. | Unverified. Phase B checks it first. |
| F4 | OpenCV in `upscale_image` decodes HEVC for exports today. | Unverified; Safari HEVC uploads presumably already export. Phase B adds one staging export of an HEVC HDR clip. |
| F5 | Playwright's Chromium in the Linux /dotask container has no HEVC decoder, so it reproduces "sound, no picture". | Hypothesis. Phase D's red run proves or refutes it. |

---

## 2. Target behavior and non-goals

### Target
1. A game video whose codec a browser may not draw (anything that is not 8-bit 4:2:0 H.264) gets a
   playable copy at `games/{blake3}.h264.mp4`: H.264 High, yuv420p, SDR BT.709, same displayed
   width and height, same frame timing, same audio, faststart, keyframe every ~2 s for fast seeking.
2. Browser playback reads the copy once it is ready, and the original until then.
3. Exports, recaps, posters and preserved extracts keep reading the original (Q3).
4. New uploads trigger the copy automatically at activation (Q1). Old games trigger it with a
   button (Q7). Both use the same endpoint and job.
5. Every state is visible: `none`, `preparing`, `ready`, `failed`. A failure is shown with
   Try again; nothing silently serves a file the browser cannot draw without saying so.
6. H.264 games: no row, no job, byte-identical URLs and payloads (C3).

### Non-goals
- No client-side transcode. No change to the shrink tool.
- No change to dedupe, the blake3 identity, refs, ref-set or storage pricing (Q4).
- No live push of "copy ready" in v1 (Q5). No parallel chunked encoding in v1.
- Directly uploaded clips (`raw_clips` with `source='upload'`) that are HEVC: follow-up.
- Preserved per-clip extracts (`_export_brilliant_clip`, stream copy) of an HEVC game stay HEVC:
  follow-up (see R9).
- HDR color accuracy of exports (OpenCV from the original does no tone mapping): measured in
  Phase B, fixed in a follow-up if needed.
- No backfill sweep over existing accounts.

---

## 3. Options compared

Assumptions behind every number (state them, then measure in Phase B):
- **A1 Modal CPU price:** $0.0000131 per physical core-second, $0.00000222 per GiB-second (Modal
  list price as last known; modal-gpu.md records no CPU price, confirm on modal.com/pricing).
  Container of 8 cores + 8 GiB = about $0.44 per container-hour. Modal is currently inside free
  credits (fixed-costs memory), so near-term cash cost may be $0.
- **A2 Modal T4 GPU price:** about $0.000164/s ($0.59/hour).
- **A3 Throughput (unmeasured):** HEVC 10-bit software decode + HLG/PQ to SDR tone map + libx264
  `veryfast`, on 8 cores: about 150 frames/s at 1080p, about 40 frames/s at 4K.
- **A4 Sizes:** Apple's own figures. Original HEVC: 1080p30 about 45 MB/min (2.7 GB/hour),
  4K30 about 170 MB/min (10 GB/hour), 4K60 about 400 MB/min. H.264 copy at CRF ~22: 1080p30 about
  3.6 GB/hour, 4K30 about 15 GB/hour (Apple's "Most Compatible" 4K30 is 21 GB/hour; ours should be
  smaller), 4K60 about 22 GB/hour.
- **A5 Storage:** R2 $0.015/GB-month, no egress fee. Retained 30 days + 14 day grace = about 1.45
  months per game unless the parent extends storage.
- The Fly API box (1 GB RAM) is not an option for transcoding (the T7090 OOM reason recap and
  compose moved to Modal).

| | (1) Convert in the browser before upload | (2) Convert on Modal after upload, copy beside original | (3) Convert on demand when a non-decoding browser opens the game |
|---|---|---|---|
| Works in the failing browser? | **No.** WebCodecs cannot decode HEVC there (F1). Only a WASM software ffmpeg could, at an assumed 5 to 15 frames/s for 1080p: 2 to 6 hours per game hour with the tab open; 4K impractical; ~30 MB download. In Safari it works, but Safari users are not the ones with the problem. | Yes | Yes |
| Compute cost per hour (1080p30 / 4K30) | $0 to us, hours of the parent's laptop | ~$0.09 / ~$0.33 | same per conversion, but only for games actually opened in a non-decoding browser |
| Wall time until playable | conversion + a larger upload (H.264 is 1.3 to 2x bigger, worsening the big-file upload problem T15850 is studying) | upload + ~1 min start + ~12 min (1080p30) / ~45 min (4K30) | same conversion time, but it starts when the parent opens the game to work |
| Storage | replaces the original; HDR and detail lost forever | +3.6 GB/h (1080p) or +15 GB/h (4K) for the life of the game | same, fewer games |
| "Mark plays while it uploads" | blocked until conversion ends (cannot upload before it ends) | unchanged where the browser decodes HEVC; in a non-decoding browser the parent waits for upload + copy | same as (2) |
| blake3 identity / dedupe | hash would name the converted bytes; encoder output differs per machine, so dedupe of the same original breaks | unchanged: original hash names the game; copy key derived from it | unchanged |
| Refs / ref-set | unchanged | unchanged; sweep deletes the copy with the original | unchanged |
| Migrations | none | one Postgres migration (job state); no per-user SQLite change | same as (2) |
| Exports | read the converted file (generation loss before the 4x GAN, which amplifies artifacts) | read the original | read the original |
| Old HEVC games | not covered | not covered alone | covered |

**Recommendation: (2) for new uploads plus (3) for old games, built as one mechanism.** The only
difference between them is what starts the job (activation vs a button). Option (1) is rejected
because it cannot run in the browsers that need it, destroys the original and breaks dedupe.

GPU encoding (T4 NVDEC + NVENC) was considered: about 4 minutes and $0.04 per 1080p hour, but it
needs an NVENC ffmpeg build, Modal video driver capabilities (unverified), and HDR tone mapping on
GPU (not in stock ffmpeg; the CPU filter would bottleneck it). Revisit only if measured CPU time
is too slow (Q5).

---

## 4. Recommended design

```
upload finishes
  -> POST /activate (existing gesture chain)
       ffprobe original (now also returns codec, pix_fmt, color_transfer)
       needs_playable_copy(probe)?  -- no -> done (H.264: no row, no job; C3)
                                    -- yes -> claim row in Postgres playable_copies
                                              (INSERT .. ON CONFLICT DO NOTHING; only the winner dispatches)
                                              background task: modal_client.call_modal_playable_copy(hash)
                                                 Modal on : encode_playable_copy_modal (CPU) -> R2 games/{hash}.h264.mp4
                                                 Modal off: local subprocess, same pure encoder
                                              -> mark ready | mark failed(error)

browser asks for the game video (/video 302, /load, clips game_video_url, list warm, share warm)
  -> browser_playback_key(hash): row ready ? games/{hash}.h264.mp4 : games/{hash}.mp4
  -> payload also carries playable_copy_status: none | preparing | ready | failed

parent's browser loads sound but no picture (T17280 detector)
  status none      -> "Make a copy this browser can play"  [button -> POST .../playable-copy]
  status preparing -> "Ready in about N minutes"            [Check again -> same POST]
  status failed    -> "We couldn't make the copy"           [Try again  -> same POST]
  status ready     -> cannot happen (we served the copy): log loudly as a bug
```

### 4.1 Which hash names the game
The original's blake3 stays the only identity: it names the game, the refs, the grace row and the
dedupe. The copy is never hashed and has no refs; its key is derived from the original's hash:
`games/{blake3}.h264.mp4`. Keeping it under `games/` means the existing non-production delete guard
(`storage.py:2492`) protects it automatically. Grep before landing Phase A that nothing parses
object keys under `games/` as `{hash}.mp4` (today only multipart listings scan that prefix:
`scripts/scan_stranded_uploads_sweep.py:120`).

### 4.2 Where the copy's state lives: Postgres `playable_copies` (Q8)
```
playable_copies(
  blake3_hash   TEXT PRIMARY KEY,
  source_codec  TEXT NOT NULL,          -- e.g. 'hevc', 'h264/yuv420p10le', 'prores'
  status        TEXT NOT NULL,          -- 'preparing' | 'ready' | 'failed'
  attempts      INT  NOT NULL DEFAULT 1,
  error         TEXT,
  source_width INT, source_height INT, source_fps DOUBLE PRECISION, source_duration DOUBLE PRECISION,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)
```
Why here and not elsewhere:
- **Per-profile SQLite column (rejected):** the copy is a fact about the shared, deduped file, not
  about one profile's game. Many profiles can hold the same hash, and the job finishes while the
  parent may be offline, so marking it ready would mean a background cross-user write into every
  holder's SQLite. That is exactly the restore-if-newer / CAS burden of T4315 for no gain.
- **R2 object existence only (rejected):** it answers "ready" but not "already running" (two users
  or two tabs would start two encodes) or "failed after 3 tries" (needed so failure is shown, not
  retried forever).
- **Postgres** already holds the other per-hash storage facts (`game_storage_refs`,
  `r2_grace_deletions`). Every editor request already depends on Postgres for the session, so the
  serve path gains no new failure domain. Postgres is per environment while R2 `games/` is shared
  across environments, so the job HEADs the copy key first: a copy another environment already made
  is marked ready without re-encoding.
- The "no new PG state" memory applies to the drip epic only.

Derived status (computed at read time, never stored as a separate flag):
- no row -> `none`
- `preparing` and `updated_at` older than `PLAYABLE_COPY_STALE_AFTER` (the job's Modal timeout plus
  a margin) -> reported as `failed` with reason `stale`. This covers a Fly machine restart while the
  app was awaiting Modal.
- otherwise the stored status.

### 4.3 The encoder (one pure module, two runners)
`app/services/playable_copy_encode.py`, pure like `recap_encode` (no DB, storage or FastAPI
imports; same import-surface guard as `test_t7090_modal_compose_dispatch`):
- `needs_playable_copy(probe) -> bool`: False only for `codec == 'h264'` and `pix_fmt == 'yuv420p'`.
  HEVC (8 or 10 bit), H.264 10-bit, ProRes and anything else -> True.
- `build_playable_copy_cmd(src_url, out_path, probe) -> list[str]`, sketch:
  ```
  ffmpeg -i SRC -map 0:v:0 -map 0:a:0? -map_metadata 0
         [HDR only: -vf zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,
                        tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p]
         -c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p -g {2*fps} -fps_mode passthrough
         -color_primaries bt709 -color_trc bt709 -colorspace bt709
         -c:a {copy if aac else aac -b:a 160k} -movflags +faststart OUT
  ```
  No `-r`, no scale filter: frame timing and displayed size must match the original (F2).
  ffmpeg's default autorotate bakes iPhone rotation metadata, so the copy's coded size equals the
  original's displayed size, which is what the browser reports as `videoWidth`/`videoHeight`.
- `estimate_seconds(width, height, fps, duration)`: the A3 rates as named constants, calibrated in
  Phase B and returned to the client as `eta_seconds`.

Runners:
- **Modal:** `encode_playable_copy_modal` in `video_processing.py`, CPU, `cpu=8`, `memory=8192`,
  ephemeral disk sized for a 4K60 2-hour copy (~45 GB), `timeout` 4 hours,
  `max_containers=CPU_MAX_CONTAINERS`, image = `recap_image`-style (bare ffmpeg image + the `app/`
  tree for the pure module). It takes a presigned GET for the original, encodes to local disk,
  uploads with boto3 (multipart for >5 GB), HEADs to verify, returns `{size, duration}`.
- **Unified client:** `modal_client.call_modal_playable_copy(hash)` using `.remote.aio` (T14100: no
  executor thread held). Modal off (dev, /dotask) runs the same pure function in
  `_run_in_subprocess`. Modal on and failing RAISES: no local fallback on production (the 1 GB box
  would OOM), matching `encode_recap_modal`.

### 4.4 Triggers and the one endpoint
- **Automatic (new uploads):** in `activate_game` after the probe, and in `_insert_game_videos`
  when it probes (attach path), call `start_playable_copy_if_needed(hash, probe)`. It claims the row
  and schedules the job as a background task after the response, the same shape as the export
  routes that run `_export_clips` in a background task after returning 202. The job writes only
  Postgres and R2, never a per-user SQLite DB, so the deferred fire-and-forget concern (per-user DB
  racing R2 sync) does not apply. It runs outside the per-user write lock.
- **Gesture endpoint:** `POST /api/games/{game_id}/videos/{sequence}/playable-copy`, used by the
  "Make a copy", "Check again" and "Try again" buttons. Idempotent:
  - row `ready` -> return `ready` + the new playback URL.
  - row `preparing`, not stale -> return `preparing` + `eta_seconds`.
  - row `failed` or stale -> HEAD the copy key; present -> mark `ready`; absent and `attempts < 3`
    -> CAS-claim (`UPDATE .. SET status='preparing', attempts=attempts+1 WHERE blake3_hash=? AND
    (status='failed' OR stale) RETURNING`) and dispatch; `attempts >= 3` -> return `failed`,
    `retryable: false`.
  - no row -> probe the original server-side; H.264 -> 409 `{code: 'copy_not_needed'}` plus an
    ERROR log (a sound-only H.264 game is a different bug and must not be hidden); otherwise claim
    and dispatch.
  - Authorization: the game must exist in the caller's profile (normal per-profile read); the
    hash comes from that row, never from the client.
- **Failure handling:** any job exception -> `status='failed'`, `error` = readable message, ERROR
  log with hash and attempt. Undeployed Modal function -> `RuntimeError("Modal ... not available")`
  -> `failed`, visible. No silent fallbacks anywhere; serving the original while `preparing` is not a
  fallback, it is the correct file for browsers that can decode it, and the payload says
  `preparing` so a non-decoding browser explains itself.

### 4.5 Serving: which copy each part of the app reads
One helper decides: `browser_playback_key(blake3_hash)` (plus a batched form for lists).

| Reader | Reads | Change |
|---|---|---|
| Annotate playback (`/video` 302, `/load` `playback_url`, multi-video `videos[]`) | copy if ready, else original | via `get_game_video_url` |
| Framing preview (clips `game_video_url`) | copy if ready, else original | via `get_game_video_url` |
| `list_games` presign warm (`games.py:1701`) and share warm (`shares.py:762`) | same key the helper will presign | route through the helper (else the warm cache misses) |
| Overlay, Gallery, downloads | export outputs (already H.264) | none |
| Exports (`resolve_clip_source` -> Modal), auto-export extracts, recap, posters | original | none (Q3) |

Payloads that carry a game video also carry `playable_copy_status` and, when preparing,
`playable_copy_eta_seconds`. For a hash with no row both fields read `none`/null and the URL is
byte-identical to today; no R2 HEAD is added to the hot path (T2880). A Postgres error in the helper
propagates as a 500, never a quiet "serve the original".

Once ready, the copy is served to every browser, Safari included (Q2). One URL per game, no
capability or user-agent branching (UA sniffing is a recurring landmine here), and the preview then
matches what exports produce (SDR).

### 4.6 Frontend
- **Upload dialog** (`GameDetailsModal`, `AnnotateScreen` upload path): `VIDEO_PICTURE_UNSUPPORTED`
  no longer refuses. The upload proceeds with `width`/`height` null (activation's ffprobe already
  backfills them, `games.py:1201-1231`) and the dialog shows a notice (wording in Q9).
- **Opened game, sound but no picture** (`useVideo` detector stays the ground truth): the error
  surface reads the game's `playable_copy_status` and shows the matching message and button. The
  button handlers are gestures that call the one endpoint. When it returns `ready`, the handler
  swaps in the returned URL for that one video (narrow single-record update, no broad refetch, no
  page reload, no polling).
- While uploading in a non-decoding browser (game still `pending`, no row yet): the notice says the
  picture arrives after the upload finishes plus about N minutes.
- Copy lives in `config/displayNames.js` next to the existing `VIDEO_PICTURE_UNSUPPORTED` entries.

### 4.7 Lifecycle and deletion
- Sweep Phase 2 (`sweep_scheduler.py:376`) deletes `games/{hash}.h264.mp4` and the
  `playable_copies` row right after the original. Same production-only gate. Refs, grace rows and
  `game_size_bytes` are unchanged.
- A dedupe re-upload of a hash that already has a ready copy: activation finds the row, no job.
- Staging-made copies of staging-only uploads are never deleted, exactly like staging originals
  today (R11).

### 4.8 Migrations
- Postgres track only: `migrations/postgres/v051_playable_copies.py` (number re-checked against
  origin at implementation time; branch collisions have bitten before) plus the same DDL in
  `pg.py` `_SCHEMA_DDL`. After deploy, an admin runs `POST /api/admin/migrate-postgres` on staging
  and then prod.
- No `user_db` or `profile_db` change. No games row field.
- **Ordering gate:** the serve-path change (Phase C) queries the table on every game-video request.
  It must not deploy to an environment until the migration has run there, or every game video 500s.

---

## 5. Phased plan (foundation before consumer, 4 tasks, each under ~200 lines of meaningful diff)

### Phase A: foundation (backend, ~170 lines). No user-visible change.
Files: `services/video_probe.py` (probe_r2_video returns codec, pix_fmt, color_transfer),
new `services/playable_copy_encode.py`, new `services/playable_copies.py` (Postgres repository:
claim, mark_ready, mark_failed, get_states(hashes), derived status), `migrations/postgres/v051_*`,
`services/pg.py` `_SCHEMA_DDL`.
Acceptance:
- A1. `needs_playable_copy` is False for H.264 yuv420p and True for HEVC Main, HEVC Main10, H.264
  10-bit and ProRes probes.
- A2. On a generated HEVC Main10 HLG fixture (portrait, with rotation metadata, with AAC audio),
  the local encoder output is H.264 yuv420p BT.709, has the same displayed width and height, the same
  frame count, duration within one frame, audio present, and frames at 3 timestamps match the
  original (SSIM >= 0.9 after tone mapping both the same way).
- A3. Two concurrent claims of one hash: exactly one wins.
- A4. Derived status: no row = `none`; old `preparing` = `failed/stale`.
- A5. Migration applies on a fresh and an existing Postgres; `_SCHEMA_DDL` matches.
- Operator gate after merge: run migrate-postgres on staging, then prod.

### Phase B: make the copy (backend + Modal, ~200 lines). Needs a Modal deploy, staging first.
Files: `modal_functions/video_processing.py` (`encode_playable_copy_modal`),
`services/modal_client.py` (`call_modal_playable_copy`, Modal off -> local subprocess),
`routers/games.py` (`start_playable_copy_if_needed` in activate and attach; the POST endpoint),
`services/sweep_scheduler.py` (delete copy + row).
Acceptance:
- B1. Activating an HEVC game dispatches exactly one job; activating an H.264 game creates no row
  and no job.
- B2. The endpoint covers: none -> claim; preparing -> eta; stale/failed -> HEAD then heal or
  re-dispatch; attempts >= 3 -> not retryable; H.264 -> 409 `copy_not_needed` with ERROR log;
  ready -> URL.
- B3. Copy already in R2 (another environment made it) -> ready without encoding.
- B4. Job exception or undeployed Modal function -> row `failed` with the error; nothing else
  changes.
- B5. Sweep Phase 2 deletes both objects and the row; non-production deletes neither.
- B6. Staging measurement (post-deploy, human-run): one real iPhone 1080p30 HDR and one 4K30 HDR
  file, record frames/s, wall time and billed cost; replace the A3 constants; export one clip from
  the HEVC game and check colors (F4, R4). Results written into this doc's Phase B notes.

### Phase C: serve the copy (backend, ~120 lines).
Deploy gate: migration already applied in that environment.
Files: `routers/games.py` (`browser_playback_key`, `get_game_video_url`, the 1701 warm, the
status fields on `/load`, `get_game`, list), `routers/shares.py:762`, `routers/clips.py`
(`game_video_url` status field).
Acceptance:
- C3-a. Characterization test written and recorded BEFORE the change: for a hash with no row, every
  listed endpoint returns the same URL key and payload as master, and no R2 HEAD is added.
- C-1. Hash with a ready row -> every browser-playback reader presigns `games/{hash}.h264.mp4`;
  exports/recap/poster/auto-export still read `games/{hash}.mp4`.
- C-2. Status fields reflect none/preparing/ready/failed(stale).
- C-3. A Postgres error in the helper surfaces as a 500, not the original URL.

### Phase D: the parent's experience (frontend, ~200 lines).
Files: `components/GameDetailsModal.jsx`, `screens/AnnotateScreen.jsx` (upload path),
`hooks/useVideo.js` error surface, the view that renders the video error (Annotate and Framing),
`config/displayNames.js`, the T17280 tests (`videoMetadata.pictureUnsupported.test.js`,
`GameDetailsModal.invalidFile.test.jsx`) updated to the new non-blocking behavior, and one
browser check under `src/frontend/e2e/checks/`.
Acceptance:
- D1 (task C2). In the container's Chromium (no HEVC decoder, F5), upload a generated HEVC
  fixture: the dialog shows the notice and the upload completes; after the local copy finishes,
  opening the game in Annotate shows a picture (`videoWidth > 0`) and plays sound, and Framing
  shows the picture. Red first on master (sound only, `videoWidth == 0`).
- D2 (task C3). An H.264 game opens and plays in Annotate and Framing with no notice and no request
  to the playable-copy endpoint (existing annotate spec plus one assertion).
- D3. Status none / preparing / failed each show their message and button; each button sends one
  POST; a `ready` response swaps the URL for that video only.
- D4. In Safari-class browsers (decoder present) nothing new is shown during upload, and marking
  plays while uploading still works (unit-level: notice only renders on the 0x0 signal).
- Human staging check: a real iPhone HEVC game on Windows Chrome without HEVC hardware decoding
  (task C2's exact wording; the container check is a proxy).

Follow-ups (not in these 4 tasks): preserved extracts re-encode instead of stream copy when the
source needs a copy (R9); HEVC direct clip uploads; live "ready" push (WebSocket) and/or parallel
chunked encoding if Phase B's wall times or feedback say the wait is too long; HDR export color fix
if B6 shows it is needed.

---

## 6. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Cost and time numbers are modeled, not measured. | B6 measures on staging before prod rollout; constants live in one module. |
| R2 | Timeline drift (edit lists, variable frame rate, non-zero start time) would misplace every marked play and keyframe on the copy. | `-fps_mode passthrough`, no `-r`; A2 compares frames at fixed timestamps on a fixture with an edit list. |
| R3 | Rotation: portrait iPhone video. | Autorotate bakes rotation; A2 uses a rotated fixture and compares displayed dims. |
| R4 | Preview (tone-mapped SDR copy) vs export (OpenCV on HDR original, no tone map) colors differ. Likely pre-existing for Safari uploads. | B6 checks; follow-up if needed. Q3 explains the trade. |
| R5 | Serve path queries a table that is not migrated yet -> every game video 500s. | Hard ordering gate before Phase C (section 4.8). |
| R6 | Modal function not deployed -> every job fails. | Fails loud as `failed` with Try again; deploy staging then prod per modal-gpu.md invariant 3. |
| R7 | Ephemeral disk too small for a 4K copy. | Set the function's disk explicitly; B6 runs a 4K file. |
| R8 | 4K H.264 software decode stutters on weak laptops. | Accepted (copy must stay 4K, F2, Q6). |
| R9 | Preserved per-clip extracts are stream copies of the HEVC original, so after the game expires, Framing that draft in Chrome is sound-only again. | Follow-up task; short clips, cheap to re-encode. |
| R10 | HEVC clips uploaded directly as clips are not covered. | Follow-up. |
| R11 | Staging-made copies in the shared namespace are never deleted. | Same as staging originals today; noted. |
| R12 | Fly machine restarts while awaiting Modal: Modal finishes but the row stays `preparing`. | Stale rule reports `failed/stale`; Check again HEADs the copy and heals without re-encoding. |
| R13 | Postgres lookup added to the video hot path. | Indexed primary-key read; batched for lists; session validation already hits Postgres. |
| R14 | Migration number collision across branches. | Re-check origin's latest `v0NN` when Phase A starts. |

---

## 7. Owner decisions (each a question with my recommended answer)

- **Q1. Convert every new iPhone (non-H.264) upload automatically, or only when someone opens it in
  a browser that cannot play it?** Recommended: every upload. Parents often upload from the phone
  and work on a laptop later; the copy is then ready. Cost is about $0.17 per hour of 1080p video.
  Cheap evidence before deciding: the existing `shrink_decode_*_hevc*` census beacons.
- **Q2. Once the copy is ready, play it in every browser, including Safari?** Recommended: yes. One
  file per game, no browser detection, and the preview matches the exported highlight's colors.
  Cost: Safari users see SDR instead of HDR in the editor.
- **Q3. Exports keep reading the original file, not the copy?** Recommended: yes. Best detail
  before upscaling. Same size, so crops line up either way.
- **Q4. Do we charge the parent for the copy (storage or credits)?** Recommended: no, we absorb it.
  It is a compatibility cost of our app, about $0.08 per 1080p hour per 44 days.
- **Q5. Is "about 12 minutes per hour of 1080p video after the upload finishes" acceptable, with a
  "Check again" button instead of a live update?** Recommended: yes for v1. Live push and faster
  parallel encoding are follow-ups if staging numbers or parent feedback say the wait hurts.
- **Q6. 4K videos: make a full 4K copy (about 45 minutes and $0.66 per hour all-in)?** Recommended:
  yes. A smaller copy would put every crop box in the wrong place at export.
- **Q7. Existing iPhone games: a button the parent presses, or a one-time conversion of all of
  them?** Recommended: the button only. No out-of-band sweep over accounts, and we only pay for
  games someone actually opens in a non-decoding browser.
- **Q8. Keep the copy's status in Postgres (shared across a parent's profiles and other users with
  the same file) rather than in each profile's database?** Recommended: Postgres (section 4.2).
- **Q9. Wording** (no em dashes; "copy" as the plain word):
  - Upload dialog notice: "This browser can't show iPhone High Efficiency video yet. We'll make a
    copy it can play once the upload finishes, about {N} minutes for this video. Until then you'll
    hear sound only. Safari can show it right away."
  - Opened game, no copy yet: "This browser can't show this video's picture, only its sound. We
    can make a copy it can play. It takes about {N} minutes." Button: "Make a playable copy".
  - Preparing: "We're making a copy of this video that this browser can play. It should be ready in
    about {N} minutes." Button: "Check again".
  - Failed: "We couldn't make a copy of this video that this browser can play. Try again, or open
    the game in Safari." Button: "Try again" (hidden after 3 attempts).
  Recommended: approve as written, or edit freely; the Safari line stays as the immediate option.

---

## 8. Verification summary
- Backend unit and integration: A1 to A5, B1 to B5, C-1 to C-3, C3-a (characterization recorded
  before the change, then re-run after).
- Frontend unit: D3, D4; T17280 tests updated (their old assertion, "upload refused", becomes "upload
  allowed with notice").
- Browser check: D1 red on master, green on the branch; D2 unchanged-behavior check.
- Human: B6 staging measurement and HDR export look; the real Windows Chrome check for task C2.
- Knowledge docs to update at Stage 7: annotate.md (upload/playback status), modal-gpu.md (new CPU
  function, cost anchors from B6), export-pipeline.md (exports still read the original; copy key
  exists beside it), persistence-sync.md (new per-hash Postgres state; no per-user write).
