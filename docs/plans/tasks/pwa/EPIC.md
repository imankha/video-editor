# Epic: Progressive Web App

**Status:** TODO
**Impact:** 7 (aggregate)
**Complexity:** 4 (aggregate)

## Goal

Make Reel Ballers installable as a native-feeling app with PWA capabilities that drive the sharing/virality loop: native share sheet for exported reels, background export that survives app close, push notifications for re-engagement, and badge counts to pull users back.

## Why

Parents export highlight reels to share with family, coaches, and on social media. Today that means: wait for export, download file, open Instagram/WhatsApp/iMessage, attach file, post. A PWA with Web Share API turns this into: export, tap share, pick destination. Background sync means they don't have to keep the app open during export. Push notifications close the loop when someone shares a clip back to them.

The Web Share API replaces the need for individual social media integrations (previously T1090) — the OS share sheet handles every platform the user has installed, with zero integration maintenance.

## Completion Criteria

- [ ] App is installable on Android, iOS, and desktop (Chrome/Edge)
- [ ] Exported reels can be shared via native share sheet (Web Share API)
- [ ] Export continues if user closes app (Background Sync)
- [ ] Users receive push notifications for key events (export complete, shared content received)
- [ ] App icon shows badge count for pending items
- [ ] T1090 (Social Media Auto-Posting) is unnecessary — Web Share covers the use case

## Task Order (dependency-based)

1. **T441 - PWA Install** — Foundation: manifest, service worker, icons, install prompt. Everything else requires this.
2. **T442 - Web Share API** — Outbound sharing from gallery. Requires installed PWA for best UX (standalone mode).
3. **T443 - Background Sync** — Export survives app close. Requires service worker from T441.
4. **T444 - Push Notifications & Badges** — Re-engagement. Requires service worker + backend push infrastructure.
5. **T445 - Landing Page Before/After Clips** — Update landing page with latest before/after comparisons. Independent of SW features.
6. **T1910 - Tutorial Video** — Record walkthrough video for landing page and in-app onboarding. Independent of SW features.

## Shared Context

- Service worker is registered in T441 and extended by T443/T444
- `vite-plugin-pwa` with Workbox handles SW lifecycle
- Two-origin strategy: `reelballers.com` (landing) vs `app.reelballers.com` (PWA)
- Landing page email capture + welcome email lives in T441 (part of install funnel)
- All PWA APIs degrade gracefully — features are additive, not required for core functionality
