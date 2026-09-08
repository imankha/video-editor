# T8836: Survey: other cheap client-side pre-upload work worth doing now (decision doc)

**Status:** WAITING ON USER
**Impact:** 4
**Complexity:** 3
**Created:** 2026-09-06
**Updated:** 2026-09-06

## Problem

User direction (2026-09-06): while the intake is being rebuilt, any modification we can
make to a file or its metadata in the browser BEFORE upload that is fast enough to be
invisible and pays off later should be measured and decided now, not rediscovered one at a
time. T1380 (moov relocation) is the model: zero re-encode, sub-second, permanent benefit.
Re-encoding of any kind is explicitly NOT in scope - that is the shrink pipeline
(T8840-T8860), and for the typical ~3 GB 1080p upload the numbers do not favour it (a
45-minute half at ~9 Mbps re-encodes at roughly 1x realtime = 30-45 min of laptop time to
save maybe 20% of a 16-minute upload).

## Solution

A bounded spike that MEASURES each candidate on the real fixtures and produces one table
(candidate, measured ms on the 17 GB DJI file, downstream bytes/time saved, risk,
recommendation, target task). No app code ships from this task; the user picks which rows
become tasks.

## Context

### Relevant Files (REQUIRED)
- `docs/plans/tasks/universal-upload/T8836-survey-cheap-client-preupload-work.md` - the
  decision table lives here (Progress Log)
- `scripts/shrink-spike/` - reuse the harness for any timing that needs a page; still
  never imported by app code
- Read-only inputs: `src/frontend/src/utils/mp4Faststart.js`,
  `src/frontend/src/utils/videoMetadata.js`, `src/frontend/src/services/uploadManager.js`,
  `src/backend/app/services/video_probe.py`, `src/backend/app/services/poster.py`

### Related Tasks
- Depends on: none (T8834 findings are useful input, not a blocker)
- Feeds: T8840 (keyframe index), T8850 (filmstrip frames, offer gating), T8860, and
  EPIC decision 4 (shrink offer threshold)

### Technical Notes - candidates to measure (add any found during the task)
1. **Client-side probe replaces server probe.** `analyzeMp4Faststart` already has the
   moov in memory; parsing duration/fps/resolution/codec/`creation_time`/`stss` count
   from it is free. T8800 already sends `creationTime`. Measure what `video_probe.py`
   (1 MB head fetch per upload) still does that the client could send on create, and
   what breaks if the client lies (trust boundary: server must validate or re-probe
   lazily).
2. **Keyframe (`stss`) index extracted client-side.** Exact sync-sample times for the
   crop filmstrip (T8850) and for chunked/cancel-resume shrinking (T8840). Cost: zero
   beyond the moov parse. Decide the payload shape (never persist view state; this is
   file metadata, so persisting is fine if it is small).
3. **Poster + per-segment preview frames from the `.LRF` proxy** (EPIC decision 2 keeps
   proxies client-side). If a 720p-class proxy frame can be drawn to canvas and uploaded
   as a ~50 KB JPEG at create time, `poster.py`'s ~5 remote seeks per game go away.
   Measure: proxy seek + draw time; decide whether the server-side poster path stays as
   the fallback for proxy-less uploads.
4. **Dropping tracks the app never reads** (DJI data tracks - gyro/GPS/timecode - and a
   second audio track): container-only via the same box-walk + offset-patch machinery.
   Measure bytes saved on the 17 GB file. Expected < 1%; if so, recommend NO and say why.
5. **Shrink offer gated by bitrate, not total bytes** (analysis only, changes EPIC
   decision 4): compute bytes/second for the three real fixtures. The 8K DJI file is
   ~96 Mbps (3.3 GB / 4.6 min) - re-encoding to 12 Mbps is an 8x win; a 3 GB 45-minute
   1080p half is ~9 Mbps and gains almost nothing. Recommendation goes to the user; the
   threshold itself is theirs to change.
6. **Anything that needs a re-encode is out** (frame-rate reduction, audio re-encode,
   bitrate reduction) - list it, mark "shrink pipeline", move on.

Bar for "cheap": < 1 s of added work per file on the dev laptop, no extra full-file read
(the sampled hash already reads 5 MB; the moov scan reads box headers + moov), no
new Postgres state.

