# T2610: Trace Server-to-Server Import POC

## Summary

Integration test proving we can: parse a Trace game URL → query their GraphQL API (anonymous) → discover HLS manifest URLs → remux via ffmpeg to MP4 → upload to R2. No UI, no API endpoint — just a backend test validating the full pipeline.

## Motivation

Trace is more complex than Veo: HLS streaming (not direct MP4), multiple halves, ffmpeg remux step. This POC must prove the pipeline works before we invest in production code or UI.

## Technical Background (from probe 2026-05-06)

### URL Structure
```
https://go.traceup.com/traceid/athlete/{hash_key}/watch/{game_id}/players
```
Example: `hash_key=SD3TRsE6-`, `game_id=10046397`

### Resolution Chain
1. Parse `hash_key` and `game_id` from URL
2. POST to `go.traceup.com/traceid-prod/graphql` with game query (user_id: 0, token: "")
3. Response contains `moments[]` with `type: "FullGameVideo"`
4. Each FullGameVideo has `base_path` + `dynamic_hls`
5. Filter to non-superfly entries (raw game footage, not player-tracking view)
6. Construct master m3u8 URL: `https://go.traceup.com{base_path}{dynamic_hls}`
7. Parse master m3u8 → select highest bitrate variant (video_3000k.m3u8 = 1080p)
8. ffmpeg remux: `ffmpeg -i <variant_m3u8> -c copy output.mp4`

### GraphQL Query (full verbatim capture from browser, 2026-05-06)

Use this exact query — it's the proven working one. A minimal query requesting only
the fields we need would likely work too (GraphQL allows partial field selection), but
this is what was tested. The fields we actually use are marked with `# NEEDED`.

```graphql
query game($game_id: Int!, $hash_key: String!, $token: UserToken, $moment_id: Int, $gid: String) {
  game(game_id: $game_id, hash_key: $hash_key, token: $token, gid: $gid) {
    game_id                    # NEEDED
    base_path                  # NEEDED
    full_date                  # NEEDED (auto-fill game date)
    approx_half_duration
    sport_type                 # NEEDED (auto-fill)
    churned
    is_multicam
    division_id
    division_title
    num_equip
    num_subs
    access {
      action
      allowed
      playlist
      edit
      type
      role
    }
    permissions {
      view
      edit
      create
      archive
      plan_type
      flex_pricing
      flex {
        type
        watch_full_video
        download
        download_highlight
        create_highlight
        save
        items_limit
        games_limit
        personalization
        superadmin
      }
      collections_limit
      family_access
    }
    home_team {
      team_id
      name                     # NEEDED (internal team slug, e.g. "6vzxptqe")
      title                    # NEEDED (auto-fill opponent, e.g. "Albion SC Santa Monica G10 Academy")
      abbr
      color
      score                    # NEEDED (auto-fill)
      players_gender
      num_families
      is_full_roster
    }
    away_team {
      team_id
      name
      title                    # NEEDED (auto-fill opponent)
      abbr
      color
      score                    # NEEDED (auto-fill)
      players_gender
    }
    team_members {
      default_trace_number
      invite_status
      invite_status_update_time
      is_active
      is_coach
      is_player
      is_videographer
      jersey_number
      join_time
      leave_time
      position
      team_id
      team_player_id
      game_player_id
      pg_name
      is_paid
      user_id
      side
      gid
      pending
      user {
        user_id
        name
        first_name
        last_name
        email
        masked_email
        image_url
        is_dummy
      }
      resources {
        default_webp
        default_thumbnail
        superfollow_webp
        superfollow_thumbnail
      }
    }
    moments(hash_key: $hash_key, moment_id: $moment_id, superfly: true) {
      game_clip_id
      game_id
      team_id
      start_time
      storage_type             # NEEDED (always "wasabi" so far)
      base_path                # NEEDED (R2 path prefix)
      duration                 # NEEDED (for size estimate)
      half                     # NEEDED (which half: 1 or 2)
      time
      title
      type                     # NEEDED (filter for "FullGameVideo")
      start_third
      end_third
      dynamic_audio
      dynamic_duration
      dynamic_hls              # NEEDED (HLS manifest relative path)
      dynamic_jfile
      dynamic_offset
      dynamic_start
      keywords
      thirds
      trace_numbers
      gids
      superfly_times
      home_team {
        team_id
        name
        title
        abbr
        color
      }
      away_team {
        team_id
        name
        title
        abbr
        color
      }
      spotlights {
        center
        corr
        height
        trace_number
        user_id
        utc
        width
      }
      tags {
        name
      }
      parent_ref_id
      parent_col_id
      sport_type
      side
      camera {
        name
        type
        title
        category
      }
      fluid_src_id
      is_fluid_src
      sources {
        game_clip_id
        game_id
        team_id
        start_time
        storage_type
        base_path
        duration
        half
        time
        title
        type
        start_third
        end_third
        dynamic_audio
        dynamic_duration
        dynamic_hls
        dynamic_jfile
        dynamic_offset
        dynamic_start
        keywords
        thirds
        trace_numbers
        fluid_src_id
        conf
        meta
        home_team {
          team_id
          name
          title
          abbr
          color
        }
        away_team {
          team_id
          name
          title
          abbr
          color
        }
        spotlights {
          center
          corr
          height
          trace_number
          user_id
          utc
          width
        }
        tags {
          game_clip_tag_id
          name
          title
        }
        parent_ref_id
        parent_col_id
        sport_type
        camera {
          name
          type
          title
          category
        }
      }
    }
    profile_player_gid
    is_favorite
    locked
    is_roster_locked
    video_render_type
  }
}
```

