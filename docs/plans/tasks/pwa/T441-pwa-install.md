# T441: PWA Install & Landing Page

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-28

## Problem

Users discover the app via QR code or landing page but have no way to "install" it. They're stuck in a browser tab that gets lost. A PWA install makes the app feel permanent — home screen icon, no browser chrome, splash screen. Also: landing page has no CTA to bridge the phone-at-game → desktop-at-home gap.

## Solution

1. **PWA manifest + service worker** via `vite-plugin-pwa` — makes app.reelballers.com installable
2. **Install prompt component** — intercepts `beforeinstallprompt` (Chrome/Edge/Android), shows iOS instructions
3. **Landing page email capture** — primary CTA sends welcome email with app link (bridges phone→desktop gap)
4. **Landing page "Try it now"** — secondary CTA for desktop visitors

## Architecture

See [T440 original task](../T440-progressive-web-app.md) for full technical details including:
- Two-origin strategy (reelballers.com vs app.reelballers.com)
- Business card flow and desktop visitor flow
- vite-plugin-pwa config, manifest, service worker strategy
- InstallPrompt component design
- Email capture → Resend welcome email integration
- Icon generation from favicon.svg

## Key Decisions

- Service worker caches static assets only (JS/CSS/fonts) — NO API caching, NO offline mode
- `display: standalone` removes browser chrome
- `?install=1` query param triggers auto-show of install banner
- Welcome email uses single CTA repeated twice (32% higher click-through)

## Implementation

1. [ ] Install `vite-plugin-pwa`
2. [ ] Generate icons (192, 512, apple-touch-icon 180) from favicon.svg
3. [ ] Configure vite-plugin-pwa in vite.config.js
4. [ ] Add theme-color meta + apple-touch-icon to index.html
5. [ ] Create InstallPrompt component (beforeinstallprompt + iOS fallback)
6. [ ] Handle `?install=1` auto-show
7. [ ] Landing page: email capture form + "Try it now" link
8. [ ] Landing page: Resend welcome email integration
9. [ ] Set up SPF/DKIM for reelballers.com in Cloudflare DNS

## Acceptance Criteria

- [ ] Passes Chrome Lighthouse PWA audit
- [ ] Installable on Android, iOS (instructions), desktop Chrome/Edge
- [ ] Standalone mode (no URL bar)
- [ ] Install banner appears with `?install=1`
- [ ] Landing page email capture sends welcome email within 30s
- [ ] Service worker caches static assets, NOT API calls
