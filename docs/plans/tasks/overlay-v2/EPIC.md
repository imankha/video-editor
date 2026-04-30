# Overlay System v2

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Move from a single "highlight ellipse" to a composable overlay system that produces vertical clips visually indistinguishable from professionally edited youth soccer content on TikTok/IG. Maintain the one-click-to-track UX that the YOLO + spline pipeline already enables.

## Non-goals

- General-purpose telestration (full whiteboard, multi-arrow tactical drawing) -- that's a Hudl/Veo coach-tool problem, not a parent/social problem
- Real-time overlays -- everything is post-process on already-uploaded clips
- Music or audio overlays

## User Stories

1. As a parent, I want to identify my kid with a name and number so anyone watching knows who to follow
2. As a parent, I want a goal/assist callout at the moment of the play so the clip tells a story without context
3. As a kid, I want my clip to look like the ones that go viral on TikTok -- pulse rings, color isolation, arrows
4. As a parent making a recruiting clip, I want to draw a simple arrow or circle on a still frame to point out a moment
5. As a parent, I want to set my kid's name + number once and reuse it across every reel I make this season

## Phasing

### Phase 1 (must-haves to be competitive)
Player label with profile, pulse ring, score bug, event badge, "Spotlight" and "Goal" presets, tracker re-acquisition.

| ID | Task | Status |
|----|------|--------|
| T2100 | [Composable Overlay Architecture](T2100-composable-overlay-architecture.md) | TODO |
| T2110 | [Player Profile Data Model](T2110-player-profile-data-model.md) | TODO |
| T2120 | [Pulse Ring Primitive](T2120-pulse-ring-primitive.md) | TODO |
| T2130 | [Player Label Overlay](T2130-player-label-overlay.md) | TODO |
| T2140 | [Screen-Anchored Event Overlays](T2140-screen-anchored-event-overlays.md) | TODO |
| T2150 | [Overlay Presets System](T2150-overlay-presets-system.md) | TODO |
| T2160 | [Tracker Re-acquisition & Gap Bridging](T2160-tracker-reacquisition.md) | TODO |

### Phase 2
Glow, arrow pointer, manual telestration, Recruiting and Social presets.

| ID | Task | Status |
|----|------|--------|
| T2170 | [Glow & Arrow Primitives](T2170-glow-arrow-primitives.md) | TODO |
| T2180 | [Manual Telestration](T2180-manual-telestration.md) | TODO |
| T2190 | [Extended Presets](T2190-extended-presets.md) | TODO |

### Phase 3
Outline trace, spotlight cone, multi-player tracking.

| ID | Task | Status |
|----|------|--------|
| T2200 | [Outline Trace Primitive](T2200-outline-trace-primitive.md) | TODO |
| T2210 | [Spotlight Cone Primitive](T2210-spotlight-cone-primitive.md) | TODO |
| T2220 | [Multi-Player Tracking](T2220-multi-player-tracking.md) | TODO |

## Feature Areas

### 1. Player Overlay Primitives
The current ellipse becomes one of several "player-attached" overlays. All inherit the existing tracking pipeline (YOLO selection -> spline animation -> manual keyframe override).

| Primitive | Use Case | Notes |
|-----------|----------|-------|
| Highlight ring (current) | Default identifier | Keep. Add color picker + opacity slider. |
| Pulse ring | Dramatic moments (goal, big save) | Animated scale + opacity loop, 1-2s duration |
| Glow / aura | Subtle continuous identification | Soft radial gradient under player |
| Arrow pointer | Wide shots where player is small | Floating arrow above player, follows tracker |
| Outline trace | Premium-feel; isolates silhouette | Edge-detect on player bbox, draw outline |
| Spotlight cone | High-drama moment | Darken/desaturate everything outside player region |

Each primitive shares a common config: color, opacity, size scaling, start/end keyframes, and follows the same tracker.

### 2. Player Label (attached to tracker)
A text tag that follows the player. Distinct from screen-anchored captions because it moves with the tracker.

- Fields: name, jersey number, position (optional)
- Auto-positions above or below player based on available frame space
- Two style presets: "minimal" (small white text) and "broadcast" (jersey-number badge with team color background)
- Player Profile: save name/number/team-color once per kid; reuse across all reels (highest-leverage piece for retention)

### 3. Screen-Anchored Event Overlays
Not attached to player tracking. Anchored to a corner or center of the frame, triggered at a specific timestamp.

| Overlay | Anchor | Notes |
|---------|--------|-------|
| Score bug | Top-left or top-right | "HOME 2 - 1 AWAY" persistent badge |
| Event badge | Center, brief | "GOAL" / "ASSIST" / "SAVE" with 1.5s entrance animation |
| Match metadata | Bottom strip | "vs Strikers FC - Sep 14" -- opening 2s of clip |
| Time of play | Top corner | "73'" |
| Custom text | User-positioned | Free text, draggable |

### 4. Manual Telestration (recruiting use case)
For the recruiting reel parent who wants to point out a specific moment on a frozen frame.

- Freeze frame + draw: pause clip, draw arrow / circle / line, hold 1-2s, resume
- Single arrow: drag-from-to, animates in
- Manual spotlight: drag-to-position circle, separate from tracked player

### 5. Tracking Robustness
- Re-acquisition: store player appearance embedding (jersey color + number OCR), auto-suggest on re-entry
- Gap bridging: if YOLO drops player for <0.5s, interpolate spline through the gap
- Multi-player tracking: highlight 2+ players simultaneously with independent overlay primitives

### 6. Composition Rules
Stacking order (top to bottom):
1. Spotlight cone (background dim layer)
2. Player overlay primitives (ring/glow/etc.)
3. Player labels (text tags)
4. Screen-anchored badges (event callouts, score bug)
5. Manual telestration (arrows, circles)

Collision: player label auto-flips above/below based on frame edges. Score bug and event badge use opposite corners.

## Suggested Presets

| Preset | Overlays | Use Case |
|--------|----------|----------|
| Spotlight | Pulse ring + player label + score bug | Default for highlights |
| Goal | Spotlight cone 2s + GOAL badge + player label | Goal clips |
| Recruiting | Minimal ring + persistent name/number/position | Clean look for coaches |
| Social | Pulse ring + glow + big broadcast name | TikTok energy |
| Custom | Drops into primitive editor | Power users |

## Technical Notes

- Player Profile data lives at account level, not per-reel. JSON blob with name/number/team color/position per saved kid.
- Tracker improvements (re-acquisition, gap bridging) are highest-impact technical work.
- Event overlays (score bug, event badges) are pure compositing -- no credit cost.
- Manual telestration runs CPU-side (FFmpeg + drawing primitives), no GPU needed.
- OCR on jersey numbers from YOLO bbox could auto-suggest number in profile setup (nice-to-have, not v1).

## Completion Criteria

- [ ] All Phase 1 tasks complete and deployed
- [ ] Presets produce clips visually comparable to professional TikTok soccer edits
- [ ] Player Profile persists across reels (set once, reuse)
- [ ] Tracker re-acquisition reduces manual re-selection friction
- [ ] End-to-end tested: annotate -> frame -> overlay (with new primitives) -> export
