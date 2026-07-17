# T5370: Spotlight loop playback — primary "Play spotlight" loops the region, de-emphasized "Play full"

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-17
**Updated:** 2026-07-17

## Problem

User report 2026-07-17 (imankh): while adding a spotlight in Overlay mode, users lose their
place when the playhead runs past the spotlight section. The video keeps playing into
un-spotlit footage and there's no easy way back to the region they're working on. Editing a
spotlight is an inherently loop-y task (tweak the highlight, watch it, tweak again), but the
player only offers linear play-to-end.

## Solution

Make the **primary** play button loop the spotlight, add a **de-emphasized** secondary
button for full-clip play, and always give the user an obvious way back to the spotlight
start.

**Locked product decisions (user, 2026-07-17):**
1. **Loop scope = span of ALL regions.** When a clip has multiple spotlight regions, the
   loop window is one continuous span from the earliest region start to the latest region
   end: `[min(startTime), max(endTime)]`. (Not per-region, not selected-region-only.)
2. **Return-to-start = BOTH mechanisms.** (a) The primary loop button always seeks to the
   spotlight start when pressed, AND (b) a visible "Back to spotlight" affordance appears
   once the playhead has moved past the span.

### Behavior spec

Let `span = { start: min over regions of startTime, end: max over regions of endTime }`
(computed over ALL highlight regions; `null` when there are zero regions).

**Two play buttons (in the playback control bar):**

| Button | Emphasis | Action |
|---|---|---|
| **Play spotlight** (primary) | Emphasized — accent color + loop glyph on the existing primary Play/Pause | Sets play-mode `loop`. If the playhead is outside `[start, end)`, seek to `start` first, then play. While playing in `loop` mode, when the playhead reaches `end` it wraps back to `start` (continuous loop). |
| **Play full** (secondary) | De-emphasized — small ghost button beside the primary | Sets play-mode `full`. Plays from the current position straight through to the end of the clip, no wrapping. |

**Return-to-spotlight affordance (both):**
- The **primary** button inherently returns-and-loops (pressing it from anywhere seeks to
  `start`).
- A **"⤺ Back to spotlight"** pill appears (over the video, bottom area, or in the control
  bar) whenever `currentTime > span.end` (played/scrubbed past the span) — pressing it seeks
  to `span.start` and switches to `loop` mode. Hidden while inside/before the span.

**Zero regions:** `span === null` → no loop, no secondary button, no pill. The primary
button behaves exactly like today's plain Play/Pause. (Nothing to loop yet.)

### Play-mode is ephemeral view state — NEVER persisted

`spotlightPlayMode` (`'loop' | 'full'`, default `'loop'`) is transient UI state. It is NOT
written to the store or backend and NOT restored on load (per the no-persisted-view-state
rule — a stale saved play-mode would read as a broken player). Reset to `'loop'` whenever
the overlay clip changes.

**This is NOT a persistence-rule violation.** The loop is enforced by a reactive effect that
calls `seek()` — but `seek()` is ephemeral *playback* control, not a DB/store *persistence*
write. The banned pattern is `useEffect` → API/store write of editing state (T350 class).
Watching `currentTime` to wrap playback touches no persistent data. Call this out for the
reviewer explicitly.

## Design

### Architecture (MVC)

```
OverlayScreen (owns useVideo instance: currentTime, isPlaying, seek, togglePlay, pause)
  └── OverlayContainer  ── computes spotlightSpan, owns spotlightPlayMode, exposes handlers +
      │                     runs the loop-enforcement effect (has currentTime/isPlaying/seek)
      └── OverlayModeView (VIEW) ── renders <Controls> with primary=spotlight, secondary=full,
                                     isLooping badge; renders the "Back to spotlight" pill
```

### 1. Span + play-mode state (OverlayContainer)

```js
// OverlayContainer.jsx
const [spotlightPlayMode, setSpotlightPlayMode] = useState('loop'); // ephemeral, never persisted

const spotlightSpan = useMemo(() => {
  if (!highlightRegions?.length) return null;
  const start = Math.min(...highlightRegions.map(r => r.startTime));
  const end   = Math.max(...highlightRegions.map(r => r.endTime));
  return { start, end };
}, [highlightRegions]);

// Reset play-mode when the overlay clip changes (new video URL).
useEffect(() => { setSpotlightPlayMode('loop'); }, [effectiveOverlayVideoUrl]);
```

