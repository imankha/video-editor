# T5645 — Recap fullscreen button doesn't exit fullscreen on mobile

**Tier:** S/M · Frontend (recap player). **Model:** Sonnet.
**Verify on real mobile** (fullscreen API behaves differently on mobile Safari/Chrome; the
button is not even visible on desktop, so desktop testing won't catch it).

## Symptom (from the user)
When the recap is put into **fullscreen** on mobile, tapping the fullscreen button **again does
not exit** fullscreen. (Not visible on desktop, which is fine — mobile-only concern.)

## Files (own these; isolated from sibling tasks — do NOT touch VideoPlayer.jsx if avoidable;
that's T5642's. If the fullscreen control lives in shared/VideoControls.jsx and you must edit it,
keep the change strictly to the fullscreen-toggle handler.)
- `src/components/RecapPlayerModal.jsx` — the recap player modal.
- `src/components/recap/useRecapPlayback.js` — recap playback hook (may own the fullscreen state).
- `src/components/shared/VideoControls.jsx` — if the fullscreen button is the shared control.

## Investigate
- The toggle likely calls `element.requestFullscreen()` to enter but the exit path
  (`document.exitFullscreen()`) is missing/guarded wrong, OR it tracks its own `isFullscreen`
  boolean that desyncs from the actual `document.fullscreenElement`.
- Mobile specifics: iOS Safari uses `webkitRequestFullscreen` / `webkitExitFullscreen` on the
  VIDEO element (not the container) and fires `webkitbeginfullscreen`/`webkitendfullscreen`; some
  mobile browsers don't support element fullscreen at all and use the native video fullscreen.
  Check the toggle handles the vendor-prefixed exit + reads `document.fullscreenElement ||
  document.webkitFullscreenElement` for current state instead of a stale local boolean.
- Prefer driving state from the browser's `fullscreenchange` (+ webkit) event, not a local flag.

## Acceptance criteria
- On mobile, tapping the fullscreen button while fullscreen **exits** fullscreen reliably.
- Entering fullscreen still works.
- Desktop unaffected (button hidden there anyway).
- Recap playback otherwise unchanged.

## QA (mandatory, REAL MOBILE)
Verify on a real mobile browser (or a device): enter fullscreen on the recap, tap the button
again, confirm it exits. If in-harness touch/fullscreen can't be fully emulated, say so and give
the user a precise manual test script. Map evidence to each acceptance criterion.
