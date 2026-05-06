# T2500: Veo Link Import

**Status: SUPERSEDED** — Absorbed into [Video Link Import epic](../video-import/EPIC.md) (T2600-T2630), which adds Trace support and restructures into POC-first approach.

## Summary
Let users paste a Veo match URL (e.g. `https://app.veo.co/matches/20260502-may-2-2026-42640-pm-v09accc3/`) in the Add Game dialog instead of downloading and re-uploading. Backend fetches the full-quality MP4 directly from Veo's CDN.

## Motivation
~2/3 of users record with Veo. Current flow: user downloads 2-3 GB game video from Veo → re-uploads to our app. This is slow, frustrating, and a major onboarding friction point. With Veo link import, users paste one URL and we handle the rest.

## Technical Discovery (verified 2026-05-04)

### How it works
1. User pastes Veo match page URL
2. Backend GETs that page (no auth needed, public 200)
3. Parses `og:image` meta tag from HTML:
   ```
   https://c.veocdn.com/{match-uuid}/standard/machine/{hash}/thumbnail.jpg
   ```
4. Transforms URL:
   - Domain: `c.veocdn.com` → `download.veocdn.com`
   - Filename: `thumbnail.jpg` → `video.mp4`
5. GETs the MP4 from `download.veocdn.com` — **no auth required**, public CDN
6. Streams to R2 storage

### Verified facts (from HAR + curl testing)
- Veo match pages are publicly accessible, contain `og:image` with CDN path
- CDN download URL has **no signed tokens or expiry** — protected by path obscurity only
- CDN supports `Accept-Ranges: bytes` (resumable downloads)
- Response: `Content-Type: video/mp4`, full quality (up to 4K for Veo Cam 2)
- No quality loss vs the Download button — same file
- Tested URL alive 33+ hours after creation, no expiry observed

### Example flow
```
Input:  https://app.veo.co/matches/20260502-may-2-2026-42640-pm-v09accc3/
Scrape: <meta property="og:image" content="https://c.veocdn.com/4ffe3580-9d65-4488-a809-eb59c5bc25b7/standard/machine/04d948ef/thumbnail.jpg">
Build:  https://download.veocdn.com/4ffe3580-9d65-4488-a809-eb59c5bc25b7/standard/machine/04d948ef/video.mp4
Fetch:  curl -I → 200 OK, Content-Length: 3222919323, video/mp4
```

## Implementation Plan

### Frontend: GameDetailsModal changes
- Add a toggle/tab at the top of the video section: **"Upload file"** | **"Use Veo link"**
- "Use Veo link" mode:
  - Text input field for pasting the URL
  - Validation: must match `app.veo.co/matches/...` pattern
  - Helper text with screenshot(s) showing users how to copy the link from Veo:
    - Screenshot 1: Veo game list → three-dot menu → "Share"
    - Screenshot 2: Share dialog → "Copy link" button
  - On submit: send URL to backend instead of file
- Keep all other fields the same (opponent, date, game type)
- Progress tracking: show download progress from backend (polling or SSE)

### Backend: New endpoint + download pipeline
- `POST /api/games/import-veo` — accepts `{ url, opponent, date, game_type }`
  1. Validate URL format
  2. Fetch match page HTML, extract `og:image`
  3. Transform to download URL
  4. HEAD request to get Content-Length (for progress + credit calculation)
  5. Calculate upload cost from file size, check user credits
  6. Create pending game record
  7. Stream download from CDN → multipart upload to R2 (reuse existing upload infra)
  8. Activate game when complete
- Progress: store download progress in DB or memory, expose via `GET /api/games/{id}/import-progress`

### UX considerations
- File size unknown until HEAD request — show "Checking..." then display size + credit cost
- Downloads are 1-4 GB, will take 30s-2min on server — need progress indication
- If Veo page returns 403 or no og:image → clear error: "This game may be private. Make sure sharing is set to Public on Veo."
- Auto-fill game name from og:title if available (e.g. "WCFC vs Rebels SC")

## Risks
- **Veo could change their og:image pattern** — URL derivation would break. Mitigation: monitor for failures, pattern is stable (embedded in OpenGraph standard)
- **Veo could add auth to CDN** — download would fail. Mitigation: fall back to "please download and upload" with clear messaging
- **Private matches** — og:image may not be present on non-public matches. Need to handle gracefully.
- **Large files** — 3+ GB downloads tie up server resources. Mitigation: stream directly to R2 (don't buffer in memory), limit concurrent imports per user

## Out of scope
- Trace import (separate task T2510)
- Importing highlights/clips (only full game)
- Veo Partner API integration (nice-to-have later, not needed)
- Browser extension approach (URL paste is simpler)

## Files affected
- `src/frontend/src/components/GameDetailsModal.jsx` — add Veo link tab
- `src/backend/app/routers/games.py` — new import endpoint
- `src/backend/app/services/` — new veo_import service
- Static assets for instruction screenshots