`highlightRegions` already carries `{ startTime, endTime, enabled }` (see
`useHighlightRegions`) and is in scope in OverlayContainer. Span uses ALL regions per the
locked decision.

### 2. Loop enforcement (extract to `useSpotlightLoop` hook for testability)

```js
// src/frontend/src/modes/overlay/hooks/useSpotlightLoop.js
const LOOP_EPS = 0.03; // ~1 frame at 30fps; wrap just before the exact end
export function useSpotlightLoop({ playMode, span, currentTime, isPlaying, isSeeking, seek }) {
  useEffect(() => {
    if (playMode !== 'loop' || !span || !isPlaying || isSeeking) return;
    if (currentTime >= span.end - LOOP_EPS) {
      seek(span.start);           // wrap to the spotlight start
    }
  }, [playMode, span, currentTime, isPlaying, isSeeking, seek]);
}
```

Called from OverlayContainer with its existing `currentTime`/`isPlaying`/`seek` props.
(`useVideo` already skips RAF time-updates during `isSeeking`, so the wrap seek is clean.)
**Do NOT add loop logic to `useVideo`** — it is shared by Annotate/Framing and must stay
mode-agnostic. The seam is the overlay hook, not the shared player.

### 3. Handlers (OverlayContainer)

```js
const isPastSpotlight = !!spotlightSpan && currentTime > spotlightSpan.end + LOOP_EPS;

const handlePlaySpotlight = useCallback(() => {
  if (!spotlightSpan) { togglePlay(); return; }        // no regions → plain play
  setSpotlightPlayMode('loop');
  const outside = currentTime < spotlightSpan.start || currentTime >= spotlightSpan.end;
  if (outside) seek(spotlightSpan.start);
  // play if paused; if already playing in loop, pressing returns-to-start (seek above) and keeps playing
  if (videoRef.current?.paused) togglePlay();
}, [spotlightSpan, currentTime, seek, togglePlay, videoRef]);

const handlePlayFull = useCallback(() => {
  setSpotlightPlayMode('full');
  if (videoRef.current?.paused) togglePlay();
}, [togglePlay, videoRef]);

const handleReturnToSpotlight = useCallback(() => {
  if (!spotlightSpan) return;
  setSpotlightPlayMode('loop');
  seek(spotlightSpan.start);
}, [spotlightSpan, seek]);
```

Expose from the container return object: `spotlightSpan`, `spotlightPlayMode`,
`isPastSpotlight`, `handlePlaySpotlight`, `handlePlayFull`, `handleReturnToSpotlight`.
`togglePlay`/`videoRef`/`pause` must be threaded into OverlayContainer (currently it
receives `seek`, `currentTime`, `duration`, `isPlaying`, `videoRef` — add `togglePlay`).

### 4. `Controls` extension (shared component — keep other modes byte-identical)

`Controls` is shared by Annotate/Framing/Overlay, so extend it with OPTIONAL props only;
modes that don't pass them render exactly as today.

```jsx
// Controls.jsx — new optional props: isLooping, secondaryPlay
// Primary Play/Pause button: when isLooping, add a small loop glyph / accent so the user
// sees "this loops". Existing onTogglePlay stays the primary action.
// secondaryPlay = { onClick, title, active } → renders a de-emphasized ghost button
// (size="sm", variant="ghost") next to the primary, only when provided.
```

Icons (lucide-react, already used): primary loop badge → `Repeat`; secondary full-play →
`FastForward` or `PlayCircle` (pick in the UI pass). De-emphasis = `variant="ghost"` +
smaller, per the button style guide.

### 5. OverlayModeView wiring (VIEW)

- Pass to BOTH `<Controls>` instances (desktop bar + mobile-fullscreen bar):
  `onTogglePlay={handlePlaySpotlight}`, `isLooping={spotlightPlayMode === 'loop' && !!spotlightSpan}`,
  `secondaryPlay={spotlightSpan ? { onClick: handlePlayFull, title: 'Play full clip', active: spotlightPlayMode === 'full' } : undefined}`.
- Render the **"⤺ Back to spotlight"** pill when `isPastSpotlight` — a small centered button
  over the lower video area (mirror the existing mobile-expand button styling in
  `OverlayModeView.jsx:437-446`), `onClick={handleReturnToSpotlight}`. Reachable + ≥44px
  touch target (coordinate with T5360).