Variables (anonymous — no login needed):
```json
{
  "game_id": 10046397,
  "hash_key": "SD3TRsE6-",
  "token": { "user_id": 0, "token": "", "timestamp": <unix_now> },
  "moment_id": null,
  "gid": null
}
```

### Auto-Fill Data from Response

The GraphQL response provides game metadata we can use to pre-fill the Add Game form:

| Response field | Auto-fill target | Example value |
|---|---|---|
| `full_date` | Game Date | `2026-04-26T20:00:00.000Z` |
| `home_team.title` | Opponent (if away) | `Albion SC Santa Monica G10 Academy` |
| `away_team.title` | Opponent (if home) | `Beach Futbol Club Gu10 Sb Partida #2` |
| `home_team.score` / `away_team.score` | (display only) | `5 - 3` |
| `sport_type` | (validation) | `soccer` |

Note: we can't determine home/away automatically — the `hash_key` identifies a player profile, not a team. The user still picks game type.

### Alternative Download Paths (explored, not viable for our use case)

1. **Direct MP4 URL construction** — Trace JS code transforms `gamevideo1.hls` → `gamevideo1.mp4`. These URLs return **403** on the CDN. Not usable.

2. **`fullDownloadLink` GraphQL mutation** — Returns a direct MP4 download URL, but requires an authenticated Trace user token (`user_id`, `token` hash, `timestamp`). Our users won't have Trace accounts linked.

3. **Clip download API** (`lapi.traceup.com/exec-prod/clip/download`) — For highlight clips, not full game video. Also requires auth.

### Example Response (FullGameVideo moments only)
```
Half 1: base_path=/us-west-1/soccer/api/teams/6vzxptqe/games/6vzxptqe-10046397/
        dynamic_hls=gamevideo1.hls/game_video.m3u8  (raw game — USE THIS)
        dynamic_hls=superfly_sf_home_7_half1/superfly_gamevideo.m3u8  (player tracking — SKIP)

Half 2: base_path=/us-west-1/soccer/api/teams/6vzxptqe/games/6vzxptqe-10046397/
        dynamic_hls=gamevideo2.hls/game_video.m3u8  (raw game — USE THIS)
        dynamic_hls=superfly_sf_home_7_half2/superfly_gamevideo.m3u8  (player tracking — SKIP)
```

Filter rule: use FullGameVideo moments where `dynamic_hls` does NOT contain "superfly".

### Master m3u8 Content (example)
```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480
video_1000k.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
video_2000k.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
video_3000k.m3u8
```

Select `video_3000k.m3u8` (1080p). Full variant URL:
`https://go.traceup.com{base_path}gamevideo1.hls/video_3000k.m3u8`

### Verified Facts
- All HLS segments (m3u8 + .ts) are publicly accessible — no auth headers, no cookies, no query params
- Served from Wasabi S3 via CloudFront CDN (`Server: WasabiS3`, `Via: cloudfront.net`)
- Each .ts segment is ~1.3MB at 1080p (2 seconds of video)
- GraphQL API works with user_id=0 and empty token string (anonymous)
- Direct MP4 URLs return 403 — HLS-only delivery
- `.ts` segment supports `Accept-Ranges: bytes`

### .ts Segment Response Headers (captured 2026-05-06)
```
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Content-Length: 1328972
Accept-Ranges: bytes
Server: WasabiS3/8.0.194-2026-03-18-d149c3595f
X-Cache: Miss from cloudfront
Via: 1.1 *.cloudfront.net (CloudFront)
X-Amz-Cf-Pop: LAX50-P4
Timing-Allow-Origin: *
```

### Key Data Points
- Master m3u8 has 3 variants: 480p (1Mbps), 720p (2.5Mbps), 1080p (5Mbps)
- ~995 segments x 2s each per half (~33 min)
- ~1.3MB per segment at 1080p → ~1.3GB per half
- Two halves per game (gamevideo1, gamevideo2)
- Superfly views (player tracking) are separate FullGameVideo entries — filter by `dynamic_hls` not containing "superfly"

## What to Test

### 1. URL Parsing
- Extract `hash_key` and `game_id` from Trace URLs:
  - `https://go.traceup.com/traceid/athlete/SD3TRsE6-/watch/10046397/players`
  - `https://go.traceup.com/traceid/athlete/SD3TRsE6-/watch/10046397/landing`
  - With query params (`?mtm_campaign=...`)

