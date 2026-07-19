# T5470: Annotate Activity Layer

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-19

## Problem

The movement profile exists (T5460) but annotators can't see it. They need, directly over the Annotate timeline, an at-a-glance answer to "where is the action?": an activity curve whose y value is proportional to movement at that frame, with dead and empty stretches visually distinct — so they can scrub straight past throw-in walks and halftime even before smart playback (T5480) exists. See [EPIC.md](EPIC.md) smart-playback-semantics section for the visual spec.

## Solution

Fetch the game's movement profile once at game load (404 → layer simply absent, no fallback data); render an area-sparkline layer in the Annotate timeline (y ∝ score, per-game-normalized 0–255 so full y-range always used), tint `DEAD` spans, hatch `EMPTY` spans, with a layer toggle. Pure read-only derived display — no persistence of any kind.

## Context

### Relevant Files (REQUIRED)
(confirm exact seams at task start via `.claude/knowledge/annotate.md` — load it before exploring)
- `src/frontend/src/screens/AnnotateScreen.jsx` — profile fetch on game load; layer mount
- `src/frontend/src/components/annotate/Timeline.jsx` — the annotate timeline the layer overlays
- `src/frontend/src/components/annotate/` — new `ActivityLayer.jsx`: canvas or SVG sparkline + state-span tinting, downsampled to visible px width
- `src/frontend/src/api/` — client for `GET /api/games/{game_id}/movement` (T5460)
- New unit tests + one e2e (layer renders for a game with a profile; absent without)

### Related Tasks
- Depends on: T5460 (endpoint + artifact). Wire to its exact response shape: `{sample_hz, scores: uint8[], states: [{t0,t1,state}]}`
- Blocks: T5480 (smart playback reuses the fetched profile from the same store slice)

### Technical Notes
- **State**: profile lives in the annotate store/hook as loaded server data (single fetch per game, cached for the session). It is NOT user state — never persisted, never watched by any effect that writes (persistence rules). No redundant derived state: DEAD/EMPTY spans come from `states` directly; the sparkline reads `scores`.
- **Rendering**: canvas is the safe choice for a 10k-point series; downsample (max-pool per pixel column, not average — spikes must stay visible; a goal is a spike). Must not degrade timeline scrub performance — the layer redraws only on resize/zoom, not on playhead move.
- **Visual spec**: subtle area fill under the existing annotation markers (annotations stay the dominant layer); `DEAD` tint and `EMPTY` hatch per UI style guide colors; toggle in the timeline controls. UI Designer agent pass required (new visual element in the app's most-used screen) — must match `.claude/references/ui-style-guide.md`.
- **Empty/missing cases**: no profile → no layer, no placeholder, no error toast (feature is opt-in; absence is normal). Profile `failed` status → same as absent (debug detail lives in admin, not here).
- **Layer visibility preference**: the on/off toggle is a real preference iff we persist it — per the no-persisted-view-state rule, default ON each session and do NOT persist the toggle initially.

## Implementation

### Steps
1. [ ] Load annotate knowledge doc; confirm timeline component seams + store shape
2. [ ] UI Designer pass: sparkline style, tints, toggle placement (approval gate)
3. [ ] API client + store slice (fetch on game load, session cache)
4. [ ] `ActivityLayer` canvas component + downsampling; wire into Timeline
5. [ ] Toggle control; unit tests; e2e with a seeded profile
6. [ ] Verify with a real staging game that has a profile (drive-app-as-user)

### Progress Log

**2026-07-19**: Task created.

## Acceptance Criteria

- [ ] Game with a profile shows the activity curve over the Annotate timeline; y tracks the score; DEAD/EMPTY visually distinct
- [ ] Game without a profile renders identically to today (no layer, no errors)
- [ ] No new persistence calls of any kind (verify network tab during a full annotate session)
- [ ] Timeline scrub/zoom performance unchanged (no per-playhead-frame redraws)
- [ ] Unit + e2e tests pass; verified in a real browser on staging
