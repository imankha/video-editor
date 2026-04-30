# T2150: Overlay Presets System

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

Most parents won't compose overlays from primitives. They need one-click templates that wire up multiple overlays at once. The presets ARE the UX for 90% of users.

## Solution

One-click preset templates that configure multiple overlay primitives simultaneously.

### Phase 1 Presets

| Preset | Overlays | Use Case |
|--------|----------|----------|
| **Spotlight** | Pulse ring + player label + score bug | Default for highlights |
| **Goal** | Spotlight cone 2s + GOAL badge + player label | Goal clips |
| **Custom** | Drops into primitive editor | Power users |

1. **Preset selection UI** -- prominent in overlay editor, shown before primitive editor
2. **One-click apply** -- selecting a preset configures all included overlays with sensible defaults
3. **Customizable after apply** -- user can tweak individual primitives after preset applies
4. **Preset data model** -- preset is a named bundle of overlay primitive configs

### Phase 2 Presets (T2190)
- "Recruiting" -- minimal ring + persistent name/number/position, no score bug
- "Social" -- pulse ring + glow + big broadcast name

## Context

### Relevant Files
- `src/frontend/src/components/overlay/` -- overlay editor UI
- Overlay data model (from T2100)

### Related Tasks
- Depends on: T2100 (architecture), T2120 (pulse ring), T2130 (player label), T2140 (event overlays)
- Extended by: T2190 (Recruiting, Social presets)

### Technical Notes
- Presets are frontend-only constructs -- they expand into individual primitives on apply. Backend stores the primitives, not the preset name.
- Consider storing "last used preset" per user for smart defaults.
- The Goal preset depends on spotlight cone (T2210, Phase 3). For Phase 1, substitute with a desaturate + vignette effect as a simpler approximation.

## Acceptance Criteria

- [ ] Preset selector UI in overlay editor
- [ ] "Spotlight" preset applies pulse ring + player label + score bug
- [ ] "Goal" preset applies highlight effect + GOAL badge + player label
- [ ] "Custom" drops into primitive editor
- [ ] Presets apply sensible defaults (colors, timing, positioning)
- [ ] User can customize individual primitives after preset apply
- [ ] Preset selection is the primary entry point (not primitive editor)
