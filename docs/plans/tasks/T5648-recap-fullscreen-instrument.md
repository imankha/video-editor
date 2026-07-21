# T5648 — Recap fullscreen exit still broken on Android Chrome: INSTRUMENT to capture the cause

**Tier:** S/M · Frontend. **Model:** Sonnet.
**Context:** T5645 added a webkit-aware `toggleFullscreen` + event-driven `isFullscreen`, and the
button wiring is correct (recap's `PlaybackControls` Minimize button → `onToggleFullscreen` →
`toggleFullscreen`, `annotate/components/PlaybackControls.jsx:285–292`). Yet on **Android Chrome**
(fully refreshed), entering fullscreen works but tapping the app's minimize icon does NOT exit.
The cause is NOT reproducible in any emulator. So the goal here is **instrumentation first** (like
the video-error beacon that cracked the overlay 401), plus a best-effort robustness pass.

## Do (own ONLY `src/frontend/src/components/RecapPlayerModal.jsx`)
Instrument `toggleFullscreen` (RecapPlayerModal.jsx ~L114) and the fullscreenchange handler
(~L101) so a real-device tap + `/logdump` reveals exactly what happens. Use `console.warn` with a
clear, greppable prefix so it lands in `clientLogger` (the ring buffer behind "Report a problem" /
`/logdump`). Log, on EACH toggle tap:
- a `[RECAP_FS]` line with: `isFullscreen` state, `document.fullscreenElement` present?,
  `document.webkitFullscreenElement` present?, and which branch it takes (enter vs exit).
- On ENTER: whether `requestFullscreen`/`webkitRequestFullscreen` exists on `contentRef.current`;
  wrap the call so a rejected promise is caught and logged (`.catch`/try) — `requestFullscreen()`
  returns a promise that can reject silently.
- On EXIT: whether `exitFullscreen`/`webkitExitFullscreen` exists on `document`; wrap so a rejected
  promise is caught and logged.
- In the fullscreenchange handler: log the new `!!getFullscreenElement()` value each time it fires.

Best-effort robustness (apply, but keep it minimal and safe): make the enter/exit decision robust
to a browser that reports `document.fullscreenElement === null` while visually fullscreen — e.g.
fall back to the `isFullscreen` STATE to decide exit-vs-enter when `getFullscreenElement()` is null
but state says fullscreen, and call BOTH `exitFullscreen()` and `webkitExitFullscreen()` if
present. Do NOT reintroduce a stale local flag as the source of truth — the event handler stays
authoritative; the state is only a fallback for the decision.

## Acceptance criteria
- A real-device tap produces `[RECAP_FS]` diagnostic lines capturing fullscreenElement state, the
  chosen branch, and any request/exit promise rejection — enough to root-cause on the next
  `/logdump`.
- No 500s / no thrown errors from the toggle (promises caught).
- Entering fullscreen still works; desktop unaffected.
- (If the robustness fallback happens to fix exit, great — but the PRIMARY deliverable is the
  diagnostic capture.)

## QA
Unit-test the toggle's branch selection + that promise rejections are caught (jsdom, simulate
fullscreenElement present/absent and request/exit methods present/absent). Verify in Chromium
emulation that the `[RECAP_FS]` logs fire on toggle. State the honest caveat: the actual Android
Chrome exit bug can't be reproduced in-harness — the logging is what surfaces it. Give the user a
1-line instruction: "reproduce on your phone, then `/logdump`." Map criteria to evidence.
Explicit `git add`.
