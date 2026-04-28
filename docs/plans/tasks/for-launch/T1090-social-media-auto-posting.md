# T1090: Social Media Auto-Posting

**Status:** SUPERSEDED
**Superseded By:** T442 (Web Share API) — native OS share sheet covers all platforms with zero integration maintenance
**Impact:** 8
**Complexity:** 7
**Created:** 2026-04-07
**Updated:** 2026-04-07

## Problem

Users create highlight videos in the app but must manually download, re-upload, and reformat them for each social platform (Instagram Reels, TikTok, YouTube Shorts, Facebook Reels). This friction means many highlights never get posted, reducing the app's viral reach. Users also struggle with platform-specific requirements (aspect ratios, caption lengths, hashtag strategies).

## Solution

**"Share to Social" — unified posting from the gallery.** One form, one caption, one click — the system adapts the video and text for each platform and posts everywhere.

### User Flow

1. User opens a highlight in the Gallery
2. Clicks "Share to Social" button
3. Sees a form with:
   - Caption text area (write once)
   - Platform toggles (IG, TikTok, YouTube, FB) — only connected platforms shown
   - Per-platform preview: AI-adapted caption with platform-specific hashtags, trimmed to character limits
   - User can edit each platform's version before posting
   - Schedule option (post now or pick a time)
4. Clicks "Post" → videos upload to all selected platforms
5. Status indicator shows progress per platform (uploading, processing, published, failed)

### Architecture

**Aggregator API approach** (not direct platform APIs). Building and maintaining 4 separate OAuth flows + app review processes is not viable for a small team.

Options (pick one):
- **Postiz** (open-source, self-hosted free, cloud $23-31/mo) — REST API, supports all 4 platforms, can self-host alongside our backend
- **Ayrshare** ($49-149/mo) — Most established, Python SDK, widest platform coverage
- **Post for Me** ($10/mo) — Simplest, unified API

The aggregator handles OAuth, platform-specific upload mechanics, and format requirements. Our app just calls one API with the video URL + caption.

### AI-Assisted Adaptation (Authentic, Not Fake)

The AI helps adapt content, but the user always sees and can edit before posting. No auto-generated fluff.

- **Caption adaptation**: One input → platform-tuned versions
  - Instagram: Add relevant hashtags (sports, team-specific), keep under 2,200 chars
  - TikTok: Shorter, punchier, trending hashtags, under 2,200 chars
  - YouTube: Longer description with context, timestamps, under 5,000 chars
  - Facebook: Conversational tone, minimal hashtags
- **Title suggestions**: Generate from clip annotations/player names/game metadata
- **Hashtag research**: Suggest relevant hashtags based on sport, team, event
- **Best-time suggestions**: "Your audience is most active at 6pm EST on Tuesdays" (if analytics data available)

What AI should NOT do:
- Auto-post without user review
- Generate clickbait or engagement-bait text
- Add generic motivational quotes
- Make the post sound bot-generated

### Video Reformatting

Leverage existing FFmpeg pipeline to prepare platform-specific versions:
- **9:16 vertical** (1080x1920) — Required for IG Reels, TikTok, YouTube Shorts, FB Reels
- **Duration trimming** — IG Reels max 90s, TikTok varies by creator, YouTube Shorts max 60s
- The Framing screen already handles crop/aspect-ratio — may be able to reuse that output directly if already 9:16

### Account Connection

- Settings page: "Connected Accounts" section
- Per-platform "Connect" button → OAuth flow via aggregator
- Show connection status (connected, expired, needs reconnect)
- Aggregator manages token refresh

## Context

### Relevant Files
- `src/frontend/src/screens/GalleryScreen.jsx` — Gallery where user views exported highlights
- `src/frontend/src/components/GalleryPlayer.jsx` — Video player in gallery
- `src/backend/app/routers/exports.py` — Export/gallery endpoints
- `src/backend/app/routers/users.py` — User settings (for connected accounts)
- `src/frontend/src/screens/SettingsScreen.jsx` — Settings (add Connected Accounts section)

### Related Tasks
- T1080 (Gallery Player Scrub Controls) — Gallery improvements
- T1070 (Team & Profiles Quest) — Viral loop features

### Technical Notes

#### Platform Requirements Summary
| Platform | Aspect Ratio | Max Duration | Max File Size | Caption Limit |
|----------|-------------|-------------|---------------|---------------|
| Instagram Reels | 9:16 | 90s (API) | 100MB | 2,200 chars |
| TikTok | 9:16 | Varies (up to 10min) | 1GB | 2,200 chars |
| YouTube Shorts | 9:16 | 60s | ~128MB | 5,000 chars |
| Facebook Reels | 9:16 | 90s (for Reels tab) | 1GB | 63,206 chars |

#### Aggregator API Comparison
| Service | Price | Self-Host | Platforms | Python SDK |
|---------|-------|-----------|-----------|------------|
| Postiz | Free (self-host) / $23-31/mo | Yes | 12+ | REST API |
| Ayrshare | $49-149/mo | No | 13 | Yes |
| Post for Me | $10/mo | No | 9+ | REST API |

#### Key Gotchas
- TikTok: Unaudited API clients → posts are private-only until audit passes
- YouTube: Unverified apps → private-only, 6 uploads/day quota
- Instagram: Business/Creator account required, 2-4 week Meta app review
- All platforms: OAuth tokens expire and need refresh handling

## Implementation

### Steps
1. [ ] Choose aggregator service (evaluate Postiz self-hosted vs Ayrshare vs Post for Me)
2. [ ] Design "Connected Accounts" UI in Settings
3. [ ] Implement OAuth connection flow via aggregator
4. [ ] Design "Share to Social" modal in Gallery
5. [ ] Build caption adaptation AI (one input → per-platform versions)
6. [ ] Implement video reformatting pipeline (aspect ratio + duration per platform)
7. [ ] Build posting backend (queue, status tracking, error handling)
8. [ ] Add scheduling support (post now or later)
9. [ ] Test end-to-end flow for each platform
10. [ ] Handle edge cases (token expiry, upload failures, platform-specific errors)

## Acceptance Criteria

- [ ] User can connect Instagram, TikTok, YouTube, and Facebook accounts from Settings
- [ ] User can share a gallery highlight to multiple platforms in one action
- [ ] AI suggests platform-adapted captions that user can edit before posting
- [ ] Videos are reformatted to meet each platform's requirements automatically
- [ ] Post status is visible (uploading, published, failed) per platform
- [ ] Scheduling works (post now or pick a future time)
- [ ] No posts go out without explicit user confirmation
- [ ] Captions feel authentic, not bot-generated
