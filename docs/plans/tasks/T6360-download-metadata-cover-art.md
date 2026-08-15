# T6360: Pack poster + rich metadata into every downloaded video

**Status:** WIP
**Impact:** 5
**Complexity:** 4
**Created:** 2026-08-02
**Updated:** 2026-08-02

## Problem

Every video a user downloads from Reel Ballers leaves the app as a **bare MP4**: no
title, no cover art, no date, no author, no attribution. Once it lands in the
user's file system, camera roll, or Plex library it is an anonymous
`Vs_Sharks_Dec_6_final.mp4` with a generic film-strip icon, sorted by the moment
they clicked download rather than by when the game was played.

Concretely, today:

- **No cover art.** We already generate a good poster frame at publish
  (`final_videos/posters/{filename}.jpg`, T5280/T4890) and use it for the tile and
  the share unfurl — but it is never written into the file the user takes home.
- **No title / author / album.** Players and libraries fall back to the filename.
- **Wrong dates.** The container's creation time is the *download* moment, so a
  reel of a December game files itself under today in Photos-style timelines.
- **No attribution inside the file.** We burn a branded outro into the pixels
  (T3950/T5240) but write nothing into the metadata a platform could read.
- **The share page's download skips the pipeline entirely.** `SharedVideoOverlay`
  fetches the presigned R2 URL directly, so a recipient's download gets neither
  metadata **nor the branded outro**. That is a pre-existing gap this task closes.

This is the "last mile" of a reel. The product value is motion + polish
(see the animation-polish direction); a file that shows up as a gray icon with a
machine name undercuts that at the exact moment the parent shows it to someone.

## Solution

One shared **serve-time stamping pass** applied to every video leaving the app,
sitting immediately after the branded-outro append that already runs on the
download path. Metadata is written with `-c copy` — **no re-encode, no quality
change, no visible edit** — so the cost is one extra local mux of an already-local
temp file.

Serve-time (not publish-time) is deliberate, and matches T3950's precedent:

- Stored `final_videos/*` objects stay byte-identical, so playback, streaming,
  ranking, and the share-page player are untouched.
- Every **existing** reel gets the treatment retroactively with no backfill.
- The metadata can reflect facts known at download time (current reel name after a
  rename, current athlete/profile name) rather than a frozen stale copy.

### What gets written

| Field | ffmpeg key | Value | Why it helps |
|---|---|---|---|
| Cover art | attached_pic stream (`covr`) | the existing publish-time poster | Finder/QuickTime/VLC/Plex/Jellyfin show the real play instead of a film-strip icon |
| Title | `title` | `final_videos.name` (the reel name the user sees) | Players show a real name, not the filename |
| Author | `artist`, `album_artist` | athlete / profile name | Groups a season of reels under one athlete in any library |
| Album | `album` | the reel's group key (game display name, or season group) | Two-level organization for free in Plex/Music-style libraries |
| Date | `date` + `creation_time` | the **game date**, not the export date | Files sort into the right place in a camera-roll / date-sorted timeline |
| Description | `comment` (and `description`) | short human line: reel name, game, tags | Readable in every "Get Info"/properties panel |
| Attribution | `copyright`, `encoder`/`©too`, `publisher` | "Made with Reel Ballers — reelballers.com" | Machine-readable attribution to pair with the burned-in outro |
| Genre | `genre` | `Sports` | Correct default bucketing in media libraries |
| Container | `-movflags +faststart` | already applied | Keep it — instant playback/scrub |

**Deliberately NOT written:**

- **No location / GPS.** These are videos of children at known, recurring venues;
  an embedded coordinate travels with every re-share. Never write `location`.
- **No chapters / subtitle tracks.** Reels are seconds long; chapters are noise.
- **No loudness normalization or any pixel/audio change.** Out of scope — this task
  is metadata only, and the `-c copy` constraint enforces that.

### Where it applies (every egress point)

