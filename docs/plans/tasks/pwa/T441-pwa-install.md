# T441: PWA Install

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-28
**Updated:** 2026-05-13

## Problem

Users arrive at the web app via the landing page or a share link. They use it in a browser tab that gets buried and forgotten. There's no way to "install" the app, and no explanation of why they'd want to.

## Design Decision: Landing Page Links to Web App, Not PWA Install

The landing page (reelballers.com) links to the web app (app.reelballers.com). The web app itself contains the PWA install prompt. The landing page sells the product; the app sells the install.

This means:
- Landing page CTAs ("Make my first reel -- free") -> app.reelballers.com (web app)
- Web app shows an install icon + benefit text for non-installed users
- Shared reel pages (/shared/:token) also show the install prompt
- Every share link becomes a distribution channel for app installs

## Solution

1. **PWA manifest + service worker** via `vite-plugin-pwa` -- makes app.reelballers.com installable
2. **In-app install prompt** -- a persistent icon + benefit text inside the web app that explains what installing gets you
3. **Share page install prompt** -- every shared reel/annotation page shows the install CTA for non-installed users

## In-App Install Prompt Design

### Placement
- **Header/nav area**: small install icon (download arrow or phone icon) with "Install App" text
- Not a modal or popup -- a persistent, non-intrusive element users can tap when ready
- Disappears when already running as installed PWA (`display-mode: standalone`)

### Benefit Text (shown on tap or hover)
When the user taps the install icon, show a brief panel/tooltip explaining:

```
Install Reel Ballers

  Home screen icon -- one tap to open
  Full screen -- no browser bars
  Push alerts when your reel is ready
  Uploads keep going if you switch apps

[Install]  [Not now]
```

### On Shared Pages
When someone opens a share link (/shared/:token or materialization page) in a browser:
- Show a banner/strip below the video: "Get the app to make your own reels" + install icon
- Less aggressive than a modal -- they came to watch a reel, not get sold
- If PWA is already installed, banner hidden

### iOS Handling
iOS Safari doesn't support `beforeinstallprompt`. Show:
- "Add to Home Screen" with step-by-step: tap Share icon -> "Add to Home Screen"
- Same benefit text

## Architecture

See [T440 original task](../T440-progressive-web-app.md) for full technical details including:
- Two-origin strategy (reelballers.com vs app.reelballers.com)
- vite-plugin-pwa config, manifest, service worker strategy
- Icon generation from favicon.svg

## Key Decisions

- Service worker caches static assets only (JS/CSS/fonts) -- NO API caching, NO offline mode
- `display: standalone` removes browser chrome
- Install prompt lives IN the web app, not on the landing page
- Detect installed state via `window.matchMedia('(display-mode: standalone)')` -- hide prompt when already installed
- Share pages get a lighter-touch banner (not the full benefit panel)
- No `?install=1` auto-popup -- install is always user-initiated from the in-app icon

## Implementation

1. [ ] Install `vite-plugin-pwa`
2. [ ] Generate icons (192, 512, apple-touch-icon 180) from favicon.svg
3. [ ] Configure vite-plugin-pwa in vite.config.js
4. [ ] Add theme-color meta + apple-touch-icon to index.html
5. [ ] Create `useInstallPrompt` hook -- intercepts `beforeinstallprompt`, tracks installed state
6. [ ] Create InstallButton component (header icon + benefit panel on tap)
7. [ ] Add InstallButton to app header/nav (visible only when not installed)
8. [ ] Create SharePageInstallBanner component (lighter CTA for shared pages)
9. [ ] Add SharePageInstallBanner to /shared/:token and shared annotation view
10. [ ] iOS fallback: "Add to Home Screen" instructions with share icon step-by-step

## Acceptance Criteria

- [ ] Passes Chrome Lighthouse PWA audit
- [ ] Installable on Android, iOS (instructions), desktop Chrome/Edge
- [ ] Standalone mode removes browser chrome (no URL bar)
- [ ] In-app install icon visible in header when running in browser
- [ ] Tapping install icon shows benefit text + install button
- [ ] Install prompt hidden when already running as installed PWA
- [ ] Share link recipients see install banner when viewing shared reels in browser
- [ ] Service worker caches static assets, NOT API calls
- [ ] iOS users see "Add to Home Screen" instructions