Both play buttons and the pill flow to mobile automatically because the mobile-fullscreen
branch reuses the same `<Controls>`.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/overlay/hooks/useSpotlightLoop.js` — NEW loop-enforcement hook
- `src/frontend/src/containers/OverlayContainer.jsx` — span, play-mode, handlers, hook call;
  accept `togglePlay` prop
- `src/frontend/src/screens/OverlayScreen.jsx` — thread `togglePlay` into the container;
  pass new derived state/handlers to the view
- `src/frontend/src/modes/OverlayModeView.jsx` — wire `Controls` (primary/secondary/loop) +
  render the "Back to spotlight" pill (both desktop and mobile-fullscreen branches)
- `src/frontend/src/components/Controls.jsx` — optional `isLooping` + `secondaryPlay` props
- `src/frontend/src/hooks/useVideo.js` — READ ONLY; confirm `isSeeking` gating; do NOT add
  loop logic here
- Tests: `useSpotlightLoop` unit test + an overlay E2E driving loop/full/return

### Related Tasks
- **T5360** (touch targets): the two play buttons + pill must meet the 44px floor — same
  mobile surface. Sequence-independent but verify together on tablet.
- Overlay domain: `keyframes-framing.md` (highlight regions), `export-pipeline.md`.

### Technical Notes
- `highlightRegions` is the single source for the span — no new state duplicates it (compute
  via `useMemo`, per no-redundant-state).
- Span uses ALL regions (locked). If a stray disabled region far from the others skews the
  span, that's the accepted trade for the simple "one continuous window" model; revisit only
  if users complain.
- No backend, no schema, no persistence, no store writes. Pure frontend playback UX.
- Keep `useVideo` mode-agnostic; the overlay hook is the only new playback behavior.

## Implementation

### Steps
1. [ ] `git checkout -b feature/T5370-spotlight-loop-playback`
2. [ ] Add `useSpotlightLoop` hook (+ unit test: wraps at end in loop mode; no-op in full
       mode / when paused / seeking / span null)
3. [ ] OverlayContainer: `spotlightSpan`, `spotlightPlayMode` (+ reset effect),
       `isPastSpotlight`, handlers, call `useSpotlightLoop`; accept `togglePlay`
4. [ ] OverlayScreen: thread `togglePlay` in; pass new fields to the view
5. [ ] Controls.jsx: optional `isLooping` badge + `secondaryPlay` ghost button
6. [ ] OverlayModeView: wire both `Controls` instances + render "Back to spotlight" pill
7. [ ] Drive the real app (drive-app-as-user) on an overlay clip with 1 and 2 regions:
       loop wraps, full plays past, pill appears past the span and returns; verify on an
       emulated tablet viewport
8. [ ] eslint clean; frontend unit + targeted E2E green; commit with co-author line

## Acceptance Criteria

- [ ] Primary "Play spotlight" loops `[min(startTime), max(endTime)]` continuously; pressing
      it from outside the span seeks to the span start first.
- [ ] Secondary "Play full" is visibly de-emphasized and plays through to the clip end with
      no wrapping.
- [ ] Multiple regions loop as ONE span (earliest start → latest end).
- [ ] "Back to spotlight" pill appears only when the playhead is past the span and returns to
      the span start (and re-enters loop mode).
- [ ] Zero regions: primary button behaves as plain Play/Pause; no secondary, no pill.
- [ ] Play-mode is not persisted or restored (ephemeral view state); resets to loop on clip
      change.
- [ ] `useVideo` unchanged in behavior for Annotate/Framing (no loop logic added there);
      `Controls` byte-identical when the new optional props aren't passed.
- [ ] Works on desktop + mobile-fullscreen (same `Controls`); buttons/pill are ≥44px touch
      targets (with T5360).

## Progress Log

**2026-07-17**: Created from a user report that the playhead runs past the spotlight during
overlay editing. Investigated overlay playback: `useVideo` RAF loop clamps at `clipDuration`
(`useVideo.js:772-780`); highlight regions carry `{startTime,endTime,enabled}`; `Controls`
is shared across modes. Product decisions locked with user: loop the SPAN of all regions;
provide BOTH a return-and-loop primary button and a "Back to spotlight" pill. Designed as an
overlay-local `useSpotlightLoop` hook + ephemeral play-mode + optional `Controls` props so
the shared player and other modes stay untouched. Frontend-only, M-tier, no persistence.
