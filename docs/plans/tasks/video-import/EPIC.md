# Video Link Import

**Status:** TODO
**Started:** --
**Absorbs:** T2500 (Veo Link Import)

## Goal

Let users paste a Veo or Trace game URL in Add Game instead of downloading and re-uploading multi-GB video files. Server-to-server transfer skips user bandwidth and local storage entirely.

## Why

~2/3 of users record with Veo, the rest with Trace. Current flow: download 2-3 GB game video → re-upload to our app. This is the single biggest onboarding friction point. With link import, users paste one URL and the backend handles the rest (datacenter-to-datacenter transfer, 2-5 minutes).

## Technical Discovery (verified 2026-05-06)

### Veo (verified via HAR + curl)
- Match pages are publicly accessible
- `og:image` meta tag contains CDN path → transform to download URL
- `download.veocdn.com` serves full-quality MP4, no auth, no signed tokens
- Supports `Accept-Ranges: bytes` (resumable)
- Single MP4 per game (full match)

### Trace (verified via HAR + browser probe)
- GraphQL API at `go.traceup.com/traceid-prod/graphql` works with `user_id: 0, token: ""` (anonymous)
- Returns `base_path` + `dynamic_hls` for all game moments, including `FullGameVideo` per half
- HLS segments (1080p/5Mbps) served from Wasabi S3 via CloudFront, no auth
- 995 segments x ~1.3MB = ~1.3GB per half at 1080p
- `ffmpeg -i <m3u8> -c copy output.mp4` remuxes without re-encoding
- URL structure: `go.traceup.com/traceid/athlete/{hash_key}/watch/{game_id}/players`
- Two halves per game, each a separate `FullGameVideo` moment

### Key Differences

| Aspect | Veo | Trace |
|--------|-----|-------|
| URL format | `app.veo.co/matches/{uuid}/` | `go.traceup.com/traceid/athlete/{hash}/watch/{game_id}/...` |
| Discovery | HTML scrape → og:image transform | GraphQL query (anonymous) |
| Delivery | Direct MP4 download | HLS stream (m3u8 + .ts segments) |
| Remux needed | No | Yes (ffmpeg, copy codec, fast) |
| Halves | Single file (full game) | Separate files per half |
| Auth | None | None |

## Architecture

```
User pastes URL
  → Frontend validates URL pattern (Veo or Trace)
  → POST /api/games/import-url { url, opponent, date, game_type }
  → Backend detects platform from URL
  → Platform-specific resolver:
      Veo:   fetch HTML → parse og:image → transform → HEAD for size → stream MP4 to R2
      Trace: parse URL → GraphQL query → get m3u8 URLs → ffmpeg remux per half → upload to R2
  → Auto-fill game details from platform metadata (team names, date, score)
  → Progress tracking via polling endpoint
  → Game activated when upload complete
```

### Auto-Fill from Platform Metadata

Both platforms return game metadata we can use to pre-fill the Add Game form:

| Field | Veo source | Trace source |
|---|---|---|
| Game date | (not in og tags — user enters) | `full_date` from GraphQL |
| Team names | `og:title` (e.g. "WCFC vs Rebels SC") | `home_team.title` / `away_team.title` |
| Score | (not available) | `home_team.score` / `away_team.score` |
| Video mode | Always `per_game` (single file) | Always `per_half` (separate files) |

## Tasks

| ID | Task | Status |
|----|------|--------|
| T2600 | [Veo Import POC](T2600-veo-import-poc.md) | TODO |
| T2610 | [Trace Import POC](T2610-trace-import-poc.md) | TODO |
| T2620 | [Import Backend Service](T2620-import-backend-service.md) | TODO |
| T2630 | [Add Game Import UI](T2630-add-game-import-ui.md) | TODO |

**Sequencing rationale:**
- T2600 + T2610 run in parallel — independent POC tests proving server-to-server works for each platform. Must pass before any production code.
- T2620 builds the real backend service after POCs prove the concept. Unified endpoint handling both platforms with progress tracking.
- T2630 is the UI — only starts after T2620 is complete. Adds "Paste Link" option to GameDetailsModal with per-platform help content.

## Completion Criteria

- [ ] Veo match URL → MP4 in R2 (proven by integration test)
- [ ] Trace game URL → MP4(s) in R2 (proven by integration test)
- [ ] Unified `POST /api/games/import-url` handles both platforms
- [ ] Progress tracking (polling endpoint) with percentage and ETA
- [ ] GameDetailsModal has "Paste Link" tab alongside "Upload File"
- [ ] Help icon (?) shows platform-specific instructions for finding the share link
- [ ] Error handling: private games, changed URLs, network failures
- [ ] Credit calculation from Content-Length before download starts
