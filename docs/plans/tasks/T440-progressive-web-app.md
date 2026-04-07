# T440: Progressive Web App (PWA)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-06
**Updated:** 2026-04-06

## Problem

Users who discover the app via a business card QR code or the landing page have no way to "install" it as a native-feeling app on their phone or desktop. They're stuck using it in a browser tab that can get lost. A PWA install makes the app feel permanent — home screen icon, no browser chrome, splash screen on launch.

## Solution

Three pieces:

1. **PWA install** — Make app.reelballers.com installable using `vite-plugin-pwa` (manifest, service worker, install prompt).
2. **Landing page email capture** — Primary CTA captures email and sends a welcome email with a link to the app. This bridges the phone-at-game → desktop-at-home gap.
3. **Landing page secondary CTA** — "Try it now" link for users already on desktop.

## Architecture

### Two-origin strategy

The landing page (reelballers.com) and the app (app.reelballers.com) are different origins. A PWA can only be installed from its own origin. So:

- **app.reelballers.com** — the actual PWA. Has manifest, service worker, install prompt.
- **reelballers.com** — landing page with email capture + secondary "Try it now" link.
- When the app detects `?install=1` in the URL, it shows an install banner/prompt after load.

### Business card flow (the critical path)

Most users discover the app at a game on their phone, but need to use it on desktop later:

```
QR code on card (at game, on phone)
  → reelballers.com (landing page — demo video, features)
  → Primary CTA: "Send me the link" (enter email)
  → Confirmation: "Check your inbox!"

Later that evening (on desktop)
  → Open email → click "Open Reel Ballers" button
  → app.reelballers.com → start using the app
  → Browser offers PWA install (standalone icon)
```

### Desktop visitor flow (secondary)

```
User types reelballers.com on desktop (from card URL text)
  → Landing page detects desktop viewport
  → Secondary CTA visible: "Try it now →"
  → app.reelballers.com?install=1
  → App loads, shows install banner
```

### Email capture → welcome email flow

```
Landing page                    Cloudflare Pages Function
┌──────────────┐                ┌──────────────────────┐
│ Email input  │ ── POST ────→  │ /api/signup           │
│ "Send me     │                │  1. Validate email    │
│  the link"   │                │  2. Store in D1       │
│              │                │  3. Send welcome via  │
└──────────────┘                │     Resend API        │
                                └──────────────────────┘
                                           │
                                           ▼
                                ┌──────────────────────┐
                                │ Welcome email         │
                                │  - Hero image/logo    │
                                │  - 3 value props      │
                                │  - "Open Reel Ballers" │
                                │    CTA button         │
                                └──────────────────────┘
```

## Context

### Relevant Files

**App (app.reelballers.com):**
- `src/frontend/vite.config.js` — Add vite-plugin-pwa config
- `src/frontend/index.html` — Add theme-color meta tag, apple-touch-icon link
- `src/frontend/public/favicon.svg` — Source for generating PNG icons
- `src/frontend/public/` — New: manifest icons (icon-192.png, icon-512.png, apple-touch-icon.png)
- `src/frontend/src/App.jsx` — Render install prompt component
- `src/frontend/src/components/InstallPrompt.jsx` — NEW: PWA install banner

**Landing page (reelballers.com) — src/landing/:**
- `src/landing/src/App.tsx` — Add email capture form (primary CTA) + "Try it now" link (secondary CTA)
- `src/landing/index.html` — Add theme-color meta tag for consistency
- `src/landing/functions/api/signup.ts` — MODIFY: Add Resend welcome email after storing signup in D1
- `src/landing/wrangler.toml` — Add RESEND_API_KEY secret binding
- `src/landing/package.json` — No new dependencies (Resend is HTTP-only, uses native fetch)

**Landing page deployment:**
- Build: `cd src/landing && npm run build` (outputs to `src/landing/dist/`)
- Deploy: `cd src/landing && npm run deploy` (runs `wrangler pages deploy dist`)
- CI/CD: GitHub Actions auto-deploys on push to `master` when `src/landing/**` files change (`.github/workflows/deploy-landing.yml`)
- Requires env vars: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- Requires secret: `RESEND_API_KEY` (set via `wrangler pages secret put RESEND_API_KEY`)

### Related Tasks
- Related: T401 (Email OTP — shares Resend as email provider)
- Related: T435 (Google One Tap — both improve conversion from landing to active user)
- Related: T445 (Business cards — QR code points to landing page)

### Technical Notes

**vite-plugin-pwa handles:**
- Generating `manifest.webmanifest` from config
- Creating and registering a service worker (Workbox under the hood)
- Injecting manifest link into index.html
- Service worker update prompts

