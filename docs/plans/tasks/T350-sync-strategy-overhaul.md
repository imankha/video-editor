# T350: Sync Strategy Overhaul — DB Writes Only on User Gestures

**Status:** DONE
**Impact:** 9
**Complexity:** 6
**Created:** 2026-03-06

## Problem

FramingScreen has a reactive sync effect (lines 649-672) that watches `keyframes`, `segmentBoundaries`, `segmentSpeeds`, and `trimRange` — writing back to the store on **every change**, including internal modifications that have no user gesture behind them.

This creates a feedback loop:
1. Load clip from DB → restore keyframes → `ensurePermanentKeyframes` adds frame 0 / fixes origins
2. Sync effect detects keyframes changed → writes modified state back to store/DB
3. Next load → restores corrupted data → origin correction runs again → repeat

Observable symptoms:
- Boundary keyframe origins corrupted ('permanent' → 'user') after load cycles
- Duplicate keyframes created at boundaries (frame 0 reconstituted, then saved, then loaded with extra keyframe)
- `[CropLayer] Boundary keyframe at frame N has origin 'user' instead of 'permanent'` warnings on every render

### Root Cause

Two sync paths exist for the same data:
1. **Gesture-based API calls** in FramingContainer (correct) — crop change, trim, keyframe add/delete each fire a backend action
2. **Reactive sync effect** in FramingScreen (incorrect) — watches state and writes back on any change

This violates the CLAUDE.md rule: "Don't add multiple save effects for the same data."

## Solution

### Principle: DB writes only on user gestures

The app should NEVER write to the database as a side effect of internal state modifications. Only explicit user actions (crop drag, keyframe add/delete, trim toggle, speed change) should trigger persistence. Internal state fixups (ensurePermanentKeyframes, origin correction, restore normalization) are runtime-only and must not round-trip through the DB.

### Implementation

1. **Remove the reactive sync effect** in FramingScreen (lines 649-672)
2. **Verify gesture-based sync** covers all user actions:
   - `handleCropComplete` → `addCropKeyframe` API call (already exists)
   - `handleKeyframeDelete` → `deleteCropKeyframe` API call (already exists)
   - `handleTrimSegment` / `handleDetrimStart` / `handleDetrimEnd` → `setTrimRange` API call (already exists)
   - `handleSegmentSpeedChange` → needs verification
   - `handleAddSplit` / `handleRemoveSplit` → needs verification
3. **Clip switching save** — `saveCurrentClipState` in FramingContainer already handles this explicitly
4. **Codify the sync strategy** in:
   - `CLAUDE.md` — add sync strategy section
   - `.claude/skills/state-management/SKILL.md` — add persistence rules
   - `.claude/references/coding-standards.md` — add sync anti-patterns

### Sync Strategy Rules (to codify)

1. **Gesture → API**: Every user action that modifies persistent state must fire a backend API call directly from the gesture handler
2. **No reactive persistence**: Never use `useEffect` to watch state and write it back to DB/store
3. **Runtime-only fixups**: Internal state corrections (ensurePermanentKeyframes, origin normalization) happen in memory only — they don't persist
4. **Restore is read-only**: Loading data from DB into state must not trigger a write-back
5. **Single write path**: Each piece of data has exactly ONE code path that writes it to the backend

## Key Files

- `src/frontend/src/screens/FramingScreen.jsx` — Reactive sync effect to remove (lines 649-672)
- `src/frontend/src/containers/FramingContainer.jsx` — Gesture-based API calls (already correct)
- `src/frontend/src/modes/framing/hooks/useCrop.js` — Restore path (should not trigger writes)
- `CLAUDE.md` — Add sync strategy section
- `.claude/skills/state-management/SKILL.md` — Add persistence rules
- `.claude/references/coding-standards.md` — Add sync anti-patterns
- `src/frontend/CLAUDE.md` — Already has "Don't add multiple save effects" rule

## Acceptance Criteria

- [ ] Reactive sync effect removed from FramingScreen
- [ ] All user gestures verified to have direct API call paths
- [ ] Loading a clip does NOT write anything back to DB
- [ ] `ensurePermanentKeyframes` modifications don't persist unless user edits
- [ ] No `[CropLayer] Boundary keyframe...` warnings after page reload
- [ ] Sync strategy documented in CLAUDE.md, skills, and coding standards
- [ ] Existing tests pass
- [ ] Manual test: load clip → switch away → switch back → keyframes unchanged in DB