### 2. GraphQL Resolution
- POST game query with anonymous token
- Parse response → extract FullGameVideo moments
- Filter out superfly views
- Handle: invalid game_id, private game, API errors

### 3. HLS Discovery
- Fetch master m3u8 → parse variants
- Select highest quality (1080p)
- Verify variant m3u8 is accessible
- Count segments, estimate total size

### 4. FFmpeg Remux
- `ffmpeg -i <m3u8_url> -c copy -movflags +faststart output.mp4`
- Verify output is valid MP4 with moov at start
- Verify duration matches expected (~33 min per half)
- Test with a small segment range first (first 10 segments = 20s)

### 5. Stream to R2
- Upload remuxed MP4 to R2
- Verify blake3 hash
- Clean up test upload

### 6. Error Scenarios
- Invalid/nonexistent game_id → clear error
- Private game (no moments returned) → clear error
- m3u8 URL returns 403 → clear error
- ffmpeg fails → cleanup temp files

## Implementation

Single test file: `src/backend/tests/test_trace_import.py`

Helper module: `src/backend/app/services/trace_import.py`:
- `parse_trace_url(url: str) -> TraceGameRef` (hash_key + game_id)
- `resolve_trace_videos(game_id: int, hash_key: str) -> list[TraceVideoInfo]` (GraphQL → video info per half)
- `remux_hls_to_mp4(m3u8_url: str, output_path: str) -> None` (ffmpeg remux)
- `stream_trace_to_r2(video_info: TraceVideoInfo, r2_key: str) -> str` (remux + upload, returns blake3)

## Success Criteria

- [x] Test queries Trace GraphQL and gets game video URLs
- [x] Test correctly filters FullGameVideo (non-superfly) and identifies both halves
- [x] Test remuxes at least 10 HLS segments to valid MP4 via ffmpeg
- [x] Test uploads remuxed MP4 to R2 and verifies it's valid
- [x] Error cases return clear, actionable error messages
- [x] Total test runtime < 90s (partial download, not full game)

## Proven Usage

```python
from app.services.trace_import import (
    parse_trace_url,        # validate + extract hash_key + game_id
    resolve_trace_videos,   # GraphQL -> video info per half + metadata
    resolve_best_variant,   # master m3u8 -> highest-quality variant URL
    remux_hls_to_mp4,       # ffmpeg -c copy to MP4 (no re-encode)
    upload_file_to_r2,      # local file -> multipart upload + blake3 hash
    TraceImportError,       # all errors are this type
)

# 1. Resolve game metadata + HLS URLs (async, ~1-2s)
info = await resolve_trace_videos("https://go.traceup.com/traceid/athlete/SD3TRsE6-/watch/10046397/players")
# info.videos      = [TraceVideoInfo(half=1, m3u8_url=...), TraceVideoInfo(half=2, m3u8_url=...)]
# info.home_team   = "Albion SC Santa Monica G10 Academy"
# info.away_team   = "Beach Futbol Club Gu10 Sb Partida #2"
# info.full_date   = "2026-04-26T20:00:00.000Z"
# info.home_score  = 5
# info.away_score  = 3

# 2. For each half: resolve best variant + remux (sync, minutes per half)
for video in info.videos:
    variant_url = await resolve_best_variant(video.m3u8_url)  # -> 1080p variant
    remux_hls_to_mp4(variant_url, f"/tmp/half{video.half}.mp4")  # ffmpeg -c copy

# 3. Upload each half to R2 (sync, seconds per half for small files)
blake3_hash = upload_file_to_r2("/tmp/half1.mp4", "games/{hash}.mp4")
```

### Key facts for downstream tasks (T2620, T2630)

- **Anonymous GraphQL** -- user_id=0, empty token works for all public games
- **Two halves per game** -- maps to `per_half` video mode, each half is a separate file
- **HLS -> MP4 remux** -- ffmpeg copies codec (no re-encode), ~2-5 min per half at ~1.3GB
- **Temp file needed** -- unlike Veo (direct stream), Trace requires ffmpeg to write a local temp file before R2 upload
- **Metadata available** -- home/away teams, scores, date, sport type for auto-fill
- **Superfly filter** -- FullGameVideo moments include player-tracking views; filter by `"superfly" not in dynamic_hls`
- **1080p always** -- `resolve_best_variant` picks the highest bandwidth variant (video_3000k.m3u8)
- **Blocking calls** -- `remux_hls_to_mp4` and `upload_file_to_r2` are sync; for production (T2620), run in background task or thread

## Files Affected
- `src/backend/app/services/trace_import.py` (new)
- `src/backend/tests/test_trace_import.py` (new)

## Open Questions
- Should we always download 1080p, or let users choose quality? (Recommendation: always 1080p -- the app needs highest resolution for good crops)
- Trace game with >2 halves (extra time, penalties)? Need to check if those appear as separate FullGameVideo moments.
