# T9220: Per-region heat level: data key, action, settings UI

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-08
**Updated:** 2026-09-08

Epic 2/6 of [On Fire](EPIC.md). See EPIC.md for design constraints (gesture persistence, additive region key, no new Postgres state).

## Problem

Every overlay style knob today is a `working_videos` column, one value per reel. Fire is a per-play choice (play 3 is on fire, play 1 is not), so this is the first per-region style field. It needs a home in the data, a surgical action, and a control in the settings card.

## Solution

1. **Data.** Additive key on the region dict inside `highlights_data`: `heat: "off" | "heating" | "fire"`. Absent key reads as `off`. No migration (T4355 `transition` key precedent). `_normalize_region_keys` in `overlay.py` fills the default at the single DB-read boundary so no downstream reader needs `.get()`.
2. **Action.** `set_region_heat` in `overlay_action` (`overlay.py`), payload `{region_id, level}`, validated against the 3-value enum in `app/constants.py` (mirrored in `src/frontend/src/constants/heatLevels.js`), falls through to the shared `_save_overlay_data` path with the `overlay_version` bump and 409 CAS check like every highlight action.
3. **Frontend.** `overlayActions.setRegionHeat` through `api/actionClient.js`; `useHighlightRegions.setRegionHeat(id, level)` updates the region in memory; a three-button segmented control ("Off / Heating up / On fire") in `OverlaySettingsCard.jsx`, scoped to the ACTIVE region (the one `OverlayModeView` already resolves for `spotlightReveal`). Empty state copy updates to mention fire.
4. **Read path.** `GET /overlay-data` returns the key; `restoreRegions` carries it through unchanged.

## Context

### Relevant Files
- `src/backend/app/routers/export/overlay.py` - `overlay_action` dispatch, `_normalize_region_keys`, `get_overlay_data`
- `src/backend/app/constants.py` - `HeatLevel` enum
- `src/frontend/src/constants/heatLevels.js` (new)
- `src/frontend/src/api/overlayActions.js`, `src/frontend/src/api/actionClient.js`
- `src/frontend/src/hooks/useHighlightRegions.js`
- `src/frontend/src/components/OverlaySettingsCard.jsx`, `src/frontend/src/modes/OverlayModeView.jsx`
- `src/backend/tests/test_overlay_actions.py`, `src/frontend/src/hooks/useHighlightRegions.persistence.test.js`

### Related Tasks
- Depends on: T9210 (enum values must match the placement spec's levels)
- Blocks: T9230
- Landmine: T7180 (bug 44p). Any new region write site must write snake_case bounds and pop camelCase; `set_region_heat` only touches `heat`, but the test must prove it leaves `start_time`/`end_time` untouched.

### Technical Notes
- Do NOT add a `working_videos` column for this. The reel-level "NBA Jam mode" is a preset (T9240 via T2150), not a column.
- Highlight carry-forward (T4350/T4355) copies region dicts verbatim across a framing re-export, so the `heat` key survives for free; add one assertion to `test_highlight_carry.py`.

## Acceptance Criteria

- [ ] `set_region_heat` persists the level, bumps `overlay_version`, rejects unknown values with 400
- [ ] `GET /overlay-data` returns `heat` for every region, defaulting to `off` for legacy rows
- [ ] Settings card control changes the active region only and round-trips a reload
- [ ] No `useEffect` writes; the only write is the click handler
- [ ] Carry-forward preserves the key across a framing re-export
