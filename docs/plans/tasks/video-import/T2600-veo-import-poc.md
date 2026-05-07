# T2600: Veo Server-to-Server Import POC

## Summary

Integration test proving we can: parse a Veo match URL → extract the CDN download URL → stream the MP4 to R2. No UI, no API endpoint — just a backend test that validates the full pipeline.

## Motivation

Before building any production import infrastructure or UI, we need proof that Veo's CDN pattern works reliably and can be automated. This test is the gate for all downstream work.

## Technical Background (verified 2026-05-04)

### Resolution Chain
1. User pastes Veo match page URL
2. Backend GETs that page (no auth needed, public 200)
3. Parses `og:image` meta tag from HTML — format:
   ```
   https://c.veocdn.com/{match-uuid}/standard/machine/{hash}/thumbnail.jpg
   ```
4. Transforms URL:
   - Domain: `c.veocdn.com` → `download.veocdn.com`
   - Filename: `thumbnail.jpg` → `video.mp4`
5. GETs the MP4 from `download.veocdn.com` — no auth required, public CDN

### Example Flow (real URLs, verified)
```
Input:  https://app.veo.co/matches/20260502-may-2-2026-42640-pm-v09accc3/
Scrape: <meta property="og:image" content="https://c.veocdn.com/4ffe3580-9d65-4488-a809-eb59c5bc25b7/standard/machine/04d948ef/thumbnail.jpg">
Build:  https://download.veocdn.com/4ffe3580-9d65-4488-a809-eb59c5bc25b7/standard/machine/04d948ef/video.mp4
Fetch:  curl -I → 200 OK, Content-Length: 3222919323, video/mp4
```

### Auto-Fill Data from HTML

The Veo match page also contains `og:title` which can auto-fill the opponent field:
```html
<meta property="og:title" content="WCFC vs Rebels SC">
```

Parse to extract team names and pre-fill the Add Game form.

### Verified Facts
- Veo match pages are publicly accessible, contain `og:image` with CDN path
- CDN download URL has **no signed tokens or expiry** — protected by path obscurity only
- CDN supports `Accept-Ranges: bytes` (resumable downloads)
- Response: `Content-Type: video/mp4`, full quality (up to 4K for Veo Cam 2)
- No quality loss vs Veo's Download button — same file
- Tested URL alive 33+ hours after creation, no expiry observed
- Veo serves a single MP4 per match (both halves in one file) — maps to `per_game` video mode

## Risks
- **Veo could change their og:image pattern** — URL derivation would break. Mitigation: monitor for failures, pattern is stable (embedded in OpenGraph standard)
- **Veo could add auth to CDN** — download would fail. Mitigation: fall back to "please download and upload" with clear messaging
- **Private matches** — og:image may not be present on non-public matches. Need to handle gracefully.
- **Large files** — 3+ GB downloads tie up server resources. Mitigation: stream directly to R2 (don't buffer in memory)

## What to Test

### 1. URL Parsing
- Extract match UUID from various Veo URL formats:
  - `https://app.veo.co/matches/20260502-may-2-2026-42640-pm-v09accc3/`
  - `https://app.veo.co/matches/20260502-may-2-2026-42640-pm-v09accc3` (no trailing slash)
  - With query params (`?utm_source=...`)

### 2. HTML Fetch + og:image Extraction
- GET the match page (no auth)
- Parse `og:image` meta tag
- Handle: 404, 403 (private match), missing og:image, changed HTML structure

### 3. CDN URL Transform
- `c.veocdn.com` → `download.veocdn.com`
- `thumbnail.jpg` → `video.mp4`
- Verify with HEAD request: expect 200, `Content-Type: video/mp4`, `Content-Length` header

### 4. Stream to R2
- Multipart upload from CDN stream directly to R2 (no local buffering)
- Verify the uploaded file is valid MP4 (check moov atom exists)
- Verify blake3 hash matches content
- Clean up test upload after verification

### 5. Error Scenarios
- Private/deleted Veo match → clear error message
- Veo CDN returns 403 → clear error message
- Network interruption during download → cleanup partial upload

## Implementation

Single test file: `src/backend/tests/test_veo_import.py`

Helper module: `src/backend/app/services/veo_import.py` — small, focused:
- `parse_veo_url(url: str) -> str` (match UUID)
- `resolve_veo_download_url(url: str) -> VeoVideoInfo` (fetches page, returns download URL + size)
- `stream_veo_to_r2(download_url: str, r2_key: str) -> str` (streams, returns blake3 hash)

## Success Criteria

- [x] Test fetches a real Veo match page and extracts the CDN URL
- [x] Test verifies the CDN URL returns video/mp4 via HEAD
- [x] Test streams at least the first 10MB to R2 and verifies it's valid video data
- [x] Error cases return clear, actionable error messages
- [x] Total test runtime < 60s (not downloading full 3GB in CI)

## Proven Usage

```python
from app.services.veo_import import (
    parse_veo_url,          # validate + extract match slug
    resolve_veo_download_url,  # scrape page -> CDN download URL + file size + title
    stream_to_r2,           # stream download -> multipart upload to R2
    VeoImportError,         # all errors are this type
)

# 1. Resolve URL to download info (async, ~1-2s)
info = await resolve_veo_download_url("https://app.veo.co/matches/some-match-slug/")
# info.download_url  = "https://download.veocdn.com/.../video.mp4"
# info.file_size     = 3222919323  (bytes)
# info.title         = "WCFC vs Rebels SC"  (from og:title, for auto-fill)

# 2. Stream to R2 (async, minutes for full game)
blake3_hash = await stream_to_r2(
    download_url=info.download_url,
    r2_key=f"games/{blake3_hash}.mp4",  # or a temp key, rename after hash known
    expected_size=info.file_size,
    max_bytes=None,  # None = download full file
)

# 3. Use blake3_hash to create game (dedup key)
# The R2 key should be games/{blake3_hash}.mp4 for dedup.
# Since we don't know the hash until after download, either:
#   a) Stream to a temp key, then R2 copy to final key (extra op but clean)
#   b) Stream to final key using a pre-computed hash (not possible here)
#   c) Accept the temp key and register the hash in the DB
```

### Key facts for downstream tasks (T2620, T2630)

- **No auth needed** -- Veo match pages and CDN are public
- **Single MP4 per game** -- maps to `per_game` video mode (no halves)
- **og:title format** -- `"Team A vs Team B"` -- parse to extract opponent name
- **File sizes** -- 500MB to 3GB typical
- **Blake3 hash caveat** -- hash is computed during download, so the R2 key can't use it upfront. T2620 needs a two-step approach: stream to temp key, then copy/rename.
- **SSRF guard** -- download URL is validated to `*.veocdn.com` before streaming
- **Event loop blocking** -- `stream_to_r2` calls sync boto3 inside async. For production (T2620), wrap R2 calls in `asyncio.to_thread` or run in a background task.

## Files Affected
- `src/backend/app/services/veo_import.py` (new)
- `src/backend/tests/test_veo_import.py` (new)
