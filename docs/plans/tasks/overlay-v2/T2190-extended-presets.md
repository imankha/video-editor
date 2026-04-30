# T2190: Extended Presets

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-04-30
**Updated:** 2026-04-30
**Phase:** 2

## Problem

Phase 1 ships Spotlight, Goal, and Custom presets. Two key audience segments remain unserved: parents making recruiting clips (clean, minimal look for coaches) and parents optimizing for social media virality.

## Solution

Two new presets built on Phase 1 + Phase 2 primitives.

### Recruiting Preset
- Minimal highlight ring (thin, subtle)
- Persistent player label: name / jersey number / position
- No score bug or event badges
- Clean, professional look that college coaches expect

### Social Preset
- Pulse ring + glow aura (double emphasis)
- Player name in big "broadcast" style label
- Maximum TikTok energy
- Bright team colors, high contrast

## Context

### Related Tasks
- Depends on: T2150 (presets system), T2170 (glow + arrow primitives)

## Acceptance Criteria

- [ ] "Recruiting" preset available in preset selector
- [ ] "Social" preset available in preset selector
- [ ] Both presets apply correct overlay combinations
- [ ] Customizable after apply
