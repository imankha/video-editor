# T5100: Compilation timeline: hover a reel segment for its name, click to jump + seek

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-13
**Updated:** 2026-07-13

## Problem

When watching a compilation (a collection/Mix of multiple reels played back-to-back), the top of the player shows a **segmented progress bar** — one line segment per reel ([CollectionPlayer.jsx:114-127](../../src/frontend/src/components/collections/CollectionPlayer.jsx#L114)). Those segments are today **purely visual** (progress fill only). User direction (2026-07-13):
1. **Hover a segment -> show that reel's name** (tooltip).
2. **Click a segment -> load that reel and seek to the position corresponding to where along the segment you clicked** (e.g., click 60% across reel 3's segment -> play reel 3 starting at ~60% of its duration).

This turns the progress bar into a real scrub/navigation strip so a viewer can jump around a long compilation instead of only stepping next/prev.

## Current State (investigation, 2026-07-13)

- **Player:** `CollectionPlayer.jsx` is a strictly-presentational "story" player. It does NOT play one concatenated video — each reel is its own `streamUrl` swapped into a single `<video>` and played sequentially via [useStoryPlayback.js](../../src/frontend/src/components/collections/useStoryPlayback.js).
- **Segments:** `reels.map` renders equal-width (`flex-1`) `h-1` bars; the active one fills to `segmentProgress`, earlier ones 100%, later ones 0%. No `onClick`, no hover, no `title`.
- **Reel data available per segment:** `{ id, name, streamUrl, aspect_ratio, duration|null, gameName, gameStartTime, project_id, clip_count }` — the header already renders `gameName` + `formatGameClock(gameStartTime)` with a fallback to `name`, so the tooltip can match that semantics.
- **Navigation API:** `useStoryPlayback` already exposes `goTo(i)` (jump to reel index) — but it is **not wired to any UI**, and it only switches reels; it does NOT seek within a reel. Progress is derived from the video element (`currentTime / duration`), robustly tolerating a NULL frozen `duration`.
- **Both consumers benefit:** `CollectionPlayer` is used by the author gallery (`DownloadsPanel`) AND the public share viewer (`SharedCollectionView`) — the change is in the shared component, so it lands in both.

## Solution

### 1. Click a segment -> jump + seek (extend `goTo`)
- Compute the click fraction within the segment from `getBoundingClientRect`: `frac = (clientX - segLeft) / segWidth`, clamped 0..1.
- Extend `useStoryPlayback.goTo(i, fraction?)`: set `activeIndex = i` and stash a **pending seek fraction**. Because switching reels calls `v.load()`, the target `duration` isn't known synchronously — apply the seek when the element reports `duration > 0` (on `loadedmetadata`, or guard inside the existing rAF tick): `v.currentTime = frac * v.duration`, then continue playback. If `i` is already active, seek immediately.
- Keep the existing progress derivation; the seek just sets `currentTime`, the tick reflects it.

### 2. Hover a segment -> reel name tooltip
- Add hover state per segment; render a small tooltip above the hovered segment showing the reel name (use the same `gameName` + game-clock / `name` fallback the header uses, for consistency).
- Desktop hover is the primary case; on touch there's no hover, so the tooltip is best-effort there — click-to-seek is the touch affordance. Tooltip is `pointer-events-none` and clipped to the viewport width.

### 3. Hit area (don't make thin bars hard to hit)
- The segments are `h-1` (4px) — too thin to click/hover reliably. Wrap each in a taller **transparent hit region** (e.g. vertical padding making a ~16-20px target) with `cursor-pointer`, keeping the visible bar 4px. (Same lesson as T4760's pick-hit-area: enlarge the target, not the visual.)
- The segmented bar sits ABOVE the `<video>` and its tap/swipe zones, so segment clicks don't conflict with the center/left/right tap navigation.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/collections/CollectionPlayer.jsx` — segmented bar (add hover tooltip + click handler + hit area); already has `reels` with names
- `src/frontend/src/components/collections/useStoryPlayback.js` — extend `goTo(i, fraction)` with a pending-seek applied once `duration` is known
- `src/frontend/src/components/collections/CollectionPlayer.test.jsx` — extend tests
- `src/frontend/src/utils/timeFormat.js` — `formatGameClock` (reuse for tooltip label)
- Consumers (no change expected, verify): `src/frontend/src/components/DownloadsPanel.jsx`, `src/frontend/src/components/SharedCollectionView.jsx`

### Related Tasks
- Builds on: T3610 (story player), T3620 (public viewer feeds presigned URLs), T3920 (game-name/clock header)
- Pattern: T4760 (pick-hit-area — enlarge click target without enlarging visual)

### Technical Notes
- M-tier, frontend-only, ~2-3 files, no backend/schema change. MVC: `useStoryPlayback` owns the seek logic (state/behavior), `CollectionPlayer` stays presentational (computes fraction from the DOM event, calls `goTo`).
- Seeking depends on the element's live `duration`, not the reel's frozen `duration` (which may be null) — consistent with the hook's existing design note.
- Keep autoplay-after-seek behavior; a blocked autoplay just pauses at the seeked frame until a gesture (existing `.catch(() => {})`).
- Accessibility: give each segment an accessible label (reel name) and pointer cursor; keyboard arrow nav already exists for stepping.

## Implementation

### Steps
1. [ ] Extend `useStoryPlayback.goTo(i, fraction)` + pending-seek applied on `loadedmetadata`/duration-known; immediate seek when already active
2. [ ] Wire segment `onClick` in CollectionPlayer to compute the within-segment fraction and call `goTo(i, frac)`
3. [ ] Add per-segment hover tooltip (reel name, header-consistent label) + transparent hit area + cursor
4. [ ] Verify both consumers (DownloadsPanel author view, SharedCollectionView public view)
5. [ ] Tests: click segment i at fraction f -> active index i and currentTime ~= f*duration; hover shows name; null frozen duration still seeks via element duration

### Progress Log

**2026-07-13**: Task created from user direction (screenshot: landscape compilation player, segmented bar at top, "My Reels"). Investigation: segments are non-interactive progress divs; `useStoryPlayback` already has `goTo(i)` (unwired) but no within-reel seek; each reel carries name/gameName; component is shared by author + public viewers.

## Acceptance Criteria

- [ ] Hovering a timeline segment shows that reel's name
- [ ] Clicking a segment loads that reel AND seeks to the position matching the horizontal click location within the segment
- [ ] Thin (4px) bars have an enlarged, easy-to-hit target; segment interaction doesn't interfere with the video tap/swipe zones
- [ ] Works in both the author gallery player and the public share viewer
- [ ] Seeking works even when a reel's frozen `duration` is null (uses the element's live duration)
- [ ] Tests pass
