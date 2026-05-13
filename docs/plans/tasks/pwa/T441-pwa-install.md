# T441: PWA Install

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-28

## Problem

Users discover the app via QR code or landing page but have no way to "install" it. They're stuck in a browser tab that gets lost. A PWA install makes the app feel permanent -- home screen icon, no browser chrome, splash screen.

## Solution

1. **PWA manifest + service worker** via `vite-plugin-pwa` -- makes app.reelballers.com installable
2. **Install prompt component** -- intercepts `beforeinstallprompt` (Chrome/Edge/Android), shows iOS instructions

Landing page CTAs and email capture are handled by the Landing Page Redesign epic (T2310/T2320).

## Architecture

See [T440 original task](../T440-progressive-web-app.md) for full technical details including:
- Two-origin strategy (reelballers.com vs app.reelballers.com)
- Business card flow and desktop visitor flow
- vite-plugin-pwa config, manifest, service worker strategy
- InstallPrompt component design
- Email capture → Resend welcome email integration
- Icon generation from favicon.svg

## Key Decisions

- Service worker caches static assets only (JS/CSS/fonts) -- NO API caching, NO offline mode
- `display: standalone` removes browser chrome
- `?install=1` query param triggers auto-show of install banner
- **Install prompt on shared pages**: every share link (`/shared/:token`, materialization page) becomes a distribution channel -- show install CTA if PWA not already installed. Detect via `window.matchMedia('(display-mode: standalone)')`.

## Implementation

1. [ ] Install `vite-plugin-pwa`
2. [ ] Generate icons (192, 512, apple-touch-icon 180) from favicon.svg
3. [ ] Configure vite-plugin-pwa in vite.config.js
4. [ ] Add theme-color meta + apple-touch-icon to index.html
5. [ ] Create InstallPrompt component (beforeinstallprompt + iOS fallback)
6. [ ] Handle `?install=1` auto-show
7. [ ] Add InstallPrompt to shared reel page (`/shared/:token`) and shared annotation view
8. [ ] Detect standalone mode -- skip install prompt if already installed

## Acceptance Criteria

- [ ] Passes Chrome Lighthouse PWA audit
- [ ] Installable on Android, iOS (instructions), desktop Chrome/Edge
- [ ] Standalone mode (no URL bar)
- [ ] Install banner appears with `?install=1`
- [ ] Service worker caches static assets, NOT API calls
- [ ] Share link recipients see install CTA when viewing shared reels in browser
- [ ] Install CTA hidden if already running as installed PWA
