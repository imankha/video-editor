# T4900: Add Spotlight ignores user-added highlight keyframes beyond the auto-added ones

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-11
**Updated:** 2026-07-11

## Problem

Customer report (2026-07-11), phrased as a feature request but describing **intended existing functionality** — i.e., this is a bug, not a feature gap:

> "I extended the spotlight segment, added keyframes and adjusted the spotlight to the right position along the video and had it all set up, but when I clicked the Add Spotlight button it ignored the extra keyframes and spotlights I added and just stuck with the original 4 auto-added clickable ones you get at the beginning. Would be nice for downfield plays … sometimes it's hard to track as the player gets smaller moving away from the camera."

Expected: the rendered overlay honors the user's full highlight keyframe set (auto-detected + manually added/adjusted, including any segment extension). Actual: the render used only the original ~4 auto-added detection keyframes; the user's manual keyframes and adjustments were silently discarded. Silent loss of user editing work in a core flow.

## Solution

Investigate where the user's edited highlight keyframes diverge from what the Add Spotlight (overlay export) render consumes, then fix that single write/read path. Candidate failure modes, in likelihood order:

1. **Persistence gap** — manual highlight-keyframe additions/adjustments (or the segment extension) never reach the backend as surgical gesture actions, so the DB still holds only the auto-added detection keyframes, and the export renders from DB state. Check each gesture (add keyframe, drag spotlight, extend segment end) fires its action and that the action lands.
2. **Export snapshot source** — the overlay export reads a stale or different source (e.g., the auto-detection result / player-track data) instead of the current highlight keyframe list.
3. **Segment-extension clipping** — keyframes past the original auto segment boundary exist but are filtered out at render because the render still uses the original segment range.

Fix the root cause; do NOT add defensive re-sync/fallback layers (see CLAUDE.md: gesture-based persistence, single write path per data).

## Context

### Relevant Files (REQUIRED)
(Entry points; Code Expert should confirm the exact path)
- `src/frontend/src/screens/OverlayScreen.jsx` — overlay editing + Add Spotlight flow
- `src/frontend/src/components/ExportButtonView.jsx` — Add Spotlight button (presentational; find the `onExport` owner)
- Highlight keyframe hook/state (per [keyframes-framing.md](../../.claude/knowledge/keyframes-framing.md)) — where auto-detected vs manual keyframes merge
- `src/backend/app/routers/export/overlay.py` — server-side overlay render: what keyframe data it reads
- Backend gesture-action endpoints for highlight keyframes

### Related Tasks
- Related history: keyframe identity divergence fix (resolveTargetFrame, profile_db v014) — display-snapped vs persisted frames previously diverged; verify manual highlight keyframes go through the same resolved-frame path.
- The reporter also hit T4880 (mobile: Add Spotlight unreachable) — different issue, same button.

### Technical Notes
- Knowledge doc: [keyframes-framing.md](../../.claude/knowledge/keyframes-framing.md) — load before exploring.
- Crop keyframes are a flat list with no permanent boundaries; confirm whether highlight keyframes follow the same model and whether the auto-detection flow ("N players detected" → clickable proposed spotlights) writes through the same path as manual adds.
- Repro recipe (from report): run auto-detection on a clip → accept a player (4 auto keyframes) → extend the spotlight segment → add manual keyframes past the original range and adjust positions → Add Spotlight → inspect what the render request/DB actually contained.

## Implementation

### Steps
1. [ ] Reproduce; capture what the export request/DB holds at click time vs what the UI shows
2. [ ] Identify the divergence point (persistence gap vs wrong read source vs range clipping)
3. [ ] Fix root cause
4. [ ] Regression test: manual keyframes + extended segment survive to the rendered overlay payload

### Progress Log

**2026-07-11**: Task created from customer report relayed by user.

## Acceptance Criteria

- [ ] Manually added highlight keyframes (including beyond the original auto segment, after extension) are honored by Add Spotlight rendering
- [ ] Adjusted positions of auto-added keyframes are honored
- [ ] No silent divergence remains between UI keyframe state and persisted/rendered state (verified by test)
- [ ] Tests pass