| # | Path | Today | After |
|---|---|---|---|
| 1 | Gallery download button → `GET /api/downloads/{id}/file` ([useDownloads.js:150](src/frontend/src/hooks/useDownloads.js#L150)) | outro only | outro + metadata |
| 2 | Mobile native share sheet → same endpoint ([useWebShare.js:78](src/frontend/src/hooks/useWebShare.js#L78)) | outro only | outro + metadata |
| 3 | Share-page download ([SharedVideoOverlay.jsx:75-89](src/frontend/src/components/SharedVideoOverlay.jsx#L75-L89)) | **raw R2 object — no outro, no metadata** | routed through a backend download endpoint → outro + metadata |
| 4 | Collection download (T4945, not built) | n/a | must call the same helper — note it in T4945 |

Path 3 is the one behavior change beyond metadata: it is a real gap (a recipient's
download is currently un-branded), and it is the reason this task is not
backend-only.

## Context

### Relevant Files (REQUIRED)

- `src/backend/app/services/download_metadata.py` — **NEW.** `stamp_download_metadata(in_path, out_path, meta) -> bool`, plus a `build_download_metadata(conn, download_id)` that assembles the field map from the DB. Same failure contract as the outro: never raises, returns False, caller ships the unstamped file.
- `src/backend/app/routers/downloads.py` — `download_file` ([downloads.py:615](src/backend/app/routers/downloads.py#L615)): the SELECT widens (name, created_at, game attribution, poster_filename), and the two streaming generators (`_stream_with_outro_r2`, `_stream_with_outro_local`) gain the stamping step after `append_branded_outro`.
- `src/backend/app/services/branded_outro.py` — read for the pattern (temp dir, `-c copy` concat, non-fatal failure, `+faststart`). Decide at design time whether stamping folds into the existing concat invocation or runs as its own pass — see Technical Notes.
- `src/backend/app/services/poster.py` — read-only: `poster_basename` / `poster_rel_path` give the existing full-size poster key. No changes.
- `src/backend/app/routers/shares.py` — new/extended share-scoped download endpoint for path 3.
- `src/frontend/src/components/SharedVideoOverlay.jsx` — point `handleDownload` at that endpoint instead of `share.video_url`.
- `src/backend/tests/test_t6360_download_metadata.py` — **NEW.**

### Related Tasks

- Builds on: **T3950** (branded outro — the serve-time append this hooks into), **T5240** (animated outro card), **T5280 / T4890** (the publish-time poster this reuses as cover art).
- Feeds: **T4945** (Download Collection as Stitched MP4) — must reuse `stamp_download_metadata`, do not re-implement.
- Adjacent: **T5410** (poster selection rework) — improves the poster this task embeds; no dependency in either direction.

### Technical Notes

**The ffmpeg shape** (cover art + tags, stream copy):

```
ffmpeg -y -i in.mp4 -i poster.jpg \
  -map 0 -map 1 -c copy -c:v:1 mjpeg -disposition:v:1 attached_pic \
  -metadata title="..." -metadata artist="..." -metadata album="..." \
  -metadata date="2025-12-06" -metadata creation_time="2025-12-06T12:00:00Z" \
  -metadata comment="..." -metadata copyright="..." -metadata genre="Sports" \
  -movflags +faststart out.mp4
```

Design decisions to settle before writing code:

1. **One pass or two?** The outro concat already writes a fresh file with
   `-movflags +faststart`. Folding `-metadata` + the attached_pic input into that
   invocation saves a full file copy; keeping it separate keeps two independently
   testable, independently failing units and works unchanged when the outro is
   disabled (`BRANDED_OUTRO_ENABLED=false`) or fails. **Recommendation: separate
   pass** — the extra local copy of a ~10-50MB temp file is cheap next to the R2
   fetch that already happened, and the outro's stream-copy/re-encode fallback
   logic is intricate enough that adding a second input to it invites regressions.
2. **Missing poster.** Pre-T5280 reels have no poster object. Skip cover art and
   still write the tags — **never fabricate an image** (no-silent-fallback rule).
3. **Missing game date.** Write no `date`/`creation_time` rather than a wrong one;
   do not silently fall back to `created_at`. A visibly absent date beats a wrong
   date in a camera-roll timeline.
4. **Athlete name in a shared file.** `artist` is what makes a library organize
   correctly, but it travels with the file to Instagram/WhatsApp. Recommendation:
   write it (it is the user's own child, and the outro already brands the file);
   flag it at kickoff as a one-line user decision, and keep the value sourced from
   the profile name so a user who wants it generic can rename the profile.
   Do not block on this — implement with it on, note the toggle point.

**Risks / must-verify:**

- **The attached_pic adds a second video stream.** Some players list it as a
  selectable track, and some upload targets are picky. The highest-risk path is #2:
  iOS share sheet → Instagram/TikTok. **If any target rejects or mangles the file,
  gate cover art off for the web-share path and keep the tags** (tags alone are
  zero-risk). Verify before merge; do not assume.
- **Windows Explorer will ignore the cover art.** It generates its own thumbnail
  via Media Foundation. This is expected and documented, not a bug to chase — the
  tags still show in Properties → Details. Do not add Windows-specific hacks.
- **Upload targets strip metadata.** YouTube/Instagram/TikTok generate their own
  thumbnails and discard most tags. The win here is the user's own filesystem,
  camera roll, AirDrop, Plex/Jellyfin, and Apple ecosystem — not social re-upload.
  Say so in the task report; do not oversell.
- **Download latency.** Measure the added time on a real reel and report it. If the
  extra pass is material, that is the argument for folding it into the concat.
- **Never touch the stored object.** Stamping is serve-time only. No writes back to
  `final_videos/*` in R2, no DB writes, no new sync call sites.

## Implementation

### Steps

1. [ ] `download_metadata.py`: `stamp_download_metadata` (ffmpeg `-c copy`, non-fatal, returns bool) + `build_download_metadata` (assembles the field map from `final_videos` + `games` + profile name; returns partial map with absent fields omitted, never guessed).
2. [ ] Wire into `download_file` for both the R2 and local branches, after `append_branded_outro`; widen the SELECT to carry name / game attribution / poster ref.
3. [ ] Cover art: resolve the existing poster object, download to the temp dir, attach; skip cleanly when absent.
4. [ ] Route the share-page download through a backend endpoint so recipients get the outro + metadata too (`shares.py` + `SharedVideoOverlay.jsx`).
5. [ ] Tests: `ffprobe` assertions on a stamped fixture (every tag present and correct; `attached_pic` disposition set; still one real video stream; `+faststart` preserved); poster-absent path; ffmpeg-failure path ships the unstamped file with a logged error; no stored object mutated.
6. [ ] Real-platform verification sweep (see Acceptance Criteria) — evidence, not claims.
7. [ ] Note in T4945 that collection downloads must reuse the helper.

### Progress Log

**2026-08-02**: Task filed from a question about whether a download-time poster
protocol exists. Egress points inventoried against the code (4 paths, listed
above); confirmed the share-page download bypasses the outro entirely. Not started.

## Acceptance Criteria

- [ ] A reel downloaded from the gallery carries: cover art, title, artist, album, game date, description, and attribution — verified by `ffprobe` output pasted into the report.
- [ ] The video stream is byte-identical to the pre-stamp file (stream copy proven, not asserted).
- [ ] A pre-T5280 reel with no poster downloads successfully with tags and no cover art, and logs the skip.
- [ ] An induced ffmpeg failure still serves a playable, unstamped download (never a broken or missing file).
- [ ] The share-page download now carries the branded outro **and** metadata.
- [ ] Platform sweep with stated results (a documented "ignored here" is a pass): macOS Finder/QuickTime, VLC, Windows Explorer Properties, iOS Photos + share sheet → at least one social target uploads successfully.
- [ ] Added download latency measured and reported on a real reel.
- [ ] No stored R2 object, DB row, or sync path modified.
- [ ] Tests pass (changed-code scope) and Branch CI is green.
