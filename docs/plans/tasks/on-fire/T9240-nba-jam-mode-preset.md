# T9240: "NBA Jam mode" auto-escalation preset + goal burst

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-08
**Updated:** 2026-09-08

Epic 4/6 of [On Fire](EPIC.md). See EPIC.md section D (heat semantics) for the escalation rule and the audio non-goal.

## Problem

Setting each region's heat by hand works but misses the thing that made NBA Jam's fire land: the escalation rule. A reel is already "consecutive plays by one athlete", so the app can tell the story automatically: play 1 normal, play 2 heating up, play 3 and later on fire, burst at each play's end.

## Solution

1. **Preset.** Add "NBA Jam mode" to T2150's preset system. Applying it is ONE gesture that issues one `set_region_heat` per region (through the existing per-entity FIFO action client, so version threading is preserved): region index 0 -> `off`, 1 -> `heating`, 2+ -> `fire`. Regions the user has already set by hand are left alone unless the preset dialog's "reset all" is checked. Removing the preset sets every region to `off`.
2. **Burst.** `heat_placements` (T9210) gains a `burst` emission in the last 0.4 s of a `fire` region, or at an explicit event time when T2140's event badge ("GOAL") sits inside the region. Same three mirrored copies, parity test extended.
3. **Text beat (optional, behind T2130).** When the athlete label overlay exists, the preset also schedules a 1.5 s "{Name} is heating up" / "{Name} is on fire" badge at the start of the heating and first fire regions via T2140's screen-anchored badge. Original copy only; no announcer audio.
4. **Discoverability.** A small "Try NBA Jam mode" chip appears in the settings card only when the reel has 3+ regions and none has heat set; dismissed per view state, never persisted (no persisted view state rule).

## Context

### Relevant Files
- `src/frontend/src/components/OverlaySettingsCard.jsx`, T2150's preset picker component
- `src/frontend/src/hooks/useHighlightRegions.js` (batch apply through the action client)
- `src/frontend/src/utils/heatPlacements.js`, `src/backend/app/services/heat_placements.py`, `video_processing._heat_placements` (burst)
- `src/backend/tests/test_heat_placements.py`

### Related Tasks
- Depends on: T9230 (render), T2150 (presets), T2140 (event badges) for the burst-at-goal and text beat
- Blocks: nothing; T9250/T9260 are independent of the preset

### Technical Notes
- The preset is a client-side gesture that fans out surgical actions; it is NOT a new server-side "apply preset" endpoint and NOT a `working_videos` column. If T2150 lands presets as a stored value, the heat assignment is still derived at apply time, never stored twice.
- Multi-clip attribution: region order == clip order in the concatenated timeline (`concat_offsets`, T4355), so "play N" is just the region's index after sorting by `start_time`.

## Acceptance Criteria

- [ ] Applying the preset on a 3-clip reel yields off / heating / fire with one click and survives reload
- [ ] Burst renders in all three paths in the last 0.4 s of a fire region (parity test extended)
- [ ] With T2140 present, burst aligns to the GOAL badge time instead of the region end
- [ ] Hand-set regions are preserved unless "reset all" is chosen
- [ ] Chip visibility is render-derived; nothing about it is persisted
