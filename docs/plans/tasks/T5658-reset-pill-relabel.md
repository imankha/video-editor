# T5658 — "Back to spotlight" pill → "Reset" (icon + reset-to-0 behavior)

**Tier:** S/M · Frontend. **Model:** Sonnet.

## Request (from the user)
The "Back to spotlight" pill should say **"Reset"** with a **reset icon**, and its action should
**reset to 0** — because the spotlight location isn't guaranteed, so jumping "back to the spotlight"
is unreliable; resetting to the start (time 0) is the dependable behavior.

## Current state
`src/frontend/src/modes/OverlayModeView.jsx:337–346` — `backToSpotlightPill` renders when
`isPastSpotlight` (playhead ran past the spotlight span):
```jsx
<button onClick={(e) => { e.stopPropagation(); onReturnToSpotlight?.(); }} ... aria-label="Back to spotlight">
  <span aria-hidden="true">&#10554;</span> Back to spotlight
</button>
```
`onReturnToSpotlight` (trace it to `OverlayContainer.jsx`) currently seeks back to the spotlight
span and loops it.

## Fix (own `src/frontend/src/modes/OverlayModeView.jsx`; touch `OverlayContainer.jsx` ONLY if the
seek-to-0 handler must be wired there)
1. Relabel the pill: text **"Reset"**, `aria-label="Reset"`, `title` updated (e.g. "Reset to the
   start").
2. Replace the `&#10554;` glyph with a **reset icon** — use the lucide `RotateCcw` icon
   (already used elsewhere, e.g. PlaybackControls' restart) at a size matching the pill.
3. Change the action to **seek the playhead to time 0** (reset to start) instead of returning to
   the spotlight span. Reuse the existing seek-to-start / restart mechanism the overlay video
   controls already use (find the seek(0) / restart handler; do NOT invent a new persistence path
   — this is a view/playback action). If `onReturnToSpotlight` is only used here, you may repoint it
   to seek-0; otherwise wire a new `onResetToStart`/seek(0) handler and pass it in.
4. Keep the existing show trigger (`isPastSpotlight`) unless it reads wrong once relabeled — if it
   does, note it; don't over-scope.

## Acceptance criteria
- The pill reads "Reset" with a reset (RotateCcw) icon.
- Tapping it seeks the playhead to time 0 (start), reliably, regardless of the spotlight position.
- No regression to when the pill appears; touch target stays ≥44px (min-h-11).

## QA (mandatory)
- Component/render test: pill shows "Reset" + the reset icon; onClick invokes the seek-to-0 handler.
- Live-drive if possible (`loginAsRealUser('imankh@gmail.com','9fa7378c')`); no backend in container
  → give a precise manual staging test. `saveEvidence` per criterion; `responsiveSweep`. Map every
  acceptance criterion to evidence.
Own ONLY `OverlayModeView.jsx` (+ `OverlayContainer.jsx` if strictly needed for the handler) + tests.
Explicit `git add`. **Commit + report — do NOT push.**
