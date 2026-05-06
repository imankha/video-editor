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

- [ ] Test fetches a real Veo match page and extracts the CDN URL
- [ ] Test verifies the CDN URL returns video/mp4 via HEAD
- [ ] Test streams at least the first 10MB to R2 and verifies it's valid video data
- [ ] Error cases return clear, actionable error messages
- [ ] Total test runtime < 60s (not downloading full 3GB in CI)

## Files Affected
- `src/backend/app/services/veo_import.py` (new)
- `src/backend/tests/test_veo_import.py` (new)