## Implementation

### Steps
1. [x] Measure candidates 1-4 on the real fixtures (DJI 0006 + 0003 + 0004 + 0005,
   Legends half, phone clip, and the 0006 `.LRF` proxy); record ms and bytes in the table.
2. [x] Compute candidate 5's bitrate numbers for the fixtures.
3. [x] Write the decision table + a one-line recommendation per row in the Progress Log;
   flag which rows are user decisions (5) vs engineering (1-4).
4. [ ] Hand the table to the user; file follow-up tasks only for the rows they pick.

### Progress Log

**2026-09-06**: Filed from the user's direction after T8830 landed.

**2026-09-07**: Measured all 5 candidates. Done entirely inline by the supervisor, not a
container - candidates 1/2/4 needed only mp4box metadata parsing (no browser, plain
Node, reading real files directly), candidate 3 needed one lightweight single-frame
browser seek+draw (not a decode marathon), candidate 5 is arithmetic over ffprobe
numbers already on hand. No heavy real-hardware runs repeated here.

**Raw metadata-parse measurements** (Node + mp4box, box-scan finds ftyp/moov wherever
they are, feeds just those two boxes to mp4box - never reads mdat):

| File | Size | Parse ms | moov location | Video | Duration | Tracks (type:codec:samples:keyframes:bytes) |
|---|---|---|---|---|---|---|
| 0003 (co64) | 17.184 GB | 94 | near EOF | 7680x4320 | 1410.3s | video:hvc1:42264s:1409kf:16663.0MB; audio:aac:66106s:55.9MB; **metadata:djmd:38.0MB; metadata:dbgi:424.0MB**; metadata:tmcd:0MB |
| 0004 | 12.349 GB | 46 | near EOF | 7680x4320 | 1013.5s | video:hvc1:30374s:1013kf:11974.9MB; audio:aac:47505s:40.2MB; **metadata:djmd:27.3MB; metadata:dbgi:304.7MB** |
| 0005 | 17.184 GB | 124 | near EOF | 7680x4320 | 1411.4s | video:hvc1:42299s:1410kf:16662.5MB; audio:aac:66160s:56.0MB; **metadata:djmd:38.1MB; metadata:dbgi:424.3MB** |
| 0006 | 3.326 GB | 16 | near EOF | 7680x4320 | 273.5s | video:hvc1:8196s:274kf:3225.3MB; audio:aac:12817s:10.8MB; **metadata:djmd:7.4MB; metadata:dbgi:82.2MB** |
| 0006.LRF proxy | 0.253 GB | 7 | near EOF | 1280x720 | 273.5s | video:avc1:8196s:274kf:234.0MB (frame-count-identical to 0006's video track - proves the proxy is frame-synced 1:1) |
| Legends 1st half | 1.547 GB | 61 | **front (already fast-start)** | 1920x1080 | 2652.5s | video:avc1:79489s:2650kf:1503.7MB; audio:aac:124337s:42.4MB (no metadata tracks) |
| Phone clip | 0.003 GB | 4 | near EOF | 1280x720 | 10.0s | video:avc1:301s:11kf:2.8MB; audio:aac:435s:0.2MB; 5x tiny `mebx` timed-metadata tracks (~0.1MB total) |

**Candidate 3 (poster from `.LRF` proxy) live test** (real Chrome, single seek+draw, NOT
a decode marathon): load metadata 70ms + seek to 30% 94ms + canvas draw+JPEG-encode
60ms = **224ms total**, output a 1280x720 JPEG at ~210 KB (q=0.85; a smaller/lower-q
target would shrink this further if bandwidth matters more than the extra ms).

## Decision table

| # | Candidate | Measured | Recommendation | Target task |
|---|---|---|---|---|
| 1 | Client-side probe replaces `video_probe.py`'s server-side head-fetch probe | 16-124 ms to get duration/resolution/codec/fps from moov on every real fixture including both 17 GB files - matches ffprobe exactly | **YES.** Send probe fields on create; server validates/re-probes lazily rather than trusting blindly (trust boundary, not a blocker) | New small task, independent of the shrink track |
| 2 | `stss` keyframe index extracted client-side | **Free** - same moov parse as #1 already returns keyframe counts/positions (0006: 274 keyframes/8196 samples; Legends: 2650/79489) | **YES**, bundle into #1's payload - it's the same data already in hand, and T8840 (chunked shrink) and T8850 (filmstrip) both want it | Bundle into #1's task, or T8840/T8850 directly |
| 3 | Poster/preview frames from the `.LRF` proxy, replacing `poster.py`'s ~5 remote seeks | 224 ms per frame, ~210 KB JPEG output, real Chrome, real proxy file | **YES** for uploads that have a proxy (DJI-style folders); keep the server-side path as the ONLY fallback for proxy-less uploads (phone/GoPro clips) - don't remove it | New task, feeds T8850's filmstrip too (same mechanism, different frame count) |
| 4 | Dropping tracks the app never reads (DJI `djmd`/`dbgi`/`tmcd` metadata tracks) | **~2.7% of file size on every DJI file, NOT the expected <1%** - `dbgi` (DJI debug telemetry) alone is 424 MB on the 17.2 GB file, 82 MB on the 3.3 GB file. Consistent ratio across all 4 segments. Legends and the phone clip carry no comparable dead weight (Legends: none; phone: ~0.1MB of tiny `mebx` tracks, not worth touching). | **CONDITIONAL YES** - real savings, but unlike #1-3 this needs an actual container REWRITE (removing tracks from `moov`, not just patching offsets), which is more work than the "cheap, offset-patch-only" bar this survey set. Don't build a standalone universal pre-upload step for it. DO bundle it into T8840's shrink output (which already re-muxes the file from scratch, so track removal is nearly free there) - it only helps DJI-shape uploads that go through shrink, but that's exactly the huge-file case that matters. | Fold into T8840's mux step, not a separate task |
| 5 | Gate the shrink offer by bitrate, not total bytes (EPIC decision 4) | 0003: **97.48 Mbps**, 0006: **97.29 Mbps** (both ~8x the "Smallest" 7 Mbps preset - huge win). Legends half: **4.67 Mbps** - already BELOW every shrink preset (Smallest 7 / Recommended 12 / Sharpest 24 Mbps). A full Legends game (~3.1 GB, both halves) crosses today's 3 GB total-bytes offer threshold despite shrinking being pure loss: it would re-encode to an EQUAL-OR-LARGER file while burning real CPU/wall time for nothing. | **YES, this is a real gap, not just an optimization** - today's decision 4 would offer to "shrink" a file that can't get smaller. Recommend gating on `totalBytes > 3GB AND sourceBitrate > ~8-10 Mbps` (a margin above the lowest preset), not bytes alone. | EPIC decision 4 amendment + T8850 (offer gating logic) |
| 6 | Anything needing a re-encode (frame-rate/audio re-encode, bitrate reduction outside the shrink flow) | N/A - out of scope by definition | Shrink pipeline territory (T8840-T8860), not this survey | - |

**2026-09-07 (user: "proceed with your recommendations")** - actioned from the readiness
review: row 1 -> **T8838** (capability census; the client-side probe in its minimal,
highest-information form), row 4 -> T8840 caveat 8 (drop DJI metadata tracks in the
mux), row 5 -> EPIC decision 4 amended (bytes AND bitrate) + T8850 gating note. Still
the user's call: row 2 (`stss` keyframe index - natural to bundle into T8838's mp4box
parse later, or into T8840/T8850 directly) and row 3 (`.LRF`-proxy posters replacing
`poster.py` seeks - a real 224 ms/frame win, but a separate small task).

**2026-09-08 (roadmap reorganization, Video Pre-Shrink milestone)** - rows 2 and 3 were
filed PROVISIONALLY as small tasks in the Pre-Shrink Research epic so they stop dangling
here: row 2 -> **T9070** (`stss` keyframe index client-side), row 3 -> **T9080** (`.LRF`
proxy posters at upload time). Status stays WAITING ON USER: the user's pick is still the
gate. Confirm = tick step 4; veto = close the task(s) and tick step 4 with the declined
row noted.

## Acceptance Criteria

- [x] Every candidate has a measured number on the 17 GB DJI file (or a stated reason it
      does not apply)
- [x] One recommendation per row, with the target task named
- [x] No app code changed by this task
- [ ] Follow-up tasks filed only for rows the user picks
