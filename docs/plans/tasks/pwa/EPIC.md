# Epic: Progressive Web App

**Status:** TODO
**Impact:** 7 (aggregate)
**Complexity:** 4 (aggregate)

## Goal

Make Reel Ballers a native-feeling app with PWA capabilities that drive the sharing/virality loop and remove friction from the core workflow: native share sheet for exported reels (especially IG/TikTok), background operations that survive app close, push notifications for re-engagement, and offline reel playback.

## Why

Parents export highlight reels to share with family, coaches, and on social media. The biggest value unlock is reducing the export-to-Instagram path to one tap. Background Fetch for uploads is the single most differentiating feature -- no competitor handles multi-GB uploads gracefully in a PWA. Push notifications close the loop when someone shares a clip back.

The Web Share API replaces the need for individual social media integrations (previously T1090) -- the OS share sheet handles every platform the user has installed, with zero integration maintenance.

## Alpha vs. Launch Split

**Quick wins moved to For Alpha** (foundation + immediate user value):
- T441 (PWA Install) -- manifest, SW, icons, install prompt
- T442 (Web Share API) -- native share sheet, post-export toast
- T446 (Screen Wake Lock) -- prevent screen dim during annotation

**Remaining in For Launch** (require more infrastructure):
- T443-T449 + T444 + T1910

## Completion Criteria

- [ ] App is installable on Android, iOS, and desktop (Chrome/Edge) -- **Alpha**
- [ ] Every share link / materialization page includes PWA install CTA for non-installed users -- **Alpha**
- [ ] Exported reels can be shared via native share sheet (Web Share API) -- **Alpha**
- [ ] Screen stays on during Annotate mode -- **Alpha**
- [ ] Export continues if user closes app (Background Sync) -- **Launch**
- [ ] Users receive push notifications for key events -- **Launch**
- [ ] Uploads continue in background when user switches apps -- **Launch**
- [ ] Reel Ballers appears as share target for video files -- **Launch**
- [ ] Exported reels playable offline -- **Launch**

## Task Order (dependency-based)

### Alpha (quick wins)

1. **T441 - PWA Install** -- Foundation: manifest, service worker, icons, install prompt. Everything else requires this.
2. **T442 - Web Share API** -- Native share sheet from gallery + post-export toast. One tap to IG/TikTok.
3. **T446 - Screen Wake Lock** -- Keep screen on during annotation. ~20 LOC, no backend.

### For Launch (infrastructure-heavy)

4. **T443 - Background Export Tracking** -- Export survives app close. Requires service worker from T441.
5. **T444 - Push Notifications & Badges** -- Re-engagement. Requires SW + backend push infrastructure.
6. **T447 - Background Fetch for Uploads** -- Multi-GB uploads survive app close. Requires SW + T444 for notifications.
7. **T448 - Share Target API** -- Receive videos from camera roll directly. Requires manifest.
8. **T449 - Offline Reel Playback** -- Cache exported reels + persistent storage. Requires SW.
9. **T1910 - Tutorial Video** -- Record walkthrough video for landing page and in-app onboarding. Independent.

## Key Design Decision: Landing Page -> Web App -> PWA Install

The landing page (reelballers.com) links to the web app (app.reelballers.com), NOT to a PWA install flow. The web app contains the install prompt with benefit text. Shared reel pages also show an install banner.

- **Landing page** sells the product -> CTA links to web app
- **Web app** sells the install -> persistent install icon in header with benefit text
- **Share pages** grow the install base -> lighter install banner below the video

## Shared Context

- Service worker is registered in T441 and extended by T443/T444/T447/T449
- `vite-plugin-pwa` with Workbox handles SW lifecycle
- Two-origin strategy: `reelballers.com` (landing) vs `app.reelballers.com` (PWA)
- All PWA APIs degrade gracefully -- features are additive, not required for core functionality
- Landing page CTAs handled by Landing Page Redesign epic (also moved to Alpha)
- Install prompt is an in-app component, never on the landing page