**manifest.webmanifest config:**
```json
{
  "name": "Reel Ballers",
  "short_name": "ReelBallers",
  "description": "AI-Powered Sports Video Editor",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#111827",
  "theme_color": "#7c3aed",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- `background_color: #111827` — matches `bg-gray-900` used throughout the app
- `theme_color: #7c3aed` — purple-600, matches the app's accent color
- `display: standalone` — removes browser chrome (URL bar, tabs)

**Service worker strategy:**
- **Static assets (JS/CSS/fonts):** Cache-first (Workbox precaching via vite-plugin-pwa)
- **API calls (/api/*):** Network-only (no caching — app requires live backend)
- **Navigation:** Network-first with offline fallback page
- Keep it simple — no offline functionality. The service worker is purely for installability and faster asset loading on repeat visits.

**vite-plugin-pwa config in vite.config.js:**
```js
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: { /* see above */ },
      workbox: {
        // Only precache JS/CSS bundles, not video files
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Don't cache API routes
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/storage/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/lh3\.googleusercontent\.com/,
            handler: 'CacheFirst',
            options: { cacheName: 'google-avatars', expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 } }
          }
        ]
      }
    })
  ]
})
```

**Install prompt component (`InstallPrompt.jsx`):**
- Intercepts the `beforeinstallprompt` event (Chrome/Edge/Android)
- Stores the event in state
- Shows a dismissible banner: "Install Reel Ballers for the best experience" + Install button
- On click: calls `event.prompt()` to trigger the native install dialog
- On iOS Safari: shows instructions ("Tap Share → Add to Home Screen") since iOS has no `beforeinstallprompt`
- If URL contains `?install=1` (from landing page CTA): auto-show the banner on load
- Otherwise: show after a short delay or on second visit (avoid being pushy)
- User dismiss: store in sessionStorage, don't show again this session

**iOS detection:**
```js
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isInStandaloneMode = window.matchMedia('(display-mode: standalone)').matches;
```

**Icon generation:**
- Source: `src/frontend/public/favicon.svg` (48x48 film reel + play button)
- Generate via sharp, ImageMagick, or an online tool:
  - `icon-192.png` (192x192) — home screen icon
  - `icon-512.png` (512x512) — splash screen, store listing
  - `apple-touch-icon.png` (180x180) — iOS home screen
- SVG scales cleanly since it's vector — no quality loss

**index.html additions:**
```html
<meta name="theme-color" content="#7c3aed" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

**Landing page CTAs (src/landing/src/App.tsx):**

The landing page currently has NO call-to-action at all. Add two:

*Primary CTA — email capture (for mobile users at games):*
- Position: hero section, after subtitle "Higher quality highlights in minutes", before demo video
- Layout: email input field + submit button, inline on desktop, stacked on mobile
- Input placeholder: "your@email.com"
- Button text: "Send me the link"
- On submit: POST `/api/signup` → show confirmation message
- Confirmation: replace form with "Check your inbox! We sent you a link to get started."
- Error handling: "Already signed up? Check your inbox for our previous email." (409), generic error for others
- No name field — just email. Reduce friction to one field. (Update signup.ts to make name optional.)

*Secondary CTA — direct app link (for desktop users):*
- Position: below the email form, smaller/muted styling
- Text: "Already on your computer? Try it now →"
- Links to: `https://app.reelballers.com`
- Style: text link, not a button — secondary to email capture

**Welcome email design (sent via Resend from signup.ts):**

Research shows welcome emails get 83% open rates — highest of any email type. Single CTA, mobile-first, scannable layout converts best.

```
From: Reel Ballers <hello@reelballers.com>
Subject: Your link to Reel Ballers

┌─────────────────────────────────────────────┐
│                                             │
│           [Logo] Reel Ballers               │
│                                             │
│   ─────────────────────────────────────     │
│                                             │
│   You're in! Here's your link to start      │
│   creating highlight reels.                 │
│                                             │
│   ┌───────────────────────────────────┐     │
│   │     Open Reel Ballers →           │     │
│   └───────────────────────────────────┘     │
│                                             │
│   ─────────────────────────────────────     │
│                                             │
│   What you can do:                          │
│                                             │
│   ✓ Upload your game footage                │
│   ✓ AI follows your player across the field │
│   ✓ Export social-ready highlights           │
│                                             │
│   ─────────────────────────────────────     │
│                                             │
│   ┌───────────────────────────────────┐     │
│   │     Open Reel Ballers →           │     │
│   └───────────────────────────────────┘     │
│                                             │
│   Open on your computer for the best        │
│   experience.                               │
│                                             │
└─────────────────────────────────────────────┘
```

Design principles (from research):
- **Single CTA** repeated twice: once above the fold, once at bottom (32% higher click-through than text links)
- **3 value props** with checkmarks — scannable, reminds them why they signed up
- **"Open on your computer"** hint — nudges desktop usage without being pushy
- **CTA button**: `https://app.reelballers.com?ref=welcome` (track welcome email conversions)
- **No images required** — HTML/CSS email works in all clients, no image-blocking issues
- **Mobile-friendly** — single column, large tap target on CTA button
- Keep total email under 200 words — respect their time

**Resend integration in signup.ts:**
```typescript
// After storing signup in D1, send welcome email
const resendResponse = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${env.RESEND_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from: 'Reel Ballers <hello@reelballers.com>',
    to: [email],
    subject: 'Your link to Reel Ballers',
    html: welcomeEmailHtml,  // Inline HTML template
  }),
});
```

- `RESEND_API_KEY` stored as Cloudflare Pages secret (not in code)
- `from` address requires verified domain in Resend dashboard (reelballers.com)
- Set up SPF/DKIM records for reelballers.com in Cloudflare DNS (Resend provides the values)
- For 409 (duplicate signup): re-send the welcome email instead of rejecting — they might have lost it

## Implementation

### Steps

**App PWA setup:**
1. [ ] Install `vite-plugin-pwa` dependency
2. [ ] Generate icon PNGs from favicon.svg (192, 512, apple-touch-icon 180)
3. [ ] Add icons to `src/frontend/public/`
4. [ ] Configure vite-plugin-pwa in `vite.config.js`
5. [ ] Add `theme-color` meta and `apple-touch-icon` link to `index.html`
6. [ ] Create `InstallPrompt.jsx` component (beforeinstallprompt + iOS fallback)
7. [ ] Render InstallPrompt in App.jsx
8. [ ] Handle `?install=1` query param to auto-show install banner

**Landing page — email capture + CTAs:**
9. [ ] Add email capture form in hero section of `src/landing/src/App.tsx` (input + "Send me the link" button)
10. [ ] Add secondary "Already on your computer? Try it now →" text link below form
11. [ ] Update `src/landing/functions/api/signup.ts`: make name optional, add Resend welcome email
12. [ ] Create inline HTML welcome email template (logo, 3 value props, CTA button to app.reelballers.com)
13. [ ] Handle 409 (duplicate) by re-sending the welcome email instead of rejecting
14. [ ] Add theme-color meta tag to `src/landing/index.html`
15. [ ] Set up Resend: verify reelballers.com domain, add SPF/DKIM DNS records in Cloudflare
16. [ ] Store RESEND_API_KEY as Cloudflare Pages secret: `wrangler pages secret put RESEND_API_KEY`
17. [ ] Build and deploy landing page: `cd src/landing && npm run build && npm run deploy`

**Testing:**
18. [ ] Verify manifest loads correctly (Chrome DevTools → Application → Manifest)
19. [ ] Verify service worker registers (Application → Service Workers)
20. [ ] Test install flow on Android Chrome
21. [ ] Test iOS Safari "Add to Home Screen" instructions
22. [ ] Test desktop Chrome/Edge install
23. [ ] Verify installed app launches in standalone mode (no browser chrome)
24. [ ] Verify API calls still work in standalone mode (cookies, CORS)
25. [ ] Test email capture: submit email → receive welcome email within 30 seconds
26. [ ] Test welcome email: CTA button links to app.reelballers.com
27. [ ] Test duplicate email: re-sends welcome email, shows friendly message
28. [ ] Test email renders correctly in Gmail, Apple Mail, Outlook (mobile + desktop)

## Acceptance Criteria

**PWA:**
- [ ] app.reelballers.com passes Chrome Lighthouse PWA audit
- [ ] App is installable on Android (Chrome install prompt)
- [ ] App is installable on iOS (instructions shown for Add to Home Screen)
- [ ] App is installable on desktop Chrome/Edge
- [ ] Installed app opens in standalone mode (no URL bar)
- [ ] Splash screen shows app icon and name on launch
- [ ] Install banner appears when arriving with `?install=1` param
- [ ] Install banner is dismissible and doesn't reappear in same session
- [ ] Service worker caches static assets but does NOT cache API calls
- [ ] App icons render correctly at all sizes (home screen, task switcher, splash)

**Landing page:**
- [ ] Email capture form visible in hero section (primary CTA)
- [ ] "Try it now" link visible for desktop visitors (secondary CTA)
- [ ] Submitting email sends a welcome email via Resend within 30 seconds
- [ ] Welcome email contains "Open Reel Ballers" CTA button linking to app
- [ ] Welcome email renders correctly on mobile and desktop email clients
- [ ] Duplicate email submissions re-send the welcome email gracefully
- [ ] SPF/DKIM configured so emails don't land in spam
- [ ] Confirmation message shown after form submit ("Check your inbox!")
